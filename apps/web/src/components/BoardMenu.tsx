import {
  LONG_PRESS_EVENT,
  makeBackground,
  PAPER_COLOR,
  parseBackground,
  type AlignEdge,
  type BoardEngine,
  type Paper,
  type Pattern,
} from "@novaloom/board-engine";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignJustify,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Baseline,
  BoxSelect,
  ChartScatter,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Grid3x3,
  Grip,
  Group,
  Lock,
  LockOpen,
  Music,
  NotebookPen,
  RotateCcw,
  RotateCw,
  Scan,
  Scissors,
  Square,
  Trash2,
  Ungroup,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { copySelection, paste } from "../clipboard";

type RowItem = { label: string; run: () => void; on?: boolean } & ({ icon: LucideIcon; swatch?: never } | { swatch: string; icon?: never });

type Entry =
  | { kind: "item"; label: string; icon: LucideIcon; keys?: string; run: () => void; danger?: boolean }
  | { kind: "row"; label: string; items: RowItem[] }
  | { kind: "sep" };

interface Open {
  x: number;
  y: number;
  entries: Entry[];
  label: string;
}

/** Lets other controls (the selection bar's "More" button) open the object menu. */
let openObjectMenu: ((x: number, y: number) => void) | null = null;
export function showObjectMenu(x: number, y: number): void {
  openObjectMenu?.(x, y);
}

/** Lets the page bar's "More backgrounds" button open the background and board colour menu. */
let openBackgroundMenu: ((x: number, y: number) => void) | null = null;
export function showBackgroundMenu(x: number, y: number): void {
  openBackgroundMenu?.(x, y);
}

const ALIGN: { edge: AlignEdge; label: string; icon: LucideIcon }[] = [
  { edge: "left", label: "Align left edges", icon: AlignStartVertical },
  { edge: "centerX", label: "Align centres horizontally", icon: AlignCenterVertical },
  { edge: "right", label: "Align right edges", icon: AlignEndVertical },
  { edge: "top", label: "Align top edges", icon: AlignStartHorizontal },
  { edge: "centerY", label: "Align centres vertically", icon: AlignCenterHorizontal },
  { edge: "bottom", label: "Align bottom edges", icon: AlignEndHorizontal },
];

const PATTERN_ITEMS: { id: Pattern; label: string; icon: LucideIcon }[] = [
  { id: "blank", label: "Blank background", icon: Square },
  { id: "grid", label: "Grid background", icon: Grid3x3 },
  { id: "dots", label: "Dots background", icon: Grip },
  { id: "ruled", label: "Lines background", icon: AlignJustify },
];
const PATTERN_ITEMS_MORE: { id: Pattern; label: string; icon: LucideIcon }[] = [
  { id: "handwriting", label: "Handwriting lines", icon: Baseline },
  { id: "seyes", label: "Seyès ruling (French notebook)", icon: NotebookPen },
  { id: "staff", label: "Music staff", icon: Music },
  { id: "axes", label: "Coordinate grid", icon: ChartScatter },
];
const PAPER_ITEMS: { id: Paper; label: string }[] = [
  { id: "white", label: "White board" },
  { id: "green", label: "Green chalkboard" },
  { id: "black", label: "Black board" },
];

/**
 * Right-click menus on the board: for the selected objects, for a locked
 * object (unlock), and for empty board (paste here, select all, background…).
 */
