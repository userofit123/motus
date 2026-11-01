// The Motus desktop app (PLAN.md §2.4). Each account is either:
//  - local: Motus's own server runs inside the app with PGlite, keeping everything on this computer;
//  - server: the app's own screens and exercise photos, with the data on your Motus server (its API is proxied).
// Accounts live side by side, each in its own browser partition (cookies, cache) and, for local ones, its own database.
import { app, BrowserWindow, ipcMain, dialog, shell, session as eSession, Menu } from "electron";
import { autoUpdater } from "electron-updater";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface Account { id: string; kind: "local" | "server"; name: string; url?: string }
const USER = app.getPath("userData");
const ACCOUNTS = path.join(USER, "accounts.json");
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../..");
const WEB = app.isPackaged ? path.join(RES, "web") : path.join(RES, "apps/web/dist");
const IMAGES = app.isPackaged ? path.join(RES, "images") : path.join(RES, "packages/exercise-data/images");

const readAccounts = (): { list: Account[]; active: string | null } => { try { return JSON.parse(fs.readFileSync(ACCOUNTS, "utf8")); } catch { return { list: [], active: null }; } };
const writeAccounts = (a: { list: Account[]; active: string | null }) => { fs.mkdirSync(USER, { recursive: true }); fs.writeFileSync(ACCOUNTS, JSON.stringify(a, null, 2)); };

let win: BrowserWindow | null = null;
let running: { id: string; port: number; close: () => Promise<void> } | null = null;

// ----- local accounts: the Motus server inside the app -----
async function startLocal(acc: Account): Promise<{ port: number; close: () => Promise<void>; token: string }> {
  const dir = path.join(USER, "accounts", acc.id);
  fs.mkdirSync(dir, { recursive: true });
  const { pgliteDb } = await import("@motus/engine/pglite");
  const { buildApp, localSession } = await import("@motus/server/src/app");
  const db = await pgliteDb(path.join(dir, "db"));
  const { app: srv } = await buildApp({ db, dataDir: dir, webDir: WEB, imagesDir: IMAGES, logger: false });
  await srv.listen({ host: "127.0.0.1", port: 0 });
  const port = (srv.server.address() as any).port;
  const token = await localSession(db, acc.name);
  return { port, token, close: async () => { await srv.close(); await db.close(); } };
}

// ----- server accounts: local screens and photos, the API proxied to the server -----
function startProxy(acc: Account): Promise<{ port: number; close: () => Promise<void> }> {
  const target = new URL(acc.url!);
  const lib = target.protocol === "https:" ? https : http;
  const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json" };
  const serveFile = (root: string, rel: string, res: http.ServerResponse) => {
    const f = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return false;
    res.writeHead(200, { "content-type": mime[path.extname(f)] ?? "application/octet-stream", "cache-control": rel.startsWith("assets/") ? "max-age=31536000, immutable" : "no-cache" });
    fs.createReadStream(f).pipe(res);
    return true;
  };
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/")) {
      const headers = { ...req.headers, host: target.host, origin: target.origin };
      const p = lib.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, path: url, method: req.method, headers }, (r) => {
        const h = { ...r.headers };
        // cookies come back for this app's own address: drop the server's domain and "Secure" (the local address is plain http)
        if (h["set-cookie"]) h["set-cookie"] = h["set-cookie"].map((c) => c.replace(/;\s*Domain=[^;]+/i, "").replace(/;\s*Secure/i, ""));
        res.writeHead(r.statusCode ?? 502, h);
        r.pipe(res);
      });
      p.on("error", () => { if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: "Can't reach your Motus server" })); });
      req.pipe(p);
      return;
    }
    const clean = decodeURIComponent(url.split("?")[0]!);
    if (clean.startsWith("/exercise-images/") && serveFile(IMAGES, clean.slice(17), res)) return;
    if (clean !== "/" && serveFile(WEB, clean.slice(1), res)) return;
    serveFile(WEB, "index.html", res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as any).port, close: () => new Promise((r) => server.close(() => r())) })));
}

async function openAccount(id: string) {
  const all = readAccounts();
  const acc = all.list.find((a) => a.id === id);
  if (!acc) return showChooser();
  if (running) { await running.close().catch(() => {}); running = null; }
  const part = eSession.fromPartition(`persist:acct-${acc.id}`);
  let port: number;
  if (acc.kind === "local") {
    const s = await startLocal(acc);
    port = s.port;
    await part.cookies.set({ url: `http://127.0.0.1:${port}`, name: "motus_session", value: s.token, httpOnly: true, expirationDate: Date.now() / 1000 + 3600 * 24 * 365 });
    running = { id, port, close: s.close };
  } else {
    const s = await startProxy(acc);
    port = s.port;
    running = { id, port, close: s.close };
  }
  writeAccounts({ ...all, active: id });
  const next = makeWindow(part);
  await next.loadURL(`http://127.0.0.1:${port}/`);
  if (win && win !== next) win.destroy();
  win = next;
}

