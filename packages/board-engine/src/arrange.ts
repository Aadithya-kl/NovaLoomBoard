/**
 * Selection and arrangement logic without the DOM: lasso hit-testing,
 * groups, alignment and distribution.
 */
import { unionBounds } from "./geometry";
import type { BoardObject, Bounds } from "./model";
import { apply, rotateAbout } from "./matrix";
import { frameCorners, objectFrame, type Frame } from "./objects";

/** Even-odd point-in-polygon; `poly` is a flat [x0, y0, x1, y1, …] list. */
export function pointInPolygon(x: number, y: number, poly: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]!;
    const yi = poly[i + 1]!;
    const xj = poly[j]!;
    const yj = poly[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Points that stand for an object's shape when testing it against a lasso. */
function samplePoints(o: BoardObject): number[] {
  if (o.type === "stroke") {
    const pts: number[] = [];
    // At most ~64 samples along the stroke.
    const step = Math.max(1, Math.floor(o.points.length / 3 / 64)) * 3;
    for (let i = 0; i < o.points.length; i += step) pts.push(o.points[i]!, o.points[i + 1]!);
    pts.push(o.points[o.points.length - 3]!, o.points[o.points.length - 2]!);
    return pts;
  }
  // Corners, edge midpoints and centre of the object's own (rotated) frame.
  const f = objectFrame(o);
  const c = frameCorners(f);
  const pts = [f.cx, f.cy];
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    pts.push(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  return pts;
}

/** Share of an object that must lie inside the lasso for it to be selected. */
export const LASSO_SHARE = 0.8;

/** True when most of the object (≥ 80% of its sample points) is inside the lasso polygon. */
export function lassoSelects(o: BoardObject, poly: readonly number[]): boolean {
  if (poly.length < 6) return false;
  const pts = samplePoints(o);
  let inside = 0;
  for (let i = 0; i < pts.length; i += 2) if (pointInPolygon(pts[i]!, pts[i + 1]!, poly)) inside++;
  return inside / (pts.length / 2) >= LASSO_SHARE;
}

/** Adds every member of any group that has a member in `ids`. */
export function expandToGroups(ids: Iterable<string>, objects: readonly BoardObject[]): Set<string> {
  const out = new Set(ids);
  const groups = new Set<string>();
  for (const o of objects) if (out.has(o.id) && o.group) groups.add(o.group);
  if (groups.size) for (const o of objects) if (o.group && groups.has(o.group)) out.add(o.id);
  return out;
}

/**
 * The group the objects form, if they are exactly all the members of one
 * group (given every object on the page); otherwise null.
 */
export function wholeGroup(selected: readonly BoardObject[], all: readonly BoardObject[]): string | null {
  const g = selected[0]?.group;
  if (!g || selected.some((o) => o.group !== g)) return null;
  return all.filter((o) => o.group === g).length === selected.length ? g : null;
}

/** Points that outline an object (stroke points; frame corners for the rest). */
function outlinePoints(o: BoardObject): number[] {
  if (o.type === "stroke") {
    const pts: number[] = [];
    for (let i = 0; i < o.points.length; i += 3) pts.push(o.points[i]!, o.points[i + 1]!);
    return pts;
  }
  return frameCorners(objectFrame(o)).flatMap((p) => [p.x, p.y]);
}

/**
 * The tightest frame turned by `angle` around the objects: its sides follow
 * the group's rotation, so a rotated group shows the same rotated frame each
 * time it is selected. Ink keeps its half-width as a margin.
 */
export function orientedFrame(objects: readonly BoardObject[], angle: number): Frame {
  const toLocal = rotateAbout(-angle, 0, 0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of objects) {
    const pad = o.type === "stroke" ? o.style.size / 2 : 0;
    const pts = outlinePoints(o);
    for (let i = 0; i < pts.length; i += 2) {
      const p = apply(toLocal, pts[i]!, pts[i + 1]!);
      minX = Math.min(minX, p.x - pad);
      maxX = Math.max(maxX, p.x + pad);
      minY = Math.min(minY, p.y - pad);
      maxY = Math.max(maxY, p.y + pad);
    }
  }
  const c = apply(rotateAbout(angle, 0, 0), (minX + maxX) / 2, (minY + maxY) / 2);
  return { cx: c.x, cy: c.y, w: maxX - minX, h: maxY - minY, angle };
}

/** Objects that move together: each group is one unit, every other object its own. */
export interface Unit {
  ids: string[];
  bounds: Bounds;
}

export function unitsOf(objects: readonly BoardObject[]): Unit[] {
  const byGroup = new Map<string, Unit>();
  const units: Unit[] = [];
  for (const o of objects) {
    if (o.group) {
      const u = byGroup.get(o.group);
      if (u) {
        u.ids.push(o.id);
        u.bounds = unionBounds(u.bounds, o.bounds);
        continue;
      }
      const nu = { ids: [o.id], bounds: o.bounds };
      byGroup.set(o.group, nu);
      units.push(nu);
    } else units.push({ ids: [o.id], bounds: o.bounds });
  }
  return units;
}

export type AlignEdge = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

/**
 * How far to move each unit to align it with the others: to the left, right,
 * top or bottom edge, or the centre line, of the selection as a whole.
 * Returns one offset per unit (same order).
 */
export function alignOffsets(units: readonly Unit[], edge: AlignEdge): { dx: number; dy: number }[] {
  if (units.length < 2) return units.map(() => ({ dx: 0, dy: 0 }));
  const all = units.reduce((b, u) => unionBounds(b, u.bounds), units[0]!.bounds);
  return units.map(({ bounds: b }) => {
    switch (edge) {
      case "left":
        return { dx: all.minX - b.minX, dy: 0 };
      case "right":
        return { dx: all.maxX - b.maxX, dy: 0 };
      case "centerX":
        return { dx: (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2, dy: 0 };
      case "top":
        return { dx: 0, dy: all.minY - b.minY };
      case "bottom":
        return { dx: 0, dy: all.maxY - b.maxY };
      case "centerY":
        return { dx: 0, dy: (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2 };
    }
  });
}

/**
 * Even spacing: the outermost units stay put and the ones between are moved
 * so the gaps between neighbours are equal (needs three units or more).
 * Returns one offset per unit (same order as given).
 */
export function distributeOffsets(units: readonly Unit[], axis: "horizontal" | "vertical"): { dx: number; dy: number }[] {
  const out = units.map(() => ({ dx: 0, dy: 0 }));
  if (units.length < 3) return out;
  const h = axis === "horizontal";
  const lo = (b: Bounds) => (h ? b.minX : b.minY);
  const hi = (b: Bounds) => (h ? b.maxX : b.maxY);
  const order = units.map((_, i) => i).sort((a, b) => lo(units[a]!.bounds) + hi(units[a]!.bounds) - (lo(units[b]!.bounds) + hi(units[b]!.bounds)));
  const first = units[order[0]!]!.bounds;
  const last = units[order[order.length - 1]!]!.bounds;
  const span = hi(last) - lo(first);
  const sizes = order.reduce((s, i) => s + hi(units[i]!.bounds) - lo(units[i]!.bounds), 0);
  const gap = (span - sizes) / (order.length - 1);
  let pos = lo(first);
  for (const i of order) {
    const b = units[i]!.bounds;
    const d = pos - lo(b);
    out[i] = h ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    pos += hi(b) - lo(b) + gap;
  }
  return out;
}

/**
 * Where padlock badges go, in screen pixels: one per locked unit, at the
 * top-right of the part of it that is on screen (so it stays visible when
 * zoomed in), and none for units too small on screen or barely visible.
 */
export function badgeSpots(
  rects: readonly { minX: number; minY: number; maxX: number; maxY: number }[],
  viewW: number,
  viewH: number,
  inset: number,
  minSize = 24,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const r of rects) {
    if (r.maxX - r.minX < minSize && r.maxY - r.minY < minSize) continue;
    const left = Math.max(r.minX, 0);
    const right = Math.min(r.maxX, viewW);
    const top = Math.max(r.minY, 0);
    const bottom = Math.min(r.maxY, viewH);
    if (right - left < inset * 2 || bottom - top < inset * 2) continue;
    out.push({ x: right - inset, y: top + inset });
  }
  return out;
}
