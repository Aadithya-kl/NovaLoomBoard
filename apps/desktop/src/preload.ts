import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AppMenu, DesktopBridge, MainSaveStatus, MenuCommand, WindowState } from "@novaloom/board-engine/persist";

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const bridge: DesktopBridge = {
  loadBoard: () => ipcRenderer.invoke("nlb:load"),
  save: (ops, props) => ipcRenderer.invoke("nlb:save", ops, props),
  snapshot: (reason) => ipcRenderer.invoke("nlb:snapshot", reason),
  dismissNotice: () => ipcRenderer.send("nlb:dismiss-notice"),
  onSaveStatus: (listener) => listen<MainSaveStatus>("nlb:save-status", listener),
  onMenuCommand: (listener) => listen<MenuCommand>("nlb:menu", listener),
  window: {
    getState: () => ipcRenderer.invoke("nlb:window-state"),
    onState: (listener) => listen<WindowState>("nlb:window-state", listener),
    action: (action) => ipcRenderer.send("nlb:window", action),
    popupMenu: (menu, x, y) => ipcRenderer.send("nlb:menu-popup", menu, x, y),
    onMenuClosed: (listener) => listen<AppMenu>("nlb:menu-closed", listener),
    command: (command) => ipcRenderer.send("nlb:command", command),
    nativeEdit: (command) => ipcRenderer.send("nlb:native-edit", command),
  },
  files: {
    importImages: () => ipcRenderer.invoke("nlb:import-images"),
    openPdf: () => ipcRenderer.invoke("nlb:open-pdf"),
    readAsset: (id) => ipcRenderer.invoke("nlb:read-asset", id),
    storeAsset: (asset) => ipcRenderer.invoke("nlb:store-asset", asset),
    chooseExportPath: (format, name) => ipcRenderer.invoke("nlb:choose-export-path", format, name),
    writeExport: (file, data) => ipcRenderer.invoke("nlb:write-export", file, data),
    exportPdf: (file, html) => ipcRenderer.invoke("nlb:export-pdf", file, html),
    showInFolder: (file) => ipcRenderer.send("nlb:show-in-folder", file),
  },
  versions: {
    list: () => ipcRenderer.invoke("nlb:versions-list"),
    preview: (at) => ipcRenderer.invoke("nlb:versions-preview", at),
    open: (at) => ipcRenderer.invoke("nlb:versions-open", at),
    saveNow: () => ipcRenderer.invoke("nlb:versions-save"),
  },
  clipboard: {
    writeBoard: (data, text, png) => ipcRenderer.invoke("nlb:clipboard-write", data, text, png),
    read: () => ipcRenderer.invoke("nlb:clipboard-read"),
  },
  onFlushRequest: (listener) =>
    listen<number>("nlb:flush-request", (requestId) => {
      Promise.resolve()
        .then(listener)
        .catch(() => undefined)
        .finally(() => ipcRenderer.send("nlb:flush-done", requestId));
    }),
};

contextBridge.exposeInMainWorld("novaLoom", bridge);
