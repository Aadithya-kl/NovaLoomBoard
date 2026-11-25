import { shortcutCode } from "../keys";
import { assets, renderThumbnail, ThumbnailPaths, type Background, type BoardEngine } from "@novaloom/board-engine";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Ellipsis,
  GalleryHorizontalEnd,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { PageSummary, Persistence } from "../persistence";
import { usePersistenceState } from "../usePersistence";
import { ConfirmDialog } from "./ConfirmDialog";
import { Tip } from "./Tip";

const THUMB_W = 128;
const THUMB_H = 80;
/** Pointer travel (px) before pressing a thumbnail becomes a drag. */
const DRAG_THRESHOLD = 5;
const OPEN_KEY = "novaloomboard.pages-open";

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* the preference is a convenience only */
  }
}

interface Drag {
  id: string;
  from: number;
  pointerId: number;
  startX: number;
  dx: number;
  active: boolean;
  /** Index the page will have after the drop. */
  to: number;
  /** Insertion marker, in list content coordinates. */
  markerX: number;
}

interface MenuState {
  id: string;
  left: number;
  top: number;
}

/**
 * Page navigation: a compact bar (previous, current page, next, new page)
 * and, on demand, a strip of page thumbnails above it for jumping between
 * pages, reordering them by dragging, renaming, duplicating and deleting.
 */
