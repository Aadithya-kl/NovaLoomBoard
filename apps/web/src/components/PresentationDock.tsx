import { inkColor, isDarkBackground, type BoardEngine, type Tool } from "@novaloom/board-engine";
import { Blinds, ChevronLeft, ChevronRight, Eraser, Highlighter, PenLine, Spotlight, Timer as TimerIcon, Undo2, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { colorTone } from "../customColors";
import type { Persistence } from "../persistence";
import { presenter, usePresenter } from "../presenter";
import { useEngineState } from "../useEngine";
import { usePersistenceState } from "../usePersistence";
import { INK_COLORS } from "./colors";
import { timer, useTimerOpen } from "./Timer";
import { Tip } from "./Tip";

/** Hidden after this long without the mouse moving, so nothing distracts from the board. */
const IDLE_MS = 2600;
/** The pen colours offered while presenting: the four most used. */
const QUICK = INK_COLORS.slice(0, 4);

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

const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon | typeof LaserIcon }[] = [
  { id: "pen", label: "Pen", key: "P", icon: PenLine },
  { id: "highlighter", label: "Highlighter", key: "H", icon: Highlighter },
  { id: "laser", label: "Laser pointer", key: "K", icon: LaserIcon },
  { id: "eraser", label: "Eraser", key: "E", icon: Eraser },
];

/**
 * Presentation mode: F5 (or Present) shows only the board, full screen, with this small bar
 * for what a presenter needs. Esc or the × button returns to the full interface.
 */
export function PresentationDock({ engine, persistence }: { engine: BoardEngine; persistence: Persistence }) {
  const p = usePresenter();

  // F5 starts presenting, Esc stops (after closing a spotlight or shade first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "F5" && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (presenter.get().presenting) void presenter.stopPresenting();
        else void presenter.startPresenting();
      } else if (e.key === "Escape" && presenter.get().presenting && !e.defaultPrevented) {
        void presenter.stopPresenting();
      }
    };
    window.addEventListener("keydown", onKey);
    const off = persistence.onMenuCommand((c) => {
      if (c === "present") void presenter.startPresenting();
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, [persistence]);

  // The interface around the board is hidden while presenting.
  useEffect(() => {
    document.querySelector(".app")?.toggleAttribute("data-presenting", p.presenting);
  }, [p.presenting]);

  if (!p.presenting) return null;
  return <Bar engine={engine} persistence={persistence} />;
}

function Bar({ engine, persistence }: { engine: BoardEngine; persistence: Persistence }) {
  const state = useEngineState(engine);
  const pages = usePersistenceState(persistence);
  const p = usePresenter();
  const timerOpen = useTimerOpen();
  const [idle, setIdle] = useState(false);
  const hovering = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = (e?: PointerEvent) => {
      // Ink and laser strokes do not bring the bar back: only moving the mouse without drawing.
      if (e && e.buttons !== 0) return;
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => !hovering.current && setIdle(true), IDLE_MS);
    };
    wake();
    window.addEventListener("pointermove", wake, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
    };
  }, []);

  const dark = isDarkBackground(state.background);
  const index = pages.pages.findIndex((x) => x.id === pages.activePage);
  const ink = state.tool === "pen" || state.tool === "pencil" ? state.tool : "pen";

  return (
    <div
      className="panel present-dock"
      role="toolbar"
      aria-label="Presentation"
      data-idle={idle || undefined}
      onPointerEnter={() => {
        hovering.current = true;
        setIdle(false);
      }}
      onPointerLeave={() => (hovering.current = false)}
    >
      {TOOLS.map(({ id, label, key, icon: Icon }) => (
        <button key={id} type="button" className="tool-btn" aria-pressed={state.tool === id} aria-label={label} onClick={() => engine.setTool(id)}>
          <Icon size={19} strokeWidth={1.7} />
          <Tip label={label} keys={key} side="top" />
        </button>
      ))}
      <span className="panel-sep" aria-hidden="true" />
      <div className="present-colors" role="radiogroup" aria-label="Pen colour">
        {QUICK.map(({ color, name }) => {
          const shown = inkColor(color, dark);
          return (
            <button
              key={color}
              type="button"
              role="radio"
              className="swatch small"
              aria-checked={state.tool === ink && state.styles[ink].color === color}
              aria-label={dark && name === "Black" ? "White" : name}
              data-tone={colorTone(shown)}
              style={{ "--swatch": shown } as CSSProperties}
              onClick={() => {
                engine.setStyle(ink, { color });
                engine.setTool(ink);
              }}
            >
              <Tip label={dark && name === "Black" ? "White" : name} side="top" />
            </button>
          );
        })}
      </div>
      <span className="panel-sep" aria-hidden="true" />
      <button type="button" className="tool-btn" aria-label="Undo" disabled={!state.canUndo} onClick={() => engine.undo()}>
        <Undo2 size={19} strokeWidth={1.7} />
        <Tip label="Undo" keys="Ctrl+Z" side="top" />
      </button>
      <span className="panel-sep" aria-hidden="true" />
      <button type="button" className="tool-btn" aria-label="Previous page" disabled={index <= 0} onClick={() => persistence.stepPage(-1)}>
        <ChevronLeft size={19} strokeWidth={1.8} />
        <Tip label="Previous page" keys="Page Up" side="top" />
      </button>
      <span className="present-page" aria-live="polite">
        {index + 1} <span>/ {pages.pages.length}</span>
      </span>
      <button type="button" className="tool-btn" aria-label="Next page" disabled={index >= pages.pages.length - 1} onClick={() => persistence.stepPage(1)}>
        <ChevronRight size={19} strokeWidth={1.8} />
        <Tip label="Next page" keys="Page Down" side="top" />
      </button>
      <span className="panel-sep" aria-hidden="true" />
      <button type="button" className="tool-btn" aria-pressed={p.spotlight} aria-label="Spotlight" onClick={() => presenter.toggleSpotlight()}>
        <Spotlight size={19} strokeWidth={1.7} />
        <Tip label="Spotlight" side="top" />
      </button>
      <button type="button" className="tool-btn" aria-pressed={p.shade} aria-label="Screen shade" onClick={() => presenter.toggleShade()}>
        <Blinds size={19} strokeWidth={1.7} />
        <Tip label="Screen shade" side="top" />
      </button>
      <button type="button" className="tool-btn" aria-pressed={timerOpen} aria-label="Timer" onClick={() => timer.toggle()}>
        <TimerIcon size={19} strokeWidth={1.7} />
        <Tip label="Timer" side="top" />
      </button>
      <span className="panel-sep" aria-hidden="true" />
      <button type="button" className="tool-btn present-exit" aria-label="Stop presenting" onClick={() => void presenter.stopPresenting()}>
        <X size={19} strokeWidth={1.8} />
        <Tip label="Stop presenting" keys="Esc" side="top" />
      </button>
    </div>
  );
}
