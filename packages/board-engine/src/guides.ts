/**
 * The ruler and the protractor: drawing aids that lie on top of the board, like the real
 * instruments on a sheet of paper. They live in screen space (they keep their size when
 * zooming) and are never saved or exported. Ink started along an edge follows it: a
 * straight line along the ruler or the protractor's base, an arc around the protractor.
 */

export type GuideKind = "ruler" | "protractor";

/** Position of a guide in screen pixels; `angle` turns it about its centre (radians). */
export interface Guide {
  kind: GuideKind;
  cx: number;
  cy: number;
  angle: number;
}

export const RULER_LENGTH = 720;
export const RULER_WIDTH = 76;
export const PROTRACTOR_RADIUS = 190;
/** Distance of the round rotate and close buttons from the guide, in pixels. */
const KNOB_GAP = 24;
export const KNOB_RADIUS = 12;
/** How far from an edge (outside, inside) a press still draws along it. */
const EDGE_OUTSIDE = 24;
const EDGE_INSIDE = 16;
/** Board units per millimetre (1 unit is one CSS pixel at 100%, 96 per inch). */
export const UNITS_PER_MM = 96 / 25.4;

/** A point in the guide's own frame: u along it, v across it (down is positive). */
export function toLocal(g: Guide, x: number, y: number): { u: number; v: number } {
  const dx = x - g.cx;
  const dy = y - g.cy;
  const c = Math.cos(g.angle);
  const s = Math.sin(g.angle);
  return { u: dx * c + dy * s, v: -dx * s + dy * c };
}

export function fromLocal(g: Guide, u: number, v: number): { x: number; y: number } {
  const c = Math.cos(g.angle);
  const s = Math.sin(g.angle);
  return { x: g.cx + u * c - v * s, y: g.cy + u * s + v * c };
}

/** The rotate and close buttons, in the guide's frame. */
export function knobs(kind: GuideKind): { rotate: { u: number; v: number }; close: { u: number; v: number } } {
  if (kind === "ruler") {
    return { rotate: { u: RULER_LENGTH / 2 + KNOB_GAP, v: 0 }, close: { u: -RULER_LENGTH / 2 - KNOB_GAP, v: 0 } };
  }
  // The protractor's flat edge is at v = 0, its arc above (v < 0).
  return { rotate: { u: 0, v: -PROTRACTOR_RADIUS - KNOB_GAP }, close: { u: PROTRACTOR_RADIUS + KNOB_GAP, v: 0 } };
}

/** The angle (in the guide's frame) at which its rotate button sits. */
export function rotateKnobAngle(kind: GuideKind): number {
  return kind === "ruler" ? 0 : -Math.PI / 2;
}

/** What ink drawn along a guide follows. */
export type GuideSnap =
  | { kind: "line"; guide: Guide; edge: "top" | "bottom" | "base" }
  | { kind: "arc"; guide: Guide };

export type GuideHit =
  | { part: "rotate" | "close" | "body"; guide: Guide }
  | { part: "edge"; guide: Guide; snap: GuideSnap };

/** What a press at (x, y) touches: an edge (only when drawing), a button, the body, or nothing. */
export function hitGuide(g: Guide, x: number, y: number, drawing: boolean): GuideHit | null {
  const { u, v } = toLocal(g, x, y);
  const k = knobs(g.kind);
  if (Math.hypot(u - k.rotate.u, v - k.rotate.v) <= KNOB_RADIUS + 3) return { part: "rotate", guide: g };
  if (Math.hypot(u - k.close.u, v - k.close.v) <= KNOB_RADIUS + 3) return { part: "close", guide: g };
  if (g.kind === "ruler") {
    const L = RULER_LENGTH / 2;
    const W = RULER_WIDTH / 2;
    if (drawing && Math.abs(u) <= L) {
      if (v >= -W - EDGE_OUTSIDE && v <= -W + EDGE_INSIDE) return { part: "edge", guide: g, snap: { kind: "line", guide: g, edge: "top" } };
      if (v >= W - EDGE_INSIDE && v <= W + EDGE_OUTSIDE) return { part: "edge", guide: g, snap: { kind: "line", guide: g, edge: "bottom" } };
    }
    return Math.abs(u) <= L && Math.abs(v) <= W ? { part: "body", guide: g } : null;
  }
  const R = PROTRACTOR_RADIUS;
  const r = Math.hypot(u, v);
  if (drawing) {
    if (v <= EDGE_INSIDE && r >= R - EDGE_INSIDE && r <= R + EDGE_OUTSIDE) return { part: "edge", guide: g, snap: { kind: "arc", guide: g } };
    if (Math.abs(u) <= R && v >= -EDGE_INSIDE && v <= EDGE_OUTSIDE) return { part: "edge", guide: g, snap: { kind: "line", guide: g, edge: "base" } };
  }
  return v <= 0 && r <= R ? { part: "body", guide: g } : null;
}