export function PageNavigator({ engine, persistence }: { engine: BoardEngine; persistence: Persistence }) {
  const { pages, activePage, save } = usePersistenceState(persistence);
  const [open, setOpenState] = useState(readOpen);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const thumbRefs = useRef(new Map<string, HTMLButtonElement>());
  const suppressClick = useRef(false);

  const activeIndex = Math.max(0, pages.findIndex((p) => p.id === activePage));
  const current = pages[activeIndex];

  const setOpen = useCallback((value: boolean | ((v: boolean) => boolean)) => {
    setOpenState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      writeOpen(next);
      return next;
    });
  }, []);

  const requestDelete = useCallback(
    (id: string) => {
      if (persistence.getState().pages.length <= 1) return;
      if (persistence.pageHasContent(id)) setConfirm(id);
      else void persistence.deletePage(id);
    },
    [persistence],
  );

  const startRename = useCallback(
    (id: string) => {
      setOpen(true);
      setMenu(null);
      setRenaming(id);
    },
    [setOpen],
  );

  // Page commands from the title-bar menu.
  useEffect(
    () =>
      persistence.onMenuCommand((c) => {
        const { activePage: id } = persistence.getState();
        switch (c) {
          case "page-new":
            persistence.addPage();
            return;
          case "page-duplicate":
            persistence.duplicatePage(id);
            return;
          case "page-rename":
            startRename(id);
            return;
          case "page-delete":
            requestDelete(id);
            return;
          case "page-prev":
            persistence.stepPage(-1);
            return;
          case "page-next":
            persistence.stepPage(1);
            return;
          case "pages-toggle":
            setOpen((v) => !v);
            return;
        }
      }),
    [persistence, requestDelete, setOpen, startRename],
  );

  // Page keys anywhere outside text fields.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.altKey || engine.isInteracting) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((shortcutCode(e) === "PageUp" || shortcutCode(e) === "PageDown") && !e.shiftKey) {
        e.preventDefault();
        persistence.stepPage(shortcutCode(e) === "PageUp" ? -1 : 1);
      } else if (mod && !e.shiftKey && shortcutCode(e) === "KeyM") {
        e.preventDefault();
        persistence.addPage();
      } else if (mod && e.shiftKey && shortcutCode(e) === "KeyP") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engine, persistence, setOpen]);

  // Keep the current page in view in the strip. Only the strip scrolls: scrollIntoView
  // would also scroll the (overflow: hidden) workspace and shift the whole board.
  useLayoutEffect(() => {
    const el = open ? thumbRefs.current.get(activePage)?.parentElement : undefined;
    if (el) revealInList(listRef.current, el);
  }, [open, activePage, pages.length]);

  // Roving focus target: the focused page, else the current one.
  const tabId = pages.some((p) => p.id === focusId) ? focusId : activePage;

  const focusPage = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    const el = thumbRefs.current.get(id);
    el?.focus({ preventScroll: true });
    if (el?.parentElement) revealInList(listRef.current, el.parentElement);
  };

  const openMenuFor = (id: string, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    setMenu({ id, left: r.left, top: r.top });
  };

  const onThumbKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, page: PageSummary, index: number) => {
    const key = e.key;
    let handled = true;
    if (e.altKey && (key === "ArrowLeft" || key === "ArrowRight")) {
      const to = index + (key === "ArrowLeft" ? -1 : 1);
      if (to >= 0 && to < pages.length) {
        persistence.movePage(index, to);
        requestAnimationFrame(() => focusPage(page.id));
      }
    } else if (key === "ArrowLeft") focusPage(pages[index - 1]?.id);
    else if (key === "ArrowRight") focusPage(pages[index + 1]?.id);
    else if (key === "Home") focusPage(pages[0]?.id);
    else if (key === "End") focusPage(pages[pages.length - 1]?.id);
    else if (key === "F2") startRename(page.id);
    else if (key === "Delete") requestDelete(page.id);
    else if (key === "ContextMenu" || (key === "F10" && e.shiftKey)) openMenuFor(page.id, e.currentTarget);
    else handled = false;
    if (handled) {
      e.preventDefault();
      // Keep board shortcuts (Delete, arrows, F2 rename board) from acting too.
      e.stopPropagation();
    }
  };

  // ----- drag to reorder -----

  const dropTarget = (clientX: number, from: number): { to: number; markerX: number } => {
    const list = listRef.current!;
    const rect = list.getBoundingClientRect();
    const x = clientX - rect.left + list.scrollLeft;
    const cards = pages.map((p) => thumbRefs.current.get(p.id)?.parentElement as HTMLElement | undefined);
    let to = 0;
    const others = cards.filter((_, i) => i !== from);
    for (const el of others) if (el && x > el.offsetLeft + el.offsetWidth / 2) to++;
    const gap = 10;
    const next = others[to];
    const prev = others[to - 1];
    const markerX = next ? next.offsetLeft - gap / 2 : prev ? prev.offsetLeft + prev.offsetWidth + gap / 2 : 0;
    return { to, markerX };
  };

  const onThumbPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, page: PageSummary, index: number) => {
    if (e.button !== 0 || renaming) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: page.id, from: index, pointerId: e.pointerId, startX: e.clientX, dx: 0, active: false, to: index, markerX: 0 });
  };

  const onThumbPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    if (!drag.active && Math.abs(dx) < DRAG_THRESHOLD) return;
    const list = listRef.current!;
    const r = list.getBoundingClientRect();
    if (e.clientX < r.left + 40) list.scrollLeft -= 12;
    else if (e.clientX > r.right - 40) list.scrollLeft += 12;
    setDrag({ ...drag, active: true, dx, ...dropTarget(e.clientX, drag.from) });
  };

  const onThumbPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.active) {
      suppressClick.current = true;
      persistence.movePage(drag.from, drag.to);
    }
    setDrag(null);
  };

  if (!current || save === "loading") return null;

  const menuPage = menu ? pages.find((p) => p.id === menu.id) : undefined;
  const menuIndex = menuPage ? pages.indexOf(menuPage) : -1;
  const confirmPage = confirm ? pages.find((p) => p.id === confirm) : undefined;

  return (
    <div className="pages-area">
      {open && (
        <div className="panel page-strip">
          <ol ref={listRef} className="page-list" aria-label="Pages" data-dragging={drag?.active || undefined}>
            {pages.map((page, index) => {
              const isActive = page.id === activePage;
              const dragging = drag?.active && drag.id === page.id;
              return (
                <li
                  key={page.id}
                  className="page-card"
                  data-page={page.id}
                  data-active={isActive || undefined}
                  data-dragging={dragging || undefined}
                  style={dragging ? { transform: `translateX(${drag.dx}px)` } : undefined}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ id: page.id, left: e.clientX, top: e.clientY });
                  }}
                >
                  <button
                    ref={(el) => {
                      if (el) thumbRefs.current.set(page.id, el);
                      else thumbRefs.current.delete(page.id);
                    }}
                    type="button"
                    className="page-thumb"
                    tabIndex={page.id === tabId ? 0 : -1}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={`${page.label}, page ${index + 1} of ${pages.length}`}
                    aria-keyshortcuts="F2 Delete Alt+ArrowLeft Alt+ArrowRight"
                    onClick={() => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      persistence.goToPage(page.id);
                    }}
                    onFocus={() => setFocusId(page.id)}
                    onKeyDown={(e) => onThumbKeyDown(e, page, index)}
                    onPointerDown={(e) => onThumbPointerDown(e, page, index)}
                    onPointerMove={onThumbPointerMove}
                    onPointerUp={onThumbPointerUp}
                    onPointerCancel={() => setDrag(null)}
                  >
                    <Thumbnail persistence={persistence} id={page.id} version={page.version} background={page.background} />
                  </button>
                  <button
                    type="button"
                    className="page-more"
                    tabIndex={-1}
                    aria-label={`Options for ${page.label}`}
                    aria-haspopup="menu"
                    onClick={(e) => openMenuFor(page.id, e.currentTarget)}
                  >
                    <Ellipsis size={14} strokeWidth={2} />
                  </button>
                  {renaming === page.id ? (
                    <RenameField
                      initial={page.name || page.label}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name !== null) persistence.renamePage(page.id, name);
                        requestAnimationFrame(() => focusPage(page.id));
                      }}
                    />
                  ) : (
                    <span className="page-name" title={page.label} onDoubleClick={() => startRename(page.id)}>
                      {page.label}
                    </span>
                  )}
                </li>
              );
            })}
            <li className="page-card add">
              <button type="button" className="page-add" aria-label="New page" onClick={() => persistence.addPage()}>
                <Plus size={18} strokeWidth={1.7} />
              </button>
              <span className="page-name" aria-hidden="true">
                New page
              </span>
            </li>
          </ol>
          {drag?.active && listRef.current && (
            <span
              className="page-drop-marker"
              style={{
                left: drag.markerX - listRef.current.scrollLeft + listRef.current.offsetLeft,
                top: listRef.current.offsetTop + 3,
              }}
            />
          )}
        </div>
      )}

      <div className="panel page-bar" role="toolbar" aria-label="Pages">
        <button
          type="button"
          className="icon-btn"
          aria-label="Page thumbnails"
          aria-pressed={open}
          onClick={() => setOpen((v) => !v)}
        >
          <GalleryHorizontalEnd size={16} strokeWidth={1.7} />
          <Tip label={open ? "Hide page thumbnails" : "Show page thumbnails"} keys="Ctrl+Shift+P" side="top" />
        </button>
        <span className="panel-sep" aria-hidden="true" />
        <button
          type="button"
          className="icon-btn"
          aria-label="Previous page"
          disabled={activeIndex === 0}
          onClick={() => persistence.stepPage(-1)}
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
          <Tip label="Previous page" keys="PgUp" side="top" />
        </button>
        <button
          type="button"
          className="page-current"
          aria-label={`${current.label}, page ${activeIndex + 1} of ${pages.length}. Show page thumbnails`}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="page-current-name">{current.label}</span>
          <span className="page-current-count">{current.name ? `${activeIndex + 1} of ${pages.length}` : `of ${pages.length}`}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Next page"
          disabled={activeIndex === pages.length - 1}
          onClick={() => persistence.stepPage(1)}
        >
          <ChevronRight size={16} strokeWidth={1.8} />
          <Tip label="Next page" keys="PgDn" side="top" />
        </button>
        <span className="panel-sep" aria-hidden="true" />
        <button type="button" className="icon-btn" aria-label="New page" onClick={() => persistence.addPage()}>
          <Plus size={16} strokeWidth={1.8} />
          <Tip label="New page" keys="Ctrl+M" side="top" />
        </button>
      </div>

      {menu && menuPage && (
        <PageMenu
          left={menu.left}
          top={menu.top}
          label={menuPage.label}
          canMoveLeft={menuIndex > 0}
          canMoveRight={menuIndex < pages.length - 1}
          canDelete={pages.length > 1}
          onClose={(refocus) => {
            setMenu(null);
            if (refocus) requestAnimationFrame(() => focusPage(menuPage.id));
          }}
          onRename={() => startRename(menuPage.id)}
          onDuplicate={() => persistence.duplicatePage(menuPage.id)}
          onMove={(d) => persistence.movePage(menuIndex, menuIndex + d)}
          onDelete={() => requestDelete(menuPage.id)}
        />
      )}

      {confirmPage && (
        <ConfirmDialog
          title={`Delete “${confirmPage.label}”?`}
          message="This page and everything on it will be deleted. You can bring it back with Undo (Ctrl+Z)."
          confirmLabel="Delete page"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void persistence.deletePage(confirmPage.id);
          }}
        />
      )}
    </div>
  );
}

