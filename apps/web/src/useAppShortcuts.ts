import { shortcutCode } from "./keys";
import { useEffect } from "react";
import type { Persistence } from "./persistence";

/**
 * Window-level shortcuts that a native menu bar would normally provide.
 * The title-bar menus show them as hints only, so each key acts once.
 */
export function useAppShortcuts(persistence: Persistence | null): void {
  useEffect(() => {
    const bridge = window.novaLoom?.window;
    if (!bridge || !persistence) return;
    const isDev = location.protocol !== "file:";
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (shortcutCode(e) === "F11") return run(() => bridge.command("toggle-fullscreen"));
      if (shortcutCode(e) === "F2" && !e.altKey && !mod) return run(() => persistence.runCommand("rename"));
      if (!mod || e.altKey) return;
      if (shortcutCode(e) === "KeyN" && !e.shiftKey) return run(() => bridge.command("new-board"));
      if (shortcutCode(e) === "KeyO" && !e.shiftKey) return run(() => bridge.command("open"));
      if (shortcutCode(e) === "KeyS" && e.shiftKey) return run(() => bridge.command("save-copy"));
      // Changes save automatically; swallow Ctrl+S so it never looks like it did nothing harmful.
      if (shortcutCode(e) === "KeyS") return run(() => undefined);
      if (isDev && shortcutCode(e) === "KeyR" && !e.shiftKey) return run(() => bridge.command("reload"));
      if (isDev && shortcutCode(e) === "KeyI" && e.shiftKey) return run(() => bridge.command("devtools"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [persistence]);
}
