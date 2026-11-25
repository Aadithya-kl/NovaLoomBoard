import { makeBackground, parseBackground, type BoardEngine, type Pattern } from "@novaloom/board-engine";
import { AlignJustify, ChevronDown, Grid3x3, Grip, Square, Trash2, type LucideIcon } from "lucide-react";
import { showBackgroundMenu } from "./BoardMenu";
import type { Persistence } from "../persistence";
import { useEngineState } from "../useEngine";
import { Tip } from "./Tip";

const BACKGROUNDS: { id: Pattern; label: string; icon: LucideIcon }[] = [
  { id: "blank", label: "Blank", icon: Square },
  { id: "grid", label: "Grid", icon: Grid3x3 },
  { id: "dots", label: "Dots", icon: Grip },
  { id: "ruled", label: "Lines", icon: AlignJustify },
];

/** Background choice and Clear page, floating at the top right of the board. */
export function PageActions({ engine, persistence }: { engine: BoardEngine; persistence: Persistence }) {
  const state = useEngineState(engine);
  const { pattern, paper } = parseBackground(state.background);
  return (
    <div className="panel page-actions" aria-label="Page">
      <div className="segmented" role="radiogroup" aria-label="Background">
        {BACKGROUNDS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={pattern === id}
            aria-label={`${label} background`}
            onClick={() => engine.setBackground(makeBackground(id, paper))}
          >
            <Icon size={16} strokeWidth={1.7} />
            <Tip label={`${label} background`} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="More backgrounds and board colours"
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // Below the button, right-aligned with it (the menu flips to stay in the window).
          showBackgroundMenu(r.right, r.bottom + 6);
        }}
      >
        <ChevronDown size={16} strokeWidth={1.7} />
        <Tip label="More backgrounds and board colours" />
      </button>
      <span className="panel-sep" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn danger"
        aria-label="Clear page"
        disabled={state.objectCount === 0}
        onClick={() => void persistence.clearPage()}
      >
        <Trash2 size={16} strokeWidth={1.7} />
        <Tip label="Clear page (Ctrl+Z brings it back)" />
      </button>
    </div>
  );
}
