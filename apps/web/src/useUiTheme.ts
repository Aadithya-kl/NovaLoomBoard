import { isDarkBackground, type BoardEngine } from "@novaloom/board-engine";
import { useEffect } from "react";

/**
 * Light or dark interface. Dark when Windows uses dark mode, and on dark boards
 * (chalkboard, black) so the tools do not glare around the board. Sets data-ui on <html>,
 * which also reaches menus and dialogs rendered outside the app root.
 */
export function useUiTheme(engine: BoardEngine | null): void {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = mq.matches || (engine ? isDarkBackground(engine.getState().background) : false);
      const value = dark ? "dark" : "light";
      if (document.documentElement.dataset.ui !== value) document.documentElement.dataset.ui = value;
    };
    apply();
    mq.addEventListener("change", apply);
    const off = engine?.subscribe(apply);
    return () => {
      mq.removeEventListener("change", apply);
      off?.();
    };
  }, [engine]);
}
