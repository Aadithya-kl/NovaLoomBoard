/**
 * Persistence format shared by the engine (renderer) and the storage layer
 * (Electron main). Pure: no DOM, no Node APIs.
 */
import { pointsBounds } from "./geometry";
import { isAssetId, type AssetData } from "./assets";
import type { BoardObject, ImageObject, InkTool, LineDash, ShapeFill, ShapeKind, ShapeObject, StrokeObject, TextAlign, TextObject } from "./model";
import { normalizeAngle } from "./matrix";
import { imageBounds, shapeBounds, textBounds } from "./objects";
import type { Batch } from "./ops";
import { BACKGROUNDS, type Background } from "./paper";

export { BACKGROUNDS };
const INK_TOOLS: readonly InkTool[] = ["pen", "pencil", "highlighter"];
export const SHAPE_KINDS: readonly ShapeKind[] = ["line", "arrow", "rect", "ellipse", "triangle", "diamond", "star", "hexagon", "bubble", "check", "xmark"];
const LINE_DASHES: readonly LineDash[] = ["dashed", "dotted"];
/** Longest TeX source kept with an equation. */
export const MAX_EQUATION_LENGTH = 2000;
/** Dash of a stored style: absent (solid) or a known style. */
function dashOf(v: unknown): { dash?: LineDash } {
  if (v === undefined) return {};
  if (!LINE_DASHES.includes(v as LineDash)) throw new Error("invalid line style");
  return { dash: v as LineDash };
}
const SHAPE_FILLS: readonly ShapeFill[] = ["none", "tint", "solid"];
const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right"];

/**
 * One object as stored on disk. `data` holds the object's fields as JSON;
 * `points` holds ink geometry as little-endian Float32 x,y,pressure triples
 * (empty for shapes and text).
 */
export interface StoredObject {
  id: string;
  type: string;
  /** Z-order key; larger is drawn later (on top). */
  z: number;
  /** JSON with the object's non-geometry fields. */
  data: string;
  points: Uint8Array;
}

export interface BoardView {
  x: number;
  y: number;
  zoom: number;
}

/** One page of a board as stored: its place in the page order and its own settings. */
export interface PageRow {
  id: string;
  /** Sort key; pages are shown in ascending order. */
  position: number;
  /** User-given name; empty means "Page n" by position. */
  name: string;
  background: Background;
  /** Last camera on this page, so returning to it shows the same area. */
  view: BoardView | null;
}

/** Changes the storage layer applies in one transaction, in order. */
export type StoreOp =
  | { op: "put"; page: string; object: StoredObject }
  | { op: "delete"; id: string }
  | { op: "setZ"; id: string; z: number }
  /** Inserts a page, or replaces its settings if it exists (its objects are kept). */
  | { op: "putPage"; page: PageRow }
  | { op: "updatePage"; id: string; position?: number; name?: string; background?: Background; view?: BoardView }
  /** Deletes a page and every object on it. */
  | { op: "deletePage"; id: string };

/** Board-level properties that are not objects or pages. */
export interface BoardProps {
  title?: string;
  /** The page shown when the board is opened. */
  activePage?: string;
}

export const MAX_PAGE_NAME = 100;
export const MAX_PAGES = 500;

export function encodePoints(points: readonly number[]): Uint8Array {
  const f = new Float32Array(points);
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
}

export function decodePoints(bytes: Uint8Array): number[] {
  if (bytes.byteLength % 12 !== 0) throw new Error("point data length is not a multiple of 12");
  // Copy so the Float32Array view is aligned regardless of the source buffer.
  const copy = new Uint8Array(bytes);
  return Array.from(new Float32Array(copy.buffer, 0, copy.byteLength / 4));
}