/** Page preview, redrawn when the page changes (the current page shortly after edits settle). */
const Thumbnail = memo(function Thumbnail({
  persistence,
  id,
  version,
  background,
}: {
  persistence: Persistence;
  id: string;
  version: number;
  background: Background;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paths = useMemo(() => new ThumbnailPaths(), []);
  // Redraw when an image on this page finishes loading (not for other pages' images).
  const [loaded, setLoaded] = useState(0);
  useEffect(
    () =>
      assets.onLoad((asset) => {
        if (persistence.pageObjects(id).some((o) => o.type === "image" && o.asset === asset)) setLoaded((n) => n + 1);
      }),
    [persistence, id],
  );
  useEffect(() => {
    const t = setTimeout(() => {
      if (ref.current) renderThumbnail(ref.current, persistence.pageObjects(id), background, THUMB_W, THUMB_H, devicePixelRatio || 1, paths);
    }, version === 0 ? 0 : 150);
    return () => clearTimeout(t);
  }, [persistence, id, version, background, paths, loaded]);
  return <canvas ref={ref} className="page-canvas" width={THUMB_W} height={THUMB_H} aria-hidden="true" />;
});

function RenameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="page-name-input"
      aria-label="Page name"
      value={value}
      maxLength={100}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value);
        else if (e.key === "Escape") finish(null);
      }}
    />
  );
}

