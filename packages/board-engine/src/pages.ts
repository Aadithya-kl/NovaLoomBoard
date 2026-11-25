/**
 * The pages of one board, independent of the DOM: their order, names,
 * backgrounds and views, each page's objects and undo history, and the
 * storage operations every page change produces. The engine shows one page
 * at a time; the caller keeps the active page's objects in sync with it.
 */
import { cloneObjects } from "./clipboard";
import { History } from "./history";
import { newId, type BoardObject } from "./model";
import {
  decodeObject,
  MAX_PAGE_NAME,
  MAX_PAGES,
  ZOrderTracker,
  type BoardView,
  type PagePayload,
  type StoreOp,
} from "./persist";
import type { Background } from "./renderer";

export interface PageRecord {
  readonly id: string;
  name: string;
  background: Background;
  view: BoardView | null;
  /** Bottom first. For the active page this is only current after the caller syncs it from the engine. */
  objects: BoardObject[];
  /** This page's undo/redo history, kept while the board is open. */
  readonly history: History;
  /** Turns this page's engine batches into stored z keys. */
  readonly tracker: ZOrderTracker;
  /** Increases on every change, so previews know when to redraw. */
  version: number;
}

/**
 * An undoable change to the page list. Pages that are removed are kept
 * whole (objects, settings and their own undo history) so they can be put
 * back exactly. `show` is the page to display after applying the change.
 */
export type PageChange =
  | { kind: "insert"; page: PageRecord; index: number; show: string }
  | { kind: "remove"; page: PageRecord; index: number; show: string }
  | { kind: "rename"; id: string; from: string; to: string }
  | { kind: "move"; id: string; from: number; to: number }
  /** Several changes undone and redone as one step (e.g. all pages of an imported PDF). */
  | { kind: "batch"; changes: PageChange[]; show: string };

/** The change that reverts `c`. */
export function invertChange(c: PageChange): PageChange {
  switch (c.kind) {
    case "insert":
      // Undoing an insert removes the page and returns to where the user was.
      return { kind: "remove", page: c.page, index: c.index, show: c.show };
    case "remove":
      // Undoing a removal puts the page back and shows it.
      return { kind: "insert", page: c.page, index: c.index, show: c.show };
    case "rename":
      return { kind: "rename", id: c.id, from: c.to, to: c.from };
    case "move":
      return { kind: "move", id: c.id, from: c.to, to: c.from };
    case "batch":
      // Reverse order, each inverted. Undoing returns to the page shown before.
      return { kind: "batch", changes: c.changes.map(invertChange).reverse(), show: c.show };
  }
}

/** What the interface shows for a page: its name, or "Page n" by position. */
export function pageLabel(page: Pick<PageRecord, "name">, index: number): string {
  return page.name.trim() || `Page ${index + 1}`;
}

export class PageList {
  private pages: PageRecord[];
  private activeId: string;

  constructor(pages: PageRecord[], activeId?: string) {
    if (!pages.length) throw new Error("a board needs at least one page");
    this.pages = pages;
    this.activeId = pages.some((p) => p.id === activeId) ? activeId! : pages[0]!.id;
  }

  /** A board with one empty page (new boards, and the browser preview). */
  static single(id = "p1"): PageList {
    return new PageList([makeRecord(id, "", "grid", null, [])]);
  }

  /** Builds the list from an opened board. Objects that fail validation are skipped and counted. */
  static fromPayload(pages: readonly PagePayload[], activeId: string): { list: PageList; skipped: number } {
    let skipped = 0;
    const records = pages.map((p) => {
      const objects: BoardObject[] = [];
      const zs: { id: string; z: number }[] = [];
      for (const row of p.objects) {
        try {
          objects.push(decodeObject(row));
          zs.push({ id: row.id, z: row.z });
        } catch {
          skipped++;
        }
      }
      const rec = makeRecord(p.id, p.name, p.background, p.view, objects);
      rec.tracker.reset(zs);
      return rec;
    });
    if (!records.length) records.push(makeRecord("p1", "", "grid", null, []));
    return { list: new PageList(records, activeId), skipped };
  }

