import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { decodeObject, type StoreOp } from "@novaloom/board-engine/persist";
import { BoardFile, BoardUnavailableError, DEFAULT_PAGE, FILE_EXT, isUnavailable, type BoardMeta, type CommitEntry, type PagedObject } from "./board-file";

const SNAP_EXT = ".nlsnap";
export const MAX_AUTO_SNAPSHOTS = 30;

export type SnapshotReason = "auto" | "close" | "before-clear" | "before-delete-page" | "manual";

export interface SnapshotInfo {
  path: string;
  createdAt: number;
  reason: SnapshotReason;
}

export interface RecentBoard {
  id: string;
  title: string;
  modifiedAt: number;
}

interface LibraryState {
  lastBoardId?: string;
  recent: RecentBoard[];
}

/** What happened while opening a board, shown to the user. */
export type RecoveryReport =
  | { kind: "unclean-exit"; lastSavedAt: number }
  | { kind: "restored-snapshot"; snapshotAt: number; damagedPath: string; problems: string[] }
  | { kind: "damaged-no-backup"; damagedPath: string; problems: string[] };

export interface OpenedBoard {
  id: string;
  file: BoardFile;
  meta: BoardMeta;
  /** Objects of every page. */
  objects: PagedObject[];
  recovery?: RecoveryReport;
}

/**
 * Boards on disk:
 *   <root>/boards/<id>.nlboard        live board files
 *   <root>/boards/<id>.nlboard.open   marker present while a board is open
 *   <root>/damaged/                   files that failed verification
 *   <root>/snapshots/<id>/<ts>-<reason>.nlsnap   verified copies
 *   <root>/library.json               recents and last opened board
 */
