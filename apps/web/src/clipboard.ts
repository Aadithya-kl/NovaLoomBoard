import { assets, isAssetId, renderObjectsPng, type BoardEngine } from "@novaloom/board-engine";
import { handlePdf, insertImageBytes, placeImported } from "./files";
import type { Persistence } from "./persistence";

/**
 * Copy, cut and paste of board objects. In the desktop app the data goes on
 * the system clipboard (private format, via the main process); the browser
 * preview keeps it in memory. Copied images carry their file bytes, so they
 * can be pasted into another board, which stores them before placing them.
 */
let memory: string | null = null;
/** The last write, so a paste right after a copy reads the new data. */
let writing: Promise<void> = Promise.resolve();

interface ClipboardAsset {
  mime: string;
  data: string;
}

function imageIds(json: string): string[] {
  try {
    const d = JSON.parse(json) as { objects?: { type?: string; data?: string }[] };
    const ids = new Set<string>();
    for (const o of d.objects ?? []) {
      if (o.type !== "image" || typeof o.data !== "string") continue;
      const asset = (JSON.parse(o.data) as { asset?: unknown }).asset;
      if (isAssetId(asset)) ids.add(asset);
    }
    return [...ids];
  } catch {
    return [];
  }
}

/** Adds the bytes of every copied image to the clipboard data. */
async function withAssets(json: string): Promise<string> {
  const files = window.novaLoom?.files;
  const ids = imageIds(json);
  if (!files || !ids.length) return json;
  const out: Record<string, ClipboardAsset> = {};
  for (const id of ids) {
    const a = await files.readAsset(id);
    if (a) out[id] = { mime: a.mime, data: toBase64(a.data) };
  }
  return JSON.stringify({ ...JSON.parse(json), assets: out });
}

/** Stores images that came with pasted data (validated again by the main process). */
async function storeAssets(json: string): Promise<void> {
  const files = window.novaLoom?.files;
  if (!files) return;
  let pasted: Record<string, ClipboardAsset> | undefined;
  try {
    pasted = (JSON.parse(json) as { assets?: Record<string, ClipboardAsset> }).assets;
  } catch {
    return;
  }
  for (const id of imageIds(json)) {
    const a = pasted?.[id];
    if (!a || typeof a.mime !== "string" || typeof a.data !== "string") continue;
    const data = fromBase64(a.data);
    const stored = await files.storeAsset({ mime: a.mime, data });
    if (stored === id) await assets.put(id, { mime: a.mime, data }).catch(() => undefined);
  }
}

/**
 * A PNG picture of objects, so a copy pastes as an image into Word, PowerPoint, chats and
 * email. Null when it cannot be drawn (the board copy still works).
 */
async function pictureOf(objects: ReturnType<BoardEngine["getSelectedObjects"]>, engine: BoardEngine): Promise<Uint8Array | undefined> {
  try {
    const canvas = await renderObjectsPng(objects, engine.getState().background, 2);
    if (!canvas) return undefined;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    canvas.width = canvas.height = 0;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
  } catch (err) {
    console.error("[clipboard] picture of the selection failed", err);
    return undefined;
  }
}

export function copySelection(engine: BoardEngine, cut = false): boolean {
  // Read before cutting removes them.
  const objects = engine.getSelectedObjects();
  const copied = engine.copySelection(cut);
  if (!copied) return false;
  const bridge = window.novaLoom?.clipboard;
  // Only text selected: other programs get the text. Anything drawn: they get the picture.
  const onlyText = objects.every((o) => o.type === "text");
  if (bridge) {
    writing = Promise.all([withAssets(copied.data), onlyText ? undefined : pictureOf(objects, engine)])
      .then(([data, png]) => bridge.writeBoard(data, onlyText ? copied.text : "", png))
      .catch((err) => {
        console.error("[clipboard] copy failed", err);
        memory = copied.data;
      });
  } else memory = copied.data;
  return true;
}

/** Where pasted images report refusals (set by the window's edit-command hook). */
let statusTarget: Persistence | null = null;
export function setClipboardPersistence(p: Persistence | null): void {
  statusTarget = p;
}

export async function paste(
  engine: BoardEngine,
  persistence: Persistence | null = statusTarget,
  /** "Paste here": centre what is pasted on this client point. */
  at?: { clientX: number; clientY: number },
): Promise<void> {
  const bridge = window.novaLoom?.clipboard;
  if (!bridge) {
    if (memory) engine.paste(memory, at);
    return;
  }
  await writing;
  const { board, text, image, files, pdf } = await bridge.read();
  if (board) {
    try {
      await storeAssets(board);
    } catch (err) {
      console.error("[clipboard] pasted images could not be stored", err);
    }
    if (engine.paste(board, at)) return;
  }
  // Text copied in another application becomes a text object.
  if (text) engine.pasteText(text);
  // A screenshot or copied picture becomes an image (same checks as importing).
  else if (image && persistence) await insertImageBytes(engine, persistence, [{ name: "Pasted image", data: image }], at);
  // Files copied in Explorer.
  else if (files && persistence) await placeImported(engine, persistence, files);
  else if (pdf) {
    if ("error" in pdf) persistence?.showStatus({ tone: "error", text: `${pdf.name} could not be imported: ${pdf.error}.` });
    else handlePdf(pdf.name, pdf.data);
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