  get all(): readonly PageRecord[] {
    return this.pages;
  }

  get size(): number {
    return this.pages.length;
  }

  get active(): PageRecord {
    return this.get(this.activeId)!;
  }

  get activeIndex(): number {
    return this.indexOf(this.activeId);
  }

  get canAdd(): boolean {
    return this.pages.length < MAX_PAGES;
  }

  get(id: string): PageRecord | undefined {
    return this.pages.find((p) => p.id === id);
  }

  indexOf(id: string): number {
    return this.pages.findIndex((p) => p.id === id);
  }

  /** Makes a page current. Returns false if it does not exist or is already current. */
  setActive(id: string): boolean {
    if (id === this.activeId || !this.get(id)) return false;
    this.activeId = id;
    return true;
  }

  /** Inserts an empty page at `index` (default: after the active page). */
  add(init: { background: Background; view: BoardView | null }, index = this.activeIndex + 1): { page: PageRecord; ops: StoreOp[] } {
    if (!this.canAdd) throw new Error("too many pages");
    const page = makeRecord(newId(), "", init.background, init.view, []);
    return { page, ops: this.insert(page, index) };
  }

  /** Inserts a new page that already holds `objects` (e.g. an imported PDF page). */
  addWithObjects(
    init: { background: Background; view: BoardView | null; name?: string },
    objects: BoardObject[],
    index: number,
  ): { page: PageRecord; ops: StoreOp[] } {
    if (!this.canAdd) throw new Error("too many pages");
    const page = makeRecord(newId(), (init.name ?? "").slice(0, MAX_PAGE_NAME), init.background, init.view, objects);
    return { page, ops: this.insertRecord(page, index) };
  }

  /**
   * Copies a page right after it: every object (with new ids), its
   * background and view. `objects` are the source page's current objects.
   */
  duplicate(id: string, objects: readonly BoardObject[]): { page: PageRecord; ops: StoreOp[] } {
    const src = this.get(id);
    if (!src) throw new Error("no such page");
    if (!this.canAdd) throw new Error("too many pages");
    const name = src.name.trim() ? `${src.name.trim()} (copy)`.slice(0, MAX_PAGE_NAME) : "";
    const page = makeRecord(newId(), name, src.background, src.view, cloneObjects(objects, 0, 0));
    const ops = this.insert(page, this.indexOf(id) + 1);
    ops.push(...page.tracker.apply(page.objects.map((object, index) => ({ kind: "add" as const, object, index }))));
    return { page, ops };
  }

  /**
   * Deletes a page with everything on it. The last page cannot be deleted.
   * When the active page is deleted, its neighbour (the next page, or the
   * previous one at the end) becomes active and is returned.
   */
  remove(id: string): { ops: StoreOp[]; activated: PageRecord | null } {
    const i = this.indexOf(id);
    if (i === -1 || this.pages.length <= 1) return { ops: [], activated: null };
    let activated: PageRecord | null = null;
    if (id === this.activeId) {
      activated = this.pages[i + 1] ?? this.pages[i - 1]!;
      this.activeId = activated.id;
    }
    this.pages.splice(i, 1);
    return { ops: [{ op: "deletePage", id }, ...this.renumber()], activated };
  }

  /**
   * Puts a whole page (e.g. one removed earlier) at `index`, writing the
   * page and every object on it.
   */
  insertRecord(page: PageRecord, index: number): StoreOp[] {
    if (this.get(page.id)) throw new Error("page already present");
    const ops = this.insert(page, index);
    page.tracker.reset([]);
    ops.push(...page.tracker.apply(page.objects.map((object, i) => ({ kind: "add" as const, object, index: i }))));
    page.version++;
    return ops;
  }

