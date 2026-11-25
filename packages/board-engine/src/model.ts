export type InkTool = "pen" | "pencil" | "highlighter";

/** Line style: solid when absent. */
export type LineDash = "dashed" | "dotted";

export interface StrokeStyle {
  color: string;
  /** Nominal stroke width in world units. */
  size: number;
  opacity: number;
  /** Dashed or dotted ink is drawn at an even width along its path. */
  dash?: LineDash;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface StrokeObject {
  id: string;
  type: "stroke";
  tool: InkTool;
  style: StrokeStyle;
  /** Flat list of x, y, pressure triples in world coordinates. Immutable once committed. */
  points: number[];
  /** True when the input device did not report usable pressure. */
  simulatePressure: boolean;
  /** Objects sharing a group id are selected, moved and aligned together. */
  group?: string;
  /** Rotation of the group's frame (radians), the same on every member; 0 or absent when upright. */
  groupAngle?: number;
  /** Locked objects cannot be selected, moved, edited or erased until unlocked. */
  locked?: boolean;
  bounds: Bounds;
}

export type ShapeKind =
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "star"
  | "hexagon"
  | "bubble"
  | "check"
  | "xmark";
export type ShapeFill = "none" | "tint" | "solid";

export interface ShapeStyle {
  color: string;
  /** Outline width in world units. */
  size: number;
  opacity: number;
  fill: ShapeFill;
  dash?: LineDash;
}

/**
 * A geometric shape defined by two corner points: the endpoints for lines
 * and arrows (direction matters), the bounding box corners otherwise.
 */
export interface ShapeObject {
  id: string;
  type: "shape";
  kind: ShapeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * Rotation in radians about the box centre, for box shapes (lines and
   * arrows keep 0: rotating them moves their endpoints instead).
   */
  rotation: number;
  style: ShapeStyle;
  /** Objects sharing a group id are selected, moved and aligned together. */
  group?: string;
  /** Rotation of the group's frame (radians), the same on every member; 0 or absent when upright. */
  groupAngle?: number;
  /** Locked objects cannot be selected, moved, edited or erased until unlocked. */
  locked?: boolean;
  bounds: Bounds;
}

export type TextAlign = "left" | "center" | "right";

export interface TextStyle {
  color: string;
  /** Font size in world units. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
}

/**
 * A text block anchored at its top-left corner (the rotation pivot). Lines break only at
 * explicit line breaks; width and height are the measured layout size,
 * stored so the storage layer can validate bounds without a font engine.
 */
export interface TextObject {
  id: string;
  type: "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  /** Rotation in radians about the top-left corner (x, y). */
  rotation: number;
  style: TextStyle;
  /**
   * Fixed box width in board units: lines wrap to fit it. Without it the box
   * is as wide as the longest line (lines break only at line breaks).
   */
  boxWidth?: number;
  /** Objects sharing a group id are selected, moved and aligned together. */
  group?: string;
  /** Rotation of the group's frame (radians), the same on every member; 0 or absent when upright. */
  groupAngle?: number;
  /** Locked objects cannot be selected, moved, edited or erased until unlocked. */
  locked?: boolean;
  bounds: Bounds;
}

/**
 * A raster image placed on the board. The pixels live once per board in its
 * asset store, addressed by the SHA-256 of the file (`asset`). The box is
 * centred on (cx, cy) and rotates about its centre; its aspect ratio is the
 * image's own and is kept when resizing.
 */
export interface ImageObject {
  id: string;
  type: "image";
  asset: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  /** Rotation in radians about the centre. */
  rotation: number;
  /** A typed equation: its TeX source, so double-clicking opens it for editing again. */
  equation?: ImageEquation;
  /*
   * An imported PDF page is a locked image: drawn like any image, but not
   * selectable or erasable, so it can be annotated freely.
   */
  group?: string;
  /** Rotation of the group's frame (radians), the same on every member; 0 or absent when upright. */
  groupAngle?: number;
  /** Locked objects cannot be selected, moved, edited or erased until unlocked. */
  locked?: boolean;
  bounds: Bounds;
}

export interface ImageEquation {
  tex: string;
  color: string;
}

export type BoardObject = StrokeObject | ShapeObject | TextObject | ImageObject;

export interface Page {
  objects: Map<string, BoardObject>;
  /** Object ids in z-order, bottom first. */
  order: string[];
}

export function createPage(): Page {
  return { objects: new Map(), order: [] };
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}
