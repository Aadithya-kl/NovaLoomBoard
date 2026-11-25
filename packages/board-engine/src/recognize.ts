/**
 * Cleaning up hand-drawn ink: light smoothing of every stroke, and turning a rough line,
 * angle, triangle, rectangle, polygon, circle or ellipse into a clean one when the person
 * holds still at the end of the stroke. The clean shape stays ink (a stroke with the same
 * tool, colour and width), only straighter and rounder.
 */

export interface Pt {
  x: number;
  y: number;
}

export type RecognizedShape =
  | { kind: "line" | "polyline"; points: Pt[] }
  | { kind: "polygon"; points: Pt[] }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; angle: number };

/**
 * Gaussian smoothing of a stroke's positions along its length (`sigma` in board units),
 * which removes the jitter of a mouse, finger or shaky hand without changing its shape.
 * The ends stay where they were; pressures are kept.
 */
export function smoothInk(points: readonly number[], sigma: number): number[] {
  const n = points.length / 3;
  if (n < 5 || !(sigma > 0)) return points.slice();
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1]! + Math.hypot(points[i * 3]! - points[i * 3 - 3]!, points[i * 3 + 1]! - points[i * 3 - 2]!);
  const out = points.slice();
  const total = s[n - 1]!;
  let lo = 0;
  for (let i = 1; i < n - 1; i++) {
    // Less smoothing near the ends, so they do not pull inwards.
    const sig = Math.min(sigma, s[i]! / 2, (total - s[i]!) / 2);
    if (sig < 1e-6) continue;
    const reach = sig * 2.5;
    while (s[lo]! < s[i]! - reach) lo++;
    let wx = 0;
    let wy = 0;
    let wt = 0;
    for (let j = lo; j < n && s[j]! <= s[i]! + reach; j++) {
      const d = s[j]! - s[i]!;
      const w = Math.exp((-d * d) / (2 * sig * sig));
      wx += points[j * 3]! * w;
      wy += points[j * 3 + 1]! * w;
      wt += w;
    }
    out[i * 3] = wx / wt;
    out[i * 3 + 1] = wy / wt;
  }
  return out;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(p: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += dist(p[i - 1]!, p[i]!);
  return l;
}

/** Points every `step` along the path (first and last kept). */
function resample(p: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [p[0]!];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    const d = dist(a, b);
    if (d === 0) continue;
    let t = step - carry;
    while (t <= d) {
      out.push({ x: a.x + ((b.x - a.x) * t) / d, y: a.y + ((b.y - a.y) * t) / d });
      t += step;
    }
    carry = d - (t - step);
  }
  const last = p[p.length - 1]!;
  if (dist(out[out.length - 1]!, last) > step * 0.25) out.push(last);
  return out;
}

