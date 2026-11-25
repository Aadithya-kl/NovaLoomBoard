/**
 * Page backgrounds: a pattern (grid, staff lines, …) on a board colour (white, chalkboard
 * green or black). Both are stored together in the page's background value, e.g. "grid"
 * (white, as in every board made before board colours existed) or "staff-green", so the
 * board file format is unchanged.
 *
 * The pattern geometry is computed once here and drawn by both the canvas (screen, PNG,
 * thumbnails) and the SVG of PDF exports, so every output shows the same lines.
 */
import type { Bounds } from "./model";

export type Pattern = "blank" | "grid" | "dots" | "ruled" | "staff" | "handwriting" | "seyes" | "axes";
export type Paper = "white" | "green" | "black";
/** A pattern alone is on a white board; otherwise "pattern-paper". */
export type Background = Pattern | `${Pattern}-${Exclude<Paper, "white">}`;

export const PATTERNS: readonly Pattern[] = ["blank", "grid", "dots", "ruled", "staff", "handwriting", "seyes", "axes"];
export const PAPERS: readonly Paper[] = ["white", "green", "black"];
/** Every valid background value. */
export const BACKGROUNDS: readonly Background[] = PAPERS.flatMap((paper) => PATTERNS.map((pattern) => makeBackground(pattern, paper)));

export function makeBackground(pattern: Pattern, paper: Paper): Background {
  return paper === "white" ? pattern : `${pattern}-${paper}`;
}

export function parseBackground(bg: Background): { pattern: Pattern; paper: Paper } {
  const [pattern, paper] = bg.split("-") as [Pattern, Paper | undefined];
  return { pattern, paper: paper ?? "white" };
}

export const PAPER_COLOR: Record<Paper, string> = { white: "#ffffff", green: "#23392f", black: "#17191c" };

/** True for the dark boards (light ink on a dark surface). */
export function isDarkBackground(bg: Background): boolean {
  return parseBackground(bg).paper !== "white";
}

export function paperColor(bg: Background): string {
  return PAPER_COLOR[parseBackground(bg).paper];
}

// ---------- ink on dark boards ----------

/**
 * The palette's dark colours shown on a dark board. Objects keep their saved colour, so a
 * page turned back to white looks as it did; only what is drawn changes. Black becomes
 * white (chalk), the others become lighter tints that stay readable.
 */
const ON_DARK: Record<string, string> = {
  "#1e293b": "#f1f5f9",
  "#334155": "#e2e8f0",
  "#2563eb": "#60a5fa",
  "#dc2626": "#f87171",
  "#16a34a": "#4ade80",
  "#ea580c": "#fb923c",
  "#7c3aed": "#a78bfa",
};

/** Relative luminance of a #rrggbb colour (0 black, 1 white). */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Highlighter brightens a dark board, which needs more strength than darkening white paper. */
export function highlighterOpacity(opacity: number, dark: boolean): number {
  return dark ? Math.min(1, opacity * 1.7) : opacity;
}

/** The colour to draw `color` with: unchanged on white boards, readable on dark ones. */
export function inkColor(color: string, dark: boolean): string {
  if (!dark) return color;
  const mapped = ON_DARK[color.toLowerCase()];
  if (mapped) return mapped;
  const l = luminance(color);
  return l !== null && l < 0.06 ? "#f1f5f9" : color;
}

// ---------- pattern geometry ----------

export interface PatternLine {
  /** World coordinates. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  /** Width in screen (or paper) pixels: lines stay hairlines at every zoom. */
  width: number;
  /** Dash pattern in screen pixels. */
  dash?: readonly number[];
}

export interface PatternDot {
  x: number;
  y: number;
  /** Radius in screen pixels. */
  r: number;
  color: string;
}

export interface PatternLabel {
  x: number;
  y: number;
  /** Offset from (x, y) in screen pixels. */
  dx: number;
  dy: number;
  text: string;
  color: string;
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
}