/**
 * Where ink at (x, y) lands along `snap`: on the edge, moved out by half the ink width
 * so the line touches the instrument without running under it.
 */
export function snapPoint(snap: GuideSnap, x: number, y: number, halfWidth: number): { x: number; y: number } {
  const g = snap.guide;
  const { u, v } = toLocal(g, x, y);
  if (snap.kind === "arc") {
    const r = PROTRACTOR_RADIUS + halfWidth;
    const a = arcAngle(u, v);
    return fromLocal(g, Math.cos(a) * r, Math.sin(a) * r);
  }
  if (g.kind === "ruler") {
    const L = RULER_LENGTH / 2;
    const edgeV = snap.edge === "top" ? -RULER_WIDTH / 2 - halfWidth : RULER_WIDTH / 2 + halfWidth;
    return fromLocal(g, Math.max(-L, Math.min(L, u)), edgeV);
  }
  const R = PROTRACTOR_RADIUS;
  return fromLocal(g, Math.max(-R, Math.min(R, u)), halfWidth);
}

/** Angle of (u, v) on the protractor's half circle, from 0 (right end) to -π (left end). */
function arcAngle(u: number, v: number): number {
  if (v >= 0) return u >= 0 ? 0 : -Math.PI;
  return Math.atan2(v, u);
}

/** The protractor reading at (x, y): 0° at its right end, 180° at its left end. */
export function protractorAngle(g: Guide, x: number, y: number): number {
  const { u, v } = toLocal(g, x, y);
  return (-arcAngle(u, v) * 180) / Math.PI;
}

/** Rotation in whole degrees, pulled to multiples of 15° when within 2.5° of one. */
export function snapGuideAngle(rad: number): number {
  let deg = (rad * 180) / Math.PI;
  const near = Math.round(deg / 15) * 15;
  deg = Math.abs(deg - near) <= 2.5 ? near : Math.round(deg);
  return (deg * Math.PI) / 180;
}

/** Rotation shown on a guide, in degrees within (-90, 90] for the ruler (it has no up or down) or (-180, 180]. */
export function displayAngle(g: Guide): number {
  let deg = Math.round((g.angle * 180) / Math.PI);
  deg = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (deg === -180) deg = 180;
  if (g.kind === "ruler") {
    if (deg > 90) deg -= 180;
    else if (deg <= -90) deg += 180;
  }
  // Screen y points down: show counter-clockwise as positive, as on paper.
  return deg === 0 ? 0 : -deg;
}

// ---------- drawing ----------

const BODY = "rgba(250, 251, 252, 0.84)";
const EDGE = "rgba(28, 32, 38, 0.42)";
const TICK = "rgba(28, 32, 38, 0.72)";
const TEXT = "#1c2026";
const FONT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

/** Tick spacing and labels for the ruler at a zoom: millimetres of board measured. */
function rulerScale(zoom: number): { minor: number; mid: number; label: number } {
  const pxPerMm = UNITS_PER_MM * zoom;
  const ladder = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000];
  const minor = ladder.find((mm) => mm * pxPerMm >= 3.5) ?? 10000;
  const label = ladder.find((mm) => mm >= 10 && mm >= minor && mm * pxPerMm >= 30) ?? 10000;
  const half = label / 2;
  const mid = half > minor && half % minor === 0 ? half : label;
  return { minor, mid, label };
}

function drawKnob(ctx: CanvasRenderingContext2D, x: number, y: number, kind: "rotate" | "close"): void {
  ctx.beginPath();
  ctx.arc(x, y, KNOB_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(28, 32, 38, 0.25)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(28, 32, 38, 0.2)";
  ctx.stroke();
  ctx.strokeStyle = "#3b414b";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (kind === "close") {
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
  } else {
    ctx.arc(x, y, 5, -Math.PI * 0.85, Math.PI * 0.55);
    ctx.stroke();
    // Arrow head at the end of the arc.
    const ex = x + 5 * Math.cos(Math.PI * 0.55);
    const ey = y + 5 * Math.sin(Math.PI * 0.55);
    ctx.beginPath();
    ctx.moveTo(ex - 3.2, ey + 0.6);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex + 0.4, ey - 3.2);
    ctx.stroke();
  }
}

