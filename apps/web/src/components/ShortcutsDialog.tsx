import { useEffect, useRef, useState } from "react";
import type { Persistence } from "../persistence";

/** Every keyboard shortcut the app handles, grouped as in the menus. */
const GROUPS: { title: string; items: [keys: string, action: string][] }[] = [
  {
    title: "Tools",
    items: [
      ["V", "Select with a box"],
      ["L", "Select with a lasso"],
      ["Alt + drag", "Select with the other one (box or lasso)"],
      ["P", "Pen"],
      ["N", "Pencil"],
      ["H", "Highlighter"],
      ["S", "Shapes"],
      ["T", "Text (drag to make a box that wraps)"],
      ["E", "Eraser"],
      ["K", "Laser pointer"],
      ["G", "Hand (move the board)"],
      ["R", "Show or hide the ruler"],
      ["Hold still after a stroke", "Turn it into a clean line or shape"],
      ["Space (hold)", "Move the board with any tool"],
    ],
  },
  {
    title: "Edit",
    items: [
      ["Ctrl+Z", "Undo"],
      ["Ctrl+Shift+Z, Ctrl+Y", "Redo"],
      ["Ctrl+X / C / V", "Cut, copy, paste"],
      ["Ctrl+D", "Duplicate"],
      ["Delete", "Delete"],
      ["Ctrl+A", "Select all"],
      ["Esc", "Deselect"],
      ["Arrow keys", "Nudge (with Shift: 10× further)"],
      ["Shift+L / Shift+R", "Rotate left / right 90°"],
      ["Ctrl+G", "Group"],
      ["Ctrl+Shift+G", "Ungroup"],
      ["Ctrl+Shift+L", "Lock"],
      ["Right-click", "More actions: align, distribute, unlock, paste here…"],
    ],
  },
  {
    title: "Text",
    items: [
      ["Ctrl+Shift+> / <", "Larger / smaller text"],
      ["Ctrl+Enter or Esc", "Finish typing"],
    ],
  },
  {
    title: "Pages",
    items: [
      ["Page Up / Page Down", "Previous / next page"],
      ["Ctrl+M", "New page"],
      ["Ctrl+Shift+P", "Show or hide page thumbnails"],
      ["F2 · Delete · Alt+← / →", "In the thumbnails: rename, delete, move a page"],
    ],
  },
  {
    title: "View",
    items: [
      ["Ctrl+= / Ctrl+−", "Zoom in / out"],
      ["Ctrl+0", "Zoom to 100%"],
      ["Shift+1", "Fit to content"],
      ["F5", "Present (board only, full screen)"],
      ["F11", "Full screen"],
      ["Esc", "Close the spotlight or screen shade, or stop presenting"],
    ],
  },
  {
    title: "File",
    items: [
      ["Ctrl+N", "New board"],
      ["Ctrl+O", "Open"],
      ["Ctrl+Shift+S", "Save a copy as"],
      ["Ctrl+I", "Import images"],
      ["Ctrl+E", "Export as PDF"],
      ["Ctrl+Shift+E", "Export page as PNG"],
      ["F2", "Rename board"],
      ["F1", "This list"],
    ],
  },
];

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** The keyboard shortcut reference (View > Keyboard shortcuts, or F1). */
export function ShortcutsDialog({ persistence }: { persistence: Persistence }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const off = persistence.onMenuCommand((c) => {
      if (c === "shortcuts") setOpen(true);
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "F1" && !e.ctrlKey && !e.altKey && !isEditable(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      off();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [persistence]);

  return open ? <Sheet onClose={() => setOpen(false)} /> : null;
}

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <div className="shortcuts-body">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.items.map(([keys, action]) => (
                <div key={keys + action} className="shortcut-row">
                  <dt>
                    <kbd>{keys}</kbd>
                  </dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <div className="confirm-actions">
        <button type="button" className="btn" autoFocus onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
