/**
 * 2D affine matrices in canvas order: x' = a·x + c·y + e, y' = b·x + d·y + f.
 */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const isIdentity = (m: Matrix) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;

export const translate = (dx: number, dy: number): Matrix => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });

/** `m` applied after `n`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function rotateAbout(theta: number, cx: number, cy: number): Matrix {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return { a: cos, b: sin, c: -sin, d: cos, e: cx - cos * cx + sin * cy, f: cy - sin * cx - cos * cy };
}

export function scaleAbout(sx: number, sy: number, ax: number, ay: number): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: ax - sx * ax, f: ay - sy * ay };
}

export function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Applies only the linear part (for direction vectors). */
export function applyVector(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y, y: m.b * x + m.d * y };
}

export const determinant = (m: Matrix) => m.a * m.d - m.b * m.c;

/** Normalises an angle to (-π, π]; values within 1e-9 of 0 become exactly 0. */
export function normalizeAngle(theta: number): number {
  let t = theta % (Math.PI * 2);
  if (t > Math.PI) t -= Math.PI * 2;
  if (t <= -Math.PI) t += Math.PI * 2;
  return Math.abs(t) < 1e-9 ? 0 : t;
}
