import { shortcutCode } from "../keys";
import { looksLikePdf, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_PDF_PAGES, parsePageRange, type BoardEngine } from "@novaloom/board-engine";
import { useEffect, useRef, useState } from "react";
import { exportPdf, exportPng, importImages, insertImageBytes, setPdfHandler } from "../files";
import { importPdfPages, openPdf, type OpenPdf, type PdfQuality } from "../pdfImport";
import type { Persistence } from "../persistence";
import { usePersistenceState } from "../usePersistence";

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Import and export: File menu commands and their shortcuts (Ctrl+I,
 * Ctrl+E, Ctrl+Shift+E), dropping files on the board, and the PDF dialogs.
 */
export function FileActions({ engine, persistence }: { engine: BoardEngine; persistence: Persistence }) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfImport, setPdfImport] = useState<OpenPdf | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Parses a PDF and asks which pages to import. */
  const startPdfImport = async (name: string, data: Uint8Array) => {
    try {
      persistence.showStatus({ tone: "progress", text: `Opening ${name}…` });
      const pdf = await openPdf(name, data);
      persistence.showStatus(null);
      setPdfImport(pdf);
    } catch (err) {
      persistence.showStatus({ tone: "error", text: `${name} could not be imported: ${(err as Error).message}.` });
    }
  };

  useEffect(() => {
    if (!window.novaLoom) return;
    setPdfHandler((name, data) => void startPdfImport(name, data));
    const offMenu = persistence.onMenuCommand((c) => {
      if (c === "import-images") void importImages(engine, persistence);
      else if (c === "export-png") void exportPng(persistence);
      else if (c === "export-pdf") setPdfOpen(true);
      else if (c === "import-pdf") {
        void window.novaLoom!.files.openPdf().then((r) => {
          if (!r) return;
          if ("error" in r) persistence.showStatus({ tone: "error", text: `${r.name} could not be imported: ${r.error}.` });
          else void startPdfImport(r.name, r.data);
        });
      }
    });

    // Files dropped anywhere on the window: images go where they are dropped, a PDF opens the import dialog.
    // (Every drop is handled here, so the window never navigates to a dropped file.)
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) ? "copy" : "none";
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      const at = { clientX: e.clientX, clientY: e.clientY };
      void (async () => {
        const pdf = files.find((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
        if (pdf) {
          if (pdf.size > MAX_PDF_BYTES) {
            persistence.showStatus({ tone: "error", text: `${pdf.name} could not be imported: the file is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.` });
            return;
          }
          const data = new Uint8Array(await pdf.arrayBuffer());
          if (!looksLikePdf(data)) {
            persistence.showStatus({ tone: "error", text: `${pdf.name} could not be imported: it is not a PDF document.` });
            return;
          }
          await startPdfImport(pdf.name, data);
          return;
        }
        const items: { name: string; data: Uint8Array }[] = [];
        const tooBig: string[] = [];
        for (const f of files) {
          // Refuse oversized files before reading them.
          if (f.size > MAX_IMAGE_BYTES) tooBig.push(f.name);
          else items.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
        }
        await insertImageBytes(engine, persistence, items, at);
        if (tooBig.length && !items.length) {
          persistence.showStatus({ tone: "error", text: `Not added: ${tooBig.join("; ")} (larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` });
        }
      })();
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    const offDrag = () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isEditable(e.target) || engine.isInteracting) return;
      if (shortcutCode(e) === "KeyI" && !e.shiftKey) {
        e.preventDefault();
        void importImages(engine, persistence);
      } else if (shortcutCode(e) === "KeyE") {
        e.preventDefault();
        if (e.shiftKey) void exportPng(persistence);
        else setPdfOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      setPdfHandler(null);
      offMenu();
      offDrag();
      window.removeEventListener("keydown", onKeyDown);
    };
    // startPdfImport only uses persistence and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, persistence]);

  return (
    <>
      {dragging && (
        <div className="drop-hint" aria-hidden="true">
          <p>Drop images or a PDF to add them to the board</p>
        </div>
      )}
      {pdfOpen && <PdfExportDialog persistence={persistence} onClose={() => setPdfOpen(false)} />}
      {pdfImport && (
        <PdfImportDialog
          pdf={pdfImport}
          onCancel={() => {
            void pdfImport.doc.loadingTask.destroy();
            setPdfImport(null);
          }}
          onImport={(pages, quality) => {
            setPdfImport(null);
            void importPdfPages(persistence, pdfImport, pages, quality);
          }}
        />
      )}
    </>
  );
}

/** Which pages of a PDF to import. */
const QUALITY_KEY = "novaloomboard.pdf-quality";
function readQuality(): PdfQuality {
  try {
    return localStorage.getItem(QUALITY_KEY) === "high" ? "high" : "standard";
  } catch {
    return "standard";
  }
}

function PdfImportDialog({
  pdf,
  onCancel,
  onImport,
}: {
  pdf: OpenPdf;
  onCancel: () => void;
  onImport: (pages: number[], quality: PdfQuality) => void;
}) {
  const [quality, setQuality] = useState<PdfQuality>(readQuality);
  const ref = useRef<HTMLDialogElement>(null);
  const n = pdf.pageCount;
  const [choice, setChoice] = useState<"all" | "range">(n <= MAX_PDF_PAGES ? "all" : "range");
  const [range, setRange] = useState(n <= MAX_PDF_PAGES ? `1-${n}` : `1-${MAX_PDF_PAGES}`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);

  const submit = () => {
    let pages: number[];
    if (choice === "all") pages = Array.from({ length: n }, (_, i) => i + 1);
    else {
      const r = parsePageRange(range, n);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      pages = r.pages.map((i) => i + 1);
    }
    if (pages.length > MAX_PDF_PAGES) {
      setError(`Import at most ${MAX_PDF_PAGES} pages at a time.`);
      return;
    }
    try {
      localStorage.setItem(QUALITY_KEY, quality);
    } catch {
      /* a convenience only */
    }
    onImport(pages, quality);
  };

  return (
    <dialog
      ref={ref}
      className="confirm export-dialog"
      aria-labelledby="pdf-import-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="pdf-import-title">Import PDF</h2>
        <p className="dialog-file">
          {pdf.name} <span className="choice-note">{n === 1 ? "1 page" : `${n} pages`}</span>
        </p>
        <fieldset className="choice-group">
          <legend className="visually-hidden">Pages</legend>
          <label className="choice" aria-disabled={n > MAX_PDF_PAGES}>
            <input type="radio" name="pdf-pages" disabled={n > MAX_PDF_PAGES} checked={choice === "all"} onChange={() => setChoice("all")} />
            <span>
              All pages <span className="choice-note">{n}</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="pdf-pages" checked={choice === "range"} onChange={() => setChoice("range")} />
            <span>Pages</span>
            <input
              className="range-input"
              aria-label="Pages to import, for example 1-3, 5"
              value={range}
              placeholder="1-3, 5"
              onFocus={() => setChoice("range")}
              onChange={(e) => {
                setRange(e.target.value);
                setError(null);
              }}
            />
          </label>
        </fieldset>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="segmented quality-choice" role="radiogroup" aria-label="Quality">
          <button type="button" role="radio" aria-checked={quality === "standard"} onClick={() => setQuality("standard")}>
            Standard
          </button>
          <button type="button" role="radio" aria-checked={quality === "high"} onClick={() => setQuality("high")}>
            High
          </button>
        </div>
        <p className="choice-help">
          {quality === "standard"
            ? "Sharp up to 200% zoom. Smallest board file."
            : "Sharp up to 300% zoom, for small print. Board file about 1.5–2× larger."}
        </p>
        <p>
          Each PDF page becomes a new board page after the current one, ready to write on.
          {n > MAX_PDF_PAGES ? ` Up to ${MAX_PDF_PAGES} pages can be imported at a time.` : ""}
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" autoFocus>
            Import
          </button>
        </div>
      </form>
    </dialog>
  );
}

type Choice = "current" | "all" | "range";

function PdfExportDialog({ persistence, onClose }: { persistence: Persistence; onClose: () => void }) {
  const { pages, activePage } = usePersistenceState(persistence);
  const ref = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<Choice>(pages.length > 1 ? "all" : "current");
  const [range, setRange] = useState(`1-${pages.length}`);
  const [error, setError] = useState<string | null>(null);
  const current = pages.find((p) => p.id === activePage);

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);

  const submit = () => {
    let ids: string[];
    if (choice === "current") ids = [activePage];
    else if (choice === "all") ids = pages.map((p) => p.id);
    else {
      const r = parsePageRange(range, pages.length);
      if ("error" in r) {
        setError(r.error);
        return;
      }
      ids = r.pages.map((i) => pages[i]!.id);
    }
    onClose();
    void exportPdf(persistence, ids);
  };

  return (
    <dialog
      ref={ref}
      className="confirm export-dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="export-title">Export as PDF</h2>
        <fieldset className="choice-group">
          <legend className="visually-hidden">Pages</legend>
          <label className="choice">
            <input type="radio" name="pages" checked={choice === "current"} onChange={() => setChoice("current")} />
            <span>
              Current page <span className="choice-note">{current?.label}</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="pages" checked={choice === "all"} onChange={() => setChoice("all")} />
            <span>
              All pages <span className="choice-note">{pages.length}</span>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="pages" checked={choice === "range"} onChange={() => setChoice("range")} />
            <span>Pages</span>
            <input
              className="range-input"
              aria-label="Pages to export, for example 1-3, 5"
              value={range}
              placeholder="1-3, 5"
              onFocus={() => setChoice("range")}
              onChange={(e) => {
                setRange(e.target.value);
                setError(null);
              }}
            />
          </label>
        </fieldset>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <p>Each page goes on its own A4 sheet, turned to suit its content. Text stays selectable.</p>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" autoFocus>
            Export…
          </button>
        </div>
      </form>
    </dialog>
  );
}
