import { describe, expect, it } from "vitest";
import { pointsBounds } from "./geometry";
import type { StrokeObject } from "./model";
import { History, pickRedo, pickUndo } from "./history";
import { invertChange, pageLabel, PageList, type PageChange } from "./pages";
import { encodeObject, type PagePayload, type StoreOp } from "./persist";

function stroke(id: string, x = 0): StrokeObject {
  const points = [x, 0, 0.5, x + 10, 10, 0.5];
  return { id, type: "stroke", tool: "pen", style: { color: "#123456", size: 4, opacity: 1 }, points, simulatePressure: true, bounds: pointsBounds(points, 4) };
}

function payload(...pages: { id: string; name?: string; objects?: StrokeObject[] }[]): PagePayload[] {
  return pages.map((p) => ({
    id: p.id,
    name: p.name ?? "",
    background: "grid",
    view: null,
    objects: (p.objects ?? []).map((o, i) => encodeObject(o, i)),
  }));
}

const ids = (list: PageList) => list.all.map((p) => p.id);
const kinds = (ops: StoreOp[]) => ops.map((o) => o.op);

describe("PageList", () => {
  it("loads pages in order with their objects and falls back to the first page", () => {
    const { list, skipped } = PageList.fromPayload(payload({ id: "a", objects: [stroke("s1")] }, { id: "b" }), "missing");
    expect(skipped).toBe(0);
    expect(ids(list)).toEqual(["a", "b"]);
    expect(list.active.id).toBe("a");
    expect(list.get("a")!.objects.map((o) => o.id)).toEqual(["s1"]);
  });

  it("skips objects that fail validation", () => {
    const pages = payload({ id: "a", objects: [stroke("s1")] });
    pages[0]!.objects.push({ id: "bad", type: "stroke", z: 5, data: "{", points: new Uint8Array() });
    const { list, skipped } = PageList.fromPayload(pages, "a");
    expect(skipped).toBe(1);
    expect(list.active.objects).toHaveLength(1);
  });

  it("adds a page after the active one; the new page is written before anything refers to it", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }), "a");
    const { page, ops } = list.add({ background: "dots", view: { x: 1, y: 2, zoom: 3 } });
    expect(ids(list)).toEqual(["a", page.id, "b"]);
    expect(ops[0]).toEqual({ op: "putPage", page: { id: page.id, position: 1, name: "", background: "dots", view: { x: 1, y: 2, zoom: 3 } } });
    // b moved from index 1 to 2.
    expect(ops).toContainEqual({ op: "updatePage", id: "b", position: 2 });
    expect(page.objects).toEqual([]);
    expect(page.history.canUndo).toBe(false);
  });

  it("duplicates a page with new object ids, same content and settings", () => {
    const { list } = PageList.fromPayload(payload({ id: "a", name: "Plan", objects: [stroke("s1"), stroke("s2", 50)] }, { id: "b" }), "b");
    const src = list.get("a")!;
    src.background = "ruled";
    src.view = { x: 9, y: 8, zoom: 2 };
    const { page, ops } = list.duplicate("a", src.objects);
    expect(ids(list)).toEqual(["a", page.id, "b"]);
    expect(page).toMatchObject({ name: "Plan (copy)", background: "ruled", view: { x: 9, y: 8, zoom: 2 } });
    expect(page.objects.map((o) => o.id)).not.toContain("s1");
    expect(page.objects.map((o) => (o as StrokeObject).points)).toEqual(src.objects.map((o) => (o as StrokeObject).points));
    expect(kinds(ops)[0]).toBe("putPage");
    const puts = ops.filter((o): o is Extract<StoreOp, { op: "put" }> => o.op === "put");
    expect(puts).toHaveLength(2);
    expect(puts.every((p) => p.page === page.id)).toBe(true);
    // Bottom-to-top order is kept.
    expect(puts[0]!.object.z).toBeLessThan(puts[1]!.object.z);
    // Each page has its own history: the copy starts with none.
    expect(page.history).not.toBe(src.history);
  });

  it("an unnamed page's copy stays unnamed (numbered by position)", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }), "a");
    expect(list.duplicate("a", []).page.name).toBe("");
  });

  it("deletes a page, activating its neighbour, and never deletes the last page", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }, { id: "c" }), "b");
    const r1 = list.remove("b");
    expect(r1.activated?.id).toBe("c");
    expect(r1.ops[0]).toEqual({ op: "deletePage", id: "b" });
    expect(ids(list)).toEqual(["a", "c"]);
    const r2 = list.remove("c");
    expect(r2.activated?.id).toBe("a"); // the last page: the previous one becomes active
    expect(list.remove("a")).toEqual({ ops: [], activated: null });
    expect(ids(list)).toEqual(["a"]);
  });

  it("deleting another page keeps the active one", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }), "a");
    expect(list.remove("b").activated).toBeNull();
    expect(list.active.id).toBe("a");
  });

  it("reorders pages and writes only the positions that changed", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }), "a");
    list.move(0, 3); // first write: every page gets its position
    expect(ids(list)).toEqual(["b", "c", "d", "a"]);
    const ops = list.move(3, 2);
    expect(ids(list)).toEqual(["b", "c", "a", "d"]);
    expect(ops).toEqual([
      { op: "updatePage", id: "a", position: 2 },
      { op: "updatePage", id: "d", position: 3 },
    ]);
    expect(list.move(1, 1)).toEqual([]);
    expect(list.active.id).toBe("a");
  });

  it("renames pages; an empty name falls back to the page number", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }), "a");
    expect(list.rename("b", "  Mind   map  ")).toEqual([{ op: "updatePage", id: "b", name: "Mind map" }]);
    expect(list.rename("b", "Mind map")).toEqual([]);
    expect(pageLabel(list.get("b")!, 1)).toBe("Mind map");
    list.rename("b", "   ");
    expect(pageLabel(list.get("b")!, 1)).toBe("Page 2");
    expect(list.rename("a", "x".repeat(300))[0]).toMatchObject({ name: "x".repeat(100) });
  });

  it("records background and view per page, writing only real changes", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }), "a");
    expect(list.setBackground("b", "dots")).toEqual([{ op: "updatePage", id: "b", background: "dots" }]);
    expect(list.setBackground("b", "dots")).toEqual([]);
    expect(list.get("a")!.background).toBe("grid");
    expect(list.setView("a", { x: 1, y: 1, zoom: 1 })).toHaveLength(1);
    expect(list.setView("a", { x: 1, y: 1, zoom: 1 })).toEqual([]);
    expect(list.get("b")!.view).toBeNull();
  });

  it("keeps an independent undo history and z-order per page", () => {
    const { list } = PageList.fromPayload(payload({ id: "a", objects: [stroke("s1")] }, { id: "b" }), "a");
    const a = list.get("a")!;
    const b = list.get("b")!;
    a.history.push([{ kind: "add", object: stroke("s2"), index: 1 }]);
    expect(a.history.canUndo).toBe(true);
    expect(b.history.canUndo).toBe(false);
    const put = b.tracker.apply([{ kind: "add", object: stroke("t1"), index: 0 }])[0];
    expect(put).toMatchObject({ op: "put", page: "b" });
  });
});

