import {
  assets,
  History,
  invertChange,
  PageList,
  pageLabel,
  type Background,
  type BoardEngine,
  type ExternalHistory,
  type PageChange, type BoardObject, type DocumentChange, type PageRecord } from "@novaloom/board-engine";
import type {
  BoardProps,
  DesktopBridge,
  MainSaveStatus,
  MenuCommand,
  RecoveryNotice,
  StoreOp,
} from "@novaloom/board-engine/persist";

declare global {
  interface Window {
    /** Present when running inside the NovaLoomBoard desktop app. */
    novaLoom?: DesktopBridge;
  }
}

export type SaveState =
  | "loading"
  | "saved"
  | "saving"
  /** Still not saved after 2 s. */
  | "delayed"
  /** Writing failed (e.g. disk full); changes are kept and retried. */
  | "error"
  /** Browser preview without the desktop app: nothing is saved. */
  | "not-persistent";

export interface PageSummary {
  id: string;
  /** Name shown to the user ("Page n" when unnamed). */
  label: string;
  /** The user-given name, possibly empty. */
  name: string;
  background: Background;
  /** Changes whenever the page's preview should be redrawn. */
  version: number;
}

/** A short-lived message about a long action (import, export): progress, success or failure. */
export interface StatusMessage {
  tone: "progress" | "success" | "error";
  text: string;
  /** Optional action button, e.g. "Show in folder". */
  action?: { label: string; run: () => void };
}

export interface PersistenceState {
  save: SaveState;
  status?: StatusMessage;
  error?: string;
  title: string;
  notice?: RecoveryNotice;
  pages: PageSummary[];
  activePage: string;
}

const DELAYED_AFTER_MS = 2_000;

/**
 * The open board: its pages, and autosave. Every change the engine
 * announces is converted to storage operations for the page it happened on
 * and handed to the desktop main process immediately; the main process
 * commits within ~150 ms. There is no explicit Save.
 *
 * The engine shows one page at a time. Switching pages hands the engine the
 * other page's objects, view and undo history, so undo never reaches into
 * another page and nothing is lost on the way.
 *
 * Page operations (add, delete, rename, duplicate, reorder) have their own
 * undo history, connected to the engine as its external history: Ctrl+Z
 * reverts whichever is more recent, the current page's last edit or the
 * last page operation. Drawings on other pages are never touched.
 */
export class Persistence {
  private readonly listeners = new Set<() => void>();
  private readonly commandListeners = new Set<(c: MenuCommand) => void>();
  private readonly inflight = new Set<Promise<void>>();
  private readonly cleanups: (() => void)[] = [];
  private pageList: PageList = PageList.single();
  private readonly pageHistory = new History<PageChange>(200);
  private readonly externalHistory: ExternalHistory;
  private mainStatus: MainSaveStatus = { status: "saved" };
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private delayed = false;
  private sendError: string | undefined;
  private disposed = false;
  private state: PersistenceState;

  constructor(
    private readonly engine: BoardEngine,
    private readonly bridge: DesktopBridge | undefined = window.novaLoom,
  ) {
    const history = this.pageHistory;
    this.externalHistory = {
      get undoStamp() {
        return history.undoStamp;
      },
      get redoStamp() {
        return history.redoStamp;
      },
      undo: () => {
        const change = history.undo();
        if (change) this.applyChange(invertChange(change));
      },
      redo: () => {
        const change = history.redo();
        if (change) this.applyChange(change);
      },
      // A new edit on the page starts a new branch: page operations can no longer be redone.
      onEdit: () => history.clearRedo(),
    };
    this.state = {
      save: bridge ? "loading" : "not-persistent",
      title: "Untitled board",
      pages: [],
      activePage: this.pageList.active.id,
    };
  }

  getState = (): PersistenceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Runs a menu command handled inside the window (e.g. F2 rename). */
  runCommand(command: MenuCommand): void {
    this.commandListeners.forEach((l) => l(command));
  }

  onMenuCommand(listener: (c: MenuCommand) => void): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  async start(): Promise<void> {
    const bridge = this.bridge;
    if (bridge) {
      this.cleanups.push(
        bridge.onSaveStatus((s) => {
          this.mainStatus = s;
          this.refresh();
        }),
        bridge.onFlushRequest(() => this.flush()),
        bridge.onMenuCommand((c) => this.commandListeners.forEach((l) => l(c))),
      );
      // Images on the board are read from the board file when first drawn.
      assets.setLoader((id) => bridge.files.readAsset(id));
      const payload = await bridge.loadBoard();
      if (this.disposed) return;
      const { list, skipped } = PageList.fromPayload(payload.pages, payload.activePage);
      // The main process verifies files on open, so this should not happen.
      if (skipped) console.error(`[persistence] skipped ${skipped} invalid object(s)`);
      this.pageList = list;
      this.state = { ...this.state, title: payload.title, notice: payload.notice };
    }
    this.showActive();
    this.engine.setExternalHistory(this.externalHistory);
    this.cleanups.push(this.engine.onDocumentChange(this.onChange), () => this.engine.setExternalHistory(null));
    this.publishPages();
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.cleanups.forEach((c) => c());
    this.cleanups.length = 0;
    if (this.delayTimer) clearTimeout(this.delayTimer);
  }

