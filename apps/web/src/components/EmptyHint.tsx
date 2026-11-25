import type { BoardEngine } from "@novaloom/board-engine";
import type { Persistence } from "../persistence";
import { usePersistenceState } from "../usePersistence";
import { useEngineState } from "../useEngine";

/** Quiet guidance on an empty board; disappears with the first stroke. */
export function EmptyHint({ engine, persistence }: { engine: BoardEngine; persistence: Persistence }) {
  const { objectCount } = useEngineState(engine);
  const { save } = usePersistenceState(persistence);
  if (objectCount > 0 || save === "loading") return null;
  return (
    <div className="empty-hint" aria-hidden="true">
      <p className="empty-title">Draw anywhere to begin</p>
      <p className="empty-keys">
        <span>
          <kbd>P</kbd> pen
        </span>
        <span>
          <kbd>S</kbd> shapes
        </span>
        <span>
          <kbd>T</kbd> text
        </span>
        <span>
          <kbd>V</kbd> select
        </span>
        <span>
          <kbd>Space</kbd> hold to move
        </span>
        <span>
          <kbd>F1</kbd> all shortcuts
        </span>
      </p>
    </div>
  );
}
