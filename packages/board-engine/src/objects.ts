/**
 * Per-type geometry for board objects: bounds, hit-testing, oriented frames
 * and affine transforms (move, resize, rotate). Pure: no DOM.
 */
import { distToSegmentSq, pointsBounds, polylineHitsSegment, segmentDistanceSq } from "./geometry";
import { apply, applyVector, determinant, normalizeAngle, rotateAbout, type Matrix } from "./matrix";
import type { BoardObject, Bounds, ImageObject, ShapeKind, ShapeObject, StrokeObject, TextObject } from "./model";

/** Line height as a multiple of the font size (shared by layout, rendering and the editor). */
export const TEXT_LINE_HEIGHT = 1.3;
/** Space kept around text so selection and erasing are comfortable. */
export const TEXT_PAD = 4;

const ELLIPSE_SEGMENTS = 64;

/** An oriented rectangle: centre, size and rotation (radians). */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export const isBoxShape = (o: BoardObject): o is ShapeObject => o.type === "shape" && o.kind !== "line" && o.kind !== "arrow";

/** Objects whose rotation is a property (box shapes, text, images), rather than baked into points. */
export const hasOwnRotation = (o: BoardObject): o is ShapeObject | TextObject | ImageObject =>
  o.type === "text" || o.type === "image" || isBoxShape(o);

/** Objects with a colour that can be changed (everything except images). */
export const hasColor = (o: BoardObject): o is StrokeObject | ShapeObject | TextObject => o.type !== "image";

// ---------- shapes ----------

/** Length of an arrow head for a shape of the given outline width and length. */
export function arrowHeadLength(size: number, length: number): number {
  return Math.min(Math.max(12, size * 3.5), length * 0.5);
}

/** Arrow head triangle [tipX, tipY, leftX, leftY, rightX, rightY] at (x2, y2). */
export function arrowHead(s: Pick<ShapeObject, "x1" | "y1" | "x2" | "y2" | "style">): number[] {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = arrowHeadLength(s.style.size, len);
  const half = head * 0.55;
  const bx = s.x2 - ux * head;
  const by = s.y2 - uy * head;
  return [s.x2, s.y2, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half];
}

/** Outline of a shape as a flat x,y list (rotation applied); `closed` says whether to close it. */
export function shapeOutline(
  s: Pick<ShapeObject, "kind" | "x1" | "y1" | "x2" | "y2" | "rotation">,
): { pts: number[]; closed: boolean } {
  const { kind } = s;
  if (kind === "line" || kind === "arrow") return { pts: [s.x1, s.y1, s.x2, s.y2], closed: false };
  const minX = Math.min(s.x1, s.x2);
  const minY = Math.min(s.y1, s.y2);
  const maxX = Math.max(s.x1, s.x2);
  const maxY = Math.max(s.y1, s.y2);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let pts: number[];
  let closed = true;
  const w = maxX - minX;
  const h = maxY - minY;
  /** Points on the box ellipse at the given angles (radians, 0 = right, clockwise on screen). */
  const around = (n: number, start: number, radius = (_i: number) => 1) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      out.push(cx + (w / 2) * radius(i) * Math.cos(a), cy + (h / 2) * radius(i) * Math.sin(a));
    }
    return out;
  };
  switch (kind as Exclude<ShapeKind, "line" | "arrow">) {
    case "star":
      // Five points, the top one up; inner corners at 40% of the size.
      pts = around(10, -Math.PI / 2, (i) => (i % 2 ? 0.4 : 1));
      break;
    case "hexagon":
      pts = [minX + w * 0.25, minY, minX + w * 0.75, minY, maxX, cy, minX + w * 0.75, maxY, minX + w * 0.25, maxY, minX, cy];
      break;
    case "bubble": {
      // A rounded speech bubble with its tail at the bottom left.
      const body = minY + h * 0.78;
      const r = Math.min(w, body - minY) * 0.18;
      const corner = (x: number, y: number, a0: number) => {
        const out: number[] = [];
        for (let i = 0; i <= 6; i++) {
          const a = a0 + (i / 6) * (Math.PI / 2);
          out.push(x + r * Math.cos(a), y + r * Math.sin(a));
        }
        return out;
      };
      pts = [
        ...corner(minX + r, minY + r, Math.PI),
        ...corner(maxX - r, minY + r, -Math.PI / 2),
        ...corner(maxX - r, body - r, 0),
        minX + w * 0.42, body,
        minX + w * 0.16, maxY,
        minX + w * 0.24, body,
        ...corner(minX + r, body - r, Math.PI / 2),
      ];
      break;
    }
    case "check":
      // A tick: short stroke down, long stroke up.
      pts = [minX, minY + h * 0.55, minX + w * 0.36, maxY, maxX, minY];
      closed = false;
      break;
    case "xmark": {
      // A bold cross as one outline (it can be filled): arm width a fifth of the size.
      const t = Math.min(w, h) * 0.14;
      const k = t / Math.SQRT2;
      pts = [
        minX + k, minY, cx, cy - t * 0.7, maxX - k, minY,
        maxX, minY + k, cx + t * 0.7, cy, maxX, maxY - k,
        maxX - k, maxY, cx, cy + t * 0.7, minX + k, maxY,
        minX, maxY - k, cx - t * 0.7, cy, minX, minY + k,
      ];
      break;
    }
    case "rect":
      pts = [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
      break;
    case "triangle":
      pts = [cx, minY, maxX, maxY, minX, maxY];
      break;
    case "diamond":
      pts = [cx, minY, maxX, cy, cx, maxY, minX, cy];
      break;
    case "ellipse": {
      const rx = (maxX - minX) / 2;
      const ry = (maxY - minY) / 2;
      pts = [];
      for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
        const a = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
        pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
      }
      break;
    }
  }
  if (s.rotation) {
    const m = rotateAbout(s.rotation, cx, cy);
    for (let i = 0; i < pts.length; i += 2) {
      const p = apply(m, pts[i]!, pts[i + 1]!);
      pts[i] = p.x;
      pts[i + 1] = p.y;
    }
  }
  return { pts, closed };
}

