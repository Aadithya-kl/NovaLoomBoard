import { assets, BoardEngine } from "@novaloom/board-engine";
import { useEffect, useRef, useState } from "react";
import { BoardMenu } from "./components/BoardMenu";
import { EmptyHint } from "./components/EmptyHint";
import { FileActions } from "./components/FileActions";
import { Notices } from "./components/Notice";
import { PageActions } from "./components/PageActions";
import { Dialogs } from "./components/Dialogs";
import { Hints } from "./components/Hints";
import { Timer } from "./components/Timer";
import { PageNavigator } from "./components/PageNavigator";
import { PresentationDock } from "./components/PresentationDock";
import { Presenter } from "./components/Presenter";
import { SelectionBar } from "./components/SelectionBar";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { TitleBar } from "./components/TitleBar";
import { Toolbar } from "./components/Toolbar";
import { ZoomControls } from "./components/ZoomControls";
import { Persistence } from "./persistence";
import { useAppShortcuts } from "./useAppShortcuts";
import { useEditCommands } from "./useEditCommands";
import { useShortcuts } from "./useEngine";
import { useUiTheme } from "./useUiTheme";
import { useViewInsets } from "./useViewInsets";

export function App() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<{ engine: BoardEngine; persistence: Persistence } | null>(null);

  useEffect(() => {
    const engine = new BoardEngine(boardRef.current!);
    const persistence = new Persistence(engine);
    // Development builds only: lets end-to-end checks read the engine state.
    if (import.meta.env.DEV) Object.assign(window, { __nlbEngine: engine, __nlbPersistence: persistence, __nlbAssets: assets });
    let disposed = false;
    setReady({ engine, persistence });
    persistence.start().catch((err) => {
      if (!disposed) console.error("[persistence] could not open the board", err);
    });
    return () => {
      disposed = true;
      persistence.dispose();
      engine.destroy();
      setReady(null);
    };
  }, []);

  useShortcuts(ready?.engine ?? null);
  useUiTheme(ready?.engine ?? null);
  useViewInsets(ready?.engine ?? null);
  useAppShortcuts(ready?.persistence ?? null);
  useEditCommands(ready?.engine ?? null, ready?.persistence ?? null);

  return (
    <div className="app" data-desktop={window.novaLoom ? "true" : undefined}>
      {ready ? <TitleBar persistence={ready.persistence} /> : <header className="titlebar" />}
      <main className="workspace">
        <div ref={boardRef} className="board" aria-label="Whiteboard" role="application" />
        {ready && (
          <>
            <Presenter />
            <EmptyHint engine={ready.engine} persistence={ready.persistence} />
            <SelectionBar engine={ready.engine} />
            <BoardMenu engine={ready.engine} />
            <Toolbar engine={ready.engine} />
            <PageActions engine={ready.engine} persistence={ready.persistence} />
            <PageNavigator engine={ready.engine} persistence={ready.persistence} />
            <ZoomControls engine={ready.engine} />
            <Notices persistence={ready.persistence} />
            <FileActions engine={ready.engine} persistence={ready.persistence} />
            <ShortcutsDialog persistence={ready.persistence} />
            <PresentationDock engine={ready.engine} persistence={ready.persistence} />
            <Hints engine={ready.engine} />
            <Timer />
            <Dialogs engine={ready.engine} persistence={ready.persistence} />
          </>
        )}
      </main>
    </div>
  );
}