export interface PatternGeometry {
  lines: PatternLine[];
  dots: PatternDot[];
  labels: PatternLabel[];
}

/** Colours of the pattern lines for each board. */
function patternColors(dark: boolean) {
  return dark
    ? {
        faint: "rgba(255, 255, 255, 0.09)",
        strong: "rgba(255, 255, 255, 0.16)",
        staff: "rgba(255, 255, 255, 0.34)",
        guide: "rgba(255, 255, 255, 0.2)",
        base: "rgba(255, 255, 255, 0.4)",
        seyesThin: "rgba(147, 197, 253, 0.2)",
        seyesStrong: "rgba(196, 181, 253, 0.42)",
        axis: "rgba(255, 255, 255, 0.62)",
        label: "rgba(255, 255, 255, 0.62)",
      }
    : {
        faint: "rgba(15, 23, 42, 0.08)",
        strong: "rgba(15, 23, 42, 0.14)",
        staff: "rgba(15, 23, 42, 0.34)",
        guide: "rgba(15, 23, 42, 0.16)",
        base: "rgba(15, 23, 42, 0.42)",
        seyesThin: "rgba(37, 99, 235, 0.18)",
        seyesStrong: "rgba(124, 58, 237, 0.4)",
        axis: "rgba(15, 23, 42, 0.62)",
        label: "rgba(15, 23, 42, 0.6)",
      };
}

/** Board units in one unit of the coordinate grid. */
export const AXIS_UNIT = 32;