export function shapeBounds(s: Omit<ShapeObject, "bounds" | "id">): Bounds {
  let pad = s.style.size / 2 + 1;
  if (s.kind === "arrow") pad += arrowHeadLength(s.style.size, Math.hypot(s.x2 - s.x1, s.y2 - s.y1)) * 0.6;
  const { pts } = shapeOutline(s);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]!);
    maxX = Math.max(maxX, pts[i]!);
    minY = Math.min(minY, pts[i + 1]!);
    maxY = Math.max(maxY, pts[i + 1]!);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function pointInPolygon(px: number, py: number, pts: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]!;
    const yi = pts[i + 1]!;
    const xj = pts[j]!;
    const yj = pts[j + 1]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shapeHitsSegment(s: ShapeObject, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const { pts, closed } = shapeOutline(s);
  const r = radius + s.style.size / 2;
  const r2 = r * r;
  const n = pts.length;
  const last = closed ? n : n - 2;
  for (let i = 0; i < last; i += 2) {
    const j = (i + 2) % n;
    if (segmentDistanceSq(pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!, ax, ay, bx, by) <= r2) return true;
  }
  if (s.kind === "arrow") {
    const h = arrowHead(s);
    if (pointInPolygon(ax, ay, h) || segmentDistanceSq(h[2]!, h[3]!, h[4]!, h[5]!, ax, ay, bx, by) <= r2) return true;
  }
  // Filled shapes are hit anywhere inside.
  return closed && s.style.fill !== "none" && (pointInPolygon(ax, ay, pts) || pointInPolygon(bx, by, pts));
}

// ---------- text ----------

/** Corners of the padded text box, rotated about (x, y): [x0,y0, x1,y1, x2,y2, x3,y3]. */
export function textCorners(t: Pick<TextObject, "x" | "y" | "width" | "height" | "rotation">): number[] {
  const p = TEXT_PAD;
  const local = [t.x - p, t.y - p, t.x + t.width + p, t.y - p, t.x + t.width + p, t.y + t.height + p, t.x - p, t.y + t.height + p];
  if (!t.rotation) return local;
  const m = rotateAbout(t.rotation, t.x, t.y);
  const out: number[] = [];
  for (let i = 0; i < 8; i += 2) {
    const q = apply(m, local[i]!, local[i + 1]!);
    out.push(q.x, q.y);
  }
  return out;
}

export function textBounds(t: Pick<TextObject, "x" | "y" | "width" | "height" | "rotation">): Bounds {
  const c = textCorners(t);
  return {
    minX: Math.min(c[0]!, c[2]!, c[4]!, c[6]!),
    minY: Math.min(c[1]!, c[3]!, c[5]!, c[7]!),
    maxX: Math.max(c[0]!, c[2]!, c[4]!, c[6]!),
    maxY: Math.max(c[1]!, c[3]!, c[5]!, c[7]!),
  };
}

function rectHitsSegment(b: Bounds, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const inside = (x: number, y: number) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  if (inside(ax, ay) || inside(bx, by)) return true;
  const r2 = radius * radius;
  const edges = [
    [b.minX, b.minY, b.maxX, b.minY],
    [b.maxX, b.minY, b.maxX, b.maxY],
    [b.maxX, b.maxY, b.minX, b.maxY],
    [b.minX, b.maxY, b.minX, b.minY],
  ] as const;
  return edges.some(([x1, y1, x2, y2]) => segmentDistanceSq(x1, y1, x2, y2, ax, ay, bx, by) <= r2);
}

