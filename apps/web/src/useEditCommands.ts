import type { BoardEngine } from "@novaloom/board-engine";
import type { MenuCommand, NativeEdit } from "@novaloom/board-engine/persist";
import { useEffect } from "react";
import { copySelection, paste, setClipboardPersistence } from "./clipboard";
import type { Persistence } from "./persistence";

const isEditable = (t: Element | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const NATIVE: Partial<Record<MenuCommand, NativeEdit>> = {
  undo: "undo",
  redo: "redo",
  cut: "cut",
  copy: "copy",
  paste: "paste",
  "select-all": "selectAll",
};

/** Runs an Edit command on the board, or on the text field being typed in. */
export function runEditCommand(engine: BoardEngine, command: MenuCommand): void {
  const native = NATIVE[command];
  if (native && isEditable(document.activeElement)) {
    window.novaLoom?.window.nativeEdit(native);
    return;
  }
  switch (command) {
    case "undo":
      engine.undo();
      return;
    case "redo":
      engine.redo();
      return;
    case "cut":
      copySelection(engine, true);
      return;
    case "copy":
      copySelection(engine);
      return;
    case "paste":
      void paste(engine);
      return;
    case "duplicate":
      engine.duplicateSelection();
      return;
    case "delete":
      engine.deleteSelection();
      return;
    case "select-all":
      engine.selectAll();
      return;
    case "rotate-left":
      engine.rotateSelection(-90);
      return;
    case "rotate-right":
      engine.rotateSelection(90);
      return;
    case "group":
      engine.groupSelection();
      return;
    case "ungroup":
      engine.ungroupSelection();
      return;
    case "lock":
      engine.lockSelection();
      return;
    case "unlock-all":
      engine.unlockAll();
      return;
  }
}

/** Edit commands chosen in the title-bar menu. */
export function useEditCommands(engine: BoardEngine | null, persistence: Persistence | null): void {
  useEffect(() => {
    if (!engine || !persistence) return;
    setClipboardPersistence(persistence);
    const off = persistence.onMenuCommand((c) => {
      if (c !== "rename") runEditCommand(engine, c);
    });
    return () => {
      off();
      setClipboardPersistence(null);
    };
  }, [engine, persistence]);
}