export function BoardMenu({ engine }: { engine: BoardEngine }) {
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(() => {
    const objectEntries = (): Entry[] => {
      const sel = engine.getState().selection;
      if (!sel) return [];
      const entries: Entry[] = [
        { kind: "item", label: "Cut", icon: Scissors, keys: "Ctrl+X", run: () => copySelection(engine, true) },
        { kind: "item", label: "Copy", icon: Copy, keys: "Ctrl+C", run: () => copySelection(engine) },
        { kind: "item", label: "Duplicate", icon: CopyPlus, keys: "Ctrl+D", run: () => engine.duplicateSelection() },
        { kind: "sep" },
      ];
      if (sel.units >= 2) entries.push({ kind: "item", label: "Group", icon: Group, keys: "Ctrl+G", run: () => engine.groupSelection() });
      if (sel.grouped) entries.push({ kind: "item", label: "Ungroup", icon: Ungroup, keys: "Ctrl+Shift+G", run: () => engine.ungroupSelection() });
      entries.push({ kind: "item", label: "Lock", icon: Lock, keys: "Ctrl+Shift+L", run: () => engine.lockSelection() });
      if (sel.units >= 2) {
        entries.push({ kind: "sep" });
        entries.push({ kind: "row", label: "Align", items: ALIGN.map((a) => ({ label: a.label, icon: a.icon, run: () => engine.alignSelection(a.edge) })) });
        if (sel.units >= 3) {
          entries.push({
            kind: "row",
            label: "Distribute",
            items: [
              { label: "Distribute horizontally", icon: AlignHorizontalDistributeCenter, run: () => engine.distributeSelection("horizontal") },
              { label: "Distribute vertically", icon: AlignVerticalDistributeCenter, run: () => engine.distributeSelection("vertical") },
            ],
          });
        }
      }
      entries.push(
        { kind: "sep" },
        { kind: "item", label: "Rotate left 90°", icon: RotateCcw, keys: "Shift+L", run: () => engine.rotateSelection(-90) },
        { kind: "item", label: "Rotate right 90°", icon: RotateCw, keys: "Shift+R", run: () => engine.rotateSelection(90) },
        { kind: "sep" },
        { kind: "item", label: "Delete", icon: Trash2, keys: "Del", run: () => engine.deleteSelection(), danger: true },
      );
      return entries;
    };

    openObjectMenu = (x, y) => {
      const entries = objectEntries();
      if (entries.length) setOpen({ x, y, entries, label: "Selection" });
    };
    openBackgroundMenu = (x, y) => setOpen({ x, y, entries: backgroundRows(engine, engine.getState().background), label: "Background" });

    const board = document.querySelector<HTMLElement>(".board");
    if (!board) return;
    // Right-click, a pen's barrel button, or a long press (finger or pen held still).
    let lastLongPress = { t: -Infinity, x: 0, y: 0 };
    const onLongPress = (e: Event) => {
      const { clientX, clientY } = (e as CustomEvent<{ clientX: number; clientY: number }>).detail;
      lastLongPress = { t: performance.now(), x: clientX, y: clientY };
      openAt(clientX, clientY);
    };
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      // Windows may also report the same long press as a right-click: one menu only.
      const l = lastLongPress;
      if (performance.now() - l.t < 1000 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 30) return;
      openAt(e.clientX, e.clientY);
    };
    const openAt = (clientX: number, clientY: number) => {
      const e = { clientX, clientY };
      const target = engine.contextTarget(e.clientX, e.clientY);
      const at = { clientX: e.clientX, clientY: e.clientY };
      if (target.kind === "object") {
        setOpen({ x: e.clientX, y: e.clientY, entries: objectEntries(), label: "Selection" });
        return;
      }
      if (target.kind === "locked") {
        setOpen({
          x: e.clientX,
          y: e.clientY,
          label: "Locked object",
          entries: [
            { kind: "item", label: "Unlock", icon: LockOpen, run: () => engine.unlock([target.id!]) },
            { kind: "item", label: "Unlock all on this page", icon: LockOpen, run: () => engine.unlockAll() },
          ],
        });
        return;
      }
      const s = engine.getState();
      const entries: Entry[] = [
        { kind: "item", label: "Paste here", icon: ClipboardPaste, keys: "Ctrl+V", run: () => void paste(engine, undefined, at) },
        { kind: "item", label: "Select all", icon: BoxSelect, keys: "Ctrl+A", run: () => engine.selectAll() },
        { kind: "sep" },
        ...backgroundRows(engine, s.background),
        { kind: "sep" },
        { kind: "item", label: "Fit to content", icon: Scan, keys: "Shift+1", run: () => engine.fitContent() },
      ];
      if (engine.hasLockedContent()) entries.push({ kind: "item", label: "Unlock all on this page", icon: LockOpen, run: () => engine.unlockAll() });
      setOpen({ x: e.clientX, y: e.clientY, entries, label: "Board" });
    };
    board.addEventListener("contextmenu", onContextMenu);
    board.addEventListener(LONG_PRESS_EVENT, onLongPress);
    return () => {
      board.removeEventListener("contextmenu", onContextMenu);
      board.removeEventListener(LONG_PRESS_EVENT, onLongPress);
      openObjectMenu = null;
      openBackgroundMenu = null;
    };
  }, [engine]);

  if (!open) return null;
  return <MenuPopup open={open} onClose={() => setOpen(null)} />;
}

