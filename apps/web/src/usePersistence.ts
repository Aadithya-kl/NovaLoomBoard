import { useSyncExternalStore } from "react";
import type { Persistence, PersistenceState } from "./persistence";

export function usePersistenceState(persistence: Persistence): PersistenceState {
  return useSyncExternalStore(persistence.subscribe, persistence.getState);
}
