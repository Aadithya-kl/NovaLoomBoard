import { inkColor, isDarkBackground, type BoardEngine, type EngineState, type InkTool, type LineDash, type ShapeKind, type Tool } from "@novaloom/board-engine";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Highlighter,
  Italic,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Pencil,
  Redo2,
  Slash,
  Square,
  Triangle,
  Type,
  Undo2,
  type LucideIcon,
  Lasso,
  Minus,
  Plus,
  SquareDashedMousePointer,
  PencilRuler,
  Ruler,
  Spotlight,
  Blinds,
  Shapes,
  Presentation,
  Star,
  Hexagon,
  MessageSquare,
  Check,
  X,
  Timer as TimerIcon,
  ChartSpline,
  Sigma,
} from "lucide-react";
import { stepTextSize } from "@novaloom/board-engine";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { addCustomColor, colorTone, useCustomColors } from "../customColors";
import { openDialog } from "../dialogs";
import { presenter, usePresenter } from "../presenter";
import { timer, useTimerOpen } from "./Timer";
import { useEngineState } from "../useEngine";
import { HIGHLIGHT_COLORS, INK_COLORS } from "./colors";
import { Tip } from "./Tip";

const SHAPES: { id: ShapeKind; label: string; icon: LucideIcon }[] = [
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "triangle", label: "Triangle", icon: Triangle },
  { id: "diamond", label: "Diamond", icon: Diamond },
  { id: "star", label: "Star", icon: Star },
  { id: "hexagon", label: "Hexagon", icon: Hexagon },
  { id: "bubble", label: "Speech bubble", icon: MessageSquare },
  { id: "check", label: "Check mark", icon: Check },
  { id: "xmark", label: "Cross", icon: X },
  { id: "line", label: "Line", icon: Slash },
  { id: "arrow", label: "Arrow", icon: MoveUpRight },
];

const DASHES: { id: LineDash | undefined; label: string }[] = [
  { id: undefined, label: "Solid line" },
  { id: "dashed", label: "Dashed line" },
  { id: "dotted", label: "Dotted line" },
];

/** A short line drawn solid, dashed or dotted. */
function DashIcon({ dash }: { dash: LineDash | undefined }) {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M3 9h12"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeDasharray={dash === "dashed" ? "3.5 3" : dash === "dotted" ? "0.1 3.6" : undefined}
      />
    </svg>
  );
}

/** One button that steps through solid, dashed and dotted lines. */
function DashButton({ value, onPick }: { value: LineDash | undefined; onPick: (d: LineDash | undefined) => void }) {
  const i = DASHES.findIndex((d) => d.id === value);
  const next = DASHES[(i + 1) % DASHES.length]!;
  return (
    <button type="button" className="size-btn" aria-label={`Line style: ${DASHES[i]!.label.toLowerCase()}`} onClick={() => onPick(next.id)}>
      <DashIcon dash={value} />
      <Tip label={`${DASHES[i]!.label}: click for ${next.label.toLowerCase()}`} side="right" />
    </button>
  );
}
const shapeIcon = (k: ShapeKind) => SHAPES.find((s) => s.id === k)!.icon;

type IconType = ComponentType<{ size?: number; strokeWidth?: number }>;

/** A laser pointer: a pen-like body with a glowing tip. */
function LaserIcon({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20l9-9" />
      <path d="M3 18.5l2.5 2.5" />
      <circle cx="16" cy="8" r="2.2" fill="currentColor" stroke="none" />
      <path d="M16 2.5v1.6M21.5 8h-1.6M19.9 4.1l-1.1 1.1M19.9 11.9l-1.1-1.1M12.1 4.1l1.1 1.1" />
    </svg>
  );
}

/** A protractor: a half circle with degree marks. */
function ProtractorIcon({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17h18a9 9 0 0 0-18 0z" />
      <path d="M12 17l4.5-6.5M12 8v1.8M6.5 10.3l1.2 1.2M17.5 10.3l-1.2 1.2" />
    </svg>
  );
}

const INK_TOOLS: { id: InkTool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "pen", label: "Pen", key: "P", icon: PenLine },
  { id: "pencil", label: "Pencil", key: "N", icon: Pencil },
  { id: "highlighter", label: "Highlighter", key: "H", icon: Highlighter },
];
const inkInfo = (t: InkTool) => INK_TOOLS.find((i) => i.id === t)!;

