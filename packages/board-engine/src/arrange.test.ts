import { describe, expect, it } from "vitest";
import { alignOffsets, distributeOffsets, expandToGroups, lassoSelects, pointInPolygon, unitsOf } from "./arrange";
import { cloneObjects } from "./clipboard";
import { stepTextSize } from "./engine";
import { pointsBounds } from "./geometry";
import type { BoardObject, ShapeObject, StrokeObject, TextObject } from "./model";
import { shapeBounds, textBounds } from "./objects";
import { decodeObject, encodeObject } from "./persist";
import { layoutLines } from "./text-layout";

function stroke(id: string, x0: number, y0: number, x1: number, y1: number, group?: string): StrokeObject {
  const points: number[] = [];
  for (let i = 0; i <= 20; i++) points.push(x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20, 0.5);
  return { id, type: "stroke", tool: "pen", style: { color: "#000000", size: 4, opacity: 1 }, points, simulatePressure: true, bounds: pointsBounds(points, 4), ...(group ? { group } : {}) };
}

function rect(id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<ShapeObject> = {}): ShapeObject {
  const base = { id, type: "shape" as const, kind: "rect" as const, x1, y1, x2, y2, rotation: 0, style: { color: "#000000", size: 2, opacity: 1, fill: "none" as const }, ...extra };
  return { ...base, bounds: shapeBounds(base) };
}

const square = (x: number, y: number, s: number) => [x, y, x + s, y, x + s, y + s, x, y + s];

describe("lasso", () => {
  it("point in polygon, including a concave loop", () => {
    const u = [0, 0, 100, 0, 100, 100, 60, 100, 60, 40, 40, 40, 40, 100, 0, 100]; // a U shape
    expect(pointInPolygon(20, 50, u)).toBe(true);
    expect(pointInPolygon(50, 70, u)).toBe(false); // inside the notch
    expect(pointInPolygon(150, 50, u)).toBe(false);
  });

  it("selects objects mostly inside the loop, not ones it only crosses", () => {
    const loop = square(0, 0, 200);
    expect(lassoSelects(stroke("in", 20, 20, 180, 150), loop)).toBe(true);
    expect(lassoSelects(stroke("half", 100, 100, 300, 100), loop)).toBe(false);
    expect(lassoSelects(stroke("out", 300, 300, 400, 400), loop)).toBe(false);
    // ~85% inside still counts (a loosely drawn loop).
    expect(lassoSelects(stroke("most", 20, 50, 225, 50), loop)).toBe(true);
    expect(lassoSelects(rect("r", 50, 50, 150, 120), loop)).toBe(true);
    expect(lassoSelects(rect("big", 50, 50, 350, 120), loop)).toBe(false);
  });

  it("follows the object's own rotation", () => {
    // A long thin box rotated 45° fits a diagonal loop, though its unrotated box would not.
    const r = rect("rot", 0, 90, 200, 110, { rotation: Math.PI / 4 });
    // A loop hugging the rotated box (a slightly larger rotated rectangle around it).
    const c = Math.cos(Math.PI / 4);
    const corner = (lx: number, ly: number) => [100 + lx * c - ly * c, 100 + lx * c + ly * c];
    const hug = [...corner(-115, -20), ...corner(115, -20), ...corner(115, 20), ...corner(-115, 20)];
    expect(lassoSelects(r, hug)).toBe(true);
    // Its axis-aligned bounds (about 156 × 156) are far larger than the loop's thin band,
    // so a test on bounds would have failed; and a loop around only half of it does not select it.
    const half = [...corner(-115, -20), ...corner(0, -20), ...corner(0, 20), ...corner(-115, 20)];
    expect(lassoSelects(r, half)).toBe(false);
  });
});

describe("groups", () => {
  const objs: BoardObject[] = [stroke("a", 0, 0, 10, 10, "g1"), stroke("b", 50, 0, 60, 10, "g1"), stroke("c", 100, 0, 110, 10), rect("d", 200, 0, 220, 20, { group: "g2" })];

  it("picking one member picks its whole group", () => {
    expect([...expandToGroups(["a"], objs)].sort()).toEqual(["a", "b"]);
    expect([...expandToGroups(["c"], objs)]).toEqual(["c"]);
    expect([...expandToGroups(["b", "d"], objs)].sort()).toEqual(["a", "b", "d"]);
  });

  it("a group moves and aligns as one unit", () => {
    const units = unitsOf(objs);
    expect(units.map((u) => u.ids)).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(units[0]!.bounds.minX).toBeLessThan(0);
    expect(units[0]!.bounds.maxX).toBeGreaterThan(60);
  });

  it("copies of a group form a new group of their own", () => {
    const copies = cloneObjects(objs, 10, 0);
    expect(copies[0]!.group).toBeDefined();
    expect(copies[0]!.group).toBe(copies[1]!.group);
    expect(copies[0]!.group).not.toBe("g1");
    expect(copies[2]!.group).toBeUndefined();
    expect(copies[3]!.group).not.toBe(copies[0]!.group);
  });
});

