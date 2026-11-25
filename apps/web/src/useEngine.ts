import { shortcutCode } from "./keys";
import { useEffect, useSyncExternalStore } from "react";
import type { BoardEngine, EngineState, Tool } from "@novaloom/board-engine";
import { runEditCommand } from "./useEditCommands";

export function useEngineState(engine: BoardEngine): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: "select",
  KeyP: "pen",
  KeyN: "pencil",
  KeyH: "highlighter",
  KeyS: "shape",
  KeyT: "text",
  KeyE: "eraser",
  KeyG: "pan",
  KeyK: "laser",
};

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Keyboard shortcuts. Uses physical key codes so they work on AZERTY and Arabic layouts. */
export function useShortcuts(engine: BoardEngine | null): void {
  useEffect(() => {
    if (!engine) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") engine.setShift(true);
      if (isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (shortcutCode(e) === "Space") {
        e.preventDefault();
        if (!e.repeat) engine.setSpacePan(true);
        return;
      }
      if (mod) {
        switch (shortcutCode(e)) {
          case "KeyZ":
            e.preventDefault();
            if (e.shiftKey) engine.redo();
            else engine.undo();
            return;
          case "KeyY":
            e.preventDefault();
            engine.redo();
            return;
          case "KeyA":
            e.preventDefault();
            engine.selectAll();
            return;
          case "KeyC":
          case "KeyX":
            // Leave the key alone (native copy) when nothing is selected on the board.
            if (!engine.getState().selection) return;
            e.preventDefault();
            runEditCommand(engine, shortcutCode(e) === "KeyC" ? "copy" : "cut");
            return;
          case "KeyV":
            e.preventDefault();
            runEditCommand(engine, "paste");
            return;
          case "KeyD":
            e.preventDefault();
            engine.duplicateSelection();
            return;
          case "KeyG":
            e.preventDefault();
            if (e.shiftKey) engine.ungroupSelection();
            else engine.groupSelection();
            return;
          case "KeyL":
            if (!e.shiftKey) return;
            e.preventDefault();
            engine.lockSelection();
            return;
          case "Period":
          case "Comma":
            // Ctrl+Shift+> / <: text size (selected text or the next text).
            if (!e.shiftKey) return;
            e.preventDefault();
            engine.stepTextSize(shortcutCode(e) === "Period" ? 1 : -1);
            return;
          case "Digit0":
          case "Numpad0":
            e.preventDefault();
            engine.resetView();
            return;
          case "Equal":
          case "NumpadAdd":
            e.preventDefault();
            engine.zoomBy(1.25);
            return;
          case "Minus":
          case "NumpadSubtract":
            e.preventDefault();
            engine.zoomBy(0.8);
            return;
        }
        return;
      }
      if (e.altKey) return;
      if (shortcutCode(e) === "Delete" || shortcutCode(e) === "Backspace") {
        if (engine.getState().selection) {
          e.preventDefault();
          engine.deleteSelection();
        }
        return;
      }
      if (shortcutCode(e) === "Escape") {
        engine.clearSelection();
        return;
      }
      const nudge = NUDGE[shortcutCode(e)];
      if (nudge && engine.getState().selection) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        engine.nudgeSelection(nudge[0] * step, nudge[1] * step);
        return;
      }
      if (e.shiftKey && shortcutCode(e) === "Digit1") {
        engine.fitContent();
        return;
      }
      if (e.shiftKey && (shortcutCode(e) === "KeyL" || shortcutCode(e) === "KeyR")) {
        if (engine.getState().selection) engine.rotateSelection(shortcutCode(e) === "KeyL" ? -90 : 90);
        return;
      }
      // V: select with a box; L: select with a lasso.
      if (!e.shiftKey && (shortcutCode(e) === "KeyV" || shortcutCode(e) === "KeyL")) {
        engine.setSelectMode(shortcutCode(e) === "KeyL" ? "lasso" : "box");
        return;
      }
      // R: show or hide the ruler (Shift+R rotates the selection, above).
      if (!e.shiftKey && shortcutCode(e) === "KeyR") {
        engine.toggleGuide("ruler");
        return;
      }
      const tool = TOOL_KEYS[shortcutCode(e)];
      if (tool && !e.shiftKey) engine.setTool(tool);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") engine.setShift(false);
      if (shortcutCode(e) === "Space") engine.setSpacePan(false);
    };
    const onBlur = () => {
      engine.setSpacePan(false);
      engine.setShift(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [engine]);
}
