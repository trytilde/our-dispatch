import { contextBridge, ipcRenderer } from "electron";

const bridge = {
  platform: process.platform === "darwin" ? "mac" : "linux",
  controlOrigin: process.env.CONTROL_ORIGIN ?? "",
  async openExternal(value: string): Promise<void> {
    await ipcRenderer.invoke("openbot:open-external", value);
  },
  authStatus: () => ipcRenderer.invoke("openbot:auth-status"),
  signIn: () => ipcRenderer.invoke("openbot:sign-in"),
  signOut: () => ipcRenderer.invoke("openbot:sign-out"),
} as const;

contextBridge.exposeInMainWorld("openbotDesktop", bridge);
