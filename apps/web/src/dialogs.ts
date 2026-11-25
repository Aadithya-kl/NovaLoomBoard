import { useSyncExternalStore } from "react";

/** The one dialog open at a time, opened from the toolbar, menus or the board. */
export type OpenDialog =
  | { kind: "plot" }
  | { kind: "equation"; edit?: { id: string; tex: string; color: string } }
  | { kind: "versions" }
  | null;

let current: OpenDialog = null;
const listeners = new Set<() => void>();

export function openDialog(d: OpenDialog): void {
  current = d;
  for (const l of listeners) l();
}

export function useOpenDialog(): OpenDialog {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
