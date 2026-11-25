import type { BoardEngine } from "@novaloom/board-engine";
import { CopyPlus, Ellipsis, Group, RotateCcw, RotateCw, Trash2, Ungroup } from "lucide-react";
import { showObjectMenu } from "./BoardMenu";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useEngineState } from "../useEngine";
import { INK_COLORS } from "./colors";
import { Tip } from "./Tip";

const BAR_GAP = 12;
const BAR_HEIGHT = 40;
/** Room for the rotation handle above the selection. */
const ROTATE_HANDLE_SPACE = 34;

/** Floating actions for the current selection: recolour, rotate, duplicate, delete. */
export function SelectionBar({ engine }: { engine: BoardEngine }) {
  const { selection, tool } = useEngineState(engine);
  const ref = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);
  // The bar's own width, to keep it inside the board (it changes with the buttons shown).
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0;
    if (w && w !== barWidth) setBarWidth(w);
  });
  if (!selection || tool !== "select") return null;
  const { screen } = selection;
  const board = document.querySelector(".board");
  const boardW = board?.clientWidth ?? innerWidth;
  const boardH = board?.clientHeight ?? innerHeight;
  // Above the selection (clear of the rotation handle); below it when there is no room;
  // always inside the board, so it is never cut off by the window edge (small windows, high scaling).
  const topAbove = screen.minY - ROTATE_HANDLE_SPACE - BAR_GAP - BAR_HEIGHT;
  const top = topAbove > 8 ? topAbove : screen.maxY + BAR_GAP;
  const half = barWidth / 2;
  const centre = (screen.minX + screen.maxX) / 2;
  const style: CSSProperties = {
    left: barWidth ? Math.max(half + 8, Math.min(boardW - half - 8, centre)) : centre,
    top: Math.max(8, Math.min(boardH - BAR_HEIGHT - 8, top)),
  };
  const label = selection.count === 1 ? "1 object selected" : `${selection.count} objects selected`;
  return (
    <div ref={ref} className="panel selection-bar" style={style} role="toolbar" aria-label={label}>
      {selection.images < selection.count && (
        <>
          <div className="bar-swatches" role="radiogroup" aria-label="Colour">
            {INK_COLORS.map(({ color, name }) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={selection.color === color}
                aria-label={name}
                className="swatch small"
                style={{ "--swatch": color } as CSSProperties}
                onClick={() => engine.setSelectionColor(color)}
              >
                <Tip label={name} />
              </button>
            ))}
          </div>
          <span className="panel-sep" aria-hidden="true" />
        </>
      )}
      <button type="button" className="icon-btn" aria-label="Rotate left 90°" onClick={() => engine.rotateSelection(-90)}>
        <RotateCcw size={16} strokeWidth={1.7} />
        <Tip label="Rotate left 90°" keys="Shift+L" />
      </button>
      <AngleInput value={selection.angle} onCommit={(deg) => engine.setSelectionAngle(deg)} />
      <button type="button" className="icon-btn" aria-label="Rotate right 90°" onClick={() => engine.rotateSelection(90)}>
        <RotateCw size={16} strokeWidth={1.7} />
        <Tip label="Rotate right 90°" keys="Shift+R" />
      </button>
      <span className="panel-sep" aria-hidden="true" />
      <button type="button" className="icon-btn" aria-label="Duplicate" onClick={() => engine.duplicateSelection()}>
        <CopyPlus size={16} strokeWidth={1.7} />
        <Tip label="Duplicate" keys="Ctrl+D" />
      </button>
      {selection.units >= 2 && (
        <button type="button" className="icon-btn" aria-label="Group" onClick={() => engine.groupSelection()}>
          <Group size={16} strokeWidth={1.7} />
          <Tip label="Group" keys="Ctrl+G" />
        </button>
      )}
      {selection.grouped && selection.units < 2 && (
        <button type="button" className="icon-btn" aria-label="Ungroup" onClick={() => engine.ungroupSelection()}>
          <Ungroup size={16} strokeWidth={1.7} />
          <Tip label="Ungroup" keys="Ctrl+Shift+G" />
        </button>
      )}
      <button type="button" className="icon-btn danger" aria-label="Delete" onClick={() => engine.deleteSelection()}>
        <Trash2 size={16} strokeWidth={1.7} />
        <Tip label="Delete" keys="Del" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          showObjectMenu(r.left, r.bottom + 4);
        }}
      >
        <Ellipsis size={16} strokeWidth={1.7} />
        <Tip label="Align, lock, more" />
      </button>
    </div>
  );
}

/** Exact rotation in degrees; Enter or leaving the field applies it, Escape restores it. */
function AngleInput({ value, onCommit }: { value: number; onCommit: (deg: number) => void }) {
  const shown = formatAngle(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const n = Number(draft.replace(",", ".").replace("°", "").trim());
    if (Number.isFinite(n) && formatAngle(n) !== shown) onCommit(n);
    else setDraft(shown);
  };
  return (
    <label className="angle-field">
      <span className="visually-hidden">Rotation in degrees</span>
      <input
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(shown);
            e.currentTarget.blur();
          }
        }}
      />
      <span aria-hidden="true">°</span>
      <Tip label="Rotation (degrees)" />
    </label>
  );
}

function formatAngle(deg: number): string {
  const r = Math.round(deg * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}
