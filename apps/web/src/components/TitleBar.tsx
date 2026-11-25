import type { AppMenu, WindowState } from "@novaloom/board-engine/persist";
import { useEffect, useState } from "react";
import type { Persistence } from "../persistence";
import { BoardTitle } from "./BoardTitle";
import { SaveStatus } from "./SaveStatus";
import logoUrl from "../assets/logo.svg";

const MENUS: { id: AppMenu; label: string }[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "page", label: "Page" },
  { id: "view", label: "View" },
];

/** Segoe Fluent Icons glyphs: crisp at every Windows scale factor, same as native caption buttons. */
const GLYPH = { minimize: "", maximize: "", restore: "", close: "" };

function useWindowState(): WindowState {
  const bridge = window.novaLoom?.window;
  const [state, setState] = useState<WindowState>({ maximized: false, fullScreen: false, focused: true });
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    void bridge.getState().then((s) => live && setState(s));
    const off = bridge.onState(setState);
    return () => {
      live = false;
      off();
    };
  }, [bridge]);
  return state;
}

/**
 * Custom window title bar. Empty space drags the window (double-click
 * maximizes, as native); every control inside opts out of dragging.
 */
export function TitleBar({ persistence }: { persistence: Persistence }) {
  const bridge = window.novaLoom?.window;
  const state = useWindowState();
  const [openMenu, setOpenMenu] = useState<AppMenu | null>(null);

  useEffect(() => bridge?.onMenuClosed(() => setOpenMenu(null)), [bridge]);

  const popup = (menu: AppMenu, el: HTMLElement) => {
    if (!bridge) return;
    const r = el.getBoundingClientRect();
    setOpenMenu(menu);
    bridge.popupMenu(menu, r.left, r.bottom + 2);
  };

  return (
    <header
      className="titlebar"
      data-focused={state.focused}
      data-maximized={state.maximized || state.fullScreen}
    >
      <div className="titlebar-start">
        <BrandMark />
        {bridge && (
          <nav className="menubar" aria-label="Application menu">
            {MENUS.map((m) => (
              <button
                key={m.id}
                type="button"
                className="menubar-btn"
                aria-haspopup="menu"
                aria-expanded={openMenu === m.id}
                onClick={(e) => popup(m.id, e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") popup(m.id, e.currentTarget);
                }}
              >
                {m.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="titlebar-center">
        <BoardTitle persistence={persistence} />
        <SaveStatus persistence={persistence} />
      </div>

      <div className="titlebar-end">
        {bridge && (
          <div className="caption-buttons">
            <button type="button" className="caption-btn" aria-label="Minimize" title="Minimize" onClick={() => bridge.action("minimize")}>
              <span className="glyph">{GLYPH.minimize}</span>
            </button>
            <button
              type="button"
              className="caption-btn"
              aria-label={state.maximized || state.fullScreen ? "Restore" : "Maximize"}
              title={state.fullScreen ? "Exit full screen" : state.maximized ? "Restore down" : "Maximize"}
              onClick={() => bridge.action("toggle-maximize")}
            >
              <span className="glyph">{state.maximized || state.fullScreen ? GLYPH.restore : GLYPH.maximize}</span>
            </button>
            <button type="button" className="caption-btn close" aria-label="Close" title="Close" onClick={() => bridge.action("close")}>
              <span className="glyph">{GLYPH.close}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/** The NovaLoomBoard mark and name. */
function BrandMark() {
  return (
    <span className="brand" aria-label="NovaLoomBoard">
      <img className="brand-logo" src={logoUrl} alt="" draggable={false} />
      <span className="brand-name">NovaLoomBoard</span>
    </span>
  );
}