  /**
   * Applies an undo/redo step. Returns the storage operations and the page
   * to show, or null when the list no longer matches the change (nothing is
   * changed then).
   */
  apply(change: PageChange): { ops: StoreOp[]; show: string } | null {
    switch (change.kind) {
      case "insert": {
        if (this.get(change.page.id)) return null;
        const ops = this.insertRecord(change.page, change.index);
        return { ops, show: change.page.id };
      }
      case "remove": {
        if (this.indexOf(change.page.id) === -1 || this.size <= 1) return null;
        const { ops } = this.remove(change.page.id);
        return { ops, show: this.get(change.show) ? change.show : this.active.id };
      }
      case "rename": {
        if (!this.get(change.id)) return null;
        return { ops: this.rename(change.id, change.to), show: change.id };
      }
      case "move": {
        const from = this.indexOf(change.id);
        if (from === -1) return null;
        return { ops: this.move(from, change.to), show: change.id };
      }
      case "batch": {
        const ops: StoreOp[] = [];
        let show = change.show;
        for (const [i, c] of change.changes.entries()) {
          const r = this.apply(c);
          if (!r) return i === 0 ? null : { ops, show: this.active.id };
          ops.push(...r.ops);
          // Redoing an import shows its first page; undoing returns to where the user was.
          if (i === 0 && c.kind === "insert") show = r.show;
        }
        return { ops, show: this.get(show) ? show : this.active.id };
      }
    }
  }

  /** Sets a page's name; empty restores the automatic "Page n". */
  rename(id: string, name: string): StoreOp[] {
    const page = this.get(id);
    const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_NAME);
    if (!page || clean === page.name) return [];
    page.name = clean;
    page.version++;
    return [{ op: "updatePage", id, name: clean }];
  }

  /** Moves the page at `from` so it ends up at index `to`. */
  move(from: number, to: number): StoreOp[] {
    const n = this.pages.length;
    if (from < 0 || from >= n) return [];
    const target = Math.max(0, Math.min(n - 1, to));
    if (target === from) return [];
    const [page] = this.pages.splice(from, 1);
    this.pages.splice(target, 0, page!);
    return this.renumber();
  }

  /** The page's new background (from the engine). */
  setBackground(id: string, background: Background): StoreOp[] {
    const page = this.get(id);
    if (!page || page.background === background) return [];
    page.background = background;
    page.version++;
    return [{ op: "updatePage", id, background }];
  }

  /** Records the page's camera; returns an op only when it changed. */
  setView(id: string, view: BoardView): StoreOp[] {
    const page = this.get(id);
    if (!page) return [];
    const v = { x: view.x, y: view.y, zoom: view.zoom };
    if (page.view && page.view.x === v.x && page.view.y === v.y && page.view.zoom === v.zoom) return [];
    page.view = v;
    return [{ op: "updatePage", id, view: v }];
  }

  private insert(page: PageRecord, index: number): StoreOp[] {
    const i = Math.max(0, Math.min(index, this.pages.length));
    this.pages.splice(i, 0, page);
    // The new page is written first so objects put onto it have a page to belong to.
    const ops: StoreOp[] = [
      { op: "putPage", page: { id: page.id, position: i, name: page.name, background: page.background, view: page.view } },
    ];
    ops.push(...this.renumber(page.id));
    return ops;
  }

  /** Positions follow the list order (0, 1, 2…); only pages whose position changed are written. */
  private renumber(skip?: string): StoreOp[] {
    const ops: StoreOp[] = [];
    this.pages.forEach((p, i) => {
      const pos = positions.get(p) ?? -1;
      positions.set(p, i);
      if (p.id !== skip && pos !== i) ops.push({ op: "updatePage", id: p.id, position: i });
    });
    return ops;
  }
}

/** Last position written for each page (kept outside the record, it is a storage detail). */
const positions = new WeakMap<PageRecord, number>();

function makeRecord(id: string, name: string, background: Background, view: BoardView | null, objects: BoardObject[]): PageRecord {
  return { id, name, background, view, objects, history: new History(), tracker: new ZOrderTracker(id), version: 0 };
}