function textHitsSegment(t: TextObject, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  // Work in the text's own (unrotated) frame.
  const inv = rotateAbout(-t.rotation, t.x, t.y);
  const a = apply(inv, ax, ay);
  const b = apply(inv, bx, by);
  const p = TEXT_PAD;
  return rectHitsSegment({ minX: t.x - p, minY: t.y - p, maxX: t.x + t.width + p, maxY: t.y + t.height + p }, a.x, a.y, b.x, b.y, radius);
}

// ---------- images ----------

/** Corners of an image box (nw, ne, se, sw) as [x0,y0, …]. */
export function imageCorners(i: Pick<ImageObject, "cx" | "cy" | "width" | "height" | "rotation">): number[] {
  const m = rotateAbout(i.rotation, i.cx, i.cy);
  const out: number[] = [];
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const q = apply(m, i.cx + (sx * i.width) / 2, i.cy + (sy * i.height) / 2);
    out.push(q.x, q.y);
  }
  return out;
}

export function imageBounds(i: Pick<ImageObject, "cx" | "cy" | "width" | "height" | "rotation">): Bounds {
  const c = imageCorners(i);
  return {
    minX: Math.min(c[0]!, c[2]!, c[4]!, c[6]!),
    minY: Math.min(c[1]!, c[3]!, c[5]!, c[7]!),
    maxX: Math.max(c[0]!, c[2]!, c[4]!, c[6]!),
    maxY: Math.max(c[1]!, c[3]!, c[5]!, c[7]!),
  };
}

/** Images are opaque: anywhere inside them counts. */
function imageHitsSegment(i: ImageObject, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const inv = rotateAbout(-i.rotation, i.cx, i.cy);
  const a = apply(inv, ax, ay);
  const b = apply(inv, bx, by);
  return rectHitsSegment(
    { minX: i.cx - i.width / 2, minY: i.cy - i.height / 2, maxX: i.cx + i.width / 2, maxY: i.cy + i.height / 2 },
    a.x,
    a.y,
    b.x,
    b.y,
    radius,
  );
}

// ---------- all objects ----------

/** True if the object's visible geometry comes within `radius` of segment AB. */
export function objectHitsSegment(obj: BoardObject, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  switch (obj.type) {
    case "stroke":
      return polylineHitsSegment(obj.points, ax, ay, bx, by, radius + obj.style.size / 2);
    case "shape":
      return shapeHitsSegment(obj, ax, ay, bx, by, radius);
    case "text":
      return textHitsSegment(obj, ax, ay, bx, by, radius);
    case "image":
      return imageHitsSegment(obj, ax, ay, bx, by, radius);
  }
}

/** True if the point is within `radius` of the object (used for click selection). */
export function objectHitsPoint(obj: BoardObject, x: number, y: number, radius: number): boolean {
  if (obj.type === "stroke" && obj.points.length === 6 && obj.points[0] === obj.points[3]) {
    return distToSegmentSq(x, y, obj.points[0]!, obj.points[1]!, obj.points[0]!, obj.points[1]!) <= (radius + obj.style.size) ** 2;
  }
  return objectHitsSegment(obj, x, y, x, y, radius);
}

export function boundsContain(outer: Bounds, inner: Bounds): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function boundsFrame(b: Bounds): Frame {
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, h: b.maxY - b.minY, angle: 0 };
}

/**
 * The object's own oriented frame: rotated box for box shapes and text,
 * axis-aligned bounds otherwise.
 */
export function objectFrame(obj: BoardObject): Frame {
  if (obj.type === "image") return { cx: obj.cx, cy: obj.cy, w: obj.width, h: obj.height, angle: obj.rotation };
  if (obj.type === "text") {
    const p = TEXT_PAD;
    const c = apply(rotateAbout(obj.rotation, obj.x, obj.y), obj.x + obj.width / 2, obj.y + obj.height / 2);
    return { cx: c.x, cy: c.y, w: obj.width + 2 * p, h: obj.height + 2 * p, angle: obj.rotation };
  }
  if (isBoxShape(obj)) {
    const pad = obj.style.size / 2 + 1;
    return {
      cx: (obj.x1 + obj.x2) / 2,
      cy: (obj.y1 + obj.y2) / 2,
      w: Math.abs(obj.x2 - obj.x1) + 2 * pad,
      h: Math.abs(obj.y2 - obj.y1) + 2 * pad,
      angle: obj.rotation,
    };
  }
  return boundsFrame(obj.bounds);
}

