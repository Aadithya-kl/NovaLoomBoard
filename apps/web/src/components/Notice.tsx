import type { RecoveryNotice } from "@novaloom/board-engine/persist";
import { AlertTriangle, CheckCircle2, Info, LoaderCircle, X } from "lucide-react";
import type { Persistence } from "../persistence";
import { usePersistenceState } from "../usePersistence";

const time = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function message(n: RecoveryNotice): { text: string; tone: "info" | "warn" } {
  switch (n.kind) {
    case "unclean-exit":
      return {
        tone: "info",
        text: `NovaLoomBoard did not close properly last time. Your board was restored as last saved (${time(n.lastSavedAt)}).`,
      };
    case "renderer-reloaded":
      return { tone: "info", text: "The board stopped unexpectedly and was reloaded. Your saved work is intact." };
    case "restored-snapshot":
      return {
        tone: "warn",
        text: `This board's file was damaged, so it was restored from the backup made ${time(n.snapshotAt)}. The damaged file was kept at ${n.damagedPath}.`,
      };
    case "damaged-no-backup":
      return {
        tone: "warn",
        text: `This board's file was damaged and no backup was available, so an empty board was started. The damaged file was kept at ${n.damagedPath}.`,
      };
    case "open-failed":
      return { tone: "warn", text: `The board could not be opened: ${n.message}` };
  }
}

/** Recovery messages and the persistent "cannot save" banner. */
export function Notices({ persistence }: { persistence: Persistence }) {
  const { notice, save, error, status } = usePersistenceState(persistence);
  const m = notice ? message(notice) : null;
  return (
    <div className="notices">
      {save === "error" && (
        <div className="notice" data-tone="error" role="alert">
          <AlertTriangle size={16} />
          <p>
            Changes can't be saved right now{error ? ` (${error})` : ""}. They are kept, and saving is retried every 10
            seconds. To keep them safe, use File &gt; Save a copy as.
          </p>
        </div>
      )}
      {status && (
        <div className="notice" data-tone={status.tone === "error" ? "error" : "info"} role={status.tone === "error" ? "alert" : "status"}>
          {status.tone === "progress" ? (
            <LoaderCircle size={16} className="spin" />
          ) : status.tone === "success" ? (
            <CheckCircle2 size={16} />
          ) : (
            <AlertTriangle size={16} />
          )}
          <p>{status.text}</p>
          {status.action && (
            <button type="button" className="btn small" onClick={status.action.run}>
              {status.action.label}
            </button>
          )}
          {status.tone !== "progress" && (
            <button type="button" className="icon-btn" title="Dismiss" onClick={() => persistence.showStatus(null)}>
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {m && (
        <div className="notice" data-tone={m.tone} role="status">
          {m.tone === "warn" ? <AlertTriangle size={16} /> : <Info size={16} />}
          <p>{m.text}</p>
          <button type="button" className="icon-btn" title="Dismiss" onClick={() => persistence.dismissNotice()}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