/** The dock: one button for the three ink tools (the last one used), then the others. */
const TOOLS: { id: Tool | "ink"; label: string; key: string; icon: (s: EngineState) => IconType }[] = [
  { id: "select", label: "Select", key: "V", icon: () => MousePointer2 },
  { id: "ink", label: "Pen", key: "P", icon: () => PenLine },
  { id: "shape", label: "Shapes", key: "S", icon: (s) => shapeIcon(s.shapeKind) },
  { id: "text", label: "Text", key: "T", icon: () => Type },
  { id: "eraser", label: "Eraser", key: "E", icon: () => Eraser },
  { id: "laser", label: "Laser pointer", key: "K", icon: () => LaserIcon },
  { id: "pan", label: "Move board (or hold Space)", key: "G", icon: () => Hand },
];

const INK_SIZES: Record<InkTool, { size: number; name: string }[]> = {
  pen: [
    { size: 2, name: "Fine" },
    { size: 4, name: "Medium" },
    { size: 7, name: "Bold" },
    { size: 12, name: "Extra bold" },
  ],
  pencil: [
    { size: 1.5, name: "Fine" },
    { size: 3, name: "Medium" },
    { size: 5, name: "Bold" },
    { size: 8, name: "Extra bold" },
  ],
  highlighter: [
    { size: 12, name: "Narrow" },
    { size: 20, name: "Medium" },
    { size: 32, name: "Wide" },
  ],
};
const SHAPE_SIZES = [
  { size: 2, name: "Thin" },
  { size: 3, name: "Medium" },
  { size: 5, name: "Bold" },
  { size: 8, name: "Extra bold" },
];
const TEXT_SIZES = [
  { size: 18, name: "Small", label: "S" },
  { size: 28, name: "Medium", label: "M" },
  { size: 40, name: "Large", label: "L" },
  { size: 64, name: "Extra large", label: "XL" },
];

const isInk = (t: Tool): t is InkTool => t === "pen" || t === "pencil" || t === "highlighter";

/**
 * Small windows and high display scaling: a settings panel taller than the
 * space beside the dock switches to a compact two-column layout (same
 * controls), and back when there is room again.
 */