export function encodeObject(object: BoardObject, z: number): StoredObject {
  const base = { id: object.id, type: object.type, z };
  // Fields every object may have; omitted when unset so older files and objects stay identical.
  const common = {
    ...(object.group ? { group: object.group } : {}),
    ...(object.group && object.groupAngle ? { groupAngle: object.groupAngle } : {}),
    ...(object.locked ? { locked: true } : {}),
  };
  switch (object.type) {
    case "stroke": {
      const { tool, style, simulatePressure } = object;
      return { ...base, data: JSON.stringify({ tool, style, simulatePressure, ...common }), points: encodePoints(object.points) };
    }
    case "shape": {
      const { kind, x1, y1, x2, y2, rotation, style } = object;
      return { ...base, data: JSON.stringify({ kind, x1, y1, x2, y2, rotation, style, ...common }), points: EMPTY };
    }
    case "text": {
      const { x, y, width, height, text, rotation, style, boxWidth } = object;
      const box = boxWidth !== undefined ? { boxWidth } : {};
      return { ...base, data: JSON.stringify({ x, y, width, height, text, rotation, style, ...box, ...common }), points: EMPTY };
    }
    case "image": {
      const { asset, cx, cy, width, height, rotation, equation } = object;
      const eq = equation ? { equation: { tex: equation.tex, color: equation.color } } : {};
      return { ...base, data: JSON.stringify({ asset, cx, cy, width, height, rotation, ...eq, ...common }), points: EMPTY };
    }
  }
}

const EMPTY = new Uint8Array(0);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi;
/** Coordinates beyond this are treated as corrupt. */
const MAX_COORD = 1e7;
export const MAX_TEXT_LENGTH = 20_000;

/** Stored rotation: absent in files from before rotation existed (= 0); must be finite. */
function rotationOf(v: unknown): number {
  if (v === undefined) return 0;
  if (!isNum(v)) throw new Error("invalid rotation");
  return normalizeAngle(v);
}

/**
 * Decodes and validates a stored object (the engine invariants checked on
 * open and during recovery). Throws with a reason when the object is invalid.
 */
export function decodeObject(row: Pick<StoredObject, "id" | "type" | "data" | "points">): BoardObject {
  const obj = decodeObjectFields(row);
  const d = JSON.parse(row.data) as { group?: unknown; groupAngle?: unknown; locked?: unknown };
  if (d.group !== undefined) {
    if (typeof d.group !== "string" || d.group.length === 0 || d.group.length > 64) throw new Error(`object ${row.id}: invalid group`);
    obj.group = d.group;
    if (d.groupAngle !== undefined) {
      if (!isNum(d.groupAngle)) throw new Error(`object ${row.id}: invalid group angle`);
      const a = normalizeAngle(d.groupAngle);
      if (a) obj.groupAngle = a;
    }
  }
  if (d.locked === true) obj.locked = true;
  return obj;
}