describe("align and distribute", () => {
  const units = unitsOf([rect("a", 0, 0, 40, 20), rect("b", 100, 50, 120, 90), rect("c", 300, 10, 380, 30)]);
  const moved = (edge: Parameters<typeof alignOffsets>[1]) =>
    alignOffsets(units, edge).map((d, i) => ({ minX: units[i]!.bounds.minX + d.dx, maxX: units[i]!.bounds.maxX + d.dx, minY: units[i]!.bounds.minY + d.dy, maxY: units[i]!.bounds.maxY + d.dy }));

  it("aligns edges and centre lines to the selection as a whole", () => {
    const l = moved("left");
    expect(new Set(l.map((b) => b.minX.toFixed(6))).size).toBe(1);
    expect(l[0]!.minX).toBeCloseTo(units[0]!.bounds.minX);
    const r = moved("right");
    expect(new Set(r.map((b) => b.maxX.toFixed(6))).size).toBe(1);
    const cx = moved("centerX");
    expect(new Set(cx.map((b) => ((b.minX + b.maxX) / 2).toFixed(6))).size).toBe(1);
    const t = moved("top");
    expect(new Set(t.map((b) => b.minY.toFixed(6))).size).toBe(1);
    expect(alignOffsets(units, "top").every((d) => d.dx === 0)).toBe(true);
    const bm = moved("bottom");
    expect(new Set(bm.map((b) => b.maxY.toFixed(6))).size).toBe(1);
    const cy = moved("centerY");
    expect(new Set(cy.map((b) => ((b.minY + b.maxY) / 2).toFixed(6))).size).toBe(1);
  });

  it("distributes with equal gaps, keeping the outermost in place", () => {
    const offs = distributeOffsets(units, "horizontal");
    const b = units.map((u, i) => ({ minX: u.bounds.minX + offs[i]!.dx, maxX: u.bounds.maxX + offs[i]!.dx }));
    expect(offs[0]!.dx).toBe(0);
    expect(offs[2]!.dx).toBe(0);
    expect(b[1]!.minX - b[0]!.maxX).toBeCloseTo(b[2]!.minX - b[1]!.maxX, 6);
    expect(offs.every((d) => d.dy === 0)).toBe(true);
  });

  it("needs two units to align and three to distribute", () => {
    const two = units.slice(0, 2);
    expect(distributeOffsets(two, "vertical").every((d) => d.dx === 0 && d.dy === 0)).toBe(true);
    expect(alignOffsets(units.slice(0, 1), "left")).toEqual([{ dx: 0, dy: 0 }]);
  });
});

describe("group, lock and text box are saved with the object", () => {
  it("round-trips through storage; unset fields stay absent", () => {
    const s = stroke("s", 0, 0, 10, 10, "g");
    const back = decodeObject(encodeObject({ ...s, locked: true }, 0));
    expect(back).toMatchObject({ group: "g", locked: true });
    const plain = decodeObject(encodeObject(stroke("p", 0, 0, 1, 1), 0));
    expect(plain.group).toBeUndefined();
    expect(plain.locked).toBeUndefined();
    expect(encodeObject(stroke("p", 0, 0, 1, 1), 0).data).not.toMatch(/group|locked/);
    const t: TextObject = { id: "t", type: "text", x: 0, y: 0, width: 200, height: 36, text: "x", rotation: 0, style: { color: "#000000", fontSize: 28, bold: false, italic: false, align: "left" }, boxWidth: 200, bounds: textBounds({ x: 0, y: 0, width: 200, height: 36, rotation: 0 }) };
    expect((decodeObject(encodeObject(t, 0)) as TextObject).boxWidth).toBe(200);
  });

  it("rejects an invalid group or box width", () => {
    const row = encodeObject(stroke("s", 0, 0, 10, 10), 0);
    const data = JSON.parse(row.data);
    expect(() => decodeObject({ ...row, data: JSON.stringify({ ...data, group: 5 }) })).toThrow(/group/);
    expect(() => decodeObject({ ...row, data: JSON.stringify({ ...data, group: "x".repeat(65) }) })).toThrow(/group/);
    const tr = encodeObject({ id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "x", rotation: 0, style: { color: "#000000", fontSize: 28, bold: false, italic: false, align: "left" }, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }, 0);
    expect(() => decodeObject({ ...tr, data: JSON.stringify({ ...JSON.parse(tr.data), boxWidth: -3 }) })).toThrow(/box width/);
  });
});

