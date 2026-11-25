/** Selection handles and the transforms that handle drags produce. Pure. */
import { apply, multiply, rotateAbout, scaleAbout, translate, type Matrix } from "./matrix";
import type { Frame } from "./objects";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const CORNER_HANDLES: readonly Handle[] = ["nw", "ne", "se", "sw"];
export const SIDE_HANDLES: readonly Handle[] = ["n", "e", "s", "w"];

/** Smallest size (world units) a selection can be resized to. */
const MIN_SIZE = 4;

/** Handle position as fractions of the frame (0 = min, 1 = max) in its own axes. */
const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** Point in a frame given in its own normalised coordinates (0..1). */
function framePoint(f: Frame, fx: number, fy: number, extraY = 0): { x: number; y: number } {
  const local = { x: f.cx + (fx - 0.5) * f.w, y: f.cy + (fy - 0.5) * f.h + extraY };
  return apply(rotateAbout(f.angle, f.cx, f.cy), local.x, local.y);
}

export function handlePoint(f: Frame, h: Handle): { x: number; y: number } {
  const [fx, fy] = HANDLE_POS[h];
  return framePoint(f, fx, fy);
}

/** Rotation handle: above the top edge's midpoint, `offset` further out along the frame's up direction. */
export function rotationHandlePoint(f: Frame, offset: number): { x: number; y: number } {
  return framePoint(f, 0.5, 0, -offset);
}

const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];
const HANDLE_DIR: Record<Handle, number> = { n: 0, ne: 1, e: 2, se: 3, s: 0, sw: 1, w: 2, nw: 3 };

/** CSS resize cursor for a handle, turned with the frame. */
export function handleCursor(h: Handle, angle = 0): string {
  const steps = Math.round(angle / (Math.PI / 4));
  return CURSORS[(((HANDLE_DIR[h] + steps) % 4) + 4) % 4]!;
}

/**
 * Matrix for dragging handle `h` of frame `f` by (dx, dy) world units. The
 * opposite corner/side stays fixed. Corners keep the aspect ratio unless
 * `free` is set; side handles stretch along one of the frame's axes. Never
 * mirrors.
 */
export function resizeMatrix(f: Frame, h: Handle, dx: number, dy: number, free: boolean): Matrix {
  // Work in the frame's own axes, centred on its middle.
  const toLocal = multiply(rotateAbout(-f.angle, 0, 0), translate(-f.cx, -f.cy));
  const toWorld = multiply(translate(f.cx, f.cy), rotateAbout(f.angle, 0, 0));
  const ld = apply(rotateAbout(-f.angle, 0, 0), dx, dy);
  const w = Math.max(f.w, 1e-6);
  const hgt = Math.max(f.h, 1e-6);
  const [fx, fy] = HANDLE_POS[h];
  const ax = (0.5 - fx) * w;
  const ay = (0.5 - fy) * hgt;
  const dirX = fx === 0.5 ? 0 : fx === 1 ? 1 : -1;
  const dirY = fy === 0.5 ? 0 : fy === 1 ? 1 : -1;
  let sx = dirX === 0 ? 1 : Math.max(MIN_SIZE / w, (w + ld.x * dirX) / w);
  let sy = dirY === 0 ? 1 : Math.max(MIN_SIZE / hgt, (hgt + ld.y * dirY) / hgt);
  if (dirX !== 0 && dirY !== 0 && !free) {
    const s = Math.max(sx, sy);
    sx = s;
    sy = s;
  }
  return multiply(toWorld, multiply(scaleAbout(sx, sy, ax, ay), toLocal));
}

/** Angle from the frame centre to a point, for rotation drags. */
export function angleFrom(f: Frame, x: number, y: number): number {
  return Math.atan2(y - f.cy, x - f.cx);
}

/** Rounds an angle to the nearest multiple of `step`. */
export function snapAngle(theta: number, step = Math.PI / 12): number {
  return Math.round(theta / step) * step;
}
