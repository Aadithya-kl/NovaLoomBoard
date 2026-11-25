import { describe, expect, it } from "vitest";
import {
  BACKGROUNDS,
  inkColor,
  isDarkBackground,
  makeBackground,
  paperColor,
  parseBackground,
  patternGeometry,
  PATTERNS,
  PAPERS,
  type Pattern,
} from "./paper";
import { BACKGROUNDS as STORED_BACKGROUNDS } from "./persist";
import { recognizeShape, shapeToInk, smoothInk, type Pt } from "./recognize";
import { displayAngle, hitGuide, PROTRACTOR_RADIUS, protractorAngle, RULER_LENGTH, RULER_WIDTH, snapGuideAngle, snapPoint, type Guide } from "./guides";

describe("backgrounds", () => {
  it("keeps the old values: a pattern alone is a white board", () => {
    for (const p of ["blank", "grid", "dots", "ruled"] as const) {
      expect(BACKGROUNDS).toContain(p);
      expect(parseBackground(p)).toEqual({ pattern: p, paper: "white" });
    }
  });
  it("round-trips every pattern on every board colour", () => {
    expect(BACKGROUNDS.length).toBe(PATTERNS.length * PAPERS.length);
    for (const pattern of PATTERNS) for (const paper of PAPERS) expect(parseBackground(makeBackground(pattern, paper))).toEqual({ pattern, paper });
    expect(STORED_BACKGROUNDS).toEqual(BACKGROUNDS);
  });
  it("knows dark boards and their colour", () => {
    expect(isDarkBackground("grid")).toBe(false);
    expect(isDarkBackground("staff-green")).toBe(true);
    expect(isDarkBackground("blank-black")).toBe(true);
    expect(paperColor("dots")).toBe("#ffffff");
    expect(paperColor("dots-green")).not.toBe("#ffffff");
  });
});

describe("ink on dark boards", () => {
  it("draws black as white and lightens the palette, but only on dark boards", () => {
    expect(inkColor("#1e293b", false)).toBe("#1e293b");
    expect(inkColor("#1e293b", true)).toBe("#f1f5f9");
    expect(inkColor("#2563EB", true)).toBe("#60a5fa");
    // Other very dark colours turn light; light colours stay.
    expect(inkColor("#000000", true)).toBe("#f1f5f9");
    expect(inkColor("#facc15", true)).toBe("#facc15");
  });
});

describe("pattern geometry", () => {
  const view = { minX: 0, minY: 0, maxX: 1000, maxY: 600 };
  it("draws something for every pattern but blank, at normal zoom", () => {
    for (const p of PATTERNS) {
      const g = patternGeometry(p, view, 1, false);
      const n = g.lines.length + g.dots.length;
      if (p === "blank") expect(n).toBe(0);
      else expect(n, p).toBeGreaterThan(0);
    }
  });
  it("puts five staff lines 12 units apart in each stave", () => {
    const ys = patternGeometry("staff", { minX: 0, minY: 0, maxX: 100, maxY: 119 }, 1, false).lines.map((l) => l.y1);
    expect(ys).toEqual([0, 12, 24, 36, 48]);
  });
  it("labels the coordinate axes with up as positive", () => {
    const g = patternGeometry("axes", { minX: -200, minY: -200, maxX: 200, maxY: 200 }, 1, false);
    expect(g.lines.some((l) => l.y1 === 0 && l.y2 === 0 && l.width > 1)).toBe(true);
    const y = g.labels.find((l) => l.x === 0 && l.y === -64);
    expect(y?.text).toBe("2");
    const x = g.labels.find((l) => l.y === 0 && l.x === -64);
    expect(x?.text).toBe("−2");
  });
  it("leaves out fine lines when zoomed far out, and never draws thousands", () => {
    const huge = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
    for (const p of PATTERNS as readonly Pattern[]) {
      const g = patternGeometry(p, huge, 0.0005, false);
      expect(g.lines.length + g.dots.length, p).toBeLessThan(20000);
    }
  });
});