function drawRuler(ctx: CanvasRenderingContext2D, g: Guide, zoom: number): void {
  const L = RULER_LENGTH / 2;
  const W = RULER_WIDTH / 2;
  ctx.beginPath();
  ctx.roundRect(-L, -W, RULER_LENGTH, RULER_WIDTH, 4);
  ctx.fillStyle = BODY;
  ctx.shadowColor = "rgba(28, 32, 38, 0.22)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1;
  ctx.strokeStyle = EDGE;
  ctx.stroke();

  // Centimetres of board along both long edges, from a zero just inside the left end.
  const { minor, mid, label } = rulerScale(zoom);
  const pxPerMm = UNITS_PER_MM * zoom;
  const start = -L + 12;
  ctx.strokeStyle = TICK;
  ctx.fillStyle = TEXT;
  ctx.font = `600 11px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.beginPath();
  for (let mm = 0; start + mm * pxPerMm <= L - 6; mm += minor) {
    const u = Math.round(start + mm * pxPerMm) + 0.5;
    const len = mm % label === 0 ? 16 : mm % mid === 0 ? 11 : 6;
    ctx.moveTo(u, -W);
    ctx.lineTo(u, -W + len);
    ctx.moveTo(u, W);
    ctx.lineTo(u, W - len);
  }
  ctx.lineWidth = 1;
  ctx.stroke();
  for (let mm = 0; start + mm * pxPerMm <= L - 6; mm += label) {
    const cm = mm / 10;
    const text = cm >= 100 ? `${cm / 100} m` : `${cm}`;
    ctx.fillText(text, start + mm * pxPerMm, -W + 18);
  }
  ctx.textAlign = "left";
  ctx.font = `500 10px ${FONT}`;
  ctx.fillStyle = "rgba(28, 32, 38, 0.55)";
  ctx.fillText("cm", start + 4, W - 30);

  // Its angle, in the middle.
  ctx.font = `600 13px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = TEXT;
  ctx.fillText(`${displayAngle(g)}°`, 0, 6);
}

function drawProtractor(ctx: CanvasRenderingContext2D): void {
  const R = PROTRACTOR_RADIUS;
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.arc(0, 0, R, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = BODY;
  ctx.shadowColor = "rgba(28, 32, 38, 0.22)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1;
  ctx.strokeStyle = EDGE;
  ctx.stroke();

  ctx.strokeStyle = TICK;
  ctx.beginPath();
  for (let d = 0; d <= 180; d++) {
    const a = (-d * Math.PI) / 180;
    const len = d % 10 === 0 ? 16 : d % 5 === 0 ? 10 : 5;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.moveTo(c * R, s * R);
    ctx.lineTo(c * (R - len), s * (R - len));
  }
  ctx.lineWidth = 1;
  ctx.stroke();

  // Outer scale counter-clockwise from the right, inner scale the other way.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let d = 0; d <= 180; d += 10) {
    const a = (-d * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = TEXT;
    ctx.fillText(String(d), c * (R - 28), s * (R - 28) + (d === 0 || d === 180 ? -6 : 0));
    ctx.font = `500 9px ${FONT}`;
    ctx.fillStyle = "rgba(28, 32, 38, 0.5)";
    ctx.fillText(String(180 - d), c * (R - 46), s * (R - 46) + (d === 0 || d === 180 ? -6 : 0));
  }
  // Lines to every 30°, faint, and the centre mark.
  ctx.beginPath();
  for (let d = 30; d < 180; d += 30) {
    const a = (-d * Math.PI) / 180;
    ctx.moveTo(Math.cos(a) * 14, Math.sin(a) * 14);
    ctx.lineTo(Math.cos(a) * (R - 58), Math.sin(a) * (R - 58));
  }
  ctx.strokeStyle = "rgba(28, 32, 38, 0.14)";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-10, 0);
  ctx.lineTo(10, 0);
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -10);
  ctx.strokeStyle = TICK;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** Draws a guide on a context set to screen pixels. */
export function drawGuide(ctx: CanvasRenderingContext2D, g: Guide, zoom: number): void {
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.rotate(g.angle);
  if (g.kind === "ruler") drawRuler(ctx, g, zoom);
  else drawProtractor(ctx);
  const k = knobs(g.kind);
  drawKnob(ctx, k.rotate.u, k.rotate.v, "rotate");
  drawKnob(ctx, k.close.u, k.close.v, "close");
  ctx.restore();
}

/** A reading such as "45°" in a dark chip next to a point (screen pixels). */
export function drawReadout(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.save();
  ctx.font = `600 12px ${FONT}`;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = "#1c2026";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 11, w, 22, 6);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}
