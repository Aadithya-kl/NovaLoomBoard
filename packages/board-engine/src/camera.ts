import type { Bounds } from "./model";

/** screen = (world - {x, y}) * zoom */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y };
}

export function worldToScreen(cam: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

/** Zoom by `factor`, keeping the world point under screen point (sx, sy) fixed. */
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const zoom = clampZoom(cam.zoom * factor);
  const anchor = screenToWorld(cam, sx, sy);
  return { x: anchor.x - sx / zoom, y: anchor.y - sy / zoom, zoom };
}

export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...cam, x: cam.x - dxScreen / cam.zoom, y: cam.y - dyScreen / cam.zoom };
}

export function viewportBounds(cam: Camera, width: number, height: number): Bounds {
  return { minX: cam.x, minY: cam.y, maxX: cam.x + width / cam.zoom, maxY: cam.y + height / cam.zoom };
}

/** Camera that fits `bounds` into a viewport with a margin; null if bounds are empty. */
export function fitBounds(bounds: Bounds, width: number, height: number, margin = 48): Camera | null {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  if (!(bw >= 0 && bh >= 0) || width <= 0 || height <= 0) return null;
  const availW = Math.max(1, width - margin * 2);
  const availH = Math.max(1, height - margin * 2);
  const zoom = clampZoom(Math.min(availW / Math.max(bw, 1), availH / Math.max(bh, 1), 1));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx - width / 2 / zoom, y: cy - height / 2 / zoom, zoom };
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Camera that fits `bounds` into the part of a viewport not covered by
 * floating panels (`insets`, screen pixels along each edge).
 */
export function fitBoundsInset(bounds: Bounds, width: number, height: number, insets: Insets, margin = 48): Camera | null {
  const w = Math.max(80, width - insets.left - insets.right);
  const h = Math.max(80, height - insets.top - insets.bottom);
  const cam = fitBounds(bounds, w, h, margin);
  return cam && { ...cam, x: cam.x - insets.left / cam.zoom, y: cam.y - insets.top / cam.zoom };
}
