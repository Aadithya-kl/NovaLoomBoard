/**
 * Decoded images for drawing, shared by the board, thumbnails and exports.
 * Assets are content-addressed (SHA-256 of the file), so one cache serves
 * every board in the window. Pixels are fetched through a loader the app
 * provides (the desktop main process reads them from the board file).
 */

/** Accepted image formats. */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];
/** Largest image file accepted. */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/** Largest decoded image accepted (pixels) and longest side. */
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_SIDE = 12_000;

/** Largest PDF accepted for import. */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
/** Most PDF pages imported at once. */
export const MAX_PDF_PAGES = 100;

/** True if the bytes start like a PDF (the signature may follow a few junk bytes). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export const isAssetId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** The format from a file's first bytes (never trust the extension). Null if it is not an accepted image. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Pixel size from the file header, without decoding (so an oversized image
 * is refused before it can use up memory). Null if the header is unreadable.
 */
export function imageSize(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  const b = bytes;
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  const tag = (i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
  if (mime === "image/png") {
    if (b.length < 24 || tag(12) !== "IHDR") return null;
    return { width: u32be(16), height: u32be(20) };
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i++; // fill byte
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; // markers without a length
        continue;
      }
      // Start of frame (any coding), not DHT/JPG/DAC.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16be(i + 5), width: u16be(i + 7) };
      }
      if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan before any frame header
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (b.length < 30) return null;
  const chunk = tag(12);
  if (chunk === "VP8 ") return { width: ((b[26]! | (b[27]! << 8)) & 0x3fff), height: ((b[28]! | (b[29]! << 8)) & 0x3fff) };
  if (chunk === "VP8L") {
    return {
      width: 1 + (((b[22]! & 0x3f) << 8) | b[21]!),
      height: 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8X") {
    return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
  }
  return null;
}

/**
 * Checks an image file before it is stored: format from its bytes, file
 * size, and pixel size from its header. Returns the format, or a reason the
 * file is refused (worded for the user).
 */
export function checkImageFile(bytes: Uint8Array): { mime: ImageMime; width: number; height: number } | { error: string } {
  if (bytes.length === 0) return { error: "the file is empty" };
  if (bytes.length > MAX_IMAGE_BYTES) return { error: `the file is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
  const mime = sniffImageMime(bytes);
  if (!mime) return { error: "it is not a PNG, JPEG or WebP image" };
  const size = imageSize(bytes, mime);
  if (!size || size.width < 1 || size.height < 1) return { error: "the image could not be read" };
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > MAX_IMAGE_PIXELS) {
    return { error: `the image is too large (${size.width} × ${size.height} pixels; at most ${MAX_IMAGE_PIXELS / 1e6} megapixels)` };
  }
  return { mime, ...size };
}

export interface AssetData {
  mime: string;
  data: Uint8Array;
}

/**
 * Decoded pixels kept in memory at most, across all images and sizes (a
 * 12-megapixel photo is ~48 MB decoded). Beyond this, the images drawn
 * least recently are released and decoded again when needed.
 */
export const IMAGE_CACHE_PIXELS = 64_000_000;
/** Images drawn on the board this recently are never released (they are on screen). */
const KEEP_RECENT_MS = 3_000;
/**
 * Sizes kept per image: the original, and copies whose longest side is at
 * most 2048 or 512 pixels. Drawing picks the smallest that is still sharp
 * at the size shown, so a zoomed-out board of photos or a strip of page
 * thumbnails does not hold every original in memory.
 */
export const LEVEL_SIDES = [Infinity, 2048, 512] as const;

interface Held {
  image: ImageBitmap;
  lastUsed: number;
}

interface Entry {
  id: string;
  missing?: boolean;
  /** Natural (oriented) size, known after the first decode. */
  width?: number;
  height?: number;
  levels: Map<number, Held>;
  loading: Map<number, Promise<void>>;
}

const pixelsOf = (b: ImageBitmap) => b.width * b.height;

/** The size level for an image shown `side` pixels across (its longest side). */
export function levelFor(side: number): number {
  let level = 0;
  for (let i = 1; i < LEVEL_SIDES.length; i++) if (side <= LEVEL_SIDES[i]!) level = i;
  return level;
}

class AssetCache {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(id: string) => void>();
  private loader: ((id: string) => Promise<AssetData | null>) | null = null;
  private pixels = 0;
  private evictTimer: ReturnType<typeof setTimeout> | null = null;

  /** How the cache fetches pixels it does not have yet. */
  setLoader(loader: ((id: string) => Promise<AssetData | null>) | null): void {
    this.loader = loader;
  }

  /**
   * A decoded image sharp enough to show `side` pixels across, or null while
   * it loads (a load is started; any other size held is returned meanwhile).
   * `pin` marks it as on screen (the board); thumbnails do not pin.
   */
  get(id: string, side = Infinity, pin = true): ImageBitmap | null {
    const e = this.entry(id);
    if (e.missing) return null;
    const level = this.effectiveLevel(e, levelFor(side));
    const held = e.levels.get(level);
    const now = performance.now();
    if (held) {
      if (pin) held.lastUsed = now;
      return held.image;
    }
    this.load(e, level);
    // Meanwhile, the closest size held (more detail first).
    const others = [...e.levels.keys()].sort((a, b) => Math.abs(a - level) - Math.abs(b - level) || a - b);
    if (!others.length) return null;
    const h = e.levels.get(others[0]!)!;
    if (pin) h.lastUsed = now;
    return h.image;
  }

  isMissing(id: string): boolean {
    return this.entries.get(id)?.missing === true;
  }

  /** Decoded pixels currently held (diagnostics and tests). */
  get heldPixels(): number {
    return this.pixels;
  }

  /** Adds an image already in memory (just imported or pasted); returns the original-size decode. */
  async put(id: string, data: AssetData): Promise<ImageBitmap> {
    const image = await decode(data);
    const e = this.entry(id);
    e.missing = false;
    e.width = image.width;
    e.height = image.height;
    this.hold(e, 0, image);
    this.emit(id);
    return image;
  }

  /** Resolves when the image is decoded at the size needed for `side` pixels (or known to be missing). */
  async whenLoaded(id: string, side = Infinity): Promise<ImageBitmap | null> {
    const e = this.entry(id);
    for (let attempt = 0; attempt < 2 && !e.missing; attempt++) {
      // The level can change once the natural size is known (after the first decode).
      const level = this.effectiveLevel(e, levelFor(side));
      const held = e.levels.get(level);
      if (held) {
        held.lastUsed = performance.now();
        return held.image;
      }
      this.load(e, level);
      await e.loading.get(level);
    }
    const held = e.levels.get(this.effectiveLevel(e, levelFor(side)));
    if (!held) return null;
    held.lastUsed = performance.now();
    return held.image;
  }

  /** Called whenever an image finishes loading (to redraw). */
  onLoad(listener: (id: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { id, levels: new Map(), loading: new Map() };
      this.entries.set(id, e);
    }
    return e;
  }

  /** A copy no smaller than the original is the original. */
  private effectiveLevel(e: Entry, level: number): number {
    if (e.width === undefined || e.height === undefined) return level;
    const side = Math.max(e.width, e.height);
    while (level > 0 && side <= LEVEL_SIDES[level]!) level--;
    return level;
  }

  private hold(e: Entry, level: number, image: ImageBitmap): void {
    const old = e.levels.get(level);
    if (old) {
      this.pixels -= pixelsOf(old.image);
      if (old.image !== image) old.image.close();
    }
    e.levels.set(level, { image, lastUsed: performance.now() });
    this.pixels += pixelsOf(image);
    this.evict();
  }

  /**
   * Releases the images drawn least recently while over budget (never ones
   * on screen). Images still too recent are checked again shortly, so the
   * memory is returned even when nothing else loads.
   */
  private evict(): void {
    if (this.evictTimer) clearTimeout(this.evictTimer);
    this.evictTimer = null;
    if (this.pixels <= IMAGE_CACHE_PIXELS) return;
    const now = performance.now();
    const held: { e: Entry; level: number; h: Held }[] = [];
    for (const e of this.entries.values()) for (const [level, h] of e.levels) held.push({ e, level, h });
    held.sort((a, b) => a.h.lastUsed - b.h.lastUsed);
    for (const { e, level, h } of held) {
      if (this.pixels <= IMAGE_CACHE_PIXELS) break;
      if (now - h.lastUsed < KEEP_RECENT_MS) {
        this.evictTimer = setTimeout(() => this.evict(), KEEP_RECENT_MS - (now - h.lastUsed) + 50);
        break;
      }
      e.levels.delete(level);
      this.pixels -= pixelsOf(h.image);
      h.image.close();
    }
  }

  private load(e: Entry, level: number): void {
    if (e.loading.has(level) || e.missing) return;
    const promise = this.decodeLevel(e, level)
      .then((image) => {
        if (!image) {
          if (!e.levels.size) e.missing = true;
          return;
        }
        this.hold(e, this.effectiveLevel(e, level), image);
      })
      .catch((err) => {
        console.error("[assets] could not load", e.id, err);
        if (!e.levels.size) e.missing = true;
      })
      .finally(() => {
        e.loading.delete(level);
        this.emit(e.id);
      });
    e.loading.set(level, promise);
  }

  /** Decodes one size: scaled down from a larger size already held, or from the file. */
  private async decodeLevel(e: Entry, level: number): Promise<ImageBitmap | null> {
    const side = LEVEL_SIDES[level]!;
    const larger = [...e.levels.entries()].filter(([l]) => l < level).sort((a, b) => b[0] - a[0])[0]?.[1].image;
    let source: ImageBitmap | null = larger ?? null;
    let decoded: ImageBitmap | null = null;
    if (!source) {
      if (!this.loader) return null;
      const data = await this.loader(e.id);
      if (!data) return null;
      decoded = await decode(data);
      e.width = decoded.width;
      e.height = decoded.height;
      source = decoded;
    }
    const k = Math.min(1, side / Math.max(source.width, source.height));
    if (k >= 1) return decoded ?? (await createImageBitmap(source));
    const scaled = await createImageBitmap(source, {
      resizeWidth: Math.max(1, Math.round(source.width * k)),
      resizeHeight: Math.max(1, Math.round(source.height * k)),
      resizeQuality: "high",
    });
    decoded?.close();
    return scaled;
  }

  private emit(id: string): void {
    for (const l of this.listeners) l(id);
  }
}

function decode(data: AssetData): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([data.data as BlobPart], { type: data.mime }));
}

/** The window's image cache. */
export const assets = new AssetCache();