describe("page undo building blocks", () => {
  it("stamps increase across histories and move with entries between the stacks", () => {
    const a = new History<string>();
    const b = new History<string>();
    a.push("a1");
    b.push("b1");
    a.push("a2");
    expect(a.undoStamp!).toBeGreaterThan(b.undoStamp!);
    const s = a.undoStamp;
    a.undo();
    expect(a.redoStamp).toBe(s);
    a.redo();
    expect(a.undoStamp).toBe(s);
    a.undo();
    a.push("a3"); // a new action drops the redo stack
    expect(a.canRedo).toBe(false);
  });

  it("undo picks the more recent history; redo the earlier undone action", () => {
    expect(pickUndo(undefined, undefined)).toBeNull();
    expect(pickUndo(3, undefined)).toBe("a");
    expect(pickUndo(undefined, 3)).toBe("b");
    expect(pickUndo(3, 5)).toBe("b");
    expect(pickUndo(5, 3)).toBe("a");
    expect(pickRedo(3, 5)).toBe("a");
    expect(pickRedo(5, 3)).toBe("b");
    expect(pickRedo(undefined, 3)).toBe("b");
  });

  it("removing and re-inserting a page restores it exactly, at its position", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b", name: "Bee", objects: [stroke("s1"), stroke("s2", 30)] }, { id: "c" }), "b");
    const page = list.get("b")!;
    page.background = "ruled";
    page.view = { x: 1, y: 2, zoom: 3 };
    page.history.push([]);
    const history = page.history;
    const del: PageChange = { kind: "remove", page, index: 1, show: "c" };
    const r1 = list.apply(del)!;
    expect(ids(list)).toEqual(["a", "c"]);
    expect(r1.show).toBe("c");
    expect(r1.ops[0]).toEqual({ op: "deletePage", id: "b" });

    const r2 = list.apply(invertChange(del))!;
    expect(ids(list)).toEqual(["a", "b", "c"]);
    expect(r2.show).toBe("b");
    const restored = list.get("b")!;
    expect(restored).toMatchObject({ name: "Bee", background: "ruled", view: { x: 1, y: 2, zoom: 3 } });
    expect(restored.objects.map((o) => o.id)).toEqual(["s1", "s2"]);
    expect(restored.history).toBe(history);
    // The page row is written before its objects, which keep their order.
    expect(r2.ops[0]).toMatchObject({ op: "putPage", page: { id: "b", position: 1, name: "Bee", background: "ruled" } });
    const puts = r2.ops.filter((o): o is Extract<StoreOp, { op: "put" }> => o.op === "put");
    expect(puts.map((p) => [p.object.id, p.page])).toEqual([
      ["s1", "b"],
      ["s2", "b"],
    ]);
    expect(puts[0]!.object.z).toBeLessThan(puts[1]!.object.z);
  });

  it("inverts renames and moves, and refuses steps that no longer match", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }, { id: "c" }), "a");
    const rename: PageChange = { kind: "rename", id: "b", from: "", to: "Two" };
    list.apply(rename);
    expect(list.get("b")!.name).toBe("Two");
    list.apply(invertChange(rename));
    expect(list.get("b")!.name).toBe("");
    const move: PageChange = { kind: "move", id: "a", from: 0, to: 2 };
    list.apply(move);
    expect(ids(list)).toEqual(["b", "c", "a"]);
    list.apply(invertChange(move));
    expect(ids(list)).toEqual(["a", "b", "c"]);
    expect(list.apply({ kind: "rename", id: "zz", from: "", to: "x" })).toBeNull();
    expect(list.apply({ kind: "insert", page: list.get("a")!, index: 0, show: "a" })).toBeNull();
  });
});