/** Distance from p to the segment ab. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Ramer–Douglas–Peucker: indices of the points kept. */
function simplify(p: readonly Pt[], eps: number): number[] {
  const keep = new Uint8Array(p.length);
  keep[0] = 1;
  keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1;
    let bestD = eps;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(p[k]!, p[i]!, p[j]!);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

/** Interior angle at b (degrees, 180 for a straight line). */
function cornerAngle(a: Pt, b: Pt, c: Pt): number {
  const v1 = Math.atan2(a.y - b.y, a.x - b.x);
  const v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(v1 - v2) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

/** Drops corners that are nearly straight or too close to a neighbour. */
function cleanCorners(v: Pt[], closed: boolean, minEdge: number): Pt[] {
  let changed = true;
  while (changed && v.length > (closed ? 3 : 2)) {
    changed = false;
    const n = v.length;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const a = v[(i - 1 + n) % n]!;
      const b = v[i]!;
      const c = v[(i + 1) % n]!;
      if (cornerAngle(a, b, c) > 152 || dist(a, b) < minEdge || dist(b, c) < minEdge) {
        v.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return v;
}

/** Mean distance of the points to a polyline (closed: back to the first vertex). */
function polylineError(p: readonly Pt[], v: readonly Pt[], closed: boolean): number {
  let sum = 0;
  const m = closed ? v.length : v.length - 1;
  for (const q of p) {
    let best = Infinity;
    for (let i = 0; i < m; i++) best = Math.min(best, segDist(q, v[i]!, v[(i + 1) % v.length]!));
    sum += best;
  }
  return sum / p.length;
}

/**
 * True when every segment was drawn straight: the points nearest to it stay within a few
 * percent of its length. A smooth curve cut into segments bulges away from them instead.
 */
function segmentsStraight(p: readonly Pt[], v: readonly Pt[], closed: boolean): boolean {
  const m = closed ? v.length : v.length - 1;
  const worst = new Array<number>(m).fill(0);
  for (const q of p) {
    let best = Infinity;
    let at = 0;
    for (let i = 0; i < m; i++) {
      const d = segDist(q, v[i]!, v[(i + 1) % v.length]!);
      if (d < best) {
        best = d;
        at = i;
      }
    }
    worst[at] = Math.max(worst[at]!, best);
  }
  return worst.every((d, i) => d <= Math.max(4, 0.06 * dist(v[i]!, v[(i + 1) % v.length]!)));
}

/** Best-fitting ellipse through PCA of the outline, and how far the points stray from it (relative). */
function fitEllipse(p: readonly Pt[]): { cx: number; cy: number; rx: number; ry: number; angle: number; error: number } {
  let mx = 0;
  let my = 0;
  for (const q of p) {
    mx += q.x;
    my += q.y;
  }
  mx /= p.length;
  my /= p.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const q of p) {
    sxx += (q.x - mx) ** 2;
    syy += (q.y - my) ** 2;
    sxy += (q.x - mx) * (q.y - my);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const q of p) {
    const u = (q.x - mx) * c + (q.y - my) * s;
    const v = -(q.x - mx) * s + (q.y - my) * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const rx = Math.max(1e-6, (u1 - u0) / 2);
  const ry = Math.max(1e-6, (v1 - v0) / 2);
  const ou = (u0 + u1) / 2;
  const ov = (v0 + v1) / 2;
  const cx = mx + ou * c - ov * s;
  const cy = my + ou * s + ov * c;
  let err = 0;
  for (const q of p) {
    const u = (q.x - cx) * c + (q.y - cy) * s;
    const v = -(q.x - cx) * s + (q.y - cy) * c;
    err += Math.abs(Math.hypot(u / rx, v / ry) - 1);
  }
  return { cx, cy, rx, ry, angle, error: err / p.length };
}

const DEG = Math.PI / 180;

/** `angle` pulled onto a multiple of `step` when within `tol` (radians). */
function magnet(angle: number, step: number, tol: number): number {
  const near = Math.round(angle / step) * step;
  return Math.abs(angle - near) <= tol ? near : angle;
}

/** A rectangle fitted to four rough corners: the outline's extents along its main direction. */
function fitRectangle(p: readonly Pt[], corners: readonly Pt[]): Pt[] {
  // Average edge direction modulo 90° (angles ×4 so opposite and perpendicular edges agree).
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const t = Math.atan2(b.y - a.y, b.x - a.x) * 4;
    const w = dist(a, b);
    ax += Math.cos(t) * w;
    ay += Math.sin(t) * w;
  }
  const theta = magnet(Math.atan2(ay, ax) / 4, Math.PI / 2, 4 * DEG);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const q of p) {
    const u = q.x * c + q.y * s;
    const v = -q.x * s + q.y * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  // Nearly square: make it square.
  const w = u1 - u0;
  const h = v1 - v0;
  if (Math.abs(w - h) / Math.max(w, h) < 0.08) {
    const side = (w + h) / 2;
    const mu = (u0 + u1) / 2;
    const mv = (v0 + v1) / 2;
    [u0, u1, v0, v1] = [mu - side / 2, mu + side / 2, mv - side / 2, mv + side / 2];
  }
  const at = (u: number, v: number): Pt => ({ x: u * c - v * s, y: u * s + v * c });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

/**
 * The clean shape a rough stroke was meant to be, or null when it is not clearly one.
 * Points are in screen pixels (board units × zoom), so the tolerances match what is seen.
 */
export function recognizeShape(input: readonly Pt[]): RecognizedShape | null {
  if (input.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const q of input) {
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 24) return null;
  const length = pathLength(input);
  const p = resample(input, Math.max(2, length / 500));
  const first = p[0]!;
  const last = p[p.length - 1]!;

  // A straight line: nearly as long as the path, and never far from it.
  const chord = dist(first, last);
  if (chord / length > 0.9) {
    let dev = 0;
    for (const q of p) dev = Math.max(dev, segDist(q, first, last));
    if (dev < Math.max(5, chord * 0.05)) {
      // Horizontal, vertical and 45° lines snap exactly when within 3°.
      const a = magnet(Math.atan2(last.y - first.y, last.x - first.x), Math.PI / 4, 3 * DEG);
      return { kind: "line", points: [first, { x: first.x + Math.cos(a) * chord, y: first.y + Math.sin(a) * chord }] };
    }
  }

  const closed = chord < Math.max(18, diag * 0.2) && length > diag * 1.8;
  if (closed) {
    // Close the loop, starting at the point farthest from the middle (surely a corner, if any).
    const ring = p.slice(0, chord < 2 ? -1 : undefined);
    const mx = ring.reduce((s, q) => s + q.x, 0) / ring.length;
    const my = ring.reduce((s, q) => s + q.y, 0) / ring.length;
    let far = 0;
    ring.forEach((q, i) => {
      if (Math.hypot(q.x - mx, q.y - my) > Math.hypot(ring[far]!.x - mx, ring[far]!.y - my)) far = i;
    });
    const loop = [...ring.slice(far), ...ring.slice(0, far), ring[far]!];
    const corners = cleanCorners(
      simplify(loop, Math.max(5, diag * 0.07))
        .slice(0, -1)
        .map((i) => loop[i]!),
      true,
      diag * 0.1,
    );
    const ellipse = fitEllipse(ring);
    const polyErr = corners.length >= 3 ? polylineError(ring, corners, true) / diag : Infinity;
    const n = corners.length;
    if (ellipse.error < 0.08 && (n < 3 || n > 6 || ellipse.error <= polyErr * 1.3)) {
      let { rx, ry, angle } = ellipse;
      if (Math.max(rx, ry) / Math.min(rx, ry) < 1.12) rx = ry = (rx + ry) / 2;
      angle = magnet(angle, Math.PI / 2, 5 * DEG);
      return { kind: "ellipse", cx: ellipse.cx, cy: ellipse.cy, rx, ry, angle };
    }
    if (n >= 3 && n <= 6 && polyErr < 0.05 && segmentsStraight(ring, corners, true)) {
      if (n === 4 && corners.every((_, i) => Math.abs(cornerAngle(corners[(i + 3) % 4]!, corners[i]!, corners[(i + 1) % 4]!) - 90) < 16)) {
        return { kind: "polygon", points: fitRectangle(ring, corners) };
      }
      return { kind: "polygon", points: corners };
    }
    return null;
  }

  // An angle, a zigzag or an arrow drawn in one go: straight segments between clear corners.
  const verts = cleanCorners(
    simplify(p, Math.max(4, diag * 0.05)).map((i) => p[i]!),
    false,
    diag * 0.08,
  );
  if (verts.length >= 3 && verts.length <= 5 && polylineError(p, verts, false) / diag < 0.035 && segmentsStraight(p, verts, false)) {
    return { kind: "polyline", points: verts };
  }
  return null;
}

/** Ink points (x, y, pressure triples) tracing a clean shape every `spacing` units, at a steady pressure. */
export function shapeToInk(shape: RecognizedShape, spacing: number, pressure = 0.5): number[] {
  const out: number[] = [];
  const push = (q: Pt) => out.push(q.x, q.y, pressure);
  if (shape.kind === "ellipse") {
    const { cx, cy, rx, ry, angle } = shape;
    const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const n = Math.max(48, Math.ceil(perimeter / spacing));
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Once round and one step more, so the ends join without a gap.
    for (let i = 0; i <= n + 1; i++) {
      const t = (i / n) * Math.PI * 2;
      const u = Math.cos(t) * rx;
      const v = Math.sin(t) * ry;
      push({ x: cx + u * c - v * s, y: cy + u * s + v * c });
    }
    return out;
  }
  const v = shape.kind === "polygon" ? [...shape.points, shape.points[0]!, shape.points[1]!] : shape.points;
  push(v[0]!);
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1]!;
    const b = v[i]!;
    const d = dist(a, b);
    // The extra edge of a closed shape only goes one step past the start.
    const isOverlap = shape.kind === "polygon" && i === v.length - 1;
    const steps = Math.max(1, Math.ceil(d / spacing));
    const until = isOverlap ? Math.min(steps, 1) : steps;
    for (let k = 1; k <= until; k++) push({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
  }
  return out;
}