describe("text wrapping", () => {
  const style = { fontSize: 20, bold: false, italic: false };
  // Every character 10 units wide.
  const mono = (s: string) => [...s].length * 10;

  it("without a box, lines break only at line breaks", () => {
    expect(layoutLines("one two\nthree", style).map((l) => l.text)).toEqual(["one two", "three"]);
  });

  it("wraps at spaces to fit the box", () => {
    const lines = layoutLines("the quick brown fox jumps", style, 100, mono).map((l) => l.text);
    expect(lines).toEqual(["the quick", "brown fox", "jumps"]);
    expect(lines.every((l) => mono(l) <= 100)).toBe(true);
  });

  it("breaks a word longer than the box between characters, never inside an Arabic letter cluster", () => {
    expect(layoutLines("abcdefghijklmnop", style, 50, mono).map((l) => l.text)).toEqual(["abcde", "fghij", "klmno", "p"]);
    // Letters with vowel marks (combining characters) stay whole.
    const word = "مَدْرَسَةٌمَدْرَسَةٌ";
    const lines = layoutLines(word, style, 30, (s) => new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)[Symbol.iterator]().next() && [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length * 10);
    expect(lines.map((l) => l.text).join("")).toBe(word);
    for (const l of lines) expect(/^[ً-ْ]/.test(l.text)).toBe(false); // no line starts with a lone vowel mark
  });

  it("wrapped lines keep their paragraph's direction (Arabic stays right-to-left)", () => {
    const lines = layoutLines("درس اليوم Bonjour à tous", style, 100, mono);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.dir === "rtl")).toBe(true);
    const fr = layoutLines("Leçon : les fractions\nالكسور", style, 100, mono);
    expect(fr[0]!.dir).toBe("ltr");
    expect(fr.at(-1)!.dir).toBe("rtl");
  });

  it("keeps empty paragraphs (blank lines)", () => {
    expect(layoutLines("a\n\nb", style, 100, mono).map((l) => l.text)).toEqual(["a", "", "b"]);
  });
});

describe("text size steps", () => {
  it("steps through common sizes and beyond", () => {
    expect(stepTextSize(28, 1)).toBe(32);
    expect(stepTextSize(28, -1)).toBe(24);
    expect(stepTextSize(30, 1)).toBe(32);
    expect(stepTextSize(30, -1)).toBe(28);
    expect(stepTextSize(8, -1)).toBe(6);
    expect(stepTextSize(256, 1)).toBe(320);
  });
});

describe("rotated groups keep their frame", () => {
  it("recognises exactly one whole group", async () => {
    const { wholeGroup } = await import("./arrange");
    const all = [stroke("a", 0, 0, 10, 10, "g"), stroke("b", 20, 0, 30, 10, "g"), stroke("c", 50, 0, 60, 10)];
    expect(wholeGroup(all.slice(0, 2), all)).toBe("g");
    expect(wholeGroup(all.slice(0, 1), all)).toBeNull();
    expect(wholeGroup(all, all)).toBeNull();
  });

  it("the frame follows the group's angle tightly", async () => {
    const { orientedFrame } = await import("./arrange");
    // Two short strokes on a 30° line: an upright box would be much taller than the rotated one.
    const a = Math.PI / 6;
    const pt = (d: number) => [d * Math.cos(a), d * Math.sin(a)] as const;
    const [x0, y0] = pt(0), [x1, y1] = pt(100), [x2, y2] = pt(200), [x3, y3] = pt(300);
    const f = orientedFrame([stroke("a", x0, y0, x1, y1), stroke("b", x2, y2, x3, y3)], a);
    expect(f.angle).toBeCloseTo(a);
    expect(f.w).toBeCloseTo(300 + 4, 0);
    expect(f.h).toBeLessThan(6);
    expect(f.cx).toBeCloseTo(150 * Math.cos(a), 0);
  });

  it("the group angle is saved with each member, and dropped when ungrouped", () => {
    const s = { ...stroke("s", 0, 0, 10, 10, "g"), groupAngle: 0.5 };
    expect(decodeObject(encodeObject(s, 0)).groupAngle).toBeCloseTo(0.5);
    const plain = { ...stroke("p", 0, 0, 10, 10), groupAngle: 0.5 };
    expect(decodeObject(encodeObject(plain, 0)).groupAngle).toBeUndefined();
    const row = encodeObject(s, 0);
    expect(() => decodeObject({ ...row, data: JSON.stringify({ ...JSON.parse(row.data), groupAngle: "x" }) })).toThrow(/group angle/);
  });
});

describe("lock badges", () => {
  it("sit at the top-right of the visible part, at a fixed inset", async () => {
    const { badgeSpots } = await import("./arrange");
    expect(badgeSpots([{ minX: 100, minY: 100, maxX: 300, maxY: 200 }], 1000, 800, 15)).toEqual([{ x: 285, y: 115 }]);
    // Zoomed in past the edges: the badge stays in the window.
    expect(badgeSpots([{ minX: -500, minY: -300, maxX: 3000, maxY: 2000 }], 1000, 800, 15)).toEqual([{ x: 985, y: 15 }]);
  });

  it("skip objects too small on screen or barely visible", async () => {
    const { badgeSpots } = await import("./arrange");
    expect(badgeSpots([{ minX: 10, minY: 10, maxX: 30, maxY: 30 }], 1000, 800, 15)).toEqual([]);
    expect(badgeSpots([{ minX: 990, minY: 100, maxX: 1200, maxY: 400 }], 1000, 800, 15)).toEqual([]);
    expect(badgeSpots([{ minX: 2000, minY: 100, maxX: 2300, maxY: 400 }], 1000, 800, 15)).toEqual([]);
  });
});
