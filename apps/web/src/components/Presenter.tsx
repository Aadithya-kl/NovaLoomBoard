import { Blinds, Minus, Plus, Spotlight as SpotlightIcon, X } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { presenter, usePresenter, SPOTLIGHT_RADII } from "../presenter";
import { Tip } from "./Tip";

/**
 * Presentation overlays above the board (under the tool panels):
 * - Spotlight: darkens the board except a circle that follows the pointer. Drawing and
 *   every tool keep working through it.
 * - Screen shade: covers the board; dragging it down uncovers the board from the top,
 *   one line at a time.
 * Neither is saved or exported. Esc closes them.
 */
export function Presenter() {
  const s = usePresenter();

  useEffect(() => {
    if (!s.spotlight && !s.shade) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      presenter.set({ spotlight: false, shade: false });
      // Handled: Esc does not also leave presentation mode.
      e.preventDefault();
    };
    // Capture: closes the overlays before anything else reacts to Esc.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [s.spotlight, s.shade]);

  if (!s.spotlight && !s.shade) return null;
  return (
    <>
      {s.shade && <Shade revealed={s.revealed} />}
      {s.spotlight && <SpotlightLayer radius={s.radius} />}
      <div className="panel present-bar" role="toolbar" aria-label="Presentation">
        {s.spotlight && (
          <div className="present-group" role="group" aria-label="Spotlight">
            <SpotlightIcon size={16} strokeWidth={1.7} aria-hidden="true" />
            <span className="present-label">Spotlight</span>
            <button type="button" className="size-btn" aria-label="Smaller spotlight" disabled={s.radius <= SPOTLIGHT_RADII[0]!} onClick={() => presenter.stepRadius(-1)}>
              <Minus size={14} strokeWidth={2} />
              <Tip label="Smaller" side="bottom" />
            </button>
            <button
              type="button"
              className="size-btn"
              aria-label="Larger spotlight"
              disabled={s.radius >= SPOTLIGHT_RADII[SPOTLIGHT_RADII.length - 1]!}
              onClick={() => presenter.stepRadius(1)}
            >
              <Plus size={14} strokeWidth={2} />
              <Tip label="Larger" side="bottom" />
            </button>
            <button type="button" className="size-btn" aria-label="Close spotlight" onClick={() => presenter.set({ spotlight: false })}>
              <X size={15} strokeWidth={1.9} />
              <Tip label="Close spotlight" keys="Esc" side="bottom" />
            </button>
          </div>
        )}
        {s.spotlight && s.shade && <span className="present-sep" role="separator" />}
        {s.shade && (
          <div className="present-group" role="group" aria-label="Screen shade">
            <Blinds size={16} strokeWidth={1.7} aria-hidden="true" />
            <span className="present-label">Screen shade</span>
            <button type="button" className="present-text-btn" onClick={() => presenter.set({ revealed: s.revealed > 0 ? 0 : Number.MAX_SAFE_INTEGER })}>
              {s.revealed > 0 ? "Cover all" : "Uncover all"}
            </button>
            <button type="button" className="size-btn" aria-label="Close screen shade" onClick={() => presenter.set({ shade: false })}>
              <X size={15} strokeWidth={1.9} />
              <Tip label="Close screen shade" keys="Esc" side="bottom" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** The dimmed board with a clear circle around the pointer (moved without re-rendering). */
function SpotlightLayer({ radius }: { radius: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const area = el.parentElement!;
    const r = area.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${r.width / 2}px`);
    el.style.setProperty("--spot-y", `${r.height / 2}px`);
    const onMove = (e: PointerEvent) => {
      const b = area.getBoundingClientRect();
      el.style.setProperty("--spot-x", `${e.clientX - b.left}px`);
      el.style.setProperty("--spot-y", `${e.clientY - b.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, []);
  return <div ref={ref} className="spotlight" aria-hidden="true" style={{ "--spot-r": `${radius}px` } as CSSProperties} />;
}

/** The shade: drag it (anywhere) down to uncover the board from the top, or back up. */
function Shade({ revealed }: { revealed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; from: number } | null>(null);
  const areaHeight = () => ref.current?.parentElement?.clientHeight ?? 0;
  const top = Math.min(revealed, areaHeight());

  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, y: e.clientY, from: top };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    presenter.set({ revealed: Math.max(0, Math.min(areaHeight(), d.from + e.clientY - d.y)) });
  };
  const onUp = (e: ReactPointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const onKey = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 120 : 32;
    if (e.key === "ArrowDown") presenter.set({ revealed: Math.min(areaHeight(), top + step) });
    else if (e.key === "ArrowUp") presenter.set({ revealed: Math.max(0, top - step) });
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      className="shade"
      style={{ top }}
      role="slider"
      tabIndex={0}
      aria-label="Screen shade: drag down to uncover the board"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((top / Math.max(1, areaHeight())) * 100)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="shade-grip" aria-hidden="true" />
      <span className="shade-hint">Drag down to uncover</span>
    </div>
  );
}
