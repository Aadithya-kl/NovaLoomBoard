import type { BoardEngine } from "@novaloom/board-engine";
import { useEffect } from "react";

const GAP = 12;

/**
 * Tells the engine which parts of the board are covered by floating panels
 * (the tool dock on the left, the page bar and thumbnails at the bottom), so
 * "fit to content" keeps content clear of them. Re-measured whenever those
 * panels change size or appear (e.g. the thumbnail strip is shown).
 */
export function useViewInsets(engine: BoardEngine | null): void {
  useEffect(() => {
    if (!engine) return;
    const workspace = document.querySelector<HTMLElement>(".workspace");
    if (!workspace) return;
    const measure = () => {
      const w = workspace.getBoundingClientRect();
      const pages = workspace.querySelector(".pages-area")?.getBoundingClientRect();
      const dock = workspace.querySelector(".dock-area")?.getBoundingClientRect();
      engine.setViewInsets({
        top: GAP,
        right: GAP,
        bottom: pages && pages.height ? Math.max(GAP, w.bottom - pages.top + GAP) : GAP,
        left: dock && dock.width ? Math.max(GAP, dock.right - w.left + GAP) : GAP,
      });
    };
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.disconnect();
      resize.observe(workspace);
      for (const sel of [".pages-area", ".dock-area"]) {
        const el = workspace.querySelector(sel);
        if (el) resize.observe(el);
      }
      measure();
    };
    // Panels mount, unmount and open later (after the board loads, strip toggled).
    const mutations = new MutationObserver(watch);
    mutations.observe(workspace, { childList: true, subtree: true });
    watch();
    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [engine]);
}
