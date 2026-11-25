import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";
import { CLIPBOARD_FORMAT, MAX_CLIPBOARD_BYTES } from "@novaloom/board-engine/clipboard";
import { checkImageFile, isAssetId, looksLikePdf, MAX_IMAGE_BYTES, MAX_PDF_BYTES, sniffImageMime } from "@novaloom/board-engine/assets";
import type { AppCommand, AppMenu, NativeEdit, WindowAction, WindowState } from "@novaloom/board-engine/persist";
import {
  validateOps,
  validateProps,
  type MainSaveStatus,
  type MenuCommand,
  type OpenBoardPayload,
  type ExportFormat,
  type ImportedImage,
  type RecoveryNotice,
  type SnapshotRequest,
  type StoredObject,
} from "@novaloom/board-engine/persist";
import { BoardFile, FILE_EXT, Journal, Library, replayEntries, type OpenedBoard, type SaveStatus } from "@novaloom/board-store";

// A packaged app always loads its own files, whatever the environment says.
const DEV_URL = app.isPackaged ? undefined : process.env.NLB_DEV_URL;
const APP_NAME = "NovaLoomBoard";
/** Automatic snapshot after this much time with unsnapshotted changes. */
const SNAPSHOT_INTERVAL_MS = 10 * 60_000;
/** PASSIVE checkpoint after this long without commits. */
const IDLE_CHECKPOINT_MS = 30_000;
/** How long the window gets to hand over its last changes before closing anyway. */
const FLUSH_TIMEOUT_MS = 3_000;
const FILE_FILTERS = [{ name: "NovaLoomBoard files", extensions: [FILE_EXT.slice(1)] }];
/** Opening also offers every file: boards are recognised by their header, not their extension. */
const OPEN_FILTERS = [...FILE_FILTERS, { name: "All files", extensions: ["*"] }];
const IMAGE_FILTERS = [{ name: "Images (PNG, JPEG, WebP)", extensions: ["png", "jpg", "jpeg", "webp"] }];
/** Files accepted in one Import images operation. */
const MAX_IMPORT_FILES = 50;
/** Largest PDF document the window may hand over for printing. */
const MAX_PDF_HTML_CHARS = 512 * 1024 * 1024;

app.setName(APP_NAME);
if (app.isPackaged) {
  // Development switches have no place in the released app (--inspect and friends are
  // also refused by the executable's fuses; see scripts/package.mjs).
  for (const s of ["remote-debugging-port", "remote-debugging-pipe", "remote-allow-origins", "inspect", "inspect-brk", "inspect-port", "js-flags"]) {
    app.commandLine.removeSwitch(s);
  }
}
// Every renderer runs sandboxed, including windows created later (the PDF printer).
app.enableSandbox();
// Only one instance may own the board files; a second launch focuses the first.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

interface Current {
  board: OpenedBoard;
  journal: Journal;
  /** Changes committed since the last snapshot. */
  unsnapshotted: boolean;
  lastSnapshotAt: number;
}

let library: Library;
let win: BrowserWindow | null = null;
let current: Current | null = null;
let pendingNotice: RecoveryNotice | undefined;
let allowClose = false;
let closing = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let flushSeq = 0;
/** The path the user chose in the last export dialog: the only place an export may be written. */
let exportPath: string | null = null;
/** The last file exported, which "Show in folder" may reveal. */
let lastExported: string | null = null;
const flushWaiters = new Map<number, () => void>();

// ---------- board lifecycle ----------

function openBoard(id: string): void {
  const board = library.openBoard(id);
  pendingNotice = undefined;
  if (board.recovery) {
    const r = board.recovery;
    pendingNotice =
      r.kind === "unclean-exit"
        ? { kind: r.kind, lastSavedAt: r.lastSavedAt }
        : r.kind === "restored-snapshot"
          ? { kind: r.kind, snapshotAt: r.snapshotAt, damagedPath: r.damagedPath }
          : { kind: r.kind, damagedPath: r.damagedPath };
    if (r.kind !== "unclean-exit") console.warn("[storage] board recovered:", r.kind, r.problems);
  }
  const journal = new Journal({
    lastSeq: board.meta.lastAppliedSeq,
    commit: (entries) => {
      board.file.commit(entries);
      if (current) current.unsnapshotted = true;
      scheduleIdleCheckpoint();
    },
    onStatus: (status: SaveStatus, error?: Error) => sendStatus({ status, error: error?.message }),
  });
  current = { board, journal, unsnapshotted: false, lastSnapshotAt: Date.now() };
}

