import { describe, expect, it } from "vitest";
import { pointsBounds } from "./geometry";
import { createPage, type ShapeObject, type StrokeObject, type TextObject } from "./model";
import { cloneObjects, parseClipboard, serializeObjects } from "./clipboard";
import { apply, normalizeAngle, rotateAbout, scaleAbout, translate } from "./matrix";
import {
  boundsContain,
  boundsFrame,
  objectFrame,
  objectHitsPoint,
  objectHitsSegment,
  recolorObject,
  shapeBounds,
  textBounds,
  transformFrame,
  transformObject,
} from "./objects";
import { applyOps, invertBatch, type Batch } from "./ops";
import { decodeObject, encodeObject, ZOrderTracker } from "./persist";
import { resizeMatrix } from "./selection";

function stroke(id: string, points = [0, 0, 0.5, 100, 0, 0.5]): StrokeObject {
  return {
    id,
    type: "stroke",
    tool: "pen",
    style: { color: "#000000", size: 4, opacity: 1 },
    points,
    simulatePressure: true,
    bounds: pointsBounds(points, 4),
  };
}

function shape(id: string, kind: ShapeObject["kind"], x1: number, y1: number, x2: number, y2: number, fill: ShapeObject["style"]["fill"] = "none"): ShapeObject {
  const s = { id, type: "shape" as const, kind, x1, y1, x2, y2, rotation: 0, style: { color: "#2563eb", size: 4, opacity: 1, fill } };
  return { ...s, bounds: shapeBounds(s) };
}

function text(id: string, x = 10, y = 20): TextObject {
  const t = {
    id,
    type: "text" as const,
    x,
    y,
    width: 120,
    height: 36,
    text: "Hello\nمرحبا",
    rotation: 0,
    style: { color: "#1e293b", fontSize: 28, bold: true, italic: false, align: "center" as const },
  };
  return { ...t, bounds: textBounds(t) };
}

describe("hit testing", () => {
  it("hits an outline shape on its edge but not in its empty middle", () => {
    const r = shape("r", "rect", 0, 0, 100, 100);
    expect(objectHitsPoint(r, 0, 50, 2)).toBe(true);
    expect(objectHitsPoint(r, 50, 50, 2)).toBe(false);
  });

  it("hits a filled shape anywhere inside", () => {
    const r = shape("r", "ellipse", 0, 0, 100, 100, "tint");
    expect(objectHitsPoint(r, 50, 50, 2)).toBe(true);
    expect(objectHitsPoint(r, 2, 2, 1)).toBe(false); // outside the ellipse, inside its box
  });

  it("hits lines, arrow heads, triangles and diamonds on their outlines", () => {
    expect(objectHitsPoint(shape("l", "line", 0, 0, 100, 100), 50, 50, 1)).toBe(true);
    expect(objectHitsPoint(shape("l", "line", 0, 0, 100, 100), 50, 60, 1)).toBe(false);
    expect(objectHitsPoint(shape("a", "arrow", 0, 0, 100, 0), 92, 3, 0.5)).toBe(true);
    expect(objectHitsPoint(shape("t", "triangle", 0, 0, 100, 100), 50, 0, 1)).toBe(true);
    expect(objectHitsPoint(shape("d", "diamond", 0, 0, 100, 100), 0, 50, 1)).toBe(true);
    expect(objectHitsPoint(shape("d", "diamond", 0, 0, 100, 100), 3, 3, 1)).toBe(false);
  });

  it("hits text anywhere in its box and erases along a segment through it", () => {
    const t = text("t");
    expect(objectHitsPoint(t, 60, 30, 1)).toBe(true);
    expect(objectHitsPoint(t, 300, 300, 1)).toBe(false);
    expect(objectHitsSegment(t, -50, 40, 400, 40, 1)).toBe(true);
  });
});

