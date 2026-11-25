import { assets, imageBounds, MAX_PDF_PAGES, newId, type BoardObject, type ImageObject } from "@novaloom/board-engine";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Persistence } from "./persistence";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Imported PDF pages are stored as images (WebP) on new board pages:
 * - quality: rendered at 2 pixels per board unit (≈190 dpi for A4), sharp
 *   up to 200% zoom and in exports;
 * - size: WebP keeps a text page around 100-300 KB and a photo page far
 *   below PNG, and the original PDF is not stored in the board.
 */
export type PdfQuality = "standard" | "high";
/** Pixels per board unit and limits for each quality (High: ≈290 dpi for A4, sharp to 300% zoom). */
const QUALITY: Record<PdfQuality, { pxPerUnit: number; maxSide: number; maxPixels: number }> = {
  standard: { pxPerUnit: 2, maxSide: 4000, maxPixels: 14_000_000 },
  high: { pxPerUnit: 3, maxSide: 6000, maxPixels: 30_000_000 },
};
const WEBP_QUALITY = 0.92;
/** Board units per PDF point (1/72 in): 96 dpi, so an A4 page is 794 × 1123 units. */
const UNITS_PER_POINT = 96 / 72;

export interface OpenPdf {
  name: string;
  pageCount: number;
  doc: pdfjs.PDFDocumentProxy;
}

const assetBase = () => new URL("./pdfjs/", document.baseURI).href;

/** Parses a PDF (in the window's pdf.js worker). Throws a user-worded error. */
export async function openPdf(name: string, data: Uint8Array): Promise<OpenPdf> {
  const base = assetBase();
  try {
    const doc = await pdfjs.getDocument({
      data,
      cMapUrl: `${base}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${base}standard_fonts/`,
      wasmUrl: `${base}wasm/`,
      iccUrl: `${base}iccs/`,
      enableXfa: false,
    }).promise;
    return { name, pageCount: doc.numPages, doc };
  } catch (err) {
    const n = (err as { name?: string }).name;
    if (n === "PasswordException") throw new Error("the PDF is password-protected");
    if (n === "InvalidPDFException") throw new Error("the file is not a valid PDF");
    throw new Error("the PDF could not be read");
  }
}

/** Renders one PDF page to WebP bytes; returns its size on the board (units) too. */
async function renderPage(
  doc: pdfjs.PDFDocumentProxy,
  pageNumber: number,
  quality: PdfQuality,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const q = QUALITY[quality];
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 }); // points, with the page's rotation applied
    const width = base.width * UNITS_PER_POINT;
    const height = base.height * UNITS_PER_POINT;
    let scale = UNITS_PER_POINT * q.pxPerUnit;
    scale = Math.min(scale, q.maxSide / base.width, q.maxSide / base.height, Math.sqrt(q.maxPixels / (base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("the page is too large to draw");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", WEBP_QUALITY));
    canvas.width = canvas.height = 0; // free the pixels now
    if (!blob) throw new Error("the page could not be converted");
    return { data: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    page.cleanup();
  }
}

let cancelRequested = false;

/**
 * Imports the given pages (1-based) as new board pages after the current
 * one, in one undoable step, with progress and a Cancel button. Pages are
 * prepared first and inserted together, so a cancelled or failed import
 * leaves the board unchanged.
 */
export async function importPdfPages(
  persistence: Persistence,
  pdf: OpenPdf,
  pages: readonly number[],
  quality: PdfQuality = "standard",
): Promise<void> {
  const files = window.novaLoom?.files;
  if (!files) return;
  if (pages.length > MAX_PDF_PAGES) {
    persistence.showStatus({ tone: "error", text: `Import at most ${MAX_PDF_PAGES} pages at a time; choose a page range.` });
    return;
  }
  cancelRequested = false;
  const title = pdf.name.replace(/\.pdf$/i, "").trim().slice(0, 80) || "PDF";
  const prepared: { objects: BoardObject[]; name: string }[] = [];
  try {
    for (const [i, n] of pages.entries()) {
      if (cancelRequested) {
        persistence.showStatus({ tone: "success", text: "PDF import cancelled. Nothing was added." });
        return;
      }
      persistence.showStatus({
        tone: "progress",
        text: `Importing ${pdf.name}: page ${i + 1} of ${pages.length}…`,
        action: { label: "Cancel", run: () => (cancelRequested = true) },
      });
      const r = await renderPage(pdf.doc, n, quality);
      // Stored like any image: the main process checks the bytes and keeps one copy per board.
      const id = await files.storeAsset({ mime: "image/webp", data: r.data });
      await assets.put(id, { mime: "image/webp", data: r.data });
      const base = { id: newId(), type: "image" as const, asset: id, cx: r.width / 2, cy: r.height / 2, width: r.width, height: r.height, rotation: 0, locked: true };
      const image: ImageObject = { ...base, bounds: imageBounds(base) };
      prepared.push({ objects: [image], name: `${title} (${n})` });
    }
    persistence.insertPages(prepared.map((p) => ({ ...p, background: "blank" as const })));
    persistence.showStatus({
      tone: "success",
      text: `Imported ${pages.length === 1 ? "1 page" : `${pages.length} pages`} from ${pdf.name}. Write on them with any tool; Ctrl+Z removes them.`,
    });
  } catch (err) {
    persistence.showStatus({ tone: "error", text: `The PDF could not be imported: ${(err as Error).message}` });
  } finally {
    void pdf.doc.loadingTask.destroy();
  }
}
