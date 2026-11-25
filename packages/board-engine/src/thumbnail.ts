import type { Camera } from "./camera";
import { drawObject, PathCache } from "./draw";
import { unionBounds } from "./geometry";
import type { BoardObject, Bounds } from "./model";
import { isDarkBackground, paperColor, type Background } from "./paper";
import { drawBackgroundPattern } from "./renderer";

/**
 * Stroke outlines keyed by object identity: a moved stroke keeps its id but
 * is a new object, so it is never drawn from a stale outline.
 */
export class ThumbnailPaths extends PathCache {
  /** Thumbnails do not keep images in memory as if they were on screen. */
  override readonly pinsImages = false;
}

/** A thumbnail always shows at least this much of the board (world units), so a lone dot stays small. */
const MIN_EXTENT = 480;

/**
 * Camera showing all of a page's content in a `width`×`height` thumbnail,
 * with a small margin. Empty pages show the board around the origin.
 */
export function thumbnailCamera(objects: readonly BoardObject[], width: number, height: number): Camera {
  let b: Bounds | null = null;
  for (const o of objects) b = b ? unionBounds(b, o.bounds) : o.bounds;
  if (!b) return { x: 0, y: 0, zoom: width / MIN_EXTENT };
  const margin = 0.08;
  const bw = Math.max(b.maxX - b.minX, MIN_EXTENT * (1 - 2 * margin));
  const bh = Math.max(b.maxY - b.minY, (MIN_EXTENT * (1 - 2 * margin) * height) / width);
  const zoom = Math.min((width * (1 - 2 * margin)) / bw, (height * (1 - 2 * margin)) / bh);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { x: cx - width / 2 / zoom, y: cy - height / 2 / zoom, zoom };
}

/** Draws a page preview (background pattern and every object) into a canvas sized for `dpr`. */
export function renderThumbnail(
  canvas: HTMLCanvasElement,
  objects: readonly BoardObject[],
  background: Background,
  width: number,
  height: number,
  dpr: number,
  paths: PathCache = new ThumbnailPaths(),
): void {
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = paperColor(background);
  ctx.fillRect(0, 0, w, h);
  const cam = thumbnailCamera(objects, width, height);
  drawBackgroundPattern(ctx, cam, background, width, height, dpr);
  const k = dpr * cam.zoom;
  ctx.setTransform(k, 0, 0, k, -cam.x * k, -cam.y * k);
  const dark = isDarkBackground(background);
  for (const obj of objects) drawObject(ctx, obj, paths, false, dark);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
