/** Text measurement shared by rendering, the editor and the model. */
import type { TextStyle } from "./model";
import { TEXT_LINE_HEIGHT } from "./objects";

export const TEXT_FONT_FAMILY = '"Segoe UI Variable Text", "Segoe UI", "Noto Sans Arabic", system-ui, sans-serif';

export const DEFAULT_TEXT_STYLE: TextStyle = { color: "#1e293b", fontSize: 28, bold: false, italic: false, align: "left" };

export function fontString(style: Pick<TextStyle, "fontSize" | "bold" | "italic">, scale = 1): string {
  return `${style.italic ? "italic " : ""}${style.bold ? 700 : 400} ${style.fontSize * scale}px ${TEXT_FONT_FAMILY}`;
}

export function textLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/** Direction from the first strong character (Arabic/Hebrew → rtl). */
export function lineDirection(line: string): "ltr" | "rtl" {
  for (const ch of line) {
    if (RTL.test(ch)) return "rtl";
    if (LTR.test(ch)) return "ltr";
  }
  return "ltr";
}

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d");
    if (!measureCtx) throw new Error("Canvas 2D is not available");
  }
  return measureCtx;
}

/** One drawn line: its text and the direction of the paragraph it belongs to. */
export interface LaidLine {
  text: string;
  dir: "ltr" | "rtl";
}

let graphemes: Intl.Segmenter | null = null;

/**
 * The lines a text is drawn as. Without a box width, lines break only at
 * line breaks. With one, each paragraph wraps greedily at spaces to fit;
 * a word longer than the box is broken between characters (grapheme
 * clusters, so Arabic letters and accents are never split apart). Wrapped
 * lines keep their paragraph's direction, so an Arabic paragraph stays
 * right-to-left even when a line starts with a Latin word.
 */
export function layoutLines(
  text: string,
  style: Pick<TextStyle, "fontSize" | "bold" | "italic">,
  boxWidth?: number,
  /** Width of a string in board units (tests pass their own; normally the canvas measures). */
  measure?: (s: string) => number,
): LaidLine[] {
  const paragraphs = textLines(text);
  if (boxWidth === undefined) return paragraphs.map((p) => ({ text: p, dir: lineDirection(p) }));
  const c = measure ? null : ctx();
  if (c) c.font = fontString(style);
  const width = measure ?? ((s: string) => c!.measureText(s).width);
  const out: LaidLine[] = [];
  for (const p of paragraphs) {
    const dir = lineDirection(p);
    if (c) c.direction = dir;
    if (!p) {
      out.push({ text: "", dir });
      continue;
    }
    let line = "";
    const push = () => {
      out.push({ text: line.replace(/\s+$/, ""), dir });
      line = "";
    };
    for (const token of p.split(/(\s+)/)) {
      if (!token) continue;
      const candidate = line + token;
      if (width(candidate.replace(/\s+$/, "")) <= boxWidth || (!line && /^\s+$/.test(token))) {
        line = candidate;
        continue;
      }
      if (/^\s+$/.test(token)) {
        // The space ends the line.
        push();
        continue;
      }
      if (line) push();
      if (width(token) <= boxWidth) {
        line = token;
        continue;
      }
      // A word wider than the box: break it between grapheme clusters.
      graphemes ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
      for (const { segment } of graphemes.segment(token)) {
        if (line && width(line + segment) > boxWidth) push();
        line += segment;
      }
    }
    if (line || !out.length) push();
  }
  return out;
}

/** Measured layout size in world units: as wide as the longest line, or the fixed box width when there is one. */
export function measureText(text: string, style: TextStyle, boxWidth?: number): { width: number; height: number } {
  const lines = layoutLines(text, style, boxWidth);
  const height = lines.length * style.fontSize * TEXT_LINE_HEIGHT;
  if (boxWidth !== undefined) return { width: boxWidth, height };
  const c = ctx();
  c.font = fontString(style);
  let width = 0;
  for (const line of lines) {
    c.direction = line.dir;
    width = Math.max(width, c.measureText(line.text).width);
  }
  return { width: Math.max(width, style.fontSize * 0.3), height };
}