/** Corners of a frame (nw, ne, se, sw). */
export function frameCorners(f: Frame): { x: number; y: number }[] {
  const m = rotateAbout(f.angle, f.cx, f.cy);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => apply(m, f.cx + (sx! * f.w) / 2, f.cy + (sy! * f.h) / 2));
}

/** Applies a matrix to a frame that it maps to another rectangle (rotation, uniform or along-axis scale). */
export function transformFrame(f: Frame, m: Matrix): Frame {
  const c = apply(m, f.cx, f.cy);
  const u = applyVector(m, Math.cos(f.angle), Math.sin(f.angle));
  const v = applyVector(m, -Math.sin(f.angle), Math.cos(f.angle));
  return { cx: c.x, cy: c.y, w: f.w * Math.hypot(u.x, u.y), h: f.h * Math.hypot(v.x, v.y), angle: normalizeAngle(Math.atan2(u.y, u.x)) };
}

export function framePointInside(f: Frame, x: number, y: number): boolean {
  const p = apply(rotateAbout(-f.angle, f.cx, f.cy), x, y);
  return Math.abs(p.x - f.cx) <= f.w / 2 && Math.abs(p.y - f.cy) <= f.h / 2;
}

/**
 * Applies a matrix, returning a new object with the same id. Ink and line
 * points are mapped directly (ink thickness scales with the area change).
 * Box shapes and text keep a rectangle: their centre/anchor moves, their
 * size follows the matrix along their own axes and their rotation turns
 * with it. Shape outlines keep their width; text scales its font.
 */
export function transformObject<T extends BoardObject>(obj: T, m: Matrix): T {
  switch (obj.type) {
    case "stroke": {
      const s = obj as StrokeObject;
      const points = s.points.slice();
      for (let i = 0; i < points.length; i += 3) {
        const p = apply(m, points[i]!, points[i + 1]!);
        points[i] = p.x;
        points[i + 1] = p.y;
      }
      const size = clamp(s.style.size * Math.sqrt(Math.abs(determinant(m))), 0.5, 500);
      return { ...s, points, style: { ...s.style, size }, bounds: pointsBounds(points, size) } as T;
    }
    case "shape": {
      const s = obj as ShapeObject;
      let next: Omit<ShapeObject, "bounds">;
      if (s.kind !== "line" && s.kind !== "arrow") {
        const c = apply(m, (s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
        const u = applyVector(m, Math.cos(s.rotation), Math.sin(s.rotation));
        const v = applyVector(m, -Math.sin(s.rotation), Math.cos(s.rotation));
        const w = Math.abs(s.x2 - s.x1) * Math.hypot(u.x, u.y);
        const h = Math.abs(s.y2 - s.y1) * Math.hypot(v.x, v.y);
        next = { ...s, x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2, rotation: normalizeAngle(Math.atan2(u.y, u.x)) };
      } else {
        const p1 = apply(m, s.x1, s.y1);
        const p2 = apply(m, s.x2, s.y2);
        next = { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, rotation: 0 };
      }
      return { ...next, bounds: shapeBounds(next) } as T;
    }
    case "text": {
      const s = obj as TextObject;
      const p = apply(m, s.x, s.y);
      const u = applyVector(m, Math.cos(s.rotation), Math.sin(s.rotation));
      const k = Math.hypot(u.x, u.y);
      const next = {
        ...s,
        x: p.x,
        y: p.y,
        width: s.width * k,
        height: s.height * k,
        rotation: normalizeAngle(Math.atan2(u.y, u.x)),
        style: { ...s.style, fontSize: clamp(s.style.fontSize * k, 4, 2000) },
      };
      return { ...next, bounds: textBounds(next) } as T;
    }
    case "image": {
      // Like a box shape; resizing is uniform for images, so the aspect ratio holds.
      const s = obj as ImageObject;
      const c = apply(m, s.cx, s.cy);
      const u = applyVector(m, Math.cos(s.rotation), Math.sin(s.rotation));
      const v = applyVector(m, -Math.sin(s.rotation), Math.cos(s.rotation));
      const next = {
        ...s,
        cx: c.x,
        cy: c.y,
        width: Math.max(1, s.width * Math.hypot(u.x, u.y)),
        height: Math.max(1, s.height * Math.hypot(v.x, v.y)),
        rotation: normalizeAngle(Math.atan2(u.y, u.x)),
      };
      return { ...next, bounds: imageBounds(next) } as T;
    }
  }
  return obj;
}

/** Returns a copy with a new colour (stroke, shape outline or text). Images are returned unchanged. */
export function recolorObject<T extends BoardObject>(obj: T, color: string): T {
  if (!hasColor(obj)) return obj;
  return { ...obj, style: { ...obj.style, color } } as T;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
