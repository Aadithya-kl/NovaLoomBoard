import { describe, expect, it } from "vitest";
import type { ImageObject, ShapeObject, StrokeObject } from "./model";
import { SHAPE_KINDS, decodeObject, encodeObject } from "./persist";
import { parseFormula, plotCurve } from "./plot";
import { shapeOutline } from "./objects";
import { AXIS_UNIT } from "./paper";

const f = (src: string) => {
  const r = parseFormula(src);
  if (!("f" in r)) throw new Error(r.error);
  return r.f;
};

describe("formula parser", () => {
  it("reads formulas as people type them", () => {
    expect(f("y = x^2 - 3")(2)).toBe(1);
    expect(f("f(x) = 2x + 1")(3)).toBe(7);
    expect(f("x² − 2")(3)).toBe(7);
    expect(f("3,5x")(2)).toBe(7);
    expect(f("2(x+1)")(1)).toBe(4);
    expect(f("x(x+1)")(2)).toBe(6);
    expect(f("√x")(9)).toBe(3);
    expect(f("2π")(0)).toBeCloseTo(2 * Math.PI, 12);
    expect(f("3 × x ÷ 2")(4)).toBe(6);
    expect(f("e^x")(1)).toBeCloseTo(Math.E, 12);
    expect(f("exp(1)")(0)).toBeCloseTo(Math.E, 12);
  });
  it("follows the usual order of operations", () => {
    expect(f("-x^2")(3)).toBe(-9);
    expect(f("2^3^2")(0)).toBe(512);
    expect(f("1 + 2 * 3")(0)).toBe(7);
    expect(f("x^-1")(4)).toBe(0.25);
  });
  it("reads functions with and without brackets", () => {
    expect(f("sin(x)")(Math.PI / 2)).toBeCloseTo(1, 12);
    expect(f("sin 2x")(Math.PI / 4)).toBeCloseTo(1, 12);
    expect(f("x sin x")(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(f("abs(x - 3)")(1)).toBe(2);
    expect(f("ln(e)")(0)).toBe(1);
    expect(f("log(100)")(0)).toBe(2);
  });
  it("takes odd roots of negative numbers as a calculator does", () => {
    expect(f("x^(1/3)")(-8)).toBeCloseTo(-2, 12);
  });
  it("explains what it cannot read, and never runs code", () => {
    for (const bad of ["", "y = ", "x +", "(x + 1", "x + 1)", "alert(1)", "y = 2 $ x", "constructor"]) {
      const r = parseFormula(bad);
      expect("error" in r, bad).toBe(true);
    }
  });
});

describe("plotting", () => {
  it("draws y = x² in board units, up being positive", () => {
    const lines = plotCurve(f("x^2"), -2, 2, -1, 5, 0.01);
    expect(lines.length).toBe(1);
    const l = lines[0]!;
    // x = 2 → y = 4 grid units up.
    expect(l[l.length - 2]).toBeCloseTo(2 * AXIS_UNIT, 6);
    expect(l[l.length - 1]).toBeCloseTo(-4 * AXIS_UNIT, 6);
  });
  it("breaks the curve at poles instead of drawing false vertical lines", () => {
    const lines = plotCurve(f("1/x"), -5, 5, -5, 5, 0.01);
    expect(lines.length).toBe(2);
    expect(plotCurve(f("tan(x)"), -4, 4, -5, 5, 0.01).length).toBeGreaterThanOrEqual(3);
  });
  it("leaves out where the function is undefined", () => {
    const lines = plotCurve(f("sqrt(x)"), -5, 5, -1, 4, 0.01);
    expect(lines.length).toBe(1);
    expect(lines[0]![0]).toBeGreaterThanOrEqual(0);
  });
});

describe("new shapes", () => {
  const box = { x1: 0, y1: 0, x2: 100, y2: 80, rotation: 0 };
  it("outlines every shape kind inside its box", () => {
    for (const kind of SHAPE_KINDS) {
      const { pts } = shapeOutline({ ...box, kind });
      expect(pts.length, kind).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < pts.length; i += 2) {
        expect(pts[i]!, kind).toBeGreaterThanOrEqual(-1e-9);
        expect(pts[i]!, kind).toBeLessThanOrEqual(100 + 1e-9);
        expect(pts[i + 1]!, kind).toBeGreaterThanOrEqual(-1e-9);
        expect(pts[i + 1]!, kind).toBeLessThanOrEqual(80 + 1e-9);
      }
    }
  });
  it("draws a check mark open and a star with ten corners", () => {
    expect(shapeOutline({ ...box, kind: "check" }).closed).toBe(false);
    expect(shapeOutline({ ...box, kind: "star" }).pts.length).toBe(20);
    expect(shapeOutline({ ...box, kind: "xmark" }).closed).toBe(true);
  });
});

describe("saving line styles and equations", () => {
  const stroke: StrokeObject = {
    id: "s1",
    type: "stroke",
    tool: "pen",
    style: { color: "#112233", size: 4, opacity: 1, dash: "dashed" },
    points: [0, 0, 0.5, 10, 10, 0.5],
    simulatePressure: false,
    bounds: { minX: -2, minY: -2, maxX: 12, maxY: 12 },
  };
  it("keeps dashed and dotted styles, and solid stays without one", () => {
    expect((decodeObject(encodeObject(stroke, 0)) as StrokeObject).style.dash).toBe("dashed");
    const solid = decodeObject(encodeObject({ ...stroke, style: { color: "#112233", size: 4, opacity: 1 } }, 0)) as StrokeObject;
    expect("dash" in solid.style).toBe(false);
    const shape: ShapeObject = { id: "h1", type: "shape", kind: "star", x1: 0, y1: 0, x2: 50, y2: 50, rotation: 0, style: { color: "#112233", size: 3, opacity: 1, fill: "none", dash: "dotted" }, bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 } };
    const back = decodeObject(encodeObject(shape, 0)) as ShapeObject;
    expect(back.kind).toBe("star");
    expect(back.style.dash).toBe("dotted");
  });
  it("rejects unknown line styles", () => {
    const row = encodeObject(stroke, 0);
    const bad = { ...row, data: row.data.replace('"dashed"', '"wavy"') };
    expect(() => decodeObject(bad)).toThrow();
  });
  it("keeps an equation's TeX with its picture, and checks it", () => {
    const img: ImageObject = {
      id: "i1",
      type: "image",
      asset: "a".repeat(64),
      cx: 0,
      cy: 0,
      width: 100,
      height: 40,
      rotation: 0,
      equation: { tex: "\\frac{a}{b}", color: "#1e293b" },
      bounds: { minX: -50, minY: -20, maxX: 50, maxY: 20 },
    };
    const back = decodeObject(encodeObject(img, 0)) as ImageObject;
    expect(back.equation).toEqual({ tex: "\\frac{a}{b}", color: "#1e293b" });
    const plain = decodeObject(encodeObject({ ...img, equation: undefined }, 0)) as ImageObject;
    expect(plain.equation).toBeUndefined();
    const row = encodeObject(img, 0);
    expect(() => decodeObject({ ...row, data: row.data.replace('"#1e293b"', '"red"') })).toThrow();
  });
});
