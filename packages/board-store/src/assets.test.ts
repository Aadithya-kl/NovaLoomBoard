import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeObject, type StoreOp } from "@novaloom/board-engine/persist";
import type { ImageObject } from "@novaloom/board-engine";
import { imageBounds } from "../../board-engine/src/objects";
import { BoardFile, SCHEMA_VERSION } from "./board-file";
import { Library } from "./library";

let dir: string;
const open: BoardFile[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nlboard-assets-"));
});
afterEach(() => {
  open.splice(0).forEach((f) => f.close());
  fs.rmSync(dir, { recursive: true, force: true });
});

const A = "a".repeat(64);
const B = "b".repeat(64);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function image(id: string, asset: string): ImageObject {
  const base = { id, type: "image" as const, asset, cx: 10, cy: 10, width: 40, height: 20, rotation: 0 };
  return { ...base, bounds: imageBounds(base) };
}
const put = (id: string, asset: string, z = 0): StoreOp => ({ op: "put", page: "p1", object: encodeObject(image(id, asset), z) });

function create(name = "b.nlboard"): BoardFile {
  const f = BoardFile.create(path.join(dir, name), { boardId: "b", title: "t" });
  open.push(f);
  return f;
}

describe("images in board files", () => {
  it("stores each image once and reads it back byte for byte", () => {
    const f = create();
    f.putAsset(A, "image/png", PNG);
    f.putAsset(A, "image/png", PNG); // the same image again: still one copy
    expect(f.assetIds()).toEqual([A]);
    expect(f.getAsset(A)).toEqual({ mime: "image/png", data: PNG });
    expect(f.getAsset(B)).toBeNull();
  });

  it("verification flags an image object whose pixels are missing", () => {
    const f = create();
    f.putAsset(A, "image/png", PNG);
    f.commit([{ seq: 1, ops: [put("i1", A)] }]);
    expect(f.verify()).toEqual([]);
    f.commit([{ seq: 2, ops: [put("i2", B, 1)] }]);
    expect(f.verify().join()).toMatch(/i2: image data missing/);
  });

  it("removes only images that nothing refers to", () => {
    const f = create();
    f.putAsset(A, "image/png", PNG);
    f.putAsset(B, "image/png", PNG);
    f.commit([{ seq: 1, ops: [put("i1", A)] }]);
    expect(f.deleteUnusedAssets()).toBe(1);
    expect(f.assetIds()).toEqual([A]);
    // Two objects sharing one image: deleting one keeps it.
    f.commit([{ seq: 2, ops: [put("i2", A, 1), { op: "delete", id: "i1" }] }]);
    expect(f.deleteUnusedAssets()).toBe(0);
    f.commit([{ seq: 3, ops: [{ op: "delete", id: "i2" }] }]);
    expect(f.deleteUnusedAssets()).toBe(1);
    expect(f.assetIds()).toEqual([]);
  });

  it("upgrades a version 2 file to add the image store", () => {
    const p = path.join(dir, "v2.nlboard");
    BoardFile.create(p, { boardId: "b", title: "t" }).close();
    // Turn it into a version 2 file.
    const db = new DatabaseSync(p);
    db.exec("DROP TABLE assets; PRAGMA user_version = 2;");
    db.close();
    const ro = BoardFile.open(p, { readOnly: true });
    expect(ro.verify()).toEqual([]);
    expect(ro.getAsset(A)).toBeNull();
    ro.close();
    const f = BoardFile.open(p);
    open.push(f);
    f.putAsset(A, "image/png", PNG);
    expect(f.getAsset(A)?.data).toEqual(PNG);
    const v = new DatabaseSync(p, { readOnly: true });
    expect((v.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    v.close();
  });

  it("library: cleans unused images on open, keeps images in snapshots, copies them on import", () => {
    const lib = new Library(dir);
    const id = lib.createBoard("Pictures");
    const a = lib.openBoard(id);
    a.file.putAsset(A, "image/png", PNG);
    a.file.putAsset(B, "image/png", PNG); // imported then undone: nothing refers to it
    a.file.commit([{ seq: 1, ops: [put("i1", A)] }]);
    const snap = lib.snapshot(a, "manual");
    lib.closeBoard(a);

    const b = lib.openBoard(id);
    expect(b.file.assetIds()).toEqual([A]);
    const dest = path.join(dir, "copy.nlboard");
    lib.exportCopy(b, dest);
    lib.closeBoard(b);
    expect(lib.verifySnapshot(snap.path)).toBe(true);

    const imported = lib.openBoard(lib.importCopy(dest));
    expect(imported.file.getAsset(A)?.data).toEqual(PNG);
    expect(imported.file.verify()).toEqual([]);
    lib.closeBoard(imported);

    // Damage the board: the snapshot brings the image back with its object.
    const p = lib.boardPath(id);
    const bytes = fs.readFileSync(p);
    bytes.fill(0xab, 100);
    fs.writeFileSync(p, bytes);
    const c = lib.openBoard(id);
    expect(c.recovery?.kind).toBe("restored-snapshot");
    expect(c.objects.map((o) => o.id)).toEqual(["i1"]);
    expect(c.file.getAsset(A)?.data).toEqual(PNG);
    lib.closeBoard(c);
  });
});