/**
 * Opens the board used last, or a new one. When the last board cannot be
 * opened now (saved by a newer version, locked by another program), its file
 * is left as it is, a new board is started and the user is told why.
 */
function openStartBoard(): void {
  const last = library.lastBoardId;
  if (last) {
    try {
      openBoard(last);
      return;
    } catch (err) {
      console.error("[storage] could not open the last board:", err);
      openBoard(library.createBoard());
      pendingNotice = { kind: "open-failed", message: (err as Error).message };
      return;
    }
  }
  openBoard(library.createBoard());
}

/** Commits everything and closes the current board. Returns false if changes could not be written. */
function closeCurrent(): boolean {
  if (!current) return true;
  const c = current;
  if (!c.journal.flush()) return false;
  if (c.unsnapshotted) {
    try {
      library.snapshot(c.board, "close");
    } catch (err) {
      console.error("[storage] close snapshot failed:", err);
    }
  }
  c.journal.dispose();
  try {
    library.closeBoard(c.board);
  } catch (err) {
    console.error("[storage] close failed:", err);
    c.board.file.close();
  }
  current = null;
  return true;
}

/** Closes without writing pending changes (the user chose "Quit without saving"). */
function discardCurrent(): void {
  if (!current) return;
  current.journal.dispose();
  try {
    library.closeBoard(current.board);
  } catch {
    current.board.file.close();
  }
  current = null;
}

function scheduleIdleCheckpoint(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    try {
      current?.board.file.checkpoint("PASSIVE");
    } catch (err) {
      console.error("[storage] checkpoint failed:", err);
    }
  }, IDLE_CHECKPOINT_MS);
}

function maybeAutoSnapshot(): void {
  const c = current;
  if (!c || !c.unsnapshotted || Date.now() - c.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
  if (!c.journal.flush()) return;
  try {
    library.snapshot(c.board, "auto");
    c.unsnapshotted = false;
    c.lastSnapshotAt = Date.now();
  } catch (err) {
    console.error("[storage] automatic snapshot failed:", err);
  }
}

/** The open board as the window should show it, including changes not yet committed. */
function boardPayload(): OpenBoardPayload {
  const c = current!;
  c.journal.flush();
  const { meta, objects } = replayEntries(c.board.file.readMeta(), c.board.file.readObjects(), c.journal.pendingEntries);
  const byPage = new Map<string, StoredObject[]>(meta.pages.map((p) => [p.id, []]));
  for (const { page, ...o } of objects) byPage.get(page)?.push(o);
  return {
    boardId: meta.boardId,
    title: meta.title,
    pages: meta.pages.map((p) => ({ id: p.id, name: p.name, background: p.background, view: p.view, objects: byPage.get(p.id)! })),
    activePage: meta.activePage,
    notice: pendingNotice,
  };
}

// ---------- window <-> main ----------

function sendStatus(status: MainSaveStatus): void {
  win?.webContents.send("nlb:save-status", status);
}

function sendMenu(command: MenuCommand): void {
  win?.webContents.send("nlb:menu", command);
}

/** Asks the window to hand over everything it has; resolves when done or after a timeout. */
function requestFlush(): Promise<void> {
  if (!win || win.webContents.isCrashed() || win.webContents.isLoading()) return Promise.resolve();
  const id = ++flushSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      flushWaiters.delete(id);
      console.warn("[storage] window did not confirm flush in time");
      resolve();
    }, FLUSH_TIMEOUT_MS);
    flushWaiters.set(id, () => {
      clearTimeout(timer);
      resolve();
    });
    win!.webContents.send("nlb:flush-request", id);
  });
}

/** True for messages from the board window's own top-level page (not a frame, not another window). */
function fromMainWindow(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  if (!win || e.sender !== win.webContents) return false;
  const frame = e.senderFrame;
  return !!frame && !frame.parent && isAppUrl(frame.url);
}