function useCompactPanel(): void {
  useLayoutEffect(() => {
    const fit = () => {
      const panel = document.querySelector<HTMLElement>(".dock-area .props");
      const workspace = document.querySelector<HTMLElement>(".workspace");
      if (!panel || !workspace) return;
      const available = workspace.clientHeight - 24;
      if (!panel.classList.contains("compact")) {
        if (panel.offsetHeight > available) {
          panel.dataset.natural = String(panel.offsetHeight);
          panel.classList.add("compact");
        }
      } else if (Number(panel.dataset.natural) <= available) panel.classList.remove("compact");
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });
}

export function Toolbar({ engine }: { engine: BoardEngine }) {
  const state = useEngineState(engine);
  const { tool, selection } = state;
  const [boardTools, setBoardTools] = useState(false);
  // The ink button picks up where you left off: pen, pencil or highlighter.
  const [lastInk, setLastInk] = useState<InkTool>("pen");
  useEffect(() => {
    if (isInk(tool)) setLastInk(tool);
  }, [tool]);
  useCompactPanel();

  // Which settings panel to show next to the dock.
  let panel: ReactNode = null;
  if (boardTools) panel = <BoardToolsPanel engine={engine} state={state} />;
  else if (isInk(tool)) panel = <InkPanel engine={engine} state={state} tool={tool} />;
  else if (tool === "shape") panel = <ShapePanel engine={engine} state={state} kinds />;
  else if (tool === "text") panel = <TextPanel engine={engine} state={state} />;
  else if (tool === "eraser") panel = <EraserPanel engine={engine} state={state} />;
  else if (tool === "select" && selection) {
    if (selection.texts === selection.count) panel = <TextPanel engine={engine} state={state} />;
    else if (selection.shapes === selection.count) panel = <ShapePanel engine={engine} state={state} kinds={false} />;
  } else if (tool === "select") panel = <SelectPanel engine={engine} state={state} />;

  return (
    <div className="dock-area">
      <nav className="panel dock" aria-label="Tools">
        {TOOLS.map((t) => {
          const ink = t.id === "ink" ? inkInfo(lastInk) : null;
          const id: Tool = ink ? ink.id : (t.id as Tool);
          const Icon = ink ? ink.icon : t.icon(state);
          const label = ink ? ink.label : t.label;
          const key = ink ? ink.key : t.key;
          const pressed = ink ? isInk(tool) : tool === id;
          return (
            <button
              key={t.id}
              type="button"
              className="tool-btn"
              aria-pressed={pressed}
              aria-label={ink ? `${label} (pen, pencil or highlighter)` : label}
              aria-keyshortcuts={key}
              onClick={() => {
                setBoardTools(false);
                engine.setTool(id);
              }}
            >
              <Icon size={19} strokeWidth={1.7} />
              {ink && <InkDot color={shown(state, state.styles[ink.id].color, ink.id === "highlighter")} />}
              {id === "shape" && <InkDot color={shown(state, state.shapeStyle.color)} />}
              {id === "text" && <InkDot color={shown(state, state.textStyle.color)} />}
              <Tip label={ink ? "Pen, pencil, highlighter" : label} keys={ink ? "P · N · H" : key} side="right" />
            </button>
          );
        })}
        <button
          type="button"
          className="tool-btn"
          aria-label="Board tools"
          aria-expanded={boardTools}
          aria-pressed={state.ruler || state.protractor ? true : undefined}
          onClick={() => setBoardTools((v) => !v)}
        >
          <PencilRuler size={19} strokeWidth={1.7} />
          <Tip label="Ruler, protractor, spotlight, screen shade" side="right" />
        </button>
        <div className="dock-sep" role="separator" />
        <button
          type="button"
          className="tool-btn"
          aria-label="Undo"
          aria-keyshortcuts="Control+Z"
          disabled={!state.canUndo}
          onClick={() => engine.undo()}
        >
          <Undo2 size={19} strokeWidth={1.7} />
          <Tip label="Undo" keys="Ctrl+Z" side="right" />
        </button>
        <button
          type="button"
          className="tool-btn"
          aria-label="Redo"
          aria-keyshortcuts="Control+Shift+Z"
          disabled={!state.canRedo}
          onClick={() => engine.redo()}
        >
          <Redo2 size={19} strokeWidth={1.7} />
          <Tip label="Redo" keys="Ctrl+Shift+Z" side="right" />
        </button>
      </nav>
      {panel}
    </div>
  );
}


/** The colour ink is drawn in on the current board (dark boards lighten dark colours). */
function shown(state: EngineState, color: string, highlighter = false): string {
  return highlighter ? color : inkColor(color, isDarkBackground(state.background));
}

/** Drawing aids and presentation overlays, each switched on or off. */
function BoardToolsPanel({ engine, state }: PanelProps) {
  const p = usePresenter();
  const timerOpen = useTimerOpen();
  const items: { label: string; tip: string; keys?: string; icon: IconType; on: boolean; toggle: () => void }[] = [
    { label: "Ruler", tip: "Draw straight lines along its edges", keys: "R", icon: Ruler, on: state.ruler, toggle: () => engine.toggleGuide("ruler") },
    { label: "Protractor", tip: "Measure angles and draw arcs", icon: ProtractorIcon, on: state.protractor, toggle: () => engine.toggleGuide("protractor") },
    { label: "Spotlight", tip: "Show only the part of the board around the pointer", icon: Spotlight, on: p.spotlight, toggle: () => presenter.toggleSpotlight() },
    { label: "Screen shade", tip: "Cover the board and uncover it bit by bit", icon: Blinds, on: p.shade, toggle: () => presenter.toggleShade() },
    { label: "Timer", tip: "A countdown or stopwatch over the board", icon: TimerIcon, on: timerOpen, toggle: () => timer.toggle() },
  ];
  return (
    <div className="panel props props-tools" aria-label="Board tools">
      <div className="tool-toggles" role="group" aria-label="Board tools">
        {items.map(({ label, tip, keys, icon: Icon, on, toggle }) => (
          <button key={label} type="button" role="switch" aria-checked={on} className="tool-toggle" onClick={toggle}>
            <Icon size={16} strokeWidth={1.7} />
            <span className="tool-toggle-label">{label}</span>
            <span className="switch" aria-hidden="true" />
            <Tip label={tip} keys={keys} side="right" />
          </button>
        ))}
      </div>
      <div className="tool-actions" role="group" aria-label="Insert">
        <button type="button" className="tool-toggle" onClick={() => openDialog({ kind: "plot" })}>
          <ChartSpline size={16} strokeWidth={1.7} />
          <span className="tool-toggle-label">Plot a function…</span>
          <Tip label="Draw y = f(x) on the coordinate grid" side="right" />
        </button>
        <button type="button" className="tool-toggle" onClick={() => openDialog({ kind: "equation" })}>
          <Sigma size={16} strokeWidth={1.7} />
          <span className="tool-toggle-label">Insert equation…</span>
          <Tip label="Fractions, roots, powers, symbols" side="right" />
        </button>
      </div>
      <button type="button" className="present-start" onClick={() => presenter.startPresenting()}>
        <Presentation size={16} strokeWidth={1.8} />
        Present
        <kbd>F5</kbd>
      </button>
    </div>
  );
}

function InkDot({ color }: { color: string }) {
  return <span className="ink-dot" aria-hidden="true" data-tone={colorTone(color)} style={{ "--ink": color } as CSSProperties} />;
}

interface PanelProps {
  engine: BoardEngine;
  state: EngineState;
}

function Swatches({
  colors,
  value,
  onPick,
  square,
  dark,
  custom = true,
}: {
  colors: { color: string; name: string }[];
  value: string | null;
  onPick: (c: string) => void;
  square?: boolean;
  /** On a dark board each colour shows as it is drawn there (black as white). */
  dark?: boolean;
  /** Offer the colour picker and recently picked colours. */
  custom?: boolean;
}) {
  const recent = useCustomColors();
  const picker = useRef<HTMLInputElement>(null);
  const known = new Set(colors.map((c) => c.color.toLowerCase()));
  const extra = custom ? recent.filter((c) => !known.has(c)) : [];
  // The current colour, when it is a custom one not in the recent list (picked elsewhere).
  if (custom && value && !known.has(value.toLowerCase()) && !extra.includes(value.toLowerCase())) extra.unshift(value.toLowerCase());
  const all = [...colors, ...extra.slice(0, 3).map((color) => ({ color, name: `Custom colour ${color.toUpperCase()}` }))];

  // Apply once the picker closes, not on every move (selected objects would get many undo steps).
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => {
      addCustomColor(el.value);
      onPick(el.value);
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [onPick]);

  return (
    <div className="swatches" role="radiogroup" aria-label="Colour">
      {all.map(({ color, name: base }) => {
        const name = dark && base === "Black" ? "White" : base;
        const shownColor = dark ? inkColor(color, true) : color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={value?.toLowerCase() === color.toLowerCase()}
            aria-label={name}
            className="swatch"
            data-highlighter={square || undefined}
            data-tone={colorTone(shownColor)}
            style={{ "--swatch": shownColor } as CSSProperties}
            onClick={() => onPick(color)}
          >
            <Tip label={name} side="right" />
          </button>
        );
      })}
      {custom && (
        <button type="button" className="swatch swatch-custom" aria-label="Pick another colour" onClick={() => picker.current?.click()}>
          <Plus size={14} strokeWidth={2.2} />
          <input ref={picker} type="color" tabIndex={-1} aria-hidden="true" className="visually-hidden" defaultValue={value ?? "#000000"} />
          <Tip label="Pick another colour" side="right" />
        </button>
      )}
    </div>
  );
}