const flat = (pts: Pt[]) => pts.flatMap((p) => [p.x, p.y, 0.5]);
/** A shaky copy of a path, as a hand or mouse draws it. */
function shaky(pts: Pt[], amount: number, seed = 1): Pt[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return pts.map((p) => ({ x: p.x + rnd() * amount, y: p.y + rnd() * amount }));
}
function along(a: Pt, b: Pt, n: number): Pt[] {
  return Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / (n - 1), y: a.y + ((b.y - a.y) * i) / (n - 1) }));
}
function polygon(corners: Pt[], perEdge = 30): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < corners.length; i++) out.push(...along(corners[i]!, corners[(i + 1) % corners.length]!, perEdge).slice(i ? 1 : 0));
  return out;
}

describe("shape recognition", () => {
  it("straightens a shaky line and snaps it to horizontal", () => {
    const r = recognizeShape(shaky(along({ x: 0, y: 0 }, { x: 300, y: 4 }, 80), 2));
    expect(r?.kind).toBe("line");
    if (r?.kind === "line") expect(Math.abs(r.points[1]!.y - r.points[0]!.y)).toBeLessThan(1e-6);
  });
  it("finds a circle", () => {
    const pts = Array.from({ length: 120 }, (_, i) => {
      const t = (i / 119) * Math.PI * 2;
      return { x: 200 + Math.cos(t) * 100, y: 200 + Math.sin(t) * 96 };
    });
    const r = recognizeShape(shaky(pts, 2.5));
    expect(r?.kind).toBe("ellipse");
    if (r?.kind === "ellipse") {
      expect(r.rx).toBeCloseTo(r.ry, 6);
      expect(Math.abs(r.cx - 200)).toBeLessThan(6);
    }
  });
  it("finds a rectangle and squares its corners", () => {
    const r = recognizeShape(shaky(polygon([{ x: 0, y: 0 }, { x: 300, y: 6 }, { x: 302, y: 160 }, { x: 4, y: 156 }, { x: 0, y: 2 }]), 2));
    expect(r?.kind).toBe("polygon");
    if (r?.kind === "polygon") {
      expect(r.points.length).toBe(4);
      // Upright (within 4° snaps to 0°): top edge horizontal.
      const [a, b] = r.points;
      expect(Math.abs(a!.y - b!.y)).toBeLessThan(1e-6);
    }
  });
  it("finds a triangle", () => {
    const r = recognizeShape(shaky(polygon([{ x: 0, y: 200 }, { x: 120, y: 0 }, { x: 240, y: 200 }, { x: 2, y: 198 }]), 2));
    expect(r?.kind).toBe("polygon");
    if (r?.kind === "polygon") expect(r.points.length).toBe(3);
  });
  it("straightens an angle drawn in one stroke", () => {
    const r = recognizeShape(shaky([...along({ x: 0, y: 0 }, { x: 0, y: 200 }, 50), ...along({ x: 0, y: 200 }, { x: 220, y: 200 }, 50).slice(1)], 1.5));
    expect(r?.kind).toBe("polyline");
    if (r?.kind === "polyline") expect(r.points.length).toBe(3);
  });
  it("leaves scribbles, handwriting-sized marks and curves alone", () => {
    expect(recognizeShape(along({ x: 0, y: 0 }, { x: 12, y: 8 }, 10))).toBeNull();
    const scribble = Array.from({ length: 200 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 3) * 40 + Math.sin(i / 7) * 25 }));
    expect(recognizeShape(scribble)).toBeNull();
    const s = Array.from({ length: 120 }, (_, i) => ({ x: i * 3, y: Math.sin((i / 119) * Math.PI * 2) * 80 }));
    expect(recognizeShape(s)).toBeNull();
  });
  it("turns a shape into evenly spaced ink with a steady pressure", () => {
    const ink = shapeToInk({ kind: "polygon", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }, 2);
    expect(ink.length % 3).toBe(0);
    for (let i = 2; i < ink.length; i += 3) expect(ink[i]).toBe(0.5);
    for (let i = 3; i < ink.length; i += 3) expect(Math.hypot(ink[i]! - ink[i - 3]!, ink[i + 1]! - ink[i - 2]!)).toBeLessThanOrEqual(2.0001);
    // Closed: it ends just past where it began.
    expect(Math.hypot(ink[ink.length - 3]! - 2, ink[ink.length - 2]!)).toBeLessThan(1e-6);
  });
});

