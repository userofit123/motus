// What the Motus screens can ask of the desktop app: accounts, backups to a folder, and updates.
import { contextBridge, ipcRenderer } from "electron";

let onProgress: ((p: number) => void) | null = null;
ipcRenderer.on("update:progress", (_e, p: number) => onProgress?.(p));

const api = {
  platform: "desktop",
  accounts: {
    list: () => ipcRenderer.invoke("accounts:list"),
    current: () => ipcRenderer.invoke("accounts:current"),
    addLocal: (name: string) => ipcRenderer.invoke("accounts:addLocal", name),
    addServer: (url: string, name: string) => ipcRenderer.invoke("accounts:addServer", url, name),
    open: (id: string) => ipcRenderer.invoke("accounts:open", id),
    rename: (id: string, name: string) => ipcRenderer.invoke("accounts:rename", id, name),
    remove: (id: string) => ipcRenderer.invoke("accounts:remove", id),
    chooser: () => ipcRenderer.invoke("accounts:chooser"),
  },
  saveBackup: (name: string, bytes: Uint8Array, keep: number) => ipcRenderer.invoke("backup:save", name, bytes, keep),
  backupFolder: () => ipcRenderer.invoke("backup:folder"),
  chooseBackupFolder: () => ipcRenderer.invoke("backup:choose"),
  openBackupFolder: () => ipcRenderer.invoke("backup:open"),
  update: {
    version: () => ipcRenderer.invoke("update:version"),
    check: () => ipcRenderer.invoke("update:check"),
    download: (cb: (p: number) => void) => { onProgress = cb; return ipcRenderer.invoke("update:download"); },
    install: () => ipcRenderer.invoke("update:install"),
  },
};
contextBridge.exposeInMainWorld("motusNative", api);
contextBridge.exposeInMainWorld("motusDesktop", true);
