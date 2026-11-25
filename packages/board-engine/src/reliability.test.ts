/**
 * Regression tests for the reliability stage: fitting content clear of the
 * floating panels, and the bounded image cache (sizes, budget, release).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitBoundsInset, viewportBounds } from "./camera";

describe("fit to content with panels covering the board", () => {
  const content = { minX: 0, minY: 0, maxX: 1000, maxY: 800 };

  it("keeps the content inside the area the panels leave free", () => {
    const insets = { top: 12, right: 12, bottom: 220, left: 140 };
    const cam = fitBoundsInset(content, 1600, 900, insets)!;
    // Content corners on screen.
    const sx = (x: number) => (x - cam.x) * cam.zoom;
    const sy = (y: number) => (y - cam.y) * cam.zoom;
    expect(sx(content.minX)).toBeGreaterThanOrEqual(insets.left - 1e-6);
    expect(sx(content.maxX)).toBeLessThanOrEqual(1600 - insets.right + 1e-6);
    expect(sy(content.minY)).toBeGreaterThanOrEqual(insets.top - 1e-6);
    expect(sy(content.maxY)).toBeLessThanOrEqual(900 - insets.bottom + 1e-6);
    // Centred in the free area.
    expect((sx(content.minX) + sx(content.maxX)) / 2).toBeCloseTo((insets.left + 1600 - insets.right) / 2, 6);
    expect((sy(content.minY) + sy(content.maxY)) / 2).toBeCloseTo((insets.top + 900 - insets.bottom) / 2, 6);
  });

  it("without panels it fits the whole board", () => {
    const cam = fitBoundsInset(content, 1600, 900, { top: 0, right: 0, bottom: 0, left: 0 })!;
    const v = viewportBounds(cam, 1600, 900);
    expect(v.minX).toBeLessThanOrEqual(0);
    expect(v.maxY).toBeGreaterThanOrEqual(800);
  });

  it("never fits into less than a usable area, even in a tiny window", () => {
    const cam = fitBoundsInset(content, 300, 200, { top: 12, right: 12, bottom: 400, left: 400 });
    expect(cam).not.toBeNull();
    expect(Number.isFinite(cam!.zoom) && cam!.zoom > 0).toBe(true);
  });
});

// ---------- image cache ----------

class FakeBitmap {
  closed = false;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  close() {
    this.closed = true;
  }
}

/** Decodes "images" whose bytes are [w/100, h/100]; resizes honour the requested size. */
function installFakeDecoder() {
  const decode = vi.fn(async (src: Blob | FakeBitmap, opts?: { resizeWidth?: number; resizeHeight?: number }) => {
    if (src instanceof FakeBitmap) return new FakeBitmap(opts?.resizeWidth ?? src.width, opts?.resizeHeight ?? src.height);
    const b = new Uint8Array(await src.arrayBuffer());
    return new FakeBitmap(b[0]! * 100, b[1]! * 100);
  });
  vi.stubGlobal("createImageBitmap", decode);
  return decode;
}

describe("image cache", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const img = (w: number, h: number) => ({ mime: "image/png", data: new Uint8Array([w / 100, h / 100]) });

  it("picks the smallest copy that is still sharp at the size shown", async () => {
    const { levelFor } = await import("./assets");
    expect(levelFor(300)).toBe(2); // a thumbnail: the 512 px copy
    expect(levelFor(1200)).toBe(1); // a photo shown zoomed out: the 2048 px copy
    expect(levelFor(5000)).toBe(0); // zoomed in: the original
  });

  it("serves a small copy for thumbnails, made from the original already decoded (no reload)", async () => {
    installFakeDecoder();
    const { assets } = await import("./assets");
    const loader = vi.fn(async () => img(4000, 3000));
    assets.setLoader(loader);
    await assets.put("a", img(4000, 3000));
    expect(assets.get("a", 200, false)).toBeInstanceOf(FakeBitmap); // the original, while the small copy is made
    const small = await assets.whenLoaded("a", 200);
    expect(small).toMatchObject({ width: 512, height: 384 });
    expect(loader).not.toHaveBeenCalled();
  });

  it("small images are never copied: every size is the original", async () => {
    installFakeDecoder();
    const { assets } = await import("./assets");
    const original = await assets.put("s", img(400, 300));
    expect(assets.get("s", 100)).toBe(original);
    expect(assets.heldPixels).toBe(400 * 300);
  });

  it("keeps decoded images within the budget, releasing those not drawn recently", async () => {
    installFakeDecoder();
    const { assets, IMAGE_CACHE_PIXELS } = await import("./assets");
    const bitmaps: FakeBitmap[] = [];
    for (let i = 0; i < 10; i++) bitmaps.push((await assets.put(`p${i}`, img(4000, 3000))) as unknown as FakeBitmap);
    // 10 × 12 MP just decoded: all recent, nothing released yet.
    expect(assets.heldPixels).toBe(120_000_000);
    // One stays on screen.
    vi.advanceTimersByTime(2_000);
    assets.get("p9", Infinity, true);
    vi.advanceTimersByTime(2_000);
    expect(assets.heldPixels).toBeLessThanOrEqual(IMAGE_CACHE_PIXELS);
    expect(bitmaps[9]!.closed).toBe(false); // drawn recently: kept
    expect(bitmaps[0]!.closed).toBe(true); // oldest: released
  });

  it("a released image is decoded again from the board when needed", async () => {
    installFakeDecoder();
    const { assets } = await import("./assets");
    const loader = vi.fn(async () => img(4000, 3000));
    assets.setLoader(loader);
    for (let i = 0; i < 8; i++) await assets.put(`q${i}`, img(4000, 3000));
    vi.advanceTimersByTime(4_000);
    expect(assets.get("q0", Infinity, true)).toBeNull(); // released; a load starts
    const back = await assets.whenLoaded("q0");
    expect(back).toMatchObject({ width: 4000, height: 3000 });
    expect(loader).toHaveBeenCalledWith("q0");
  });

  it("thumbnails do not keep images in memory as if they were on screen", async () => {
    installFakeDecoder();
    const { assets } = await import("./assets");
    const first = (await assets.put("t0", img(4000, 3000))) as unknown as FakeBitmap;
    vi.advanceTimersByTime(3_500);
    assets.get("t0", Infinity, false); // drawn by a thumbnail: not pinned
    for (let i = 1; i < 8; i++) await assets.put(`t${i}`, img(4000, 3000));
    vi.advanceTimersByTime(3_500);
    expect(first.closed).toBe(true);
  });
});
