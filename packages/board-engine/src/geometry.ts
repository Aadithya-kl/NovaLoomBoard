import type { Bounds } from "./model";

/** Bounds of a flat x,y,p point list, padded by `pad`. */
export function pointsBounds(points: readonly number[], pad = 0): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Squared distance from point P to segment AB. */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Squared minimum distance between segments AB and CD. */
export function segmentDistanceSq(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.min(
    distToSegmentSq(ax, ay, cx, cy, dx, dy),
    distToSegmentSq(bx, by, cx, cy, dx, dy),
    distToSegmentSq(cx, cy, ax, ay, bx, by),
    distToSegmentSq(dx, dy, ax, ay, bx, by),
  );
}

/** True if any part of the polyline comes within `radius` of segment AB. */
export function polylineHitsSegment(
  points: readonly number[], ax: number, ay: number, bx: number, by: number, radius: number,
): boolean {
  const r2 = radius * radius;
  const n = points.length;
  if (n < 3) return false;
  if (n === 3) return distToSegmentSq(points[0]!, points[1]!, ax, ay, bx, by) <= r2;
  for (let i = 0; i + 5 < n; i += 3) {
    if (segmentDistanceSq(points[i]!, points[i + 1]!, points[i + 3]!, points[i + 4]!, ax, ay, bx, by) <= r2) {
      return true;
    }
  }
  return false;
}

/** Inserts interpolated points so no segment is longer than `maxStep`. */
export function densify(points: readonly number[], maxStep: number): number[] {
  if (points.length <= 3 || maxStep <= 0) return points.slice();
  const out: number[] = [points[0]!, points[1]!, points[2]!];
  for (let i = 3; i < points.length; i += 3) {
    const x0 = points[i - 3]!;
    const y0 = points[i - 2]!;
    const p0 = points[i - 1]!;
    const x1 = points[i]!;
    const y1 = points[i + 1]!;
    const p1 = points[i + 2]!;
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxStep);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t);
    }
    out.push(x1, y1, p1);
  }
  return out;
}

/**
 * Removes the parts of a polyline within `radius` of eraser segment AB.
 * Returns null when nothing is erased, otherwise the remaining runs
 * (each with at least two points).
 */
export function erasePolyline(
  points: readonly number[], ax: number, ay: number, bx: number, by: number, radius: number,
): number[][] | null {
  const dense = densify(points, Math.max(radius / 2, 0.5));
  const r2 = radius * radius;
  const runs: number[][] = [];
  let current: number[] = [];
  let erased = false;
  for (let i = 0; i < dense.length; i += 3) {
    const x = dense[i]!;
    const y = dense[i + 1]!;
    if (distToSegmentSq(x, y, ax, ay, bx, by) <= r2) {
      erased = true;
      if (current.length >= 6) runs.push(current);
      current = [];
    } else {
      current.push(x, y, dense[i + 2]!);
    }
  }
  if (!erased) return null;
  if (current.length >= 6) runs.push(current);
  return runs;
}