describe("ink smoothing", () => {
  it("removes jitter but keeps the ends and the length of a stroke", () => {
    const clean = along({ x: 0, y: 0 }, { x: 200, y: 0 }, 200);
    const noisy = flat(shaky(clean, 1));
    const out = smoothInk(noisy, 3);
    expect(out.slice(0, 3)).toEqual(noisy.slice(0, 3));
    expect(out.slice(-3)).toEqual(noisy.slice(-3));
    const dev = (pts: number[]) => {
      let m = 0;
      for (let i = 30; i < pts.length - 30; i += 3) m += Math.abs(pts[i + 1]!);
      return m;
    };
    expect(dev(out)).toBeLessThan(dev(noisy) * 0.6);
  });
  it("leaves very short strokes as they are", () => {
    expect(smoothInk([0, 0, 0.5, 1, 1, 0.5], 3)).toEqual([0, 0, 0.5, 1, 1, 0.5]);
  });
});

describe("ruler and protractor", () => {
  const ruler: Guide = { kind: "ruler", cx: 500, cy: 300, angle: 0 };
  const prot: Guide = { kind: "protractor", cx: 500, cy: 300, angle: 0 };
  it("draws along the ruler's edge, just outside it", () => {
    const hit = hitGuide(ruler, 520, 300 - RULER_WIDTH / 2 - 8, true);
    expect(hit?.part).toBe("edge");
    if (hit?.part !== "edge") return;
    const p = snapPoint(hit.snap, 530, 200, 2);
    expect(p.y).toBeCloseTo(300 - RULER_WIDTH / 2 - 2, 6);
    expect(p.x).toBeCloseTo(530, 6);
    // Never past the ends.
    expect(snapPoint(hit.snap, 5000, 0, 2).x).toBeCloseTo(500 + RULER_LENGTH / 2, 6);
  });
  it("moves when pressed in the middle, and only draws along edges with an ink tool", () => {
    expect(hitGuide(ruler, 500, 300, true)?.part).toBe("body");
    expect(hitGuide(ruler, 520, 300 - RULER_WIDTH / 2 - 8, false)).toBeNull();
    expect(hitGuide(ruler, 500, 600, true)).toBeNull();
  });
  it("follows the protractor's arc and reads its angle", () => {
    const hit = hitGuide(prot, 500, 300 - PROTRACTOR_RADIUS - 5, true);
    expect(hit?.part).toBe("edge");
    if (hit?.part !== "edge" || hit.snap.kind !== "arc") throw new Error("expected the arc");
    const p = snapPoint(hit.snap, 600, 100, 0);
    expect(Math.hypot(p.x - 500, p.y - 300)).toBeCloseTo(PROTRACTOR_RADIUS, 6);
    expect(protractorAngle(prot, 600, 300)).toBeCloseTo(0, 6);
    expect(protractorAngle(prot, 500, 100)).toBeCloseTo(90, 6);
    expect(protractorAngle(prot, 400, 300)).toBeCloseTo(180, 6);
    // Below the flat edge, each side keeps its end.
    expect(protractorAngle(prot, 400, 320)).toBeCloseTo(180, 6);
    const below = snapPoint(hit.snap, 300, 360, 0);
    expect(below.x).toBeCloseTo(500 - PROTRACTOR_RADIUS, 6);
  });
  it("turns in whole degrees, pulled to 15° steps", () => {
    expect((snapGuideAngle((44 * Math.PI) / 180) * 180) / Math.PI).toBeCloseTo(45, 6);
    expect((snapGuideAngle((37.4 * Math.PI) / 180) * 180) / Math.PI).toBeCloseTo(37, 6);
    // Shown counter-clockwise positive; a ruler has no up or down.
    expect(displayAngle({ ...ruler, angle: (-30 * Math.PI) / 180 })).toBe(30);
    expect(displayAngle({ ...ruler, angle: Math.PI })).toBe(0);
  });
});