export class Library {
  readonly boardsDir: string;
  readonly damagedDir: string;
  readonly snapshotsDir: string;
  private readonly statePath: string;

  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
  ) {
    this.boardsDir = path.join(root, "boards");
    this.damagedDir = path.join(root, "damaged");
    this.snapshotsDir = path.join(root, "snapshots");
    this.statePath = path.join(root, "library.json");
    for (const d of [this.boardsDir, this.damagedDir, this.snapshotsDir]) fs.mkdirSync(d, { recursive: true });
  }

  boardPath(id: string): string {
    return path.join(this.boardsDir, `${safeId(id)}${FILE_EXT}`);
  }

  exists(id: string): boolean {
    return fs.existsSync(this.boardPath(id));
  }

  // ---------- state ----------

  get lastBoardId(): string | undefined {
    const id = this.readState().lastBoardId;
    return id && this.exists(id) ? id : undefined;
  }

  recent(): RecentBoard[] {
    return this.readState().recent.filter((r) => this.exists(r.id));
  }

  /** Records a board as most recently used. */
  touch(meta: Pick<BoardMeta, "boardId" | "title" | "modifiedAt">): void {
    const state = this.readState();
    state.lastBoardId = meta.boardId;
    state.recent = [
      { id: meta.boardId, title: meta.title, modifiedAt: meta.modifiedAt },
      ...state.recent.filter((r) => r.id !== meta.boardId),
    ].slice(0, 20);
    this.writeState(state);
  }

  private readState(): LibraryState {
    try {
      const s = JSON.parse(fs.readFileSync(this.statePath, "utf8")) as Partial<LibraryState>;
      return {
        lastBoardId: typeof s.lastBoardId === "string" ? s.lastBoardId : undefined,
        recent: Array.isArray(s.recent) ? s.recent.filter((r) => r && typeof r.id === "string") : [],
      };
    } catch {
      return { recent: [] };
    }
  }

  private writeState(state: LibraryState): void {
    writeFileAtomic(this.statePath, JSON.stringify(state, null, 2));
  }

  // ---------- boards ----------

  createBoard(title = "Untitled board"): string {
    const id = randomUUID();
    BoardFile.create(this.boardPath(id), { boardId: id, title, now: this.now() }).close();
    return id;
  }

  /**
   * Opens a board for editing. A leftover open-marker means the previous
   * session did not close cleanly; the file is then checked like any open,
   * and the report tells the user. A file that fails the check is moved to
   * `damaged/` and replaced by its newest verified snapshot when one exists.
   * A file that only cannot be opened right now (newer version, locked,
   * read-only) is left untouched and {@link BoardUnavailableError} is thrown.
   */
  openBoard(id: string): OpenedBoard {
    const filePath = this.boardPath(id);
    const marker = `${filePath}.open`;
    const unclean = fs.existsSync(marker);

    let file: BoardFile | null = null;
    let problems: string[] = [];
    try {
      file = BoardFile.open(filePath);
      problems = file.verify();
    } catch (err) {
      file?.close();
      if (isUnavailable(err)) throw err instanceof BoardUnavailableError ? err : new BoardUnavailableError((err as Error).message);
      problems = [(err as Error).message];
    }

    let recovery: RecoveryReport | undefined;
    if (problems.length) {
      file?.close();
      file = null;
      const damagedPath = this.quarantine(id);
      const snap = this.listSnapshots(id).find((s) => this.verifySnapshot(s.path));
      if (snap) {
        fs.copyFileSync(snap.path, filePath);
        file = BoardFile.open(filePath);
        recovery = { kind: "restored-snapshot", snapshotAt: snap.createdAt, damagedPath, problems };
      } else {
        file = BoardFile.create(filePath, { boardId: id, title: "Recovered board", now: this.now() });
        recovery = { kind: "damaged-no-backup", damagedPath, problems };
      }
    }

    const meta = file!.readMeta();
    if (!recovery && unclean) recovery = { kind: "unclean-exit", lastSavedAt: meta.modifiedAt };
    try {
      // No undo history exists yet, so images nothing refers to can go.
      file!.deleteUnusedAssets();
    } catch (err) {
      console.error("[storage] could not remove unused images:", err);
    }
    writeFileAtomic(marker, JSON.stringify({ pid: process.pid, openedAt: this.now() }));
    this.touch(meta);
    return { id, file: file!, meta, objects: file!.readObjects(), recovery };
  }

  /** Clean close: checkpoint, close, remove the marker. */
  closeBoard(board: OpenedBoard): void {
    const meta = board.file.readMeta();
    board.file.checkpoint("TRUNCATE");
    board.file.close();
    fs.rmSync(`${board.file.path}.open`, { force: true });
    this.touch(meta);
  }

  private quarantine(id: string): string {
    const src = this.boardPath(id);
    const dest = path.join(this.damagedDir, `${safeId(id)}-${this.now()}${FILE_EXT}`);
    for (const suffix of ["", "-wal", "-shm"]) {
      if (fs.existsSync(src + suffix)) fs.renameSync(src + suffix, dest + suffix);
    }
    return dest;
  }

  // ---------- snapshots ----------

  /**
   * Writes a verified snapshot: VACUUM INTO a temporary file, verify the
   * copy, then rename. A snapshot that fails verification is deleted and
   * never offered. Keeps the newest {@link MAX_AUTO_SNAPSHOTS} automatic ones.
   */
  snapshot(board: OpenedBoard, reason: SnapshotReason): SnapshotInfo {
    const dir = path.join(this.snapshotsDir, safeId(board.id));
    fs.mkdirSync(dir, { recursive: true });
    let createdAt = this.now();
    // Keep names unique even when two snapshots land in the same millisecond.
    while (fs.existsSync(path.join(dir, `${createdAt}-${reason}${SNAP_EXT}`))) createdAt++;
    const final = path.join(dir, `${createdAt}-${reason}${SNAP_EXT}`);
    const tmp = `${final}.tmp`;
    fs.rmSync(tmp, { force: true });
    board.file.vacuumInto(tmp);
    if (!this.verifySnapshot(tmp)) {
      fs.rmSync(tmp, { force: true });
      throw new Error("snapshot failed verification");
    }
    fs.renameSync(tmp, final);
    this.pruneSnapshots(board.id);
    return { path: final, createdAt, reason };
  }

  /** Snapshots of a board, newest first. */
  listSnapshots(id: string): SnapshotInfo[] {
    const dir = path.join(this.snapshotsDir, safeId(id));
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((name) => {
        const m = /^(\d+)-(auto|close|before-clear|before-delete-page|manual)\.nlsnap$/.exec(name);
        return m ? { path: path.join(dir, name), createdAt: Number(m[1]), reason: m[2] as SnapshotReason } : null;
      })
      .filter((s): s is SnapshotInfo => s !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  verifySnapshot(file: string): boolean {
    try {
      const f = BoardFile.open(file, { readOnly: true });
      try {
        return f.verify().length === 0;
      } finally {
        f.close();
      }
    } catch {
      return false;
    }
  }

  private pruneSnapshots(id: string): void {
    const auto = this.listSnapshots(id).filter((s) => s.reason !== "manual");
    for (const s of auto.slice(MAX_AUTO_SNAPSHOTS)) fs.rmSync(s.path, { force: true });
  }

  // ---------- import / export ----------

  /**
   * Imports a board file as a new board. The source is never modified: it is
   * copied to a temporary file, verified, and its objects are re-validated and
   * rebuilt into a fresh file with a new id.
   */
  importCopy(sourcePath: string, title?: string): string {
    const tmp = path.join(this.root, `import-${this.now()}.tmp`);
    fs.copyFileSync(sourcePath, tmp);
    for (const suffix of ["-wal"]) {
      if (fs.existsSync(sourcePath + suffix)) fs.copyFileSync(sourcePath + suffix, tmp + suffix);
    }
    try {
      const src = BoardFile.open(tmp);
      let meta: BoardMeta;
      let objects: PagedObject[];
      const images = new Map<string, { mime: string; data: Uint8Array }>();
      try {
        const problems = src.verify();
        if (problems.length) throw new Error(`the file is damaged (${problems[0]})`);
        meta = src.readMeta();
        objects = src.readObjects();
        for (const o of objects) {
          const obj = decodeObject(o);
          if (obj.type === "image" && !images.has(obj.asset)) images.set(obj.asset, src.getAsset(obj.asset)!);
        }
      } finally {
        src.close();
      }
      const id = randomUUID();
      const dest = BoardFile.create(this.boardPath(id), { boardId: id, title: (title ?? meta.title).slice(0, 100), now: this.now() });
      try {
        for (const [assetId, a] of images) dest.putAsset(assetId, a.mime, a.data);
        const ops: StoreOp[] = meta.pages.map((page) => ({ op: "putPage", page }));
        if (!meta.pages.some((p) => p.id === DEFAULT_PAGE)) ops.push({ op: "deletePage", id: DEFAULT_PAGE });
        for (const o of objects) {
          decodeObject(o);
          const { page, ...object } = o;
          ops.push({ op: "put", page, object });
        }
        dest.commit([{ seq: 1, ops, props: { activePage: meta.activePage } }]);
        dest.checkpoint("TRUNCATE");
      } finally {
        dest.close();
      }
      return id;
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(tmp + suffix, { force: true });
    }
  }

  /**
   * Writes a standalone copy of an open board to `destPath`, including
   * changes not yet committed. Written to a temporary file next to the
   * destination and renamed only after verification, so an existing file is
   * never left half-written.
   */
  exportCopy(board: OpenedBoard, destPath: string, pending: readonly CommitEntry[] = []): void {
    const tmp = `${destPath}.${process.pid}.tmp`;
    fs.rmSync(tmp, { force: true });
    try {
      board.file.vacuumInto(tmp);
      if (pending.length) {
        const copy = BoardFile.open(tmp);
        try {
          copy.commit(pending, this.now());
          copy.checkpoint("TRUNCATE");
        } finally {
          copy.close();
        }
        // Fold the WAL back so the exported copy is a single file.
        fs.rmSync(`${tmp}-wal`, { force: true });
        fs.rmSync(`${tmp}-shm`, { force: true });
      }
      if (!this.verifySnapshot(tmp)) throw new Error("the copy failed verification");
      fs.renameSync(tmp, destPath);
      // A file replaced here may have left a write-ahead log behind (it was not
      // closed cleanly); it belongs to the old file and must not be applied to the copy.
      for (const suffix of ["-wal", "-shm"]) fs.rmSync(destPath + suffix, { force: true });
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(tmp + suffix, { force: true });
    }
  }
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) throw new Error(`invalid board id "${id}"`);
  return id;
}

/** temp file + fsync + rename. */
export function writeFileAtomic(file: string, data: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
