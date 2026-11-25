import { useSyncExternalStore } from "react";

/** Presentation overlays: a spotlight that follows the pointer, and a shade over the board. */
export interface PresenterState {
  spotlight: boolean;
  /** Spotlight radius in pixels. */
  radius: number;
  shade: boolean;
  /** How much of the board the shade has uncovered from the top, in pixels. */
  revealed: number;
  /** Presentation mode: full screen, tools hidden, a small control bar that fades when idle. */
  presenting: boolean;
}

export const SPOTLIGHT_RADII = [90, 130, 180, 240, 320];

let state: PresenterState = { spotlight: false, radius: 180, shade: false, revealed: 0, presenting: false };
/** Whether starting the presentation made the window full screen (so stopping undoes it). */
let madeFullScreen = false;
const listeners = new Set<() => void>();

export const presenter = {
  get: (): PresenterState => state,
  set(patch: Partial<PresenterState>): void {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  toggleSpotlight(): void {
    presenter.set({ spotlight: !state.spotlight });
  },
  /** A new shade covers the whole board. */
  toggleShade(): void {
    presenter.set({ shade: !state.shade, revealed: 0 });
  },
  async startPresenting(): Promise<void> {
    if (state.presenting) return;
    presenter.set({ presenting: true });
    const win = window.novaLoom?.window;
    if (!win) return;
    const ws = await win.getState();
    madeFullScreen = !ws.fullScreen;
    if (madeFullScreen) win.command("toggle-fullscreen");
  },
  async stopPresenting(): Promise<void> {
    if (!state.presenting) return;
    presenter.set({ presenting: false, spotlight: false, shade: false });
    const win = window.novaLoom?.window;
    if (!win || !madeFullScreen) return;
    madeFullScreen = false;
    const ws = await win.getState();
    if (ws.fullScreen) win.command("toggle-fullscreen");
  },
  /** The next spotlight size up (+1) or down (-1). */
  stepRadius(dir: 1 | -1): void {
    const i = SPOTLIGHT_RADII.findIndex((r) => r >= state.radius);
    const next = SPOTLIGHT_RADII[Math.max(0, Math.min(SPOTLIGHT_RADII.length - 1, (i < 0 ? SPOTLIGHT_RADII.length - 1 : i) + dir))]!;
    presenter.set({ radius: next });
  },
};

export function usePresenter(): PresenterState {
  return useSyncExternalStore(presenter.subscribe, presenter.get);
}