function SizeDots({
  sizes,
  value,
  color,
  scale,
  square,
  onPick,
}: {
  sizes: { size: number; name: string }[];
  value: number;
  color: string;
  scale: number;
  square?: boolean;
  onPick: (s: number) => void;
}) {
  return (
    <div className="sizes" role="radiogroup" aria-label="Thickness">
      {sizes.map(({ size, name }) => {
        const d = Math.min(20, Math.max(3, size * scale));
        return (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={value === size}
            aria-label={name}
            className="size-btn"
            onClick={() => onPick(size)}
          >
            <span
              className="size-dot"
              data-highlighter={square || undefined}
              data-tone={colorTone(color)}
              style={{ width: d, height: d, "--ink": color } as CSSProperties}
            />
            <Tip label={name} side="right" />
          </button>
        );
      })}
    </div>
  );
}

function InkPanel({ engine, state, tool }: PanelProps & { tool: InkTool }) {
  const style = state.styles[tool];
  const hl = tool === "highlighter";
  const dark = isDarkBackground(state.background);
  return (
    <div className="panel props" aria-label={`${tool} settings`}>
      <div className="sizes" role="radiogroup" aria-label="Ink tool">
        {INK_TOOLS.map(({ id, label, key, icon: Icon }) => (
          <button key={id} type="button" role="radio" className="size-btn ink-kind" aria-checked={tool === id} aria-label={label} onClick={() => engine.setTool(id)}>
            <Icon size={17} strokeWidth={1.8} />
            <Tip label={label} keys={key} side="right" />
          </button>
        ))}
      </div>
      <div className="props-sep" />
      <Swatches
        colors={hl ? HIGHLIGHT_COLORS : INK_COLORS}
        value={style.color}
        square={hl}
        dark={dark && !hl}
        onPick={(color) => engine.setStyle(tool, { color })}
      />
      <div className="props-sep" />
      <SizeDots
        sizes={INK_SIZES[tool]}
        value={style.size}
        color={style.color}
        scale={hl ? 0.62 : 1.35}
        square={hl}
        onPick={(size) => engine.setStyle(tool, { size })}
      />
      <div className="props-sep" />
      {!hl && <DashButton value={style.dash} onPick={(dash) => engine.setStyle(tool, { dash })} />}
      <button
        type="button"
        className="size-btn"
        aria-pressed={state.shapeSnap}
        aria-label="Clean shapes"
        onClick={() => engine.setShapeSnap(!state.shapeSnap)}
      >
        <Shapes size={16} strokeWidth={1.8} />
        <Tip label={state.shapeSnap ? "Clean shapes: on. Hold still at the end of a stroke to straighten it" : "Clean shapes: off"} side="right" />
      </button>
    </div>
  );
}

