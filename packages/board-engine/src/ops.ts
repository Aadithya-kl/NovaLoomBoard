import type { BoardObject, Page } from "./model";

/** An operation as requested by a tool. `index` is optional for adds (append). */
export type Operation =
  | { kind: "add"; object: BoardObject; index?: number }
  | { kind: "remove"; object: BoardObject };

/** An operation after application, with the exact z-index it affected. */
export type ResolvedOp =
  | { kind: "add"; object: BoardObject; index: number }
  | { kind: "remove"; object: BoardObject; index: number };

export type Batch = ResolvedOp[];

/**
 * Applies operations in order and returns them with resolved indices, so the
 * result can be inverted exactly. Removing an object that is not on the page,
 * or adding a duplicate id, is skipped (and not recorded).
 */
export function applyOps(page: Page, ops: readonly (Operation | ResolvedOp)[]): Batch {
  const resolved: Batch = [];
  for (const op of ops) {
    if (op.kind === "add") {
      if (page.objects.has(op.object.id)) continue;
      const max = page.order.length;
      const index = op.index === undefined ? max : Math.max(0, Math.min(op.index, max));
      page.order.splice(index, 0, op.object.id);
      page.objects.set(op.object.id, op.object);
      resolved.push({ kind: "add", object: op.object, index });
    } else {
      const index = page.order.indexOf(op.object.id);
      if (index === -1) continue;
      page.order.splice(index, 1);
      page.objects.delete(op.object.id);
      resolved.push({ kind: "remove", object: op.object, index });
    }
  }
  return resolved;
}

/** Inverse of a resolved batch: reversed order, kinds swapped, same indices. */
export function invertBatch(batch: Batch): Batch {
  const inverse: Batch = [];
  for (let i = batch.length - 1; i >= 0; i--) {
    const op = batch[i]!;
    inverse.push(
      op.kind === "add"
        ? { kind: "remove", object: op.object, index: op.index }
        : { kind: "add", object: op.object, index: op.index },
    );
  }
  return inverse;
}
