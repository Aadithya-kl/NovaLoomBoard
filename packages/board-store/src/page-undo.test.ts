/**
 * Undo/redo of page operations through the real Persistence class (the
 * window's board model), with a minimal engine stand-in that keeps the
 * engine's undo rules (pickUndo/pickRedo over its page history and the
 * external page-operation history). Everything Persistence saves is
 * committed to a real board file, which must reopen in the same state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Background, BoardEngine, BoardObject, DocumentChange, ExternalHistory, ImageObject, LoadedDocument, StrokeObject } from "@novaloom/board-engine";
import { imageBounds } from "../../board-engine/src/objects";
import { validateOps, validateProps, type BoardProps, type DesktopBridge, type StoreOp } from "@novaloom/board-engine/persist";
import { History, pickRedo, pickUndo } from "../../board-engine/src/history";
import { createPage } from "../../board-engine/src/model";
import { applyOps, invertBatch, type Batch } from "../../board-engine/src/ops";
import { Persistence } from "../../../apps/web/src/persistence";
import { BoardFile } from "./board-file";

let dir: string;
const openFiles: BoardFile[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nlboard-undo-"));
});
afterEach(() => {
  openFiles.splice(0).forEach((f) => f.close());
  fs.rmSync(dir, { recursive: true, force: true });
});

function stroke(id: string, x = 0): StrokeObject {
  const points = [x, 0, 0.5, x + 10, 10, 0.5];
  return { id, type: "stroke", tool: "pen", style: { color: "#123456", size: 4, opacity: 1 }, points, simulatePressure: true, bounds: { minX: x - 2, minY: -2, maxX: x + 12, maxY: 12 } };
}

/** The parts of BoardEngine that Persistence uses, with the same undo rules. */
class FakeEngine {
  page = createPage();
  view = { x: 0, y: 0, zoom: 1 };
  background: Background = "grid";
  history = new History();
  external: ExternalHistory | null = null;
  readonly isInteracting = false;
  private listeners = new Set<(c: DocumentChange) => void>();

