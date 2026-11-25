import { AlertTriangle, Check, CloudOff, Loader2, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Persistence, SaveState } from "../persistence";
import { usePersistenceState } from "../usePersistence";

/** Saves take ~150 ms; only show "Saving…" if one takes longer, to avoid flicker on every stroke. */
const SHOW_SAVING_AFTER_MS = 400;

const VIEW: Record<SaveState, { label: string; icon: LucideIcon; tone: string; tip?: string }> = {
  loading: { label: "Opening…", icon: Loader2, tone: "muted" },
  saved: { label: "Saved", icon: Check, tone: "muted", tip: "All changes are saved automatically" },
  saving: { label: "Saving…", icon: Loader2, tone: "muted" },
  delayed: { label: "Saving is delayed", icon: AlertTriangle, tone: "warn", tip: "The disk is slow to respond. Your changes are kept." },
  error: { label: "Not saved", icon: AlertTriangle, tone: "error" },
  "not-persistent": { label: "Not saved (browser preview)", icon: CloudOff, tone: "warn", tip: "Run the desktop app to save boards" },
};

export function SaveStatus({ persistence }: { persistence: Persistence }) {
  const { save, error } = usePersistenceState(persistence);
  const shown = useDebouncedSaving(save);
  const v = VIEW[shown];
  const Icon = v.icon;
  return (
    <span className="save-status" data-tone={v.tone} title={shown === "error" ? error : v.tip} role="status" aria-live="polite">
      <Icon size={14} strokeWidth={2} className={shown === "saving" || shown === "loading" ? "spin" : undefined} />
      <span>{v.label}</span>
    </span>
  );
}

function useDebouncedSaving(save: SaveState): SaveState {
  const [shown, setShown] = useState(save);
  useEffect(() => {
    if (save !== "saving") {
      setShown(save);
      return;
    }
    const t = setTimeout(() => setShown("saving"), SHOW_SAVING_AFTER_MS);
    return () => clearTimeout(t);
  }, [save]);
  return shown;
}