function decodeObjectFields(row: Pick<StoredObject, "id" | "type" | "data" | "points">): BoardObject {
  if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 64) throw new Error("invalid id");
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    throw new Error(`object ${row.id}: data is not JSON`);
  }
  if (!data || typeof data !== "object") throw new Error(`object ${row.id}: data is not an object`);
  const fail = (what: string): never => {
    throw new Error(`object ${row.id}: invalid ${what}`);
  };
  const coord = (v: unknown, what: string) => (inRange(v, -MAX_COORD, MAX_COORD) ? v : fail(what));

  switch (row.type) {
    case "stroke": {
      const d = data as Partial<StrokeObject>;
      const style = d.style;
      if (!INK_TOOLS.includes(d.tool as InkTool)) fail("tool");
      if (!style || !isColor(style.color) || !inRange(style.size, 1e-3, 1000) || !inRange(style.opacity, 0, 1)) fail("style");
      if (!(row.points instanceof Uint8Array)) throw new Error(`object ${row.id}: missing point data`);
      const points = decodePoints(row.points);
      if (points.length < 6) throw new Error(`object ${row.id}: fewer than 2 points`);
      if (!points.every(Number.isFinite)) throw new Error(`object ${row.id}: non-finite point`);
      return {
        id: row.id,
        type: "stroke",
        tool: d.tool as InkTool,
        style: { color: style!.color, size: style!.size, opacity: style!.opacity, ...dashOf(style!.dash) },
        points,
        simulatePressure: d.simulatePressure === true,
        bounds: pointsBounds(points, style!.size),
      };
    }
    case "shape": {
      const d = data as Partial<ShapeObject>;
      const s = d.style;
      if (!SHAPE_KINDS.includes(d.kind as ShapeKind)) fail("shape kind");
      if (!s || !isColor(s.color) || !inRange(s.size, 0.1, 500) || !inRange(s.opacity, 0, 1) || !SHAPE_FILLS.includes(s.fill as ShapeFill)) {
        fail("style");
      }
      const shape = {
        id: row.id,
        type: "shape" as const,
        kind: d.kind as ShapeKind,
        x1: coord(d.x1, "geometry"),
        y1: coord(d.y1, "geometry"),
        x2: coord(d.x2, "geometry"),
        y2: coord(d.y2, "geometry"),
        // Lines and arrows carry rotation in their endpoints.
        rotation: d.kind === "line" || d.kind === "arrow" ? 0 : rotationOf(d.rotation),
        style: { color: s!.color, size: s!.size, opacity: s!.opacity, fill: s!.fill as ShapeFill, ...dashOf(s!.dash) },
      };
      return { ...shape, bounds: shapeBounds(shape) };
    }
    case "text": {
      const d = data as Partial<TextObject>;
      const s = d.style;
      if (typeof d.text !== "string" || d.text.length > MAX_TEXT_LENGTH) fail("text");
      if (
        !s ||
        !isColor(s.color) ||
        !inRange(s.fontSize, 1, 5000) ||
        typeof s.bold !== "boolean" ||
        typeof s.italic !== "boolean" ||
        !TEXT_ALIGNS.includes(s.align as TextAlign)
      ) {
        fail("style");
      }
      const text = {
        id: row.id,
        type: "text" as const,
        x: coord(d.x, "position"),
        y: coord(d.y, "position"),
        width: inRange(d.width, 0, MAX_COORD) ? d.width : fail("size"),
        height: inRange(d.height, 0, MAX_COORD) ? d.height : fail("size"),
        text: d.text as string,
        rotation: rotationOf(d.rotation),
        style: { color: s!.color, fontSize: s!.fontSize, bold: s!.bold, italic: s!.italic, align: s!.align as TextAlign },
        ...(d.boxWidth !== undefined ? { boxWidth: inRange(d.boxWidth, 1, MAX_COORD) ? d.boxWidth : fail("text box width") } : {}),
      };
      return { ...text, bounds: textBounds(text) };
    }
    case "image": {
      const d = data as Partial<ImageObject>;
      if (!isAssetId(d.asset)) fail("image asset");
      const image = {
        id: row.id,
        type: "image" as const,
        asset: d.asset as string,
        cx: coord(d.cx, "position"),
        cy: coord(d.cy, "position"),
        width: inRange(d.width, 1e-3, MAX_COORD) ? d.width : fail("size"),
        height: inRange(d.height, 1e-3, MAX_COORD) ? d.height : fail("size"),
        rotation: rotationOf(d.rotation),
        ...equationOf(d.equation),
      };
      return { ...image, bounds: imageBounds(image) };
    }
    default:
      throw new Error(`unknown object type "${String(row.type)}"`);
  }
}

