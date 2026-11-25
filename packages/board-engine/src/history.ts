import type { Batch } from "./ops";

let lastStamp = 0;
/**
 * One increasing sequence shared by every history on the board (each page's
 * object history and the page-operation history), so the most recent action
 * across histories can be found by comparing stamps.
 */
export function nextStamp(): number {
  return ++lastStamp;
}

/**
 * Which of two histories undo should revert, given the stamps of their last
 * actions: the more recent one. Null when neither has anything.
 */
export function pickUndo(a: number | undefined, b: number | undefined): "a" | "b" | null {
  if (a === undefined) return b === undefined ? null : "b";
  return b !== undefined && b > a ? "b" : "a";
}

/** Which of two histories redo should re-apply: the action that was done first. */
export function pickRedo(a: number | undefined, b: number | undefined): "a" | "b" | null {
  if (a === undefined) return b === undefined ? null : "b";
  return b !== undefined && b < a ? "b" : "a";
}

interface Entry<T> {
  item: T;
  stamp: number;
}

/** Undo/redo stacks. Entries keep their stamp when they move between the stacks. */
export class History<T = Batch> {
  private undoStack: Entry<T>[] = [];
  private redoStack: Entry<T>[] = [];

  constructor(private readonly limit = 500) {}

  /** Records a new action; anything that could be redone is dropped. */
  push(item: T): void {
    if (Array.isArray(item) && item.length === 0) return;
    this.undoStack.push({ item, stamp: nextStamp() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the item to revert (caller applies its inverse). */
  undo(): T | undefined {
    const e = this.undoStack.pop();
    if (e) this.redoStack.push(e);
    return e?.item;
  }

  /** Returns the item to re-apply. */
  redo(): T | undefined {
    const e = this.redoStack.pop();
    if (e) this.undoStack.push(e);
    return e?.item;
  }

  /** Stamp of the action {@link undo} would revert. */
  get undoStamp(): number | undefined {
    return this.undoStack[this.undoStack.length - 1]?.stamp;
  }

  /** Stamp of the action {@link redo} would re-apply. */
  get redoStamp(): number | undefined {
    return this.redoStack[this.redoStack.length - 1]?.stamp;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clearRedo(): void {
    this.redoStack = [];
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
