import { useSyncExternalStore } from "react";

/**
 * Colours picked with the colour picker, most recent first, shared by every tool and kept
 * between sessions (a per-computer convenience: losing them loses nothing on the board).
 */
const KEY = "novaloomboard.customColors";
const MAX = 3;

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

let colors = read();
const listeners = new Set<() => void>();

export function addCustomColor(color: string): void {
  const c = color.toLowerCase();
  colors = [c, ...colors.filter((x) => x !== c)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(colors));
  } catch {
    /* storage unavailable: keep them for this session */
  }
  for (const l of listeners) l();
}

export function useCustomColors(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => colors,
  );
}

/** Light colours need a dark outline on light panels; dark colours a light one on dark panels. */
export function colorTone(color: string): "light" | "dark" | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  const y = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  return y > 200 ? "light" : y < 70 ? "dark" : undefined;
}