/** The TeX source kept with an equation image: absent, or text and a colour. */
function equationOf(v: unknown): { equation?: { tex: string; color: string } } {
  if (v === undefined) return {};
  const e = v as { tex?: unknown; color?: unknown };
  if (!e || typeof e.tex !== "string" || !e.tex || e.tex.length > MAX_EQUATION_LENGTH || !isColor(e.color)) throw new Error("invalid equation");
  return { equation: { tex: e.tex, color: e.color as string } };
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isView = (v: unknown): v is BoardView =>
  !!v && typeof v === "object" && [(v as BoardView).x, (v as BoardView).y, (v as BoardView).zoom].every(isNum) && (v as BoardView).zoom > 0;

/** Normalises a stored or received view; null when it is missing or invalid. */
export function viewOf(v: unknown): BoardView | null {
  return isView(v) ? { x: v.x, y: v.y, zoom: v.zoom } : null;
}

/**
 * Validates changes before they reach storage (the main process runs this on
 * everything the window sends), so nothing invalid is ever written.
 * Returns clean copies; throws on the first invalid operation.
 */
export function validateOps(ops: unknown): StoreOp[] {
  if (!Array.isArray(ops) || ops.length > 100_000) throw new Error("invalid ops");
  const bad = (what: string): never => {
    throw new Error(`invalid ${what}`);
  };
  return (ops as StoreOp[]).map((op): StoreOp => {
    switch (op?.op) {
      case "put": {
        const o = op.object;
        if (!isId(op.page)) bad("page id");
        if (!o || !isNum(o.z) || typeof o.data !== "string" || o.data.length > 262_144) bad("object");
        if (!(o.points instanceof Uint8Array) || o.points.byteLength > 16 * 1024 * 1024) bad("points");
        decodeObject(o);
        return { op: "put", page: op.page, object: { id: o.id, type: o.type, z: o.z, data: o.data, points: o.points } };
      }
      case "delete":
        return isId(op.id) ? { op: "delete", id: op.id } : bad("id");
      case "setZ":
        return isId(op.id) && isNum(op.z) ? { op: "setZ", id: op.id, z: op.z } : bad("z");
      case "putPage": {
        const p = op.page;
        if (!p || !isId(p.id) || !isNum(p.position) || !BACKGROUNDS.includes(p.background)) bad("page");
        if (typeof p.name !== "string" || p.name.length > MAX_PAGE_NAME) bad("page name");
        if (p.view !== null && !isView(p.view)) bad("page view");
        return { op: "putPage", page: { id: p.id, position: p.position, name: p.name, background: p.background, view: viewOf(p.view) } };
      }
      case "updatePage": {
        if (!isId(op.id)) bad("page id");
        const out: Extract<StoreOp, { op: "updatePage" }> = { op: "updatePage", id: op.id };
        if (op.position !== undefined) out.position = isNum(op.position) ? op.position : bad("page position");
        if (op.name !== undefined) out.name = typeof op.name === "string" && op.name.length <= MAX_PAGE_NAME ? op.name : bad("page name");
        if (op.background !== undefined) out.background = BACKGROUNDS.includes(op.background) ? op.background : bad("background");
        if (op.view !== undefined) out.view = isView(op.view) ? viewOf(op.view)! : bad("page view");
        return out;
      }
      case "deletePage":
        return isId(op.id) ? { op: "deletePage", id: op.id } : bad("page id");
      default:
        return bad("op");
    }
  });
}

export function validateProps(props: unknown): BoardProps | undefined {
  if (props === undefined || props === null || typeof props !== "object") return undefined;
  const p = props as BoardProps;
  const out: BoardProps = {};
  if (typeof p.title === "string") out.title = p.title.trim().slice(0, 200) || "Untitled board";
  if (isId(p.activePage)) out.activePage = p.activePage;
  return Object.keys(out).length ? out : undefined;
}

/** Gap below which keys are renumbered instead of bisected. */
const MIN_GAP = 1e-6;

/**
 * Mirrors the engine's z-order and turns its index-based batches into
 * storage operations with stable numeric z keys, so a change only writes
 * the objects it touches. When bisection runs out of precision, the page
 * is renumbered (rare; emitted as setZ ops in the same change set).
 */
export class ZOrderTracker {
  private order: string[] = [];
  private z = new Map<string, number>();

  /** @param page The page whose objects this tracks; written into every put. */
  constructor(readonly page: string) {}

  /** Initialise from loaded objects (any order). */
  reset(entries: readonly { id: string; z: number }[]): void {
    const sorted = [...entries].sort((a, b) => a.z - b.z);
    this.order = sorted.map((e) => e.id);
    this.z = new Map(sorted.map((e) => [e.id, e.z]));
  }

  get ids(): readonly string[] {
    return this.order;
  }

  zOf(id: string): number | undefined {
    return this.z.get(id);
  }

  apply(batch: Batch): StoreOp[] {
    const out: StoreOp[] = [];
    for (const op of batch) {
      if (op.kind === "remove") {
        const i = this.order.indexOf(op.object.id);
        if (i !== -1) this.order.splice(i, 1);
        this.z.delete(op.object.id);
        out.push({ op: "delete", id: op.object.id });
        continue;
      }
      const i = Math.max(0, Math.min(op.index, this.order.length));
      const prev = i > 0 ? this.z.get(this.order[i - 1]!)! : null;
      const next = i < this.order.length ? this.z.get(this.order[i]!)! : null;
      let key: number;
      if (prev === null && next === null) key = 0;
      else if (prev === null) key = next! - 1;
      else if (next === null) key = prev + 1;
      else key = (prev + next) / 2;
      this.order.splice(i, 0, op.object.id);
      if (prev !== null && next !== null && (next - prev < MIN_GAP || key <= prev || key >= next)) {
        this.order.forEach((id, n) => {
          if (id !== op.object.id && this.z.get(id) !== n) out.push({ op: "setZ", id, z: n });
          this.z.set(id, n);
        });
        key = i;
      }
      this.z.set(op.object.id, key);
      out.push({ op: "put", page: this.page, object: encodeObject(op.object, key) });
    }
    return out;
  }
}

// ---------- desktop bridge (exposed by the Electron preload as window.novaLoom) ----------

/** Shown to the user after a board opens. */
export type RecoveryNotice =
  | { kind: "unclean-exit"; lastSavedAt: number }
  | { kind: "restored-snapshot"; snapshotAt: number; damagedPath: string }
  | { kind: "damaged-no-backup"; damagedPath: string }
  | { kind: "renderer-reloaded" }
  | { kind: "open-failed"; message: string };

export interface PagePayload {
  id: string;
  name: string;
  background: Background;
  view: BoardView | null;
  /** Bottom first. */
  objects: StoredObject[];
}

export interface OpenBoardPayload {
  boardId: string;
  title: string;
  /** In page order; never empty. */
  pages: PagePayload[];
  activePage: string;
  notice?: RecoveryNotice;
}

export interface MainSaveStatus {
  status: "saved" | "saving" | "error";
  error?: string;
}

/** Snapshots the window may ask for before a destructive action. */
export type SnapshotRequest = "before-clear" | "before-delete-page";

/** Commands from the title-bar menus that the window carries out. */
export type MenuCommand =
  | "rename"
  | "page-new"
  | "page-duplicate"
  | "page-rename"
  | "page-delete"
  | "page-prev"
  | "page-next"
  | "pages-toggle"
  | "import-images"
  | "import-pdf"
  | "export-png"
  | "export-pdf"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "duplicate"
  | "delete"
  | "select-all"
  | "rotate-left"
  | "rotate-right"
  | "group"
  | "ungroup"
  | "lock"
  | "unlock-all"
  | "present"
  | "versions"
  | "shortcuts";

/** Native editing actions for text fields (run by the main process on the focused element). */
export type NativeEdit = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

/** One file picked in the Import images dialog: stored in the board, or why it was refused. */
export interface ImportedImage {
  name: string;
  asset?: { id: string } & AssetData;
  error?: string;
}

export type ExportFormat = "png" | "pdf";

/** Files in and out of the board (native dialogs and the board's image store). */
export interface FilesBridge {
  /** Native open dialog for images; accepted files are stored in the board. Null if cancelled. */
  importImages(): Promise<ImportedImage[] | null>;
  /** Native open dialog for one PDF (checked for size and signature). Null if cancelled. */
  openPdf(): Promise<{ name: string; data: Uint8Array } | { name: string; error: string } | null>;
  /** An image of the open board, by id. */
  readAsset(id: string): Promise<AssetData | null>;
  /** Stores image bytes in the open board (e.g. pasted from another board); returns its id. */
  storeAsset(data: AssetData): Promise<string>;
  /** Native save dialog. Null if cancelled. */
  chooseExportPath(format: ExportFormat, suggestedName: string): Promise<string | null>;
  /** Writes an exported file to the path just chosen. */
  writeExport(path: string, data: Uint8Array): Promise<void>;
  /** Prints the given HTML document (one sheet per page) to a PDF at the path just chosen. */
  exportPdf(path: string, html: string): Promise<{ bytes: number }>;
  showInFolder(path: string): void;
}

export interface ClipboardBridge {
  /**
   * Puts NovaLoomBoard object data (and optional plain text and a PNG picture of it, for pasting
   * into other programs) on the system clipboard, replacing what was there.
   */
  writeBoard(data: string, text: string, png?: Uint8Array): Promise<void>;
  /**
   * NovaLoomBoard object data if the clipboard holds some; otherwise its plain
   * text; otherwise an image (as PNG), e.g. a screenshot.
   */
  read(): Promise<{
    board?: string;
    text?: string;
    image?: Uint8Array;
    /** Image files copied in Explorer, already checked and stored (like Import images). */
    files?: ImportedImage[];
    /** A PDF file copied in Explorer. */
    pdf?: { name: string; data: Uint8Array } | { name: string; error: string };
  }>;
}

/** An earlier version of the open board: one of its automatic or saved snapshots. */
export interface VersionInfo {
  /** When it was saved (ms since 1970). */
  at: number;
  reason: "auto" | "close" | "before-clear" | "before-delete-page" | "manual";
}

export interface VersionPreview {
  title: string;
  pageCount: number;
  objectCount: number;
  /** The page that was open then, to draw a preview of. */
  page: PagePayload;
}

export interface VersionsBridge {
  /** Versions of the open board, newest first. */
  list(): Promise<VersionInfo[]>;
  preview(at: number): Promise<VersionPreview | null>;
  /** Opens a version as a new board (a copy): the current board is left exactly as it is. */
  open(at: number): Promise<void>;
  /** Saves a version of the board as it is now (kept until deleted). */
  saveNow(): Promise<void>;
}

export interface DesktopBridge {
  /** The board the main process has open (after a reload: including every change it received). */
  loadBoard(): Promise<OpenBoardPayload>;
  /** Hands changes to the main process. Resolves once received (not yet committed). */
  save(ops: StoreOp[], props?: BoardProps): Promise<void>;
  /** Flushes and writes a verified snapshot before a risky action. */
  snapshot(reason: SnapshotRequest): Promise<void>;
  /** The user closed the recovery notice; it is not shown again. */
  dismissNotice(): void;
  onSaveStatus(listener: (status: MainSaveStatus) => void): () => void;
  /** Main asks the window to hand over everything before closing or switching boards. */
  onFlushRequest(listener: () => Promise<void>): () => void;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  window: WindowBridge;
  clipboard: ClipboardBridge;
  files: FilesBridge;
  versions: VersionsBridge;
}

// ---------- window chrome (custom title bar) ----------

export type WindowAction = "minimize" | "toggle-maximize" | "close";
export type AppMenu = "file" | "edit" | "page" | "view";
export type AppCommand = "new-board" | "open" | "save-copy" | "toggle-fullscreen" | "reload" | "devtools";

export interface WindowState {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

export interface WindowBridge {
  getState(): Promise<WindowState>;
  onState(listener: (state: WindowState) => void): () => void;
  action(action: WindowAction): void;
  /** Opens a native menu at window coordinates (CSS pixels). */
  popupMenu(menu: AppMenu, x: number, y: number): void;
  onMenuClosed(listener: (menu: AppMenu) => void): () => void;
  command(command: AppCommand): void;
  /** Runs a native editing command on the focused text field. */
  nativeEdit(command: NativeEdit): void;
}