/** The app's own pages: the bundled files, or the Vite server in development. */
function isAppUrl(url: string): boolean {
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file:");
}

const SNAPSHOT_REQUESTS: readonly SnapshotRequest[] = ["before-clear", "before-delete-page"];

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** Writes a file via a temporary file in the same folder, so a failure never leaves half a file. */
async function writeFileSafely(dest: string, data: Uint8Array): Promise<void> {
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Reads, checks and stores image files (from the Import images dialog, or
 * copied in Explorer and pasted). Same rules for every source.
 */
async function importImageFiles(files: readonly string[]): Promise<ImportedImage[]> {
  if (!current) throw new Error("no board is open");
  const out: ImportedImage[] = [];
  for (const [n, file] of files.entries()) {
    const name = path.basename(file);
    if (n >= MAX_IMPORT_FILES) {
      out.push({ name, error: `only ${MAX_IMPORT_FILES} images can be imported at once` });
      continue;
    }
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw new Error("it is not a file");
      // Refuse oversized files before reading them.
      if (stat.size > MAX_IMAGE_BYTES) throw new Error(`the file is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
      const data = new Uint8Array(await fs.promises.readFile(file));
      const check = checkImageFile(data);
      if ("error" in check) throw new Error(check.error);
      const id = sha256(data);
      current.board.file.putAsset(id, check.mime, data);
      out.push({ name, asset: { id, mime: check.mime, data } });
    } catch (err) {
      out.push({ name, error: (err as Error).message });
    }
  }
  return out;
}

/** Reads a PDF chosen by the user (dialog or pasted file): size and signature checked. */
async function readPdfFile(file: string): Promise<{ name: string; data: Uint8Array } | { name: string; error: string }> {
  const name = path.basename(file);
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) throw new Error("it is not a file");
    if (stat.size === 0) throw new Error("the file is empty");
    if (stat.size > MAX_PDF_BYTES) throw new Error(`the file is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB`);
    const data = new Uint8Array(await fs.promises.readFile(file));
    if (!looksLikePdf(data)) throw new Error("it is not a PDF document");
    return { name, data };
  } catch (err) {
    return { name, error: (err as Error).message };
  }
}

/** Local files in a text/uri-list (what Explorer offers for Ctrl+C on files). */
function filesFromUriList(list: string): string[] {
  return list
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && /^file:/i.test(l))
    .map((l) => {
      try {
        return fileURLToPath(l);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

/** Takes the chosen export path, refusing any other (the window cannot write where the user did not choose). */
function takeExportPath(requested: unknown): string {
  if (typeof requested !== "string" || requested !== exportPath) throw new Error("not allowed");
  exportPath = null;
  return requested;
}

/**
 * Prints an HTML document to PDF in a hidden window that runs no scripts and
 * can load nothing but the document itself (its images are inline).
 */
async function printHtmlToPdf(html: string): Promise<Uint8Array> {
  const tmp = path.join(os.tmpdir(), `novaloomboard-export-${randomUUID()}.html`);
  await fs.promises.writeFile(tmp, html, "utf8");
  const printer = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, devTools: false },
  });
  try {
    printer.webContents.on("will-navigate", (e) => e.preventDefault());
    printer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    printer.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    await printer.loadFile(tmp);
    const pdf = await printer.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return new Uint8Array(pdf);
  } finally {
    printer.destroy();
    await fs.promises.rm(tmp, { force: true });
  }
}

function registerIpc(): void {
  ipcMain.handle("nlb:load", (e) => {
    if (!fromMainWindow(e)) throw new Error("not allowed");
    if (!current) openStartBoard();
    // The notice stays until dismissed, so a reload (or a second mount in dev) still shows it.
    return boardPayload();
  });

  ipcMain.handle("nlb:save", (e, rawOps: unknown, rawProps: unknown) => {
    if (!fromMainWindow(e) || !current) throw new Error("not allowed");
    const ops = validateOps(rawOps);
    const props = validateProps(rawProps);
    current.journal.add(ops, props);
    if (props?.title) library.touch({ ...current.board.file.readMeta(), title: props.title });
  });

  ipcMain.handle("nlb:snapshot", (e, reason: unknown) => {
    if (!fromMainWindow(e) || !current || !SNAPSHOT_REQUESTS.includes(reason as SnapshotRequest)) throw new Error("not allowed");
    if (!current.journal.flush()) throw new Error("changes could not be saved");
    library.snapshot(current.board, reason as SnapshotRequest);
  });

  ipcMain.on("nlb:window", (e, action: WindowAction) => {
    if (!fromMainWindow(e) || !win) return;
    if (action === "minimize") win.minimize();
    else if (action === "toggle-maximize") {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "close") win.close();
  });

  ipcMain.on("nlb:menu-popup", (e, menu: AppMenu, x: number, y: number) => {
    if (!fromMainWindow(e) || !win || !["file", "edit", "page", "view"].includes(menu)) return;
    const popup = Menu.buildFromTemplate(menuTemplate(menu));
    popup.popup({
      window: win,
      x: Math.round(Number(x) || 0),
      y: Math.round(Number(y) || 0),
      callback: () => win?.webContents.send("nlb:menu-closed", menu),
    });
  });

  ipcMain.on("nlb:command", (e, command: AppCommand) => {
    if (fromMainWindow(e)) runCommand(command);
  });

  const NATIVE_EDITS: readonly NativeEdit[] = ["undo", "redo", "cut", "copy", "paste", "selectAll"];
  ipcMain.on("nlb:native-edit", (e, command: NativeEdit) => {
    if (fromMainWindow(e) && NATIVE_EDITS.includes(command)) win!.webContents[command]();
  });

  // Board objects go on the system clipboard under a private format, so copies
  // survive switching boards and restarting, and a later copy elsewhere replaces them.
  ipcMain.handle("nlb:clipboard-write", async (e, data: unknown, text: unknown, png: unknown) => {
    if (!fromMainWindow(e) || typeof data !== "string" || data.length > MAX_CLIPBOARD_BYTES) throw new Error("not allowed");
    const items: Record<string, string | Blob> = { [CLIPBOARD_FORMAT]: new Blob([data], { type: CLIPBOARD_FORMAT }) };
    if (typeof text === "string" && text) items["text/plain"] = text.slice(0, 1_000_000);
    // A picture of the selection, for pasting into other programs: only a real PNG of a sane size.
    if (png instanceof Uint8Array && png.length > 8 && png.length <= MAX_IMAGE_BYTES && sniffImageMime(png) === "image/png") {
      items["image/png"] = new Blob([png as BlobPart], { type: "image/png" });
    }
    await clipboard.write([new ClipboardItem(items)]);
  });

  // ---------- versions (snapshots of the open board) ----------

  const versionPath = (at: unknown): string => {
    if (!current || typeof at !== "number") throw new Error("not allowed");
    const s = library.listSnapshots(current.board.id).find((v) => v.createdAt === at);
    if (!s) throw new Error("that version no longer exists");
    return s.path;
  };

  ipcMain.handle("nlb:versions-list", (e) => {
    if (!fromMainWindow(e) || !current) throw new Error("not allowed");
    return library.listSnapshots(current.board.id).map((s) => ({ at: s.createdAt, reason: s.reason }));
  });

  ipcMain.handle("nlb:versions-preview", (e, at: unknown) => {
    if (!fromMainWindow(e)) throw new Error("not allowed");
    const f = BoardFile.open(versionPath(at), { readOnly: true });
    try {
      const meta = f.readMeta();
      const objects = f.readObjects();
      const page = meta.pages.find((p) => p.id === meta.activePage) ?? meta.pages[0];
      if (!page) return null;
      return {
        title: meta.title,
        pageCount: meta.pages.length,
        objectCount: objects.length,
        page: { id: page.id, name: page.name, background: page.background, view: page.view, objects: objects.filter((o) => o.page === page.id).map(({ page: _p, ...o }) => o) },
      };
    } finally {
      f.close();
    }
  });

  ipcMain.handle("nlb:versions-open", async (e, at: unknown) => {
    if (!fromMainWindow(e) || !current) throw new Error("not allowed");
    const src = versionPath(at);
    const title = current.board.file.readMeta().title;
    const when = new Date(at as number).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const id = library.importCopy(src, `${title} (${when})`);
    await switchBoard(() => id);
  });

  ipcMain.handle("nlb:versions-save", async (e) => {
    if (!fromMainWindow(e) || !current) throw new Error("not allowed");
    await requestFlush();
    if (!current.journal.flush()) throw new Error("the latest changes could not be saved");
    library.snapshot(current.board, "manual");
  });

  ipcMain.handle("nlb:clipboard-read", async (e) => {
    if (!fromMainWindow(e)) throw new Error("not allowed");
    const items = await clipboard.read();
    for (const item of items) {
      if (!item.types.includes(CLIPBOARD_FORMAT)) continue;
      const blob = (await item.getType(CLIPBOARD_FORMAT)) as Blob;
      if (blob.size > 0 && blob.size <= MAX_CLIPBOARD_BYTES) return { board: await blob.text() };
    }
    const text = await clipboard.readText();
    if (text) return { text: text.slice(0, 100_000) };
    // No text: an image (screenshot, copied picture) is offered as PNG; validated again when stored.
    for (const item of items) {
      if (!item.types.includes("image/png")) continue;
      const blob = (await item.getType("image/png")) as Blob;
      if (blob.size > 0 && blob.size <= MAX_IMAGE_BYTES) return { image: new Uint8Array(await blob.arrayBuffer()) };
    }
    // Files copied in Explorer: image files are imported (same checks as the dialog); a PDF opens the PDF import.
    for (const item of items) {
      if (!item.types.includes("text/uri-list")) continue;
      const files = filesFromUriList(await ((await item.getType("text/uri-list")) as Blob).text());
      const pdf = files.find((f) => /\.pdf$/i.test(f));
      if (pdf) return { pdf: await readPdfFile(pdf) };
      if (files.length) return { files: await importImageFiles(files) };
    }
    return {};
  });

  // ----- import / export -----

  ipcMain.handle("nlb:import-images", async (e): Promise<ImportedImage[] | null> => {
    if (!fromMainWindow(e) || !win || !current) throw new Error("not allowed");
    const res = await dialog.showOpenDialog(win, { title: "Import images", filters: IMAGE_FILTERS, properties: ["openFile", "multiSelections"] });
    if (res.canceled || !res.filePaths.length) return null;
    return importImageFiles(res.filePaths);
  });

  ipcMain.handle("nlb:open-pdf", async (e) => {
    if (!fromMainWindow(e) || !win) throw new Error("not allowed");
    const res = await dialog.showOpenDialog(win, {
      title: "Import PDF",
      filters: [{ name: "PDF documents", extensions: ["pdf"] }],
      properties: ["openFile"],
    });
    const file = res.filePaths[0];
    if (res.canceled || !file) return null;
    return readPdfFile(file);
  });

  ipcMain.handle("nlb:read-asset", (e, id: unknown) => {
    if (!fromMainWindow(e) || !current || !isAssetId(id)) throw new Error("not allowed");
    return current.board.file.getAsset(id);
  });

  ipcMain.handle("nlb:store-asset", (e, asset: unknown) => {
    if (!fromMainWindow(e) || !current) throw new Error("not allowed");
    const data = (asset as { data?: unknown })?.data;
    if (!(data instanceof Uint8Array)) throw new Error("invalid image");
    const check = checkImageFile(data);
    if ("error" in check) throw new Error(check.error);
    const id = sha256(data);
    current.board.file.putAsset(id, check.mime, data);
    return id;
  });

  ipcMain.handle("nlb:choose-export-path", async (e, format: unknown, suggested: unknown) => {
    if (!fromMainWindow(e) || !win || (format !== "png" && format !== "pdf")) throw new Error("not allowed");
    const fmt = format as ExportFormat;
    const name = sanitizeFileName(typeof suggested === "string" ? suggested : "Board");
    const res = await dialog.showSaveDialog(win, {
      title: fmt === "png" ? "Export page as PNG" : "Export as PDF",
      defaultPath: path.join(app.getPath("documents"), `${name}.${fmt}`),
      filters: [fmt === "png" ? { name: "PNG image", extensions: ["png"] } : { name: "PDF document", extensions: ["pdf"] }],
    });
    exportPath = res.canceled || !res.filePath ? null : res.filePath;
    return exportPath;
  });

  ipcMain.handle("nlb:write-export", async (e, dest: unknown, data: unknown) => {
    if (!fromMainWindow(e) || !(data instanceof Uint8Array)) throw new Error("not allowed");
    const file = takeExportPath(dest);
    await writeFileSafely(file, data);
    lastExported = file;
  });

  ipcMain.handle("nlb:export-pdf", async (e, dest: unknown, html: unknown) => {
    if (!fromMainWindow(e) || typeof html !== "string" || html.length > MAX_PDF_HTML_CHARS) throw new Error("not allowed");
    const file = takeExportPath(dest);
    const pdf = await printHtmlToPdf(html);
    await writeFileSafely(file, pdf);
    lastExported = file;
    return { bytes: pdf.byteLength };
  });

  ipcMain.on("nlb:show-in-folder", (e, file: unknown) => {
    if (fromMainWindow(e) && typeof file === "string" && file === lastExported) shell.showItemInFolder(file);
  });

  ipcMain.handle("nlb:window-state", (e) => {
    if (!fromMainWindow(e) || !win) throw new Error("not allowed");
    return { maximized: win.isMaximized(), fullScreen: win.isFullScreen(), focused: win.isFocused() } satisfies WindowState;
  });

  ipcMain.on("nlb:dismiss-notice", (e) => {
    if (fromMainWindow(e)) pendingNotice = undefined;
  });

  ipcMain.on("nlb:flush-done", (e, id: number) => {
    if (!fromMainWindow(e)) return;
    flushWaiters.get(id)?.();
    flushWaiters.delete(id);
  });
}

// ---------- commands ----------

async function switchBoard(pickId: () => string | null): Promise<void> {
  if (closing) return;
  await requestFlush();
  if (!closeCurrent()) {
    dialog.showErrorBox(APP_NAME, "Your latest changes could not be saved, so the board was not switched. Try again, or use File > Save a copy as.");
    return;
  }
  let failure: RecoveryNotice | undefined;
  try {
    const id = pickId();
    if (id) openBoard(id);
  } catch (err) {
    failure = { kind: "open-failed", message: (err as Error).message };
  }
  if (!current) openStartBoard();
  if (failure) pendingNotice = failure;
  win?.webContents.reload();
}

async function openFromFile(): Promise<void> {
  if (!win) return;
  const res = await dialog.showOpenDialog(win, { title: "Open board", filters: OPEN_FILTERS, properties: ["openFile"] });
  const src = res.filePaths[0];
  if (res.canceled || !src) return;
  let id: string;
  try {
    id = library.importCopy(src);
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `This file could not be opened: ${(err as Error).message}`);
    return;
  }
  await switchBoard(() => id);
}

/** Returns true when a copy was written. */
async function saveCopyAs(): Promise<boolean> {
  if (!win || !current) return false;
  await requestFlush();
  const c = current;
  const title = c.board.file.readMeta().title;
  const res = await dialog.showSaveDialog(win, {
    title: "Save a copy",
    defaultPath: path.join(app.getPath("documents"), `${sanitizeFileName(title)}${FILE_EXT}`),
    filters: FILE_FILTERS,
  });
  if (res.canceled || !res.filePath) return false;
  try {
    c.journal.flush();
    library.exportCopy(c.board, res.filePath, c.journal.pendingEntries);
    return true;
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `The copy could not be saved: ${(err as Error).message}`);
    return false;
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100) || "Board";
}

/** Window close: collect the last changes, commit, and only then close. */
async function requestClose(): Promise<void> {
  if (closing || !win) return;
  closing = true;
  try {
    await requestFlush();
    for (;;) {
      if (closeCurrent()) break;
      const error = current?.journal.error?.message ?? "unknown error";
      const choice = dialog.showMessageBoxSync(win, {
        type: "warning",
        title: APP_NAME,
        message: "Some changes could not be saved.",
        detail: `${error}\n\nYou can save a copy of the board, including these changes, somewhere else.`,
        buttons: ["Save a copy elsewhere…", "Retry", "Quit without saving"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice === 0) {
        if (await saveCopyAs()) {
          discardCurrent();
          break;
        }
        continue;
      }
      if (choice === 1) continue;
      const sure = dialog.showMessageBoxSync(win, {
        type: "warning",
        title: APP_NAME,
        message: "Quit and lose the unsaved changes?",
        buttons: ["Quit without saving", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (sure === 0) {
        discardCurrent();
        break;
      }
    }
    allowClose = true;
    win.close();
  } finally {
    closing = false;
  }
}

/**
 * The window has no native menu bar (custom title bar), so these menus open
 * as native popups from the title bar. Accelerators are shown as hints only;
 * the window handles the keys itself so nothing fires twice.
 */
function menuTemplate(menu: AppMenu): MenuItemConstructorOptions[] {
  const hint = (accelerator: string) => ({ accelerator, registerAccelerator: false });
  // The window decides what these act on (board objects, a text field, the current page).
  const item = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? hint(accelerator) : {}),
    click: () => sendMenu(command),
  });
  if (menu === "file") {
    const recent = library.recent().filter((r) => r.id !== current?.board.id);
    return [
      { label: "&New board", ...hint("CmdOrCtrl+N"), click: () => runCommand("new-board") },
      { label: "&Open…", ...hint("CmdOrCtrl+O"), click: () => runCommand("open") },
      {
        label: "Open &recent",
        enabled: recent.length > 0,
        submenu: recent.length
          ? recent.map((r) => ({ label: r.title.replace(/&/g, "&&"), click: () => void switchBoard(() => r.id) }))
          : [{ label: "No recent boards", enabled: false }],
      },
      { type: "separator" },
      { label: "Save a &copy as…", ...hint("CmdOrCtrl+Shift+S"), click: () => runCommand("save-copy") },
      { type: "separator" },
      item("&Import images…", "import-images", "CmdOrCtrl+I"),
      item("Import P&DF…", "import-pdf"),
      item("Export page as P&NG…", "export-png", "CmdOrCtrl+Shift+E"),
      item("&Export as PDF…", "export-pdf", "CmdOrCtrl+E"),
      { label: "Re&name board", ...hint("F2"), click: () => sendMenu("rename") },
      { type: "separator" },
      { label: "&Version history…", click: () => sendMenu("versions") },
      { label: "Show board &files", click: () => void shell.openPath(library.boardsDir) },
      { type: "separator" },
      { label: "E&xit", ...hint("Alt+F4"), click: () => win?.close() },
    ];
  }
  if (menu === "page") {
    return [
      item("&New page", "page-new", "CmdOrCtrl+M"),
      item("D&uplicate page", "page-duplicate"),
      item("&Rename page…", "page-rename"),
      item("&Delete page…", "page-delete"),
      { type: "separator" },
      item("&Previous page", "page-prev", "PageUp"),
      item("Ne&xt page", "page-next", "PageDown"),
      { type: "separator" },
      item("Show or hide page &thumbnails", "pages-toggle", "CmdOrCtrl+Shift+P"),
    ];
  }
  if (menu === "edit") {
    return [
      item("&Undo", "undo", "CmdOrCtrl+Z"),
      item("&Redo", "redo", "CmdOrCtrl+Shift+Z"),
      { type: "separator" },
      item("Cu&t", "cut", "CmdOrCtrl+X"),
      item("&Copy", "copy", "CmdOrCtrl+C"),
      item("&Paste", "paste", "CmdOrCtrl+V"),
      item("D&uplicate", "duplicate", "CmdOrCtrl+D"),
      item("&Delete", "delete", "Delete"),
      { type: "separator" },
      item("Rotate &left 90°", "rotate-left", "Shift+L"),
      item("Rotate ri&ght 90°", "rotate-right", "Shift+R"),
      { type: "separator" },
      item("&Group", "group", "CmdOrCtrl+G"),
      item("U&ngroup", "ungroup", "CmdOrCtrl+Shift+G"),
      item("Loc&k", "lock", "CmdOrCtrl+Shift+L"),
      item("Unlock all on this page", "unlock-all"),
      { type: "separator" },
      item("Select &all", "select-all", "CmdOrCtrl+A"),
    ];
  }
  return [
    item("&Present", "present", "F5"),
    { label: "&Full screen", ...hint("F11"), type: "checkbox", checked: !!win?.isFullScreen(), click: () => runCommand("toggle-fullscreen") },
    { type: "separator" },
    item("&Keyboard shortcuts", "shortcuts", "F1"),
    ...(DEV_URL
      ? ([
          { type: "separator" },
          { label: "Reload", ...hint("CmdOrCtrl+R"), click: () => runCommand("reload") },
          { label: "Developer tools", ...hint("CmdOrCtrl+Shift+I"), click: () => runCommand("devtools") },
        ] as MenuItemConstructorOptions[])
      : []),
  ];
}

function runCommand(command: AppCommand): void {
  if (!win) return;
  switch (command) {
    case "new-board":
      void switchBoard(() => library.createBoard());
      return;
    case "open":
      void openFromFile();
      return;
    case "save-copy":
      void saveCopyAs();
      return;
    case "toggle-fullscreen":
      win.setFullScreen(!win.isFullScreen());
      return;
    case "reload":
      if (DEV_URL) win.webContents.reload();
      return;
    case "devtools":
      if (DEV_URL) win.webContents.toggleDevTools();
      return;
  }
}

function sendWindowState(): void {
  if (!win) return;
  const state: WindowState = { maximized: win.isMaximized(), fullScreen: win.isFullScreen(), focused: win.isFocused() };
  win.webContents.send("nlb:window-state", state);
}

// ---------- window ----------

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: APP_NAME,
    // The colour shown before the page paints: the interface background for the Windows theme.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1d2025" : "#ffffff",
    // Custom title bar drawn by the page; Windows keeps resize borders, snapping and shadows.
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Developer tools only in development.
      devTools: !app.isPackaged,
      // Long work (PDF import renders pages frame by frame) must keep going while the
      // window is minimized or covered. The board itself only draws when something changes.
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  for (const ev of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen", "focus", "blur"] as const) {
    win.on(ev as "maximize", sendWindowState);
  }
  win.once("ready-to-show", () => {
    win?.maximize();
    win?.show();
  });
  win.on("close", (e) => {
    if (allowClose) return;
    e.preventDefault();
    void requestClose();
  });
  win.on("closed", () => {
    win = null;
  });
  // Windows shutdown or log-off: commit synchronously, there is no time for the window.
  win.on("session-end", () => {
    closeCurrent();
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("[window] renderer gone:", details.reason);
    if (details.reason === "clean-exit" || !win) return;
    // Changes already handed over are in the journal; reload from the main process.
    pendingNotice = { kind: "renderer-reloaded" };
    win.webContents.reload();
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
  win.webContents.on("did-finish-load", sendWindowState);

  if (DEV_URL) void win.loadURL(DEV_URL);
  // Packaged: the interface sits next to dist/ (see scripts/package.mjs); from source: apps/web/dist.
  else void win.loadFile(path.join(__dirname, app.isPackaged ? "../web/index.html" : "../../web/dist/index.html"));
}

// Safety net for every web page the app creates: no new windows, no <webview>,
// no navigation away from the app's own files.
app.on("web-contents-created", (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.on("will-navigate", (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
  contents.on("will-redirect", (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

if (gotLock) void app.whenReady().then(() => {
  // The interface follows Windows light or dark mode; native menus and dialogs follow it too.
  nativeTheme.themeSource = "system";
  const base = process.env.LOCALAPPDATA ?? app.getPath("userData");
  library = new Library(path.join(base, DEV_URL ? `${APP_NAME} (dev)` : APP_NAME));
  registerIpc();
  createWindow();
  setInterval(maybeAutoSnapshot, 60_000);
});

app.on("window-all-closed", () => app.quit());

// Safety net for exits that skip the window's close event (e.g. the page calling
// window.close()): commit whatever the main process holds and close cleanly.
app.on("will-quit", () => {
  if (current && !closeCurrent()) console.error("[storage] exit with unsaved changes:", current.journal.pending);
});

process.on("unhandledRejection", (err) => console.error("[main] unhandled rejection:", err));

// Last resort if the main process hits a bug: try to commit what it holds.
process.on("uncaughtException", (err) => {
  console.error("[main] uncaught exception:", err);
  try {
    current?.journal.flush();
  } catch {
    /* nothing more to do */
  }
});