  setTitle(title: string): void {
    const clean = title.trim().slice(0, 200) || "Untitled board";
    if (clean === this.state.title) return;
    this.set({ title: clean });
    this.send([], { title: clean });
  }

  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  /** Shows (or clears) the status message. Success messages fade after a few seconds. */
  showStatus(status: StatusMessage | null): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = null;
    this.set({ status: status ?? undefined });
    if (status?.tone === "success") this.statusTimer = setTimeout(() => this.showStatus(null), 8000);
  }

  /** Background, objects and label of a page, for exporting. */
  pageForExport(id: string): { objects: readonly BoardObject[]; background: Background; label: string } | null {
    const i = this.pageList.indexOf(id);
    const rec = this.pageList.get(id);
    if (!rec) return null;
    const background = id === this.pageList.active.id ? this.engine.getState().background : rec.background;
    return { objects: this.pageObjects(id), background, label: pageLabel(rec, i) };
  }

  dismissNotice(): void {
    this.set({ notice: undefined });
    this.bridge?.dismissNotice();
  }

  /** Clear page, after a verified snapshot so it can be restored even after the undo history is gone. */
  async clearPage(): Promise<void> {
    await this.safetySnapshot("before-clear");
    this.engine.clearPage();
  }

  /** Hands everything to the main process (called before closing or switching boards). */
  async flush(): Promise<void> {
    if (!this.bridge) return;
    this.send(this.pageList.setView(this.pageList.active.id, this.engine.getView()));
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  // ---------- pages ----------

  /** Current objects of a page (the active page's live from the engine). */
  pageObjects(id: string): readonly BoardObject[] {
    if (id === this.pageList.active.id) return this.engine.getObjects();
    return this.pageList.get(id)?.objects ?? [];
  }

  pageRecord(id: string): PageRecord | undefined {
    return this.pageList.get(id);
  }

  pageHasContent(id: string): boolean {
    return this.pageObjects(id).length > 0;
  }

  goToPage(id: string): void {
    const list = this.pageList;
    if (id === list.active.id || !list.get(id)) return;
    this.leaveActive();
    list.setActive(id);
    this.send([], { activePage: id });
    this.showActive();
    this.publishPages();
  }

  /** Moves to the previous (-1) or next (+1) page. */
  stepPage(delta: number): void {
    const next = this.pageList.all[this.pageList.activeIndex + delta];
    if (next) this.goToPage(next.id);
  }

  /** Adds an empty page after the current one and shows it. Undoable. */
  addPage(): void {
    if (!this.pageList.canAdd) return;
    const active = this.pageList.active;
    this.leaveActive();
    // Same background and position on the board, so the new page feels like turning a sheet.
    const { page, ops } = this.pageList.add({ background: active.background, view: active.view });
    this.send(ops);
    this.record({ kind: "insert", page, index: this.pageList.indexOf(page.id), show: active.id });
    this.goToPage(page.id);
  }

  /** Copies a page (objects, background, view) right after it and shows the copy. Undoable. */
  duplicatePage(id: string): void {
    if (!this.pageList.canAdd || !this.pageList.get(id)) return;
    const before = this.pageList.active.id;
    this.leaveActive();
    const { page, ops } = this.pageList.duplicate(id, this.pageObjects(id));
    this.send(ops);
    this.record({ kind: "insert", page, index: this.pageList.indexOf(page.id), show: before });
    this.goToPage(page.id);
  }

  /**
   * Deletes a page and its objects (the last page cannot be deleted).
   * Undoable: the whole page is kept in the undo history. A page with
   * content is also snapshotted first, as a backup beyond the session.
   */
  async deletePage(id: string): Promise<void> {
    const list = this.pageList;
    if (list.size <= 1 || !list.get(id)) return;
    if (this.pageHasContent(id)) await this.safetySnapshot("before-delete-page");
    if (this.disposed || !list.get(id) || list.size <= 1) return;
    this.leaveActive();
    const page = list.get(id)!;
    const index = list.indexOf(id);
    const { ops, activated } = list.remove(id);
    this.send(ops, activated ? { activePage: activated.id } : undefined);
    this.record({ kind: "remove", page, index, show: list.active.id });
    if (activated) this.showActive();
    this.publishPages();
  }

  /**
   * Inserts new pages, each holding its objects (e.g. imported PDF pages),
   * after the current page, as one undoable step, and shows the first one
   * fitted to the window. Returns the new page ids.
   */
  insertPages(pages: readonly { objects: BoardObject[]; background: Background; name?: string }[]): string[] {
    const list = this.pageList;
    if (!pages.length || !list.canAdd) return [];
    const before = list.active.id;
    this.leaveActive();
    let index = list.activeIndex + 1;
    const changes: Extract<PageChange, { kind: "insert" }>[] = [];
    const ops: StoreOp[] = [];
    for (const p of pages) {
      if (!list.canAdd) break;
      const { page, ops: o } = list.addWithObjects({ background: p.background, view: null, name: p.name }, p.objects, index);
      ops.push(...o);
      changes.push({ kind: "insert", page, index, show: before });
      index++;
    }
    this.send(ops);
    this.record({ kind: "batch", changes, show: before });
    const first = changes[0]!.page.id;
    this.goToPage(first);
    this.engine.fitContent();
    // Same fit for the other pages (PDF pages usually share a size).
    const view = this.engine.getView();
    for (const c of changes) this.send(list.setView(c.page.id, view));
    this.publishPages();
    return changes.map((c) => c.page.id);
  }

  /** Undoable. */
  renamePage(id: string, name: string): void {
    const from = this.pageList.get(id)?.name ?? "";
    const ops = this.pageList.rename(id, name);
    if (!ops.length) return;
    this.send(ops);
    this.record({ kind: "rename", id, from, to: this.pageList.get(id)!.name });
    this.publishPages();
  }

  /** Reorders: the page at `from` ends up at index `to`. Undoable. */
  movePage(from: number, to: number): void {
    const page = this.pageList.all[from];
    const ops = this.pageList.move(from, to);
    if (!page || !ops.length) return;
    this.send(ops);
    this.record({ kind: "move", id: page.id, from, to: this.pageList.indexOf(page.id) });
    this.publishPages();
  }

  /** Records a page operation. Like any new action, it ends what could be redone on the current page. */
  private record(change: PageChange): void {
    this.pageHistory.push(change);
    this.pageList.active.history.clearRedo();
    this.engine.refreshHistory();
  }

  /** Applies a page undo/redo step and shows the page it concerns. */
  private applyChange(change: PageChange): void {
    const list = this.pageList;
    const before = list.active.id;
    // Keep text being typed and capture the current page, which the change may remove.
    this.leaveActive();
    const result = list.apply(change);
    if (!result) {
      // The list no longer matches the history (should not happen): drop it rather than guess.
      console.error("[persistence] page history out of step; cleared", change.kind);
      this.pageHistory.clear();
      this.engine.refreshHistory();
      return;
    }
    list.setActive(result.show);
    const switched = list.active.id !== before;
    this.send(result.ops, switched ? { activePage: list.active.id } : undefined);
    if (switched) this.showActive();
    this.publishPages();
  }

  /** Saves the leaving page's state: text being typed, its objects and its view. */
  private leaveActive(): void {
    this.engine.commitEdits();
    const active = this.pageList.active;
    active.objects = this.engine.getObjects();
    this.send(this.pageList.setView(active.id, this.engine.getView()));
  }

  private showActive(): void {
    const p = this.pageList.active;
    this.engine.loadDocument({ objects: p.objects, background: p.background, view: p.view ?? undefined, history: p.history });
  }

  private publishPages(): void {
    const pages = this.pageList.all.map((p, i) => ({
      id: p.id,
      label: pageLabel(p, i),
      name: p.name,
      background: p.background,
      version: p.version,
    }));
    this.set({ pages, activePage: this.pageList.active.id });
  }

  private async safetySnapshot(reason: "before-clear" | "before-delete-page"): Promise<void> {
    if (!this.bridge) return;
    try {
      await this.bridge.snapshot(reason);
    } catch (err) {
      console.error(`[persistence] snapshot ${reason} failed`, err);
    }
  }

  private onChange = (change: DocumentChange): void => {
    const active = this.pageList.active;
    active.version++;
    if (change.kind === "objects") {
      // The view rides along so reopening shows the same area.
      this.send([...active.tracker.apply(change.batch), ...this.pageList.setView(active.id, this.engine.getView())]);
    } else {
      this.send(this.pageList.setBackground(active.id, change.background));
    }
    this.publishPages();
  };

  private send(ops: StoreOp[], props?: BoardProps): void {
    if (!this.bridge || (!ops.length && !props)) return;
    const p = this.bridge
      .save(ops, props)
      .then(() => {
        this.sendError = undefined;
      })
      .catch((err: unknown) => {
        this.sendError = err instanceof Error ? err.message : String(err);
        console.error("[persistence] save rejected", err);
      })
      .finally(() => {
        this.inflight.delete(p);
        this.refresh();
      });
    this.inflight.add(p);
    this.refresh();
  }

  private refresh(): void {
    if (!this.bridge) return;
    let save: SaveState;
    let error: string | undefined;
    if (this.sendError || this.mainStatus.status === "error") {
      save = "error";
      error = this.sendError ?? this.mainStatus.error;
    } else if (this.inflight.size || this.mainStatus.status === "saving") {
      save = "saving";
    } else save = "saved";

    if (save === "saving") {
      if (!this.delayTimer && !this.delayed) {
        this.delayTimer = setTimeout(() => {
          this.delayTimer = null;
          this.delayed = true;
          this.refresh();
        }, DELAYED_AFTER_MS);
      }
      if (this.delayed) save = "delayed";
    } else {
      if (this.delayTimer) clearTimeout(this.delayTimer);
      this.delayTimer = null;
      this.delayed = false;
    }
    if (save !== this.state.save || error !== this.state.error) this.set({ save, error });
  }

  private set(patch: Partial<PersistenceState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}