function ShapePanel({ engine, state, kinds }: PanelProps & { kinds: boolean }) {
  const style = state.shapeStyle;
  return (
    <div className="panel props" aria-label="Shape settings">
      {kinds && (
        <>
          <div className="shape-kinds" role="radiogroup" aria-label="Shape">
            {SHAPES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                className="size-btn"
                aria-checked={state.shapeKind === id}
                aria-label={label}
                onClick={() => engine.setShapeKind(id)}
              >
                <Icon size={17} strokeWidth={1.8} />
                <Tip label={label} side="right" />
              </button>
            ))}
          </div>
          <div className="props-sep" />
        </>
      )}
      <Swatches colors={INK_COLORS} value={style.color} dark={isDarkBackground(state.background)} onPick={(color) => engine.setShapeStyle({ color })} />
      <div className="props-sep" />
      <SizeDots sizes={SHAPE_SIZES} value={style.size} color={style.color} scale={2} onPick={(size) => engine.setShapeStyle({ size })} />
      <DashButton value={style.dash} onPick={(dash) => engine.setShapeStyle({ dash })} />
      <div className="props-sep" />
      <div className="sizes" role="radiogroup" aria-label="Fill">
        {(
          [
            ["none", "No fill"],
            ["tint", "Light fill"],
            ["solid", "Solid fill"],
          ] as const
        ).map(([fill, name]) => (
          <button
            key={fill}
            type="button"
            role="radio"
            className="size-btn"
            aria-checked={style.fill === fill}
            aria-label={name}
            onClick={() => engine.setShapeStyle({ fill })}
          >
            <span className="fill-chip" data-fill={fill} data-tone={colorTone(style.color)} style={{ "--ink": style.color } as CSSProperties} />
            <Tip label={name} side="right" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** How dragging on empty board selects: a rectangle, or a freehand loop. */
function SelectPanel({ engine, state }: PanelProps) {
  return (
    <div className="panel props props-eraser" aria-label="Selection">
      <div className="segmented vertical" role="radiogroup" aria-label="Select by">
        <button type="button" role="radio" aria-checked={state.selectMode === "box"} onClick={() => engine.setSelectMode("box")}>
          <span className="seg-row">
            <SquareDashedMousePointer size={15} strokeWidth={1.7} /> Box
          </span>
          <Tip label="Drag a box around objects" keys="V" side="right" />
        </button>
        <button type="button" role="radio" aria-checked={state.selectMode === "lasso"} onClick={() => engine.setSelectMode("lasso")}>
          <span className="seg-row">
            <Lasso size={15} strokeWidth={1.7} /> Lasso
          </span>
          <Tip label="Draw a loop around objects (Alt switches)" keys="L" side="right" />
        </button>
      </div>
    </div>
  );
}

/** Exact text size: type a number or step through common sizes. */
function SizeField({ engine, size }: { engine: BoardEngine; size: number }) {
  const shown = String(Math.round(size));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= 4 && n <= 2000 && n !== Math.round(size)) engine.setTextStyle({ fontSize: n });
    else setDraft(shown);
  };
  return (
    <div className="size-field" role="group" aria-label="Text size">
      <button type="button" className="size-btn" aria-label="Smaller text" onClick={() => engine.setTextStyle({ fontSize: stepTextSize(size, -1) })}>
        <Minus size={14} strokeWidth={2} />
        <Tip label="Smaller" keys="Ctrl+Shift+<" side="right" />
      </button>
      <input
        aria-label="Text size in points"
        inputMode="numeric"
        value={draft}
        // The text being edited keeps its caret only when typing here is a deliberate choice.
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(shown);
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            engine.setTextStyle({ fontSize: stepTextSize(size, e.key === "ArrowUp" ? 1 : -1) });
          }
        }}
      />
      <button type="button" className="size-btn" aria-label="Larger text" onClick={() => engine.setTextStyle({ fontSize: stepTextSize(size, 1) })}>
        <Plus size={14} strokeWidth={2} />
        <Tip label="Larger" keys="Ctrl+Shift+>" side="right" />
      </button>
    </div>
  );
}

