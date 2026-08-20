import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { startRendererServer, type RendererServer } from "./local-server.js";
import { DesktopAuth } from "./auth.js";

if (process.platform === "win32")
  throw new Error("OpenBot Desktop currently supports macOS and Linux");

// A packaged build takes its mark from the app bundle, but an unpackaged run would otherwise
// show the stock Electron icon. build/icon.png is not shipped in the package, so resolve it
// only when running unpackaged.
const developmentIcon = app.isPackaged ? undefined : join(__dirname, "../build/icon.png");
// The only deployment value the desktop is given: everything else is discovered from here.
const controlOrigin = process.env.CONTROL_ORIGIN || "http://127.0.0.1:4100";

let window: BrowserWindow | undefined;
let rendererServer: RendererServer | undefined;
let desktopAuth: DesktopAuth | undefined;
const pendingProtocolUrls: string[] = [];

if (!app.requestSingleInstanceLock()) app.quit();
app.setAsDefaultProtocolClient("openbot");
app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleProtocolUrl(url);
});
app.on("second-instance", (_event, argv) => {
  const url = argv.find((value) => value.startsWith("openbot://"));
  if (url) void handleProtocolUrl(url);
  window?.show();
  window?.focus();
});

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1480,
    height: 930,
    minWidth: 900,
    minHeight: 640,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(developmentIcon && process.platform === "linux" ? { icon: developmentIcon } : {}),
    backgroundColor: "#fafafb",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const current = window?.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin) event.preventDefault();
  });

  rendererServer ??= await startRendererServer(join(process.resourcesPath, "web"), controlOrigin, {
    accessToken: async () => await desktopAuth?.accessToken(),
    ...(process.env.DESKTOP_DEV_URL ? { webOrigin: process.env.DESKTOP_DEV_URL } : {}),
  });
  await window.loadURL(rendererServer.origin);
}

async function main(): Promise<void> {
  ipcMain.handle("openbot:open-external", async (_event, value: unknown) => {
    if (typeof value !== "string") throw new Error("A URL is required");
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("Only web links may be opened externally");
    await shell.openExternal(url.toString());
  });

  await app.whenReady();
  // macOS reads the dock icon from the bundle, which an unpackaged run does not have.
  if (developmentIcon && process.platform === "darwin") app.dock?.setIcon(developmentIcon);
  desktopAuth = new DesktopAuth(join(app.getPath("userData"), "auth.enc"), controlOrigin);
  await desktopAuth.load();
  ipcMain.handle("openbot:auth-status", () => desktopAuth!.status());
  ipcMain.handle("openbot:sign-in", () => desktopAuth!.signIn());
  ipcMain.handle("openbot:sign-out", () => desktopAuth!.signOut());
  for (const url of pendingProtocolUrls.splice(0)) await desktopAuth.handleCallback(url);
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    void rendererServer?.close();
  });
}

async function handleProtocolUrl(url: string): Promise<void> {
  if (!desktopAuth) {
    pendingProtocolUrls.push(url);
    return;
  }
  await desktopAuth.handleCallback(url);
  window?.show();
  window?.focus();
}

void main().catch((error: unknown) => {
  console.error("OpenBot Desktop failed to start", error);
  app.quit();
});
