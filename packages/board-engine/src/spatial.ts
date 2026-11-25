import RBush from "rbush";
import type { BoardObject, Bounds } from "./model";

interface Entry extends Bounds {
  id: string;
}

/** R-tree of object bounds for culling and hit-testing. */
export class SpatialIndex {
  private tree = new RBush<Entry>();
  private entries = new Map<string, Entry>();

  insert(object: BoardObject): void {
    if (this.entries.has(object.id)) return;
    const entry: Entry = { ...object.bounds, id: object.id };
    this.entries.set(object.id, entry);
    this.tree.insert(entry);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.tree.remove(entry);
    this.entries.delete(id);
  }

  search(bounds: Bounds): string[] {
    return this.tree.search(bounds).map((e) => e.id);
  }

  clear(): void {
    this.tree.clear();
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