/** Background pattern and board colour, kept together in the page's background. */
function backgroundRows(engine: BoardEngine, background: Parameters<BoardEngine["setBackground"]>[0]): Entry[] {
  const { pattern, paper } = parseBackground(background);
  const patternItem = (b: { id: Pattern; label: string; icon: LucideIcon }): RowItem => ({
    label: b.label,
    icon: b.icon,
    on: pattern === b.id,
    run: () => {
      engine.setBackground(makeBackground(b.id, paper));
      // The axes cross at the board's origin: bring it into view.
      if (b.id === "axes") engine.revealPoint(0, 0);
    },
  });
  return [
    { kind: "row", label: "Background", items: PATTERN_ITEMS.map(patternItem) },
    { kind: "row", label: "", items: PATTERN_ITEMS_MORE.map(patternItem) },
    {
      kind: "row",
      label: "Board colour",
      items: PAPER_ITEMS.map((p) => ({ label: p.label, swatch: PAPER_COLOR[p.id], on: paper === p.id, run: () => engine.setBackground(makeBackground(pattern, p.id)) })),
    },
  ];
}

function MenuPopup({ open, onClose }: { open: Open; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: open.x, top: open.y });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Below-right of the pointer, flipped to stay inside the window.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setPos({
      left: open.x + r.width > innerWidth - 8 ? Math.max(8, open.x - r.width) : open.x,
      top: open.y + r.height > innerHeight - 8 ? Math.max(8, open.y - r.height) : open.y,
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current();
    };
    const onBlur = () => closeRef.current();
    const onWheel = () => closeRef.current();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  const run = (fn: () => void) => () => {
    closeRef.current();
    fn();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    const items = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus({ preventScroll: true });
    };
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeRef.current();
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") move(i + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
  };

  return createPortal(
    <div ref={ref} className="menu board-menu" role="menu" aria-label={open.label} style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {open.entries.map((entry, n) => {
        if (entry.kind === "sep") {
          // No separator first, last or twice in a row.
          const prev = open.entries[n - 1];
          if (!prev || prev.kind === "sep" || n === open.entries.length - 1) return null;
          return <span key={n} className="menu-sep" role="separator" />;
        }
        if (entry.kind === "row") {
          return (
            <div key={n} className="menu-row" role="group" aria-label={entry.label}>
              <span className="menu-row-label">{entry.label}</span>
              {entry.items.map((it) => (
                <button key={it.label} type="button" role="menuitem" className="menu-icon" aria-label={it.label} title={it.label} aria-pressed={it.on} onClick={run(it.run)}>
                  {it.icon ? <it.icon size={15} strokeWidth={1.7} /> : <span className="menu-swatch" style={{ background: it.swatch }} />}
                </button>
              ))}
            </div>
          );
        }
        const Icon = entry.icon;
        return (
          <button key={n} type="button" role="menuitem" className={entry.danger ? "danger" : undefined} onClick={run(entry.run)}>
            <Icon size={15} strokeWidth={1.7} />
            {entry.label}
            {entry.keys && <kbd>{entry.keys}</kbd>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