function makeWindow(part?: Electron.Session) {
  const w = new BrowserWindow({
    width: 1400, height: 900, minWidth: 380, minHeight: 600, backgroundColor: "#17100d", show: false, autoHideMenuBar: true, title: "Motus",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), session: part, contextIsolation: true, sandbox: false },
  });
  w.once("ready-to-show", () => w.show());
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  return w;
}

function showChooser() {
  const w = makeWindow();
  w.loadFile(path.join(__dirname, "accounts.html")).catch(() => w.loadURL("data:text/html,Motus"));
  if (win) win.destroy();
  win = w;
}

// ----- what the screens can ask of the app (window.motusNative, see preload.ts) -----
ipcMain.handle("accounts:list", () => readAccounts());
ipcMain.handle("accounts:addLocal", async (_e, name: string) => { const a = readAccounts(); const acc: Account = { id: crypto.randomUUID(), kind: "local", name: name || "Me" }; a.list.push(acc); writeAccounts(a); await openAccount(acc.id); });
ipcMain.handle("accounts:addServer", async (_e, url: string, name: string) => {
  const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  const res = await fetch(new URL("/api/version", u)).catch(() => null);
  if (!res?.ok) throw new Error("No Motus server answered at that address");
  const a = readAccounts(); const acc: Account = { id: crypto.randomUUID(), kind: "server", name: name || u.host, url: u.origin }; a.list.push(acc); writeAccounts(a); await openAccount(acc.id);
});
ipcMain.handle("accounts:open", (_e, id: string) => openAccount(id));
ipcMain.handle("accounts:chooser", () => showChooser());
ipcMain.handle("accounts:remove", async (_e, id: string) => {
  const a = readAccounts();
  const acc = a.list.find((x) => x.id === id);
  if (!acc) return;
  const r = await dialog.showMessageBox(win!, { type: "warning", buttons: ["Cancel", "Remove"], defaultId: 0, message: `Remove ${acc.name} from this computer?`, detail: acc.kind === "local" ? "Its data on this computer is deleted. Make a backup first if you want to keep it." : "Your data stays on the server." });
  if (r.response !== 1) return;
  if (running?.id === id) { await running.close(); running = null; }
  if (acc.kind === "local") fs.rmSync(path.join(USER, "accounts", id), { recursive: true, force: true });
  await eSession.fromPartition(`persist:acct-${id}`).clearStorageData();
  writeAccounts({ list: a.list.filter((x) => x.id !== id), active: null });
  showChooser();
});
ipcMain.handle("accounts:current", () => { const a = readAccounts(); return a.list.find((x) => x.id === a.active) ?? null; });

const backupDir = () => { const f = path.join(USER, "backup-folder.txt"); try { return fs.readFileSync(f, "utf8").trim(); } catch { return path.join(app.getPath("documents"), "Motus Backups"); } };
ipcMain.handle("backup:folder", () => backupDir());
ipcMain.handle("backup:choose", async () => { const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"], defaultPath: backupDir() }); if (r.canceled || !r.filePaths[0]) return null; fs.writeFileSync(path.join(USER, "backup-folder.txt"), r.filePaths[0]); return r.filePaths[0]; });
ipcMain.handle("backup:save", (_e, name: string, bytes: Uint8Array, keep: number) => {
  const dir = backupDir(); fs.mkdirSync(dir, { recursive: true });
  const acc = readAccounts().list.find((a) => a.id === readAccounts().active);
  const file = path.join(dir, (acc ? acc.name.replace(/[^\w.-]+/g, "_") + "-" : "") + path.basename(name));
  fs.writeFileSync(file + ".tmp", Buffer.from(bytes)); fs.renameSync(file + ".tmp", file);
  const mine = fs.readdirSync(dir).filter((f) => f.endsWith(".motusbackup") && (!acc || f.startsWith(acc.name.replace(/[^\w.-]+/g, "_") + "-"))).sort().reverse();
  for (const old of mine.slice(Math.max(1, keep))) fs.rmSync(path.join(dir, old), { force: true });
  return file;
});
ipcMain.handle("backup:open", () => shell.openPath(backupDir()));

// ----- updates from GitHub Releases -----
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on("download-progress", (p) => win?.webContents.send("update:progress", p.percent / 100));
ipcMain.handle("update:version", () => app.getVersion());
ipcMain.handle("update:check", async () => { try { const r = await autoUpdater.checkForUpdates(); return r?.updateInfo?.version ?? null; } catch { return null; } });
ipcMain.handle("update:download", async () => { await autoUpdater.checkForUpdates(); await autoUpdater.downloadUpdate(); return true; });
ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());

app.setAppUserModelId("org.motus.app");
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const a = readAccounts();
  if (a.active && a.list.some((x) => x.id === a.active)) await openAccount(a.active).catch(() => showChooser());
  else showChooser();
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15000);
});
app.on("window-all-closed", async () => { if (running) await running.close().catch(() => {}); app.quit(); });
