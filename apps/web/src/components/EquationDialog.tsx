import { assets, inkColor, isDarkBackground, type BoardEngine } from "@novaloom/board-engine";
import { useEffect, useRef, useState } from "react";
import { equationPng, renderEquation, type RenderedEquation } from "../equation";
import type { Persistence } from "../persistence";

/** Buttons that insert common notation; "▢" marks where the caret goes. */
const GROUPS: { label: string; items: { show: string; tex: string; name: string }[] }[] = [
  {
    label: "Structure",
    items: [
      { show: "a⁄b", tex: "\\frac{▢}{}", name: "Fraction" },
      { show: "√", tex: "\\sqrt{▢}", name: "Square root" },
      { show: "ⁿ√", tex: "\\sqrt[n]{▢}", name: "Root" },
      { show: "xⁿ", tex: "^{▢}", name: "Power" },
      { show: "xₙ", tex: "_{▢}", name: "Index" },
      { show: "( )", tex: "\\left( ▢ \\right)", name: "Brackets" },
      { show: "|x|", tex: "\\left| ▢ \\right|", name: "Absolute value" },
      { show: "v⃗", tex: "\\vec{▢}", name: "Vector" },
    ],
  },
  {
    label: "Symbols",
    items: [
      { show: "±", tex: "\\pm ", name: "Plus or minus" },
      { show: "×", tex: "\\times ", name: "Times" },
      { show: "÷", tex: "\\div ", name: "Divided by" },
      { show: "≠", tex: "\\neq ", name: "Not equal" },
      { show: "≤", tex: "\\le ", name: "Less or equal" },
      { show: "≥", tex: "\\ge ", name: "Greater or equal" },
      { show: "≈", tex: "\\approx ", name: "Approximately" },
      { show: "∞", tex: "\\infty ", name: "Infinity" },
      { show: "°", tex: "^\\circ ", name: "Degrees" },
      { show: "→", tex: "\\rightarrow ", name: "Arrow" },
    ],
  },
  {
    label: "Greek and more",
    items: [
      { show: "π", tex: "\\pi ", name: "Pi" },
      { show: "α", tex: "\\alpha ", name: "Alpha" },
      { show: "β", tex: "\\beta ", name: "Beta" },
      { show: "θ", tex: "\\theta ", name: "Theta" },
      { show: "λ", tex: "\\lambda ", name: "Lambda" },
      { show: "Δ", tex: "\\Delta ", name: "Delta" },
      { show: "Σ", tex: "\\sum_{i=1}^{n} ▢", name: "Sum" },
      { show: "∫", tex: "\\int_{a}^{b} ▢ \\, dx", name: "Integral" },
      { show: "lim", tex: "\\lim_{x \\to ▢}", name: "Limit" },
    ],
  },
];

const EXAMPLES = ["x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", "a^2 + b^2 = c^2", "E = mc^2", "\\ce{2H2 + O2 -> 2H2O}"];

/**
 * Typed equations: write TeX (or use the buttons), see it as it will look, and add it to the
 * board as a picture that remembers its TeX, so double-clicking it opens it here again.
 */
export function EquationDialog({
  engine,
  persistence,
  edit,
  onClose,
}: {
  engine: BoardEngine;
  persistence: Persistence;
  edit?: { id: string; tex: string; color: string };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [tex, setTex] = useState(edit?.tex ?? "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
  const [result, setResult] = useState<RenderedEquation | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const state = engine.getState();
  // New equations take the text colour, drawn light on a dark board like other ink.
  const color = edit?.color ?? inkColor(state.textStyle.color, isDarkBackground(state.background));
  const fontSize = Math.max(18, state.textStyle.fontSize);

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    input.current?.focus();
    input.current?.select();
    return () => d.close();
  }, []);

  // Live preview, a moment after typing stops.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void renderEquation(tex, color, 28).then((r) => live && setResult(r));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [tex, color]);

  const insert = (snippet: string) => {
    const el = input.current;
    if (!el) return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    const selected = tex.slice(a, b);
    const caret = snippet.indexOf("▢");
    const text = snippet.replace("▢", selected);
    setTex(tex.slice(0, a) + text + tex.slice(b));
    requestAnimationFrame(() => {
      el.focus();
      const at = a + (caret >= 0 ? caret + selected.length : text.length);
      el.setSelectionRange(at, at);
    });
  };

  const add = async () => {
    const files = window.novaLoom?.files;
    if (!files || busy) return;
    setBusy(true);
    try {
      const eq = await renderEquation(tex, color, fontSize);
      if ("error" in eq) return;
      const png = await equationPng(eq, 4);
      const id = await files.storeAsset({ mime: "image/png", data: png });
      await assets.put(id, { mime: "image/png", data: png });
      engine.placeImage({ asset: id, width: eq.width, height: eq.height, equation: { tex: tex.trim(), color } }, edit?.id);
      onClose();
    } catch (err) {
      persistence.showStatus({ tone: "error", text: `The equation could not be added: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const ok = result !== null && !("error" in result);
  return (
    <dialog
      ref={ref}
      className="confirm equation-dialog"
      aria-labelledby="equation-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void add();
        }
      }}
    >
      <h2 id="equation-title">{edit ? "Edit equation" : "Insert equation"}</h2>
      {GROUPS.map((g) => (
        <div key={g.label} className="symbol-row" role="group" aria-label={g.label}>
          {g.items.map((it) => (
            <button key={it.name} type="button" className="symbol-btn" title={it.name} aria-label={it.name} onClick={() => insert(it.tex)}>
              {it.show}
            </button>
          ))}
        </div>
      ))}
      <textarea
        ref={input}
        className="formula-input tex-input"
        aria-label="Equation (TeX)"
        spellCheck={false}
        rows={3}
        value={tex}
        onChange={(e) => setTex(e.target.value)}
      />
      <div className="equation-preview" aria-live="polite">
        {result === null ? (
          <span className="dialog-help">Loading…</span>
        ) : "error" in result ? (
          <span className="field-error">{result.error}</span>
        ) : (
          // MathJax output from the TeX above (plain SVG: no links or scripts can be produced).
          <span className="equation-svg" dangerouslySetInnerHTML={{ __html: result.svg }} />
        )}
      </div>
      <div className="example-row" role="group" aria-label="Examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="chip" onClick={() => setTex(ex)}>
            {ex.length > 26 ? `${ex.slice(0, 24)}…` : ex}
          </button>
        ))}
      </div>
      <p className="dialog-help">
        Written in TeX, as in maths documents: <code>\frac{"{a}{b}"}</code>, <code>x^2</code>, <code>\sqrt{"{x}"}</code>. Chemistry with <code>\ce{"{…}"}</code>.
      </p>
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!ok || busy} onClick={() => void add()}>
          {edit ? "Update" : "Insert"}
        </button>
      </div>
    </dialog>
  );
}