describe("inserting several pages at once", () => {
  it("adds pages that already hold objects, and undoes/redoes them as one step", () => {
    const { list } = PageList.fromPayload(payload({ id: "a" }, { id: "b" }), "a");
    const changes: PageChange[] = [];
    const ops: StoreOp[] = [];
    for (const [i, name] of ["Doc (1)", "Doc (2)"].entries()) {
      const r = list.addWithObjects({ background: "blank", view: null, name }, [stroke(`s${i}`)], 1 + i);
      ops.push(...r.ops);
      changes.push({ kind: "insert", page: r.page, index: 1 + i, show: "a" });
    }
    const ids2 = changes.map((c) => (c.kind === "insert" ? c.page.id : ""));
    expect(ids(list)).toEqual(["a", ...ids2, "b"]);
    // Each page row is written before its objects.
    const firstPut = ops.findIndex((o) => o.op === "put");
    expect(ops.slice(0, firstPut).some((o) => o.op === "putPage")).toBe(true);
    expect(ops.filter((o) => o.op === "put").map((o) => (o as Extract<StoreOp, { op: "put" }>).page)).toEqual(ids2);

    const batch: PageChange = { kind: "batch", changes, show: "a" };
    const undo = list.apply(invertChange(batch))!;
    expect(ids(list)).toEqual(["a", "b"]);
    expect(undo.show).toBe("a");
    const redo = list.apply(batch)!;
    expect(ids(list)).toEqual(["a", ...ids2, "b"]);
    expect(redo.show).toBe(ids2[0]);
    expect(list.get(ids2[1]!)!.objects.map((o) => o.id)).toEqual(["s1"]);
    expect(list.get(ids2[0]!)!.name).toBe("Doc (1)");
  });
});
