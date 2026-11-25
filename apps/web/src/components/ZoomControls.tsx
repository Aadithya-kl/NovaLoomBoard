import type { BoardEngine } from "@novaloom/board-engine";
import { Minus, Plus, Presentation, Scan } from "lucide-react";
import { presenter } from "../presenter";
import { useEngineState } from "../useEngine";
import { Tip } from "./Tip";

export function ZoomControls({ engine }: { engine: BoardEngine }) {
  const { zoom } = useEngineState(engine);
  return (
    <div className="panel zoom" aria-label="Zoom">
      <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => engine.zoomBy(0.8)}>
        <Minus size={16} strokeWidth={1.8} />
        <Tip label="Zoom out" keys="Ctrl+−" side="top" />
      </button>
      <button type="button" className="zoom-value" aria-label="Reset zoom to 100%" onClick={() => engine.resetView()}>
        {Math.round(zoom * 100)}%
        <Tip label="Reset to 100%" keys="Ctrl+0" side="top" />
      </button>
      <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => engine.zoomBy(1.25)}>
        <Plus size={16} strokeWidth={1.8} />
        <Tip label="Zoom in" keys="Ctrl+=" side="top" />
      </button>
      <span className="zoom-sep" aria-hidden="true" />
      <button type="button" className="icon-btn" aria-label="Fit to content" onClick={() => engine.fitContent()}>
        <Scan size={16} strokeWidth={1.8} />
        <Tip label="Fit to content" keys="Shift+1" side="top" />
      </button>
      <span className="zoom-sep" aria-hidden="true" />
      <button type="button" className="icon-btn" aria-label="Present" onClick={() => void presenter.startPresenting()}>
        <Presentation size={16} strokeWidth={1.8} />
        <Tip label="Present: board only, full screen" keys="F5" side="top" />
      </button>
    </div>
  );
}
