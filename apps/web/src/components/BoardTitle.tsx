import { useEffect, useRef, useState } from "react";
import type { Persistence } from "../persistence";
import { usePersistenceState } from "../usePersistence";
import { Tip } from "./Tip";

/** Board name; click (or F2 in the desktop app) to rename. */
export function BoardTitle({ persistence }: { persistence: Persistence }) {
  const { title, save } = usePersistenceState(persistence);
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;

  useEffect(
    () => persistence.onMenuCommand((c) => c === "rename" && setDraft(persistence.getState().title)),
    [persistence],
  );
  useEffect(() => {
    document.title = `${title} — NovaLoomBoard`;
  }, [title]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = () => {
    if (draft !== null) persistence.setTitle(draft);
    setDraft(null);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="board-title"
        aria-label={`Board name: ${title}. Rename`}
        disabled={save === "loading" || save === "not-persistent"}
        onClick={() => setDraft(title)}
      >
        <span className="board-title-text">{title}</span>
        <Tip label="Rename board" keys="F2" />
      </button>
    );
  }
  return (
    <input
      ref={input}
      className="board-title-input"
      aria-label="Board name"
      value={draft}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