describe("transforms", () => {
  it("moves every object type by the same offset", () => {
    const t = translate(10, -5);
    const s = transformObject(stroke("s"), t);
    expect(s.points.slice(0, 2)).toEqual([10, -5]);
    expect(s.style.size).toBe(4);
    const sh = transformObject(shape("r", "rect", 0, 0, 50, 50), t);
    expect([sh.x1, sh.y1, sh.x2, sh.y2]).toEqual([10, -5, 60, 45]);
    const tx = transformObject(text("t"), t);
    expect([tx.x, tx.y, tx.style.fontSize]).toEqual([20, 15, 28]);
  });

  it("scales ink thickness and text size, but keeps shape outline width", () => {
    const t = scaleAbout(2, 2, 0, 0);
    expect(transformObject(stroke("s"), t).style.size).toBeCloseTo(8);
    expect(transformObject(shape("r", "rect", 0, 0, 10, 10), t).style.size).toBe(4);
    const tx = transformObject(text("t"), t);
    expect(tx.style.fontSize).toBe(56);
    expect(tx.width).toBe(240);
  });

  it("keeps the opposite corner fixed and the aspect ratio when resizing from a corner", () => {
    const f = boundsFrame({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
    const m = resizeMatrix(f, "se", 100, 10, false);
    expect(apply(m, 0, 0).x).toBeCloseTo(0);
    expect(apply(m, 0, 0).y).toBeCloseTo(0);
    expect(apply(m, 100, 50).x).toBeCloseTo(200);
    expect(apply(m, 100, 50).y).toBeCloseTo(100);
    const nw = resizeMatrix(f, "nw", -100, 0, false);
    expect(apply(nw, 100, 50).x).toBeCloseTo(100);
    expect(apply(nw, 100, 50).y).toBeCloseTo(50);
    expect(apply(nw, 0, 0).x).toBeCloseTo(-100);
  });

  it("stretches one axis from a side handle and never mirrors", () => {
    const f = boundsFrame({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    const e = resizeMatrix(f, "e", 50, 999, false);
    expect(e.d).toBeCloseTo(1);
    expect(apply(e, 100, 0).x).toBeCloseTo(150);
    const collapsed = resizeMatrix(f, "w", 500, 0, false);
    expect(collapsed.a).toBeGreaterThan(0);
  });
});

describe("replacing objects (move, resize, recolour)", () => {
  it("keeps id and z-order, and undo restores the original exactly", () => {
    const page = createPage();
    applyOps(page, [stroke("a"), stroke("b"), stroke("c")].map((object) => ({ kind: "add" as const, object })));
    const b = page.objects.get("b")!;
    const moved = recolorObject(transformObject(b, translate(5, 5)), "#ff0000");
    const index = page.order.indexOf("b");
    const batch: Batch = applyOps(page, [
      { kind: "remove", object: b },
      { kind: "add", object: moved, index },
    ]);
    expect(page.order).toEqual(["a", "b", "c"]);
    expect((page.objects.get("b") as StrokeObject).style.color).toBe("#ff0000");
    applyOps(page, invertBatch(batch));
    expect(page.order).toEqual(["a", "b", "c"]);
    expect(page.objects.get("b")).toBe(b);
  });

  it("produces storage ops that keep the replaced object at the same z", () => {
    const page = createPage();
    const tracker = new ZOrderTracker("p1");
    tracker.apply(applyOps(page, [stroke("a"), stroke("b"), stroke("c")].map((object) => ({ kind: "add" as const, object }))));
    const b = page.objects.get("b")!;
    const ops = tracker.apply(
      applyOps(page, [
        { kind: "remove", object: b },
        { kind: "add", object: transformObject(b, translate(1, 1)), index: 1 },
      ]),
    );
    expect(ops.map((o) => o.op)).toEqual(["delete", "put"]);
    const z = (id: string) => tracker.zOf(id)!;
    expect(z("a") < z("b") && z("b") < z("c")).toBe(true);
  });
});

describe("marquee containment", () => {
  it("selects only objects entirely inside the box", () => {
    const box = { minX: -10, minY: -10, maxX: 60, maxY: 60 };
    expect(boundsContain(box, shape("r", "rect", 0, 0, 50, 50).bounds)).toBe(true);
    expect(boundsContain(box, shape("r", "rect", 0, 0, 80, 50).bounds)).toBe(false);
  });
});

describe("persistence of shapes and text", () => {
  it("round-trips every shape kind", () => {
    for (const kind of ["line", "arrow", "rect", "ellipse", "triangle", "diamond"] as const) {
      const s = shape(`s-${kind}`, kind, 1.5, 2.5, 40, -30, "solid");
      expect(decodeObject(encodeObject(s, 0))).toEqual(s);
    }
  });

  it("round-trips text including Arabic and line breaks", () => {
    const t = text("t");
    expect(decodeObject(encodeObject(t, 0))).toEqual(t);
  });

  it("rejects invalid shapes and text", () => {
    const s = encodeObject(shape("s", "rect", 0, 0, 10, 10), 0);
    const t = encodeObject(text("t"), 0);
    const patch = (row: typeof s, fn: (d: Record<string, unknown>) => void) => {
      const d = JSON.parse(row.data);
      fn(d);
      return { ...row, data: JSON.stringify(d) };
    };
    expect(() => decodeObject(patch(s, (d) => (d.kind = "spiral")))).toThrow(/shape kind/);
    expect(() => decodeObject(patch(s, (d) => (d.x1 = "1")))).toThrow(/geometry/);
    expect(() => decodeObject(patch(s, (d) => ((d.style as Record<string, unknown>).fill = "plaid")))).toThrow(/style/);
    expect(() => decodeObject(patch(t, (d) => (d.text = 42)))).toThrow(/text/);
    expect(() => decodeObject(patch(t, (d) => ((d.style as Record<string, unknown>).align = "justify")))).toThrow(/style/);
    expect(() => decodeObject(patch(t, (d) => (d.text = "x".repeat(20_001))))).toThrow(/text/);
  });
});

describe("rotation", () => {
  const deg = (d: number) => (d * Math.PI) / 180;

  it("rotates a box shape about a pivot, keeping its size and turning its rotation", () => {
    const r = shape("r", "rect", 0, 0, 100, 40);
    const out = transformObject(r, rotateAbout(deg(90), 50, 20));
    expect(out.rotation).toBeCloseTo(deg(90));
    expect(out.x2 - out.x1).toBeCloseTo(100);
    expect(out.y2 - out.y1).toBeCloseTo(40);
    expect(out.bounds.maxY - out.bounds.minY).toBeGreaterThan(out.bounds.maxX - out.bounds.minX);
    // The outline turned with it: the old left-edge midpoint (0, 20) is now at (50, -30).
    expect(objectHitsPoint(out, 50, -30, 2)).toBe(true);
    expect(objectHitsPoint(out, 0, 20, 2)).toBe(false);
  });

  it("rotates ink and line points exactly", () => {
    const s = transformObject(stroke("s"), rotateAbout(deg(90), 0, 0));
    expect(s.points[3]).toBeCloseTo(0);
    expect(s.points[4]).toBeCloseTo(100);
    const l = transformObject(shape("l", "arrow", 0, 0, 100, 0), rotateAbout(deg(-90), 0, 0));
    expect([l.x2, l.y2].map((v) => Math.round(v))).toEqual([0, -100]);
    expect(l.rotation).toBe(0);
  });

  it("rotates text about the pivot and hit-tests inside the rotated box", () => {
    const t = transformObject(text("t", 0, 0), rotateAbout(deg(90), 0, 0));
    expect(t.rotation).toBeCloseTo(deg(90));
    expect(t.x).toBeCloseTo(0);
    expect(t.style.fontSize).toBeCloseTo(28);
    // Unrotated, (60, 18) is inside; after 90 degrees it maps to (-18, 60).
    expect(objectHitsPoint(t, -18, 60, 1)).toBe(true);
    expect(objectHitsPoint(t, 60, 18, 1)).toBe(false);
    expect(t.bounds.minX).toBeLessThan(-30);
  });

  it("keeps the relative positions of several objects when rotating them together", () => {
    const a = shape("a", "rect", 0, 0, 20, 20);
    const b = text("b", 100, 0);
    const m = rotateAbout(deg(37), 60, 10);
    const [a2, b2] = [transformObject(a, m), transformObject(b, m)];
    const dist = (p: { cx: number; cy: number }, q: { cx: number; cy: number }) => Math.hypot(p.cx - q.cx, p.cy - q.cy);
    expect(dist(objectFrame(a2), objectFrame(b2))).toBeCloseTo(dist(objectFrame(a), objectFrame(b)));
    expect(a2.rotation).toBeCloseTo(deg(37));
    expect(b2.rotation).toBeCloseTo(deg(37));
  });

  it("stretches a rotated shape along its own axes from a rotated frame", () => {
    const r = transformObject(shape("r", "rect", 0, 0, 100, 40), rotateAbout(deg(30), 50, 20));
    const f = objectFrame(r);
    // Drag the frame's east handle outwards by 50 along the frame's own x axis.
    const m = resizeMatrix(f, "e", 50 * Math.cos(deg(30)), 50 * Math.sin(deg(30)), false);
    const out = transformObject(r, m);
    expect(out.rotation).toBeCloseTo(deg(30));
    expect(out.x2 - out.x1).toBeCloseTo(100 * ((f.w + 50) / f.w));
    expect(out.y2 - out.y1).toBeCloseTo(40);
    expect(transformFrame(f, m).angle).toBeCloseTo(deg(30));
  });

  it("normalises angles", () => {
    expect(normalizeAngle(deg(370))).toBeCloseTo(deg(10));
    expect(normalizeAngle(deg(-190))).toBeCloseTo(deg(170));
    expect(normalizeAngle(1e-12)).toBe(0);
  });

  it("persists rotation, treats a missing rotation as 0 and rejects invalid values", () => {
    const r = transformObject(shape("r", "ellipse", 0, 0, 80, 40, "solid"), rotateAbout(deg(45), 40, 20));
    expect(decodeObject(encodeObject(r, 0))).toEqual(r);
    const t = transformObject(text("t"), rotateAbout(deg(-20), 0, 0));
    expect(decodeObject(encodeObject(t, 0))).toEqual(t);
    const legacy = encodeObject(shape("s", "rect", 0, 0, 10, 10), 0);
    const d = JSON.parse(legacy.data);
    delete d.rotation;
    expect((decodeObject({ ...legacy, data: JSON.stringify(d) }) as ShapeObject).rotation).toBe(0);
    expect(() => decodeObject({ ...legacy, data: JSON.stringify({ ...d, rotation: "1" }) })).toThrow(/rotation/);
  });
});

describe("clipboard", () => {
  const sample = () => [
    stroke("s"),
    transformObject(shape("r", "diamond", 0, 0, 30, 30, "tint"), rotateAbout(1, 15, 15)),
    text("t"),
  ];

  it("round-trips every object type with all properties", () => {
    const objs = sample();
    const back = parseClipboard(serializeObjects(objs))!;
    expect(back.map((o) => o.type)).toEqual(["stroke", "shape", "text"]);
    expect(back[1]).toEqual(objs[1]);
    expect(back[2]).toEqual(objs[2]);
    expect((back[0] as StrokeObject).points).toEqual((objs[0] as StrokeObject).points);
  });

  it("ignores data that is not NovaLoomBoard objects and drops invalid entries", () => {
    expect(parseClipboard("hello")).toBeNull();
    expect(parseClipboard(JSON.stringify({ app: "other", version: 1, objects: [] }))).toBeNull();
    const data = JSON.parse(serializeObjects(sample()));
    data.objects[1].data = "{broken";
    expect(parseClipboard(JSON.stringify(data))!.map((o) => o.id)).toEqual(["s", "t"]);
  });

  it("clones with new ids and an offset, keeping everything else", () => {
    const objs = sample();
    const copies = cloneObjects(objs, 24, 24);
    expect(new Set(copies.map((c) => c.id)).size).toBe(3);
    copies.forEach((c, i) => expect(c.id).not.toBe(objs[i]!.id));
    const t = copies[2] as TextObject;
    expect([t.x, t.y]).toEqual([34, 44]);
    expect(t.style).toEqual((objs[2] as TextObject).style);
    expect((copies[1] as ShapeObject).rotation).toBeCloseTo(1);
  });
});
