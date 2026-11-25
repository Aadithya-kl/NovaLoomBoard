import type { BoardEngine, EngineState } from "@novaloom/board-engine";
import { Lightbulb } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePresenter, type PresenterState } from "../presenter";
import { useEngineState } from "../useEngine";

/**
 * One-time tips for what cannot be seen on screen: shown the first time a feature is used,
 * once per computer, then never again. They never block anything and close by themselves.
 */
const HINTS: { id: string; when: (s: EngineState, p: PresenterState) => boolean; text: string }[] = [
  {
    id: "clean-shapes",
    when: (s) => (s.tool === "pen" || s.tool === "pencil" || s.tool === "highlighter") && s.shapeSnap,
    text: "Hold still for a moment at the end of a stroke to turn it into a clean line, circle or shape.",
  },
  { id: "ruler", when: (s) => s.ruler, text: "Drag the ruler to move it and turn it with the round handle. Draw along an edge for a perfectly straight line." },
  { id: "protractor", when: (s) => s.protractor, text: "Draw along the curved edge to make an arc. The angle shows as you draw." },
  { id: "laser", when: (s) => s.tool === "laser", text: "The laser leaves no marks: its trail fades by itself." },
  { id: "present", when: (_s, p) => p.presenting, text: "Move the mouse to show the controls. Press Esc to stop presenting." },
];

const KEY = "novaloomboard.hintsSeen";
const SHOW_MS = 12_000;

function seen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function markSeen(id: string): void {
  const s = seen();
  s.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: the tip may show again next time, which is harmless */
  }
}

export function Hints({ engine }: { engine: BoardEngine }) {
  const state = useEngineState(engine);
  const p = usePresenter();
  const [hint, setHint] = useState<{ id: string; text: string } | null>(null);
  const shownThisSession = useRef(new Set<string>());

  useEffect(() => {
    if (hint) return;
    const done = seen();
    const next = HINTS.find((h) => !done.has(h.id) && !shownThisSession.current.has(h.id) && h.when(state, p));
    if (!next) return;
    shownThisSession.current.add(next.id);
    markSeen(next.id);
    setHint(next);
  }, [state, p, hint]);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [hint]);

  if (!hint) return null;
  return (
    <div className="hint" role="status">
      <Lightbulb size={16} strokeWidth={1.8} aria-hidden="true" />
      <p>{hint.text}</p>
      <button type="button" className="hint-close" onClick={() => setHint(null)}>
        Got it
      </button>
    </div>
  );
}