function TextPanel({ engine, state }: PanelProps) {
  const style = state.textStyle;
  return (
    // Keep focus in the text being edited while formatting it.
    <div className="panel props" aria-label="Text settings" onMouseDown={(e) => e.preventDefault()}>
      <Swatches colors={INK_COLORS} value={style.color} dark={isDarkBackground(state.background)} onPick={(color) => engine.setTextStyle({ color })} />
      <div className="props-sep" />
      <div className="sizes" role="radiogroup" aria-label="Text size">
        {TEXT_SIZES.map(({ size, name, label }) => (
          <button
            key={size}
            type="button"
            role="radio"
            className="size-btn text-size"
            aria-checked={style.fontSize === size}
            aria-label={name}
            onClick={() => engine.setTextStyle({ fontSize: size })}
          >
            {label}
            <Tip label={name} side="right" />
          </button>
        ))}
      </div>
      <SizeField engine={engine} size={style.fontSize} />
      <div className="props-sep" />
      <div className="sizes">
        <button
          type="button"
          className="size-btn"
          aria-pressed={style.bold}
          aria-label="Bold"
          onClick={() => engine.setTextStyle({ bold: !style.bold })}
        >
          <Bold size={16} strokeWidth={2.2} />
          <Tip label="Bold" side="right" />
        </button>
        <button
          type="button"
          className="size-btn"
          aria-pressed={style.italic}
          aria-label="Italic"
          onClick={() => engine.setTextStyle({ italic: !style.italic })}
        >
          <Italic size={16} strokeWidth={2} />
          <Tip label="Italic" side="right" />
        </button>
      </div>
      <div className="props-sep" />
      <div className="sizes" role="radiogroup" aria-label="Alignment">
        {(
          [
            ["left", "Align left", AlignLeft],
            ["center", "Centre", AlignCenter],
            ["right", "Align right", AlignRight],
          ] as const
        ).map(([align, name, Icon]) => (
          <button
            key={align}
            type="button"
            role="radio"
            className="size-btn"
            aria-checked={style.align === align}
            aria-label={name}
            onClick={() => engine.setTextStyle({ align })}
          >
            <Icon size={16} strokeWidth={1.9} />
            <Tip label={name} side="right" />
          </button>
        ))}
      </div>
      <div className="props-sep" />
      <button type="button" className="size-btn" aria-label="Insert equation" onClick={() => openDialog({ kind: "equation" })}>
        <Sigma size={16} strokeWidth={1.9} />
        <Tip label="Insert equation" side="right" />
      </button>
    </div>
  );
}

function EraserPanel({ engine, state }: PanelProps) {
  return (
    <div className="panel props props-eraser" aria-label="Eraser settings">
      <div className="segmented vertical" role="radiogroup" aria-label="Eraser mode">
        <button type="button" role="radio" aria-checked={state.eraserMode === "stroke"} onClick={() => engine.setEraserMode("stroke")}>
          Whole object
        </button>
        <button type="button" role="radio" aria-checked={state.eraserMode === "partial"} onClick={() => engine.setEraserMode("partial")}>
          Partial ink
        </button>
      </div>
    </div>
  );
}
