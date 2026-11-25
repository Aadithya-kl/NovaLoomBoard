import type { BoardProps, StoreOp } from "@novaloom/board-engine/persist";
import type { CommitEntry } from "./board-file";

export type SaveStatus = "saved" | "saving" | "error";

export interface JournalEntry extends CommitEntry {
  createdAt: number;
}

export interface JournalOptions {
  /** Writes entries atomically; throws on failure (nothing written). */
  commit: (entries: readonly JournalEntry[]) => void;
  /** Sequence number already stored in the file. */
  lastSeq: number;
  onStatus?: (status: SaveStatus, error?: Error) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Commit at most this long after the oldest pending entry arrived. */
  windowMs?: number;
  /** Commit immediately once this many entries are pending. */
  maxEntries?: number;
  /** Retry interval after a failed commit (disk full, I/O error). */
  retryMs?: number;
}

/**
 * Pending changes held in the main process until they are committed.
 * Entries get consecutive sequence numbers; a failed commit keeps them all
 * and retries, so nothing is dropped while the disk is full.
 */
export class Journal {
  private entries: JournalEntry[] = [];
  private seq: number;
  private commitTimer: unknown = null;
  private status: SaveStatus = "saved";
  private lastError: Error | undefined;
  private readonly o: Required<Omit<JournalOptions, "onStatus" | "lastSeq">> & Pick<JournalOptions, "onStatus">;

  constructor(opts: JournalOptions) {
    this.seq = opts.lastSeq;
    this.o = {
      now: Date.now,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      windowMs: 150,
      maxEntries: 200,
      retryMs: 10_000,
      ...opts,
    };
  }

  get pending(): number {
    return this.entries.length;
  }

  get saveStatus(): SaveStatus {
    return this.status;
  }

  get error(): Error | undefined {
    return this.lastError;
  }

  /** Entries not yet committed (for "Save a copy elsewhere"). */
  get pendingEntries(): readonly JournalEntry[] {
    return this.entries;
  }

  add(ops: readonly StoreOp[], props?: BoardProps): void {
    if (ops.length === 0 && !props) return;
    this.entries.push({ seq: ++this.seq, ops, props, createdAt: this.o.now() });
    if (this.status === "saved") this.setStatus("saving");
    if (this.entries.length >= this.o.maxEntries && this.status !== "error") {
      this.flush();
      return;
    }
    if (this.commitTimer === null && this.status !== "error") {
      this.commitTimer = this.o.setTimer(() => {
        this.commitTimer = null;
        this.flush();
      }, this.o.windowMs);
    }
  }

  /** Commits everything now. Returns true when nothing is left pending. */
  flush(): boolean {
    this.clearCommitTimer();
    if (this.entries.length === 0) return true;
    const batch = this.entries;
    try {
      this.o.commit(batch);
    } catch (err) {
      this.lastError = err as Error;
      this.setStatus("error", this.lastError);
      this.commitTimer = this.o.setTimer(() => {
        this.commitTimer = null;
        this.flush();
      }, this.o.retryMs);
      return false;
    }
    this.entries = this.entries.slice(batch.length);
    this.lastError = undefined;
    if (this.entries.length) {
      this.setStatus("saving");
      this.commitTimer = this.o.setTimer(() => {
        this.commitTimer = null;
        this.flush();
      }, this.o.windowMs);
    } else this.setStatus("saved");
    return this.entries.length === 0;
  }

  /** Stops timers; pending entries stay available. */
  dispose(): void {
    this.clearCommitTimer();
  }

  private clearCommitTimer(): void {
    if (this.commitTimer !== null) this.o.clearTimer(this.commitTimer);
    this.commitTimer = null;
  }

  private setStatus(status: SaveStatus, error?: Error): void {
    if (status === this.status && !error) return;
    this.status = status;
    this.o.onStatus?.(status, error);
  }
}