function PageMenu({
  left,
  top,
  label,
  canMoveLeft,
  canMoveRight,
  canDelete,
  onClose,
  onRename,
  onDuplicate,
  onMove,
  onDelete,
}: {
  left: number;
  top: number;
  label: string;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canDelete: boolean;
  onClose: (refocus: boolean) => void;
  onRename: () => void;
  onDuplicate: () => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left, top });

  // Open above the anchor point, kept inside the window.
  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(left, innerWidth - r.width - 8)),
      top: Math.max(8, top - r.height - 6),
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [left, top]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeRef.current(false);
    };
    const onBlur = () => closeRef.current(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const run = (fn: () => void) => () => {
    onClose(false);
    fn();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    const items = [...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus({ preventScroll: true });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus({ preventScroll: true });
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus({ preventScroll: true });
    }
  };

  // In <body>: a transformed ancestor would otherwise become the fixed position's reference.
  return createPortal(
    <div ref={ref} className="menu" role="menu" aria-label={`${label} options`} style={pos} onKeyDown={onKeyDown}>
      <button type="button" role="menuitem" onClick={run(onRename)}>
        <Pencil size={15} strokeWidth={1.7} />
        Rename
        <kbd>F2</kbd>
      </button>
      <button type="button" role="menuitem" onClick={run(onDuplicate)}>
        <CopyPlus size={15} strokeWidth={1.7} />
        Duplicate
      </button>
      <span className="menu-sep" role="separator" />
      <button type="button" role="menuitem" disabled={!canMoveLeft} onClick={run(() => onMove(-1))}>
        <ArrowLeft size={15} strokeWidth={1.7} />
        Move left
        <kbd>Alt+←</kbd>
      </button>
      <button type="button" role="menuitem" disabled={!canMoveRight} onClick={run(() => onMove(1))}>
        <ArrowRight size={15} strokeWidth={1.7} />
        Move right
        <kbd>Alt+→</kbd>
      </button>
      <span className="menu-sep" role="separator" />
      <button type="button" role="menuitem" className="danger" disabled={!canDelete} onClick={run(onDelete)}>
        <Trash2 size={15} strokeWidth={1.7} />
        Delete page
        <kbd>Del</kbd>
      </button>
    </div>,
    document.body,
  );
}

/** Scrolls the strip (only) so `card` is fully visible. */
function revealInList(list: HTMLElement | null, card: HTMLElement): void {
  if (!list) return;
  const pad = 12;
  const left = card.offsetLeft - pad;
  const right = card.offsetLeft + card.offsetWidth + pad;
  if (left < list.scrollLeft) list.scrollLeft = left;
  else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
}
