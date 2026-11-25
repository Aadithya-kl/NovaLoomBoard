import { renderThumbnail, type BoardObject } from "@novaloom/board-engine";
import { decodeObject, type VersionInfo, type VersionPreview } from "@novaloom/board-engine/persist";
import { History } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Persistence } from "../persistence";

const REASONS: Record<VersionInfo["reason"], string> = {
  auto: "Saved automatically",
  close: "When the board was closed",
  "before-clear": "Before a page was cleared",
  "before-delete-page": "Before a page was deleted",
  manual: "Saved by you",
};

function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}
const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * Version history: the board's automatic snapshots (every 10 minutes of work, on closing,
 * and before clearing or deleting a page), newest first. Opening one makes a separate copy,
 * so the current board is never overwritten.
 */
export function VersionsDialog({ persistence, onClose }: { persistence: Persistence; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const thumb = useRef<HTMLCanvasElement>(null);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ at: number; data: VersionPreview | null; objects: BoardObject[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const bridge = window.novaLoom?.versions;

  const reload = () =>
    bridge?.list().then((list) => {
      setVersions(list);
      setSelected((s) => (s !== null && list.some((v) => v.at === s) ? s : (list[0]?.at ?? null)));
    });

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    void reload();
    return () => d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected === null || !bridge) return;
    let live = true;
    void bridge.preview(selected).then((data) => {
      if (!live) return;
      const objects: BoardObject[] = [];
      for (const o of data?.page.objects ?? []) {
        try {
          objects.push(decodeObject(o));
        } catch {
          /* a damaged object is left out of the preview */
        }
      }
      setPreview({ at: selected, data, objects });
    });
    return () => {
      live = false;
    };
  }, [selected, bridge]);

  useLayoutEffect(() => {
    const c = thumb.current;
    if (!c || !preview?.data) return;
    renderThumbnail(c, preview.objects, preview.data.page.background, 320, 200, window.devicePixelRatio || 1);
  }, [preview]);

  const open = async () => {
    if (!bridge || selected === null) return;
    setBusy(true);
    try {
      await bridge.open(selected);
    } catch (err) {
      persistence.showStatus({ tone: "error", text: `That version could not be opened: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}` });
      setBusy(false);
    }
  };

  const saveNow = async () => {
    if (!bridge) return;
    setBusy(true);
    try {
      await bridge.saveNow();
      await reload();
    } catch (err) {
      persistence.showStatus({ tone: "error", text: `The version could not be saved: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}` });
    } finally {
      setBusy(false);
    }
  };

  // Grouped by day, newest first.
  const groups: { day: string; items: VersionInfo[] }[] = [];
  for (const v of versions ?? []) {
    const day = dayLabel(v.at);
    const g = groups[groups.length - 1];
    if (g && g.day === day) g.items.push(v);
    else groups.push({ day, items: [v] });
  }

  return (
    <dialog
      ref={ref}
      className="confirm versions-dialog"
      aria-labelledby="versions-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 id="versions-title">Version history</h2>
      <p>Earlier versions of this board, saved automatically as you work. Opening one makes a separate copy: this board stays as it is.</p>
      <div className="versions-body">
        <div className="versions-list" role="listbox" aria-label="Versions">
          {versions === null && <p className="dialog-help">Loading…</p>}
          {versions?.length === 0 && (
            <div className="versions-empty">
              <History size={20} strokeWidth={1.6} aria-hidden="true" />
              <p>No earlier versions yet. One is saved every 10 minutes of work and when the board is closed.</p>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.day} role="group" aria-label={g.day}>
              <h3 className="versions-day">{g.day}</h3>
              {g.items.map((v) => (
                <button
                  key={v.at}
                  type="button"
                  role="option"
                  aria-selected={selected === v.at}
                  className="version-item"
                  onClick={() => setSelected(v.at)}
                  onDoubleClick={() => void open()}
                >
                  <span className="version-time">{time(v.at)}</span>
                  <span className="version-reason">{REASONS[v.reason] ?? "Saved"}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="versions-preview">
          {preview?.data ? (
            <>
              <canvas ref={thumb} style={{ width: 320, height: 200 }} aria-label="Preview of the page that was open" />
              <p className="dialog-help">
                {preview.data.pageCount} page{preview.data.pageCount === 1 ? "" : "s"} · {preview.data.objectCount} item{preview.data.objectCount === 1 ? "" : "s"}
              </p>
            </>
          ) : (
            <div className="versions-placeholder" aria-hidden="true" />
          )}
        </div>
      </div>
      <div className="confirm-actions">
        <button type="button" className="btn versions-save" disabled={busy} onClick={() => void saveNow()}>
          Save a version now
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn primary" disabled={busy || selected === null} onClick={() => void open()}>
          Open as a copy
        </button>
      </div>
    </dialog>
  );
}
