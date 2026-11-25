import { EDIT_EQUATION_EVENT, type BoardEngine } from "@novaloom/board-engine";
import { useEffect } from "react";
import { openDialog, useOpenDialog } from "../dialogs";
import type { Persistence } from "../persistence";
import { EquationDialog } from "./EquationDialog";
import { PlotDialog } from "./PlotDialog";
import { VersionsDialog } from "./VersionsDialog";

/** Hosts the plot, equation and version-history dialogs, and opens them from the board and menus. */
export function Dialogs({ engine, persistence }: { engine: BoardEngine; persistence: Persistence }) {
  const d = useOpenDialog();

  useEffect(() => {
    const board = document.querySelector<HTMLElement>(".board");
    const onEdit = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; tex: string; color: string }>).detail;
      if (detail) openDialog({ kind: "equation", edit: detail });
    };
    board?.addEventListener(EDIT_EQUATION_EVENT, onEdit);
    const off = persistence.onMenuCommand((c) => {
      if (c === "versions") openDialog({ kind: "versions" });
    });
    return () => {
      board?.removeEventListener(EDIT_EQUATION_EVENT, onEdit);
      off();
    };
  }, [persistence]);

  const close = () => openDialog(null);
  if (!d) return null;
  if (d.kind === "plot") return <PlotDialog engine={engine} onClose={close} />;
  if (d.kind === "equation") return <EquationDialog engine={engine} persistence={persistence} edit={d.edit} onClose={close} />;
  return <VersionsDialog persistence={persistence} onClose={close} />;
}
