import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeObject, encodeObject, type StoreOp } from "@novaloom/board-engine/persist";
import type { BoardObject, StrokeObject, TextObject } from "@novaloom/board-engine";
import { pointsBounds } from "../../board-engine/src/geometry";
import { textBounds } from "../../board-engine/src/objects";
import { Library } from "./library";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nlboard-editing-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const stroke = (id: string, extra: Partial<StrokeObject> = {}): StrokeObject => {
  const points = [0, 0, 0.5, 10, 10, 0.5];
  return { id, type: "stroke", tool: "pen", style: { color: "#112233", size: 4, opacity: 1 }, points, simulatePressure: true, bounds: pointsBounds(points, 4), ...extra };
};
const box: TextObject = {
  id: "t",
  type: "text",
  x: 0,
  y: 0,
  width: 180,
  height: 72,
  text: "Bonjour à tous — مرحبا بالجميع",
  rotation: 0.3,
  style: { color: "#1e293b", fontSize: 28, bold: false, italic: false, align: "right" },
  boxWidth: 180,
  group: "g1",
  bounds: textBounds({ x: 0, y: 0, width: 180, height: 72, rotation: 0.3 }),
};
const put = (o: BoardObject, z: number): StoreOp => ({ op: "put", page: "p1", object: encodeObject(o, z) });

describe("groups, locks and text boxes in board files", () => {
  it("survive an unclean exit, and Open (import) keeps them", () => {
    const lib = new Library(dir);
    const id = lib.createBoard("Editing");
    const a = lib.openBoard(id);
    a.file.commit([{ seq: 1, ops: [put(stroke("s1", { group: "g1" }), 0), put(stroke("s2", { locked: true }), 1), put(box, 2)] }]);
    // Crash: never closed.
    const b = new Library(dir).openBoard(id);
    expect(b.recovery?.kind).toBe("unclean-exit");
    const objs = b.objects.map((o) => decodeObject(o));
    expect(objs.map((o) => [o.id, o.group ?? null, o.locked ?? false])).toEqual([
      ["s1", "g1", false],
      ["s2", null, true],
      ["t", "g1", false],
    ]);
    expect((objs[2] as TextObject).boxWidth).toBe(180);
    expect((objs[2] as TextObject).text).toBe("Bonjour à tous — مرحبا بالجميع");
    const copy = path.join(dir, "copy.nlboard");
    lib.exportCopy(b, copy);
    a.file.close();
    lib.closeBoard(b);
    const c = lib.openBoard(lib.importCopy(copy));
    expect(c.objects.map((o) => decodeObject(o)).map((o) => [o.id, o.group ?? null, o.locked ?? false])).toEqual([
      ["s1", "g1", false],
      ["s2", null, true],
      ["t", "g1", false],
    ]);
    lib.closeBoard(c);
  });
});