  getObjects = (): BoardObject[] => this.page.order.map((id) => this.page.objects.get(id)!);
  getView = () => ({ ...this.view });
  fitContent() {
    this.view = { x: -10, y: -20, zoom: 0.75 };
  }
  commitEdits() {}
  refreshHistory() {}
  setExternalHistory(e: ExternalHistory | null) {
    this.external = e;
  }
  onDocumentChange = (l: (c: DocumentChange) => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  loadDocument(doc: LoadedDocument) {
    this.page = createPage();
    applyOps(this.page, doc.objects.map((object) => ({ kind: "add" as const, object })));
    if (doc.background) this.background = doc.background;
    if (doc.view) this.view = { ...doc.view };
    this.history = doc.history ?? new History();
  }
  /** A user edit: recorded in the page's history and announced. */
  draw(object: BoardObject) {
    const batch = applyOps(this.page, [{ kind: "add", object }]);
    this.history.push(batch);
    this.external?.onEdit();
    this.emit(batch);
  }
  setBackground(background: Background) {
    this.background = background;
    this.listeners.forEach((l) => l({ kind: "background", background }));
  }
  undo() {
    if (pickUndo(this.history.undoStamp, this.external?.undoStamp) === "b") return this.external!.undo();
    const b = this.history.undo();
    if (b) this.emit(applyOps(this.page, invertBatch(b)));
  }
  redo() {
    if (pickRedo(this.history.redoStamp, this.external?.redoStamp) === "b") return this.external!.redo();
    const b = this.history.redo();
    if (b) this.emit(applyOps(this.page, b));
  }
  get canUndo() {
    return this.history.canUndo || this.external?.undoStamp !== undefined;
  }
  private emit(batch: Batch) {
    if (batch.length) this.listeners.forEach((l) => l({ kind: "objects", batch }));
  }
}

/** A board file plus a bridge that commits every save to it, in order, like the main process. */
async function openBoard() {
  const file = BoardFile.create(path.join(dir, "b.nlboard"), { boardId: "b", title: "t" });
  openFiles.push(file);
  let seq = 0;
  const bridge = {
    loadBoard: async () => ({
      boardId: "b",
      title: "t",
      pages: file.readMeta().pages.map((p) => ({ id: p.id, name: p.name, background: p.background, view: p.view, objects: [] })),
      activePage: file.readMeta().activePage,
    }),
    save: async (ops: StoreOp[], props?: BoardProps) => {
      file.commit([{ seq: ++seq, ops: validateOps(ops), props: validateProps(props) }]);
    },
    snapshot: async () => {},
    dismissNotice: () => {},
    onSaveStatus: () => () => {},
    onFlushRequest: () => () => {},
    onMenuCommand: () => () => {},
  } as unknown as DesktopBridge;
  const engine = new FakeEngine();
  const board = new Persistence(engine as unknown as BoardEngine, bridge);
  await board.start();
  /** Ids of every page's objects, in page order, as the window has them. */
  const windowState = () =>
    board.getState().pages.map((p) => ({ id: p.id, name: p.name, background: p.background, objects: board.pageObjects(p.id).map((o) => o.id) }));
  /** The same, read back from the file. */
  const fileState = async () => {
    await board.flush();
    await new Promise((r) => setTimeout(r, 0));
    const meta = file.readMeta();
    return {
      active: meta.activePage,
      pages: meta.pages.map((p) => ({ id: p.id, name: p.name, background: p.background, objects: file.readObjects(p.id).map((o) => o.id) })),
    };
  };
  const expectSaved = async () => {
    const f = await fileState();
    expect(f.pages).toEqual(windowState());
    expect(f.active).toBe(board.getState().activePage);
  };
  return { file, engine, board, windowState, expectSaved, active: () => board.getState().activePage };
}

function pdfPage(id: string, asset: string): ImageObject {
  const base = { id, type: "image" as const, asset, cx: 397, cy: 561.5, width: 794, height: 1123, rotation: 0, locked: true };
  return { ...base, bounds: imageBounds(base) };
}

describe("inserting imported PDF pages", () => {
  it("adds all pages after the current one in one undoable step, saved with their images, and back after reopening", async () => {
    const { engine, board, active, file, expectSaved } = await openBoard();
    const first = active();
    engine.draw(stroke("mine"));
    const A = "a".repeat(64);
    const B = "b".repeat(64);
    file.putAsset(A, "image/webp", new Uint8Array([1]));
    file.putAsset(B, "image/webp", new Uint8Array([2]));
    const ids = board.insertPages([
      { objects: [pdfPage("pdf1", A)], background: "blank", name: "Slides (1)" },
      { objects: [pdfPage("pdf2", B)], background: "blank", name: "Slides (2)" },
    ]);
    expect(board.getState().pages.map((p) => p.id)).toEqual([first, ...ids]);
    expect(active()).toBe(ids[0]);
    expect(engine.getObjects().map((o) => o.id)).toEqual(["pdf1"]);
    expect(engine.view).toEqual({ x: -10, y: -20, zoom: 0.75 }); // fitted
    await expectSaved();

    engine.draw(stroke("note")); // annotate the PDF page
    engine.undo(); // the note
    engine.undo(); // the whole import
    expect(board.getState().pages.map((p) => p.id)).toEqual([first]);
    expect(active()).toBe(first);
    expect(engine.getObjects().map((o) => o.id)).toEqual(["mine"]);
    await expectSaved();
    engine.redo();
    expect(board.getState().pages.map((p) => [p.id, p.name])).toEqual([
      [first, ""],
      [ids[0], "Slides (1)"],
      [ids[1], "Slides (2)"],
    ]);
    engine.draw(stroke("note2"));
    await expectSaved();

    await board.flush();
    file.close();
    openFiles.splice(openFiles.indexOf(file), 1);
    const g = BoardFile.open(path.join(dir, "b.nlboard"));
    try {
      expect(g.verify()).toEqual([]);
      const objs = g.readObjects(ids[0]!).map((o) => o.id);
      expect(objs).toEqual(["pdf1", "note2"]);
      const pdf1 = JSON.parse(g.readObjects(ids[0]!)[0]!.data) as { locked?: boolean; asset: string };
      expect(pdf1).toMatchObject({ locked: true, asset: A });
      expect(g.getAsset(B)).not.toBeNull();
    } finally {
      g.close();
    }
  });
});

describe("page operation undo/redo", () => {
  it("undoing a delete restores the page's objects, background, view, name, position and history", async () => {
    const { engine, board, active, expectSaved, file } = await openBoard();
    const first = active();
    board.addPage();
    const doomed = active();
    engine.draw(stroke("d1"));
    engine.draw(stroke("d2", 30));
    engine.setBackground("dots");
    engine.view = { x: 7, y: 8, zoom: 2 };
    board.renamePage(doomed, "Doomed");
    board.addPage();
    const after = active();
    board.goToPage(doomed);
    await board.deletePage(doomed);
    expect(board.getState().pages.map((p) => p.id)).toEqual([first, after]);
    await expectSaved();
    expect(file.readObjects(doomed)).toEqual([]);

    engine.undo();
    expect(board.getState().pages.map((p) => p.id)).toEqual([first, doomed, after]);
    expect(active()).toBe(doomed);
    expect(engine.getObjects().map((o) => o.id)).toEqual(["d1", "d2"]);
    expect(engine.background).toBe("dots");
    expect(engine.view).toEqual({ x: 7, y: 8, zoom: 2 });
    expect(board.getState().pages[1]!.name).toBe("Doomed");
    await expectSaved();

    // The restored page brought its own undo history back with it.
    expect(engine.history.canUndo).toBe(true);
    expect(engine.history.undoStamp).toBeDefined();

    engine.redo();
    expect(board.getState().pages.map((p) => p.id)).toEqual([first, after]);
    await expectSaved();
  });

  it("undo never removes drawings from another page: the current page's newer edits go first", async () => {
    const { engine, board, active } = await openBoard();
    const a = active();
    engine.draw(stroke("a1"));
    board.addPage();
    const b = active();
    engine.draw(stroke("b1"));
    board.renamePage(b, "B");
    board.goToPage(a);
    engine.draw(stroke("a2"));

    engine.undo(); // a2: the newest action on this page
    expect(engine.getObjects().map((o) => o.id)).toEqual(["a1"]);
    expect(board.pageObjects(b).map((o) => o.id)).toEqual(["b1"]);

    engine.undo(); // the rename (newer than a1)
    expect(board.getState().pages[1]!.name).toBe("");
    expect(board.pageObjects(b).map((o) => o.id)).toEqual(["b1"]);
    expect(board.pageObjects(a).map((o) => o.id)).toEqual(["a1"]);

    // Redo in the order things were done: the rename, then a2.
    engine.redo();
    expect(board.getState().pages[1]!.name).toBe("B");
    if (active() !== a) board.goToPage(a);
    engine.redo();
    expect(engine.getObjects().map((o) => o.id)).toEqual(["a1", "a2"]);
    // Page B's own history was never touched: on B, the rename (newer) goes first, then its stroke.
    board.goToPage(b);
    engine.undo();
    expect(board.getState().pages[1]!.name).toBe("");
    expect(engine.getObjects().map((o) => o.id)).toEqual(["b1"]);
    engine.undo();
    expect(engine.getObjects().map((o) => o.id)).toEqual([]);
    expect(board.getState().pages.map((p) => p.id)).toEqual([a, b]);
  });

  it("undoes and redoes add, duplicate, rename and reorder, persisting every step", async () => {
    const { engine, board, active, expectSaved } = await openBoard();
    const p1 = active();
    engine.draw(stroke("s1"));
    board.addPage();
    const p2 = active();
    board.duplicatePage(p1);
    const copy = active();
    expect(board.getState().pages.map((p) => p.id)).toEqual([p1, copy, p2]);
    board.movePage(0, 2);
    board.renamePage(p2, "Two");
    expect(board.getState().pages.map((p) => [p.id, p.name])).toEqual([
      [copy, ""],
      [p2, "Two"],
      [p1, ""],
    ]);
    await expectSaved();

    engine.undo(); // rename
    engine.undo(); // move
    expect(board.getState().pages.map((p) => [p.id, p.name])).toEqual([
      [p1, ""],
      [copy, ""],
      [p2, ""],
    ]);
    await expectSaved();
    engine.undo(); // duplicate: the copy goes, back to where the user was
    expect(board.getState().pages.map((p) => p.id)).toEqual([p1, p2]);
    expect(active()).toBe(p2);
    engine.undo(); // add
    expect(board.getState().pages.map((p) => p.id)).toEqual([p1]);
    expect(active()).toBe(p1);
    expect(engine.getObjects().map((o) => o.id)).toEqual(["s1"]); // drawing untouched
    await expectSaved();

    for (let i = 0; i < 4; i++) engine.redo();
    expect(board.getState().pages.map((p) => [p.id, p.name])).toEqual([
      [copy, ""],
      [p2, "Two"],
      [p1, ""],
    ]);
    expect(board.pageObjects(copy).length).toBe(1);
    await expectSaved();
  });

  it("a new edit ends what could be redone", async () => {
    const { engine, board, active } = await openBoard();
    board.addPage();
    const p2 = active();
    engine.undo(); // removes p2
    expect(board.getState().pages.map((p) => p.id)).not.toContain(p2);
    engine.draw(stroke("new"));
    engine.redo(); // nothing to redo: p2 stays gone
    expect(board.getState().pages.map((p) => p.id)).not.toContain(p2);
    expect(engine.getObjects().map((o) => o.id)).toEqual(["new"]);
  });

  it("a page operation ends what could be redone on the current page", async () => {
    const { engine, board } = await openBoard();
    engine.draw(stroke("s1"));
    engine.undo();
    expect(engine.history.canRedo).toBe(true);
    board.renamePage(board.getState().activePage, "X");
    expect(engine.history.canRedo).toBe(false);
  });

  it("the deleted page reopens from the file after a restart following undo", async () => {
    const { engine, board, active, file } = await openBoard();
    board.addPage();
    const p2 = active();
    engine.draw(stroke("keep"));
    await board.deletePage(p2);
    engine.undo();
    await board.flush();
    file.close();
    const g = BoardFile.open(path.join(dir, "b.nlboard"));
    expect(g.readMeta().pages.map((p) => p.id)).toContain(p2);
    expect(g.readObjects(p2).map((o) => o.id)).toEqual(["keep"]);
    expect(g.verify()).toEqual([]);
    g.close();
  });
});
