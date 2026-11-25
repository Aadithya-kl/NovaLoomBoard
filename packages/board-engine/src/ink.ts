import { getStroke, type StrokeOptions } from "perfect-freehand";
import type { InkTool } from "./model";

/** Per-tool outline behaviour. */
export const TOOL_STROKE_OPTIONS: Record<InkTool, StrokeOptions> = {
  pen: {
    thinning: 0.55,
    smoothing: 0.55,
    streamline: 0.5,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  },
  pencil: {
    thinning: 0.7,
    smoothing: 0.35,
    streamline: 0.3,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  },
  highlighter: {
    thinning: 0,
    smoothing: 0.6,
    streamline: 0.6,
    start: { cap: false, taper: 0 },
    end: { cap: false, taper: 0 },
  },
};

/** Converts flat x,y,p points to perfect-freehand input. */
function toInput(points: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < points.length; i += 3) out.push([points[i]!, points[i + 1]!, points[i + 2]!]);
  return out;
}

/** Outline polygon of a stroke in world coordinates. */
export function strokeOutline(
  points: readonly number[],
  tool: InkTool,
  size: number,
  simulatePressure: boolean,
  complete: boolean,
): number[][] {
  const options = TOOL_STROKE_OPTIONS[tool];
  return getStroke(toInput(points), {
    ...options,
    // Without a pen's pressure the width follows speed; keep that subtle so lines look even.
    thinning: simulatePressure ? (options.thinning ?? 0) * 0.45 : options.thinning,
    size,
    simulatePressure,
    last: complete,
  });
}

const avg = (a: number, b: number) => (a + b) / 2;
const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Smooth closed SVG path through an outline polygon (quadratic midpoints). */
export function outlineToSvgPath(outline: readonly number[][]): string {
  const len = outline.length;
  if (len < 4) return "";
  let a = outline[0]!;
  let b = outline[1]!;
  const c = outline[2]!;
  let d = `M${f(a[0]!)},${f(a[1]!)} Q${f(b[0]!)},${f(b[1]!)} ${f(avg(b[0]!, c[0]!))},${f(avg(b[1]!, c[1]!))} T`;
  for (let i = 2; i < len - 1; i++) {
    a = outline[i]!;
    b = outline[i + 1]!;
    d += `${f(avg(a[0]!, b[0]!))},${f(avg(a[1]!, b[1]!))} `;
  }
  return `${d}Z`;
}

/** True if the recorded pressures carry no information (mouse, or pen driver without pressure). */
export function needsSimulatedPressure(pointerType: string, points: readonly number[]): boolean {
  if (pointerType !== "pen") return true;
  if (points.length < 6) return false;
  const first = points[2]!;
  for (let i = 5; i < points.length; i += 3) if (Math.abs(points[i]! - first) > 1e-3) return false;
  return true;
}
