/**
 * Clipboard format for copying objects within NovaLoomBoard (and between boards).
 * Pure: no DOM. Parsed data is re-validated with the storage decoder, so
 * pasting can never introduce an object a board file would reject.
 */
import { newId, type BoardObject, type Bounds } from "./model";
import { transformObject } from "./objects";
import { decodeObject, encodeObject } from "./persist";
import { unionBounds } from "./geometry";

/**
 * Private clipboard format (a web custom format: it round-trips through the
 * Windows clipboard next to plain text, and any later copy elsewhere replaces it).
 */
export const CLIPBOARD_FORMAT = "web application/x-novaloomboard";
const APP = "novaloomboard";
const VERSION = 1;
/** Refuse absurdly large payloads. */
export const MAX_CLIPBOARD_BYTES = 64 * 1024 * 1024;

export function serializeObjects(objects: readonly BoardObject[]): string {
  // Stored form (as in board files): compact and validated the same way on the way back.
  const rows = objects.map((o) => {
    const s = encodeObject(o, 0);
    return { id: s.id, type: s.type, data: s.data, points: bytesToBase64(s.points) };
  });
  return JSON.stringify({ app: APP, version: VERSION, objects: rows });
}

/** Parses clipboard JSON; invalid objects are dropped. Returns null if it is not NovaLoomBoard data. */
export function parseClipboard(json: string): BoardObject[] | null {
  if (json.length > MAX_CLIPBOARD_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const d = data as { app?: unknown; version?: unknown; objects?: unknown };
  if (!d || d.app !== APP || d.version !== VERSION || !Array.isArray(d.objects)) return null;
  const out: BoardObject[] = [];
  for (const row of d.objects as { id?: unknown; type?: unknown; data?: unknown; points?: unknown }[]) {
    try {
      if (typeof row.data !== "string" || typeof row.points !== "string") continue;
      out.push(decodeObject({ id: String(row.id), type: String(row.type), data: row.data, points: base64ToBytes(row.points) }));
    } catch {
      // Skip anything that does not validate.
    }
  }
  return out;
}

/**
 * Copies with new ids, moved by (dx, dy) world units; order is kept. Groups
 * are copied as new groups (members of one group stay together in the copy,
 * apart from the original).
 */
export function cloneObjects(objects: readonly BoardObject[], dx: number, dy: number): BoardObject[] {
  const t = { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
  const groups = new Map<string, string>();
  return objects.map((o) => {
    const copy = { ...transformObject(o, t), id: newId() };
    if (o.group) {
      if (!groups.has(o.group)) groups.set(o.group, newId());
      copy.group = groups.get(o.group)!;
    }
    return copy;
  });
}

/** Plain text of the text objects, for pasting into other applications. */
export function plainTextOf(objects: readonly BoardObject[]): string {
  return objects
    .filter((o): o is Extract<BoardObject, { type: "text" }> => o.type === "text")
    .map((t) => t.text)
    .join("\n\n");
}

export function unionOf(objects: readonly BoardObject[]): Bounds | null {
  let b: Bounds | null = null;
  for (const o of objects) b = b ? unionBounds(b, o.bounds) : o.bounds;
  return b;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