/** Indices i with i·step inside [min, max]. */
function steps(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const from = Math.ceil(min / step);
  const to = Math.floor(max / step);
  // Never more than a few thousand lines, whatever the zoom.
  if (to - from > 4000) return out;
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Horizontal rows repeating every `pitch` units: `offsets` are the lines within one row. */
function rows(
  region: Bounds,
  pitch: number,
  offsets: readonly { at: number; color: string; width?: number; dash?: readonly number[] }[],
): PatternLine[] {
  const out: PatternLine[] = [];
  const span = Math.max(...offsets.map((o) => o.at));
  for (const i of steps(region.minY - span, region.maxY, pitch)) {
    for (const o of offsets) {
      const y = i * pitch + o.at;
      if (y < region.minY || y > region.maxY) continue;
      out.push({ x1: region.minX, y1: y, x2: region.maxX, y2: y, color: o.color, width: o.width ?? 1, dash: o.dash });
    }
  }
  return out;
}

/**
 * The lines, dots and labels of `pattern` over `region` (world units) shown at `pxPerUnit`
 * screen pixels per board unit. Fine lines that would crowd together are left out.
 */
export function patternGeometry(pattern: Pattern, region: Bounds, pxPerUnit: number, dark: boolean): PatternGeometry {
  const g: PatternGeometry = { lines: [], dots: [], labels: [] };
  const c = patternColors(dark);
  const vertical = (x: number, color: string, width = 1) => g.lines.push({ x1: x, y1: region.minY, x2: x, y2: region.maxY, color, width });
  const horizontal = (y: number, color: string, width = 1) => g.lines.push({ x1: region.minX, y1: y, x2: region.maxX, y2: y, color, width });

  switch (pattern) {
    case "blank":
      return g;
    case "grid":
    case "dots":
    case "ruled": {
      // Lines at least 12 pixels apart: 32 units, or 4× further apart when zoomed out.
      let step = 32;
      while (step * pxPerUnit < 12) step *= 4;
      if (pattern === "dots") {
        const r = Math.min(1.6, Math.max(0.8, (step * pxPerUnit) / 20));
        for (const i of steps(region.minX, region.maxX, step)) {
          for (const j of steps(region.minY, region.maxY, step)) g.dots.push({ x: i * step, y: j * step, r, color: c.strong });
        }
        return g;
      }
      if (pattern === "grid") for (const i of steps(region.minX, region.maxX, step)) vertical(i * step, mod(i, 4) === 0 ? c.strong : c.faint);
      for (const j of steps(region.minY, region.maxY, step)) horizontal(j * step, pattern === "grid" && mod(j, 4) === 0 ? c.strong : c.faint);
      return g;
    }
    case "staff": {
      // Five lines 12 units apart, a stave every 120 units.
      if (12 * pxPerUnit < 2.5) return g;
      g.lines.push(...rows(region, 120, [0, 12, 24, 36, 48].map((at) => ({ at, color: c.staff }))));
      return g;
    }
    case "handwriting": {
      // Four lines a row (top, dashed middle, baseline, bottom), for Latin and Arabic script.
      if (100 * pxPerUnit < 4) return g;
      const fine = 20 * pxPerUnit >= 3;
      g.lines.push(
        ...rows(region, 100, [
          ...(fine
            ? [
                { at: 0, color: c.guide },
                { at: 20, color: c.guide, dash: [5, 4] },
                { at: 60, color: c.guide },
              ]
            : []),
          { at: 40, color: c.base, width: 1.25 },
        ]),
      );
      return g;
    }
    case "seyes": {
      // French ruling: a thin line every 8 units, a strong one every 32, and margins every 32.
      if (32 * pxPerUnit < 4) return g;
      const fine = 8 * pxPerUnit >= 3;
      for (const i of steps(region.minX, region.maxX, 32)) vertical(i * 32, c.seyesThin);
      for (const j of steps(region.minY, region.maxY, 8)) {
        if (mod(j, 4) === 0) horizontal(j * 8, c.seyesStrong);
        else if (fine) horizontal(j * 8, c.seyesThin);
      }
      return g;
    }
    case "axes": {
      // A grid of AXIS_UNIT squares with x and y axes through the origin, numbered.
      let m = 1;
      const ladder = [1, 2, 5];
      for (let k = 0; AXIS_UNIT * m * pxPerUnit < 14 && k < 30; k++) m = ladder[(k + 1) % 3]! * 10 ** Math.floor((k + 1) / 3);
      const step = AXIS_UNIT * m;
      for (const i of steps(region.minX, region.maxX, step)) if (i !== 0) vertical(i * step, mod(i, 5) === 0 ? c.strong : c.faint);
      for (const j of steps(region.minY, region.maxY, step)) if (j !== 0) horizontal(j * step, mod(j, 5) === 0 ? c.strong : c.faint);
      const xAxis = region.minY <= 0 && region.maxY >= 0;
      const yAxis = region.minX <= 0 && region.maxX >= 0;
      if (xAxis) horizontal(0, c.axis, 1.5);
      if (yAxis) vertical(0, c.axis, 1.5);
      // Numbers at least 36 pixels apart.
      let every = 1;
      while (step * every * pxPerUnit < 36) every = every === 1 ? 2 : every === 2 ? 5 : every * 2;
      const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace("-", "−");
      if (xAxis) {
        for (const i of steps(region.minX, region.maxX, step)) {
          if (i === 0 || mod(i, every) !== 0) continue;
          g.labels.push({ x: i * step, y: 0, dx: 0, dy: 5, text: fmt((i * step) / AXIS_UNIT), color: c.label, align: "center", baseline: "top" });
        }
      }
      if (yAxis) {
        for (const j of steps(region.minY, region.maxY, step)) {
          if (j === 0 || mod(j, every) !== 0) continue;
          // Up is positive, as in mathematics.
          g.labels.push({ x: 0, y: j * step, dx: -6, dy: 0, text: fmt((-j * step) / AXIS_UNIT), color: c.label, align: "right", baseline: "middle" });
        }
      }
      if (xAxis && yAxis) g.labels.push({ x: 0, y: 0, dx: -6, dy: 5, text: "0", color: c.label, align: "right", baseline: "top" });
      return g;
    }
  }
}
