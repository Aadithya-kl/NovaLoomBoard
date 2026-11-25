import { AXIS_UNIT, inkColor, makeBackground, parseBackground, parseFormula, plotCurve, type BoardEngine } from "@novaloom/board-engine";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const EXAMPLES = ["y = x²", "y = 2x + 1", "y = x³ − 3x", "y = sin(x)", "y = 1/x", "y = √x"];
const SYMBOLS: { label: string; insert: string }[] = [
  { label: "x²", insert: "²" },
  { label: "xⁿ", insert: "^" },
  { label: "√", insert: "√(" },
  { label: "π", insert: "π" },
  { label: "sin", insert: "sin(" },
  { label: "cos", insert: "cos(" },
  { label: "|x|", insert: "abs(" },
  { label: "ln", insert: "ln(" },
];

/** "x^2" → "x²" and similar, for the label written next to the curve. */
function pretty(src: string): string {
  let s = src.trim().replace(/\s+/g, " ");
  if (!/^\s*(y|f\s*\(\s*x\s*\))\s*=/i.test(s)) s = `y = ${s}`;
  return s
    .replace(/\^\(?2\)?(?![\d.])/g, "²")
    .replace(/\^\(?3\)?(?![\d.])/g, "³")
    .replace(/sqrt/gi, "√")
    .replace(/\bpi\b/gi, "π")
    .replace(/\*/g, "·")
    .replace(/-/g, "−");
}

/**
 * Plot a function: type y = f(x), see it drawn, and add it to the board as clean ink in the
 * pen's colour on the coordinate grid (which it switches to, keeping the board colour).
 */
export function PlotDialog({ engine, onClose }: { engine: BoardEngine; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [formula, setFormula] = useState("y = x² − 2");
  const [label, setLabel] = useState(true);
  const parsed = useMemo(() => parseFormula(formula), [formula]);

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    input.current?.select();
    return () => d.close();
  }, []);

  // A small preview from −10 to 10.
  useLayoutEffect(() => {
    const c = preview.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = 360;
    const H = 170;
    c.width = W * dpr;
    c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = document.documentElement.dataset.ui === "dark";
    ctx.fillStyle = dark ? "#1d2025" : "#fbfbfc";
    ctx.fillRect(0, 0, W, H);
    const unit = W / 20;
    const ox = W / 2;
    const oy = H / 2;
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.07)" : "rgba(15,23,42,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -10; i <= 10; i++) {
      ctx.moveTo(Math.round(ox + i * unit) + 0.5, 0);
      ctx.lineTo(Math.round(ox + i * unit) + 0.5, H);
    }
    for (let j = -5; j <= 5; j++) {
      ctx.moveTo(0, Math.round(oy + j * unit) + 0.5);
      ctx.lineTo(W, Math.round(oy + j * unit) + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.45)";
    ctx.beginPath();
    ctx.moveTo(0, oy + 0.5);
    ctx.lineTo(W, oy + 0.5);
    ctx.moveTo(ox + 0.5, 0);
    ctx.lineTo(ox + 0.5, H);
    ctx.stroke();
    if (!("f" in parsed)) return;
    const s = engine.getState();
    ctx.strokeStyle = inkColor(s.styles.pen.color, dark);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    for (const line of plotCurve(parsed.f, -10, 10, -H / 2 / unit, H / 2 / unit, 0.02)) {
      ctx.beginPath();
      for (let i = 0; i < line.length; i += 2) {
        const x = ox + (line[i]! / AXIS_UNIT) * unit;
        const y = oy + (line[i + 1]! / AXIS_UNIT) * unit;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [parsed, engine]);

  const insert = (text: string) => {
    const el = input.current;
    if (!el) return;
    const a = el.selectionStart ?? formula.length;
    const b = el.selectionEnd ?? formula.length;
    const close = text.endsWith("(") ? ")" : "";
    const next = formula.slice(0, a) + text + formula.slice(a, b) + close + formula.slice(b);
    setFormula(next);
    requestAnimationFrame(() => {
      el.focus();
      const at = a + text.length + (b - a);
      el.setSelectionRange(at, at);
    });
  };

  const plot = () => {
    if (!("f" in parsed)) return;
    const { pattern, paper } = parseBackground(engine.getState().background);
    // The curve belongs on the coordinate grid, with the axes in view.
    if (pattern !== "axes") engine.setBackground(makeBackground("axes", paper));
    engine.revealPoint(0, 0);
    const v = engine.getViewBounds();
    const x0 = Math.max(-1000, v.minX / AXIS_UNIT);
    const x1 = Math.min(1000, v.maxX / AXIS_UNIT);
    // Board y grows downwards; the plot's y grows upwards.
    const y0 = -v.maxY / AXIS_UNIT;
    const y1 = -v.minY / AXIS_UNIT;
    const lines = plotCurve(parsed.f, x0, x1, y0, y1, (x1 - x0) / 1500);
    if (!lines.length) return;
    // The label beside the end of the longest visible piece, nudged away from the curve.
    let tag: { text: string; x: number; y: number } | undefined;
    if (label) {
      const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
      const inView = [];
      for (let i = 0; i < longest.length; i += 2) {
        const x = longest[i]!;
        const y = longest[i + 1]!;
        if (x > v.minX && x < v.maxX - 160 && y > v.minY + 40 && y < v.maxY - 40) inView.push([x, y]);
      }
      // Where the curve last shows on screen (top or right edge): the label goes just to its right.
      const at = inView[inView.length - 1];
      if (at) tag = { text: pretty(formula), x: at[0]! + 14, y: at[1]! - 18 };
    }
    engine.addInkLines(lines, tag);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className="confirm plot-dialog"
      aria-labelledby="plot-title"
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
          plot();
        }}
      >
        <h2 id="plot-title">Plot a function</h2>
        <input
          ref={input}
          className="formula-input"
          aria-label="Formula"
          spellCheck={false}
          autoComplete="off"
          value={formula}
          onChange={(e) => setFormula(e.target.value)}
        />
        <div className="symbol-row" role="group" aria-label="Insert">
          {SYMBOLS.map((s) => (
            <button key={s.label} type="button" className="symbol-btn" onClick={() => insert(s.insert)}>
              {s.label}
            </button>
          ))}
        </div>
        <canvas ref={preview} className="plot-preview" aria-label="Preview" style={{ width: 360, height: 170 }} />
        <p className={"f" in parsed ? "dialog-help" : "field-error"} role={"f" in parsed ? undefined : "alert"}>
          {"f" in parsed ? "Use x as the variable, for example 2x + 1, x^3, sin(x) or 1/x." : parsed.error}
        </p>
        <div className="example-row" role="group" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => setFormula(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={label} onChange={(e) => setLabel(e.target.checked)} />
          Write the formula next to the curve
        </label>
        <div className="confirm-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!("f" in parsed)}>
            Plot
          </button>
        </div>
      </form>
    </dialog>
  );
}
