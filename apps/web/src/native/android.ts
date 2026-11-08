// Inside the Android app (Capacitor): accounts, backups to a folder on the phone, the in-app updater, the system bars'
// colours, and the back button. Exposed as window.motusNative, like the desktop app.
import { accounts, addLocal, addServer, open, remove, rename, chooser } from "./accounts";
import { sheetIsOpen, closeTopSheet } from "../core/sheets";
import { REPO, newer, fetchWithin } from "../core/releases";
import { router } from "../router";
import { applyTheme } from "../core/theme";
import { notificationState, askNotificationPermission } from "../workout/native";

const cap = () => (globalThis as any).Capacitor;
const P = (n: string) => cap()?.Plugins?.[n];
export const isAndroid = () => cap()?.getPlatform?.() === "android";
// the Filesystem plugin takes file contents as base64
function base64(bytes: Uint8Array) {
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
// "name.json", then "name (2).json", ...: a later try when an earlier name is taken, so a file is never overwritten
function numbered(name: string, i: number) {
  const dot = name.lastIndexOf(".");
  return i === 1 ? name : dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
}
type Fs = {
  stat(o: { path: string; directory: string }): Promise<unknown>;
  writeFile(o: { path: string; data: string; directory: string; recursive?: boolean }): Promise<unknown>;
};
// writes the file under the first free name in dir. Android 11+ hides files of other apps from stat, so a name that
// looks free can still fail on write: that name is skipped and the next one tried. Names stat finds taken are stepped
// past without limit; only failed writes count, and after 6 of them the error goes to the caller (which may fall back)
async function writeFree(fs: Fs, dir: string, directory: string, name: string, data: string) {
  let err: unknown;
  for (let i = 1, fails = 0; fails < 6; i++) {
    const n = numbered(name, i);
    if (await fs.stat({ path: `${dir}/${n}`, directory }).then(() => true, () => false)) continue;
    try { await fs.writeFile({ path: `${dir}/${n}`, data, directory, recursive: true }); return n; } catch (e) { err = e; fails++; }
  }
  throw err;
}

async function latestApk() {
  const r = await fetchWithin(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error("Could not reach GitHub");
  const j = await r.json();
  const manifest = j.assets?.find((a: any) => a.name === "android-latest.json");
  const meta = manifest ? await (await fetchWithin(manifest.browser_download_url)).json() : null;
  const apk = j.assets?.find((a: any) => a.name.endsWith(".apk"));
  return { version: String(j.tag_name).replace(/^v/, ""), url: meta?.url ?? apk?.browser_download_url, sha256: meta?.sha256 ?? null, notes: j.body ?? "", html: j.html_url };
}

export function installAndroidBridge() {
  if (!isAndroid()) return;
  const info = P("App")?.getInfo?.();
  let staged: string | null = null;
  (globalThis as any).motusNative = {
    platform: "android",
    accounts: {
      list: async () => ({ list: accounts.list.map(({ token, ...a }) => a), active: accounts.active }),
      current: async () => accounts.list.find((a) => a.id === accounts.active) ?? null,
      addLocal, addServer, open, remove, rename, chooser,
    },
    // backups go to Documents/Motus on the phone (the Filesystem plugin), newest `keep` are kept
    async saveBackup(name: string, bytes: Uint8Array, keep: number) {
      const fs = P("Filesystem");
      await fs.writeFile({ path: `Motus/${name}`, data: base64(bytes), directory: "DOCUMENTS", recursive: true });
      const list = (await fs.readdir({ path: "Motus", directory: "DOCUMENTS" })).files.map((f: any) => f.name ?? f).filter((n: string) => n.endsWith(".motusbackup")).sort().reverse();
      for (const old of list.slice(Math.max(1, keep))) await fs.deleteFile({ path: `Motus/${old}`, directory: "DOCUMENTS" }).catch(() => {});
      return `Documents/Motus/${name}`;
    },
    backupFolder: async () => "Documents/Motus",
    // exports and other files saved by hand go to the phone's Downloads folder, where the Files app shows them first.
    // Android 10 and older don't let an app write there without a storage permission Motus doesn't ask for: the file
    // then goes to Motus's own folder on the phone's storage instead, and the toast names that path.
    async saveFile(name: string, bytes: Uint8Array): Promise<string> {
      const fs: Fs = P("Filesystem"), data = base64(bytes);
      try {
        return `Downloads/${await writeFree(fs, "Download", "EXTERNAL_STORAGE", name, data)}`;
      } catch {
        return `Android/data/org.motus.app/files/Motus/${await writeFree(fs, "Motus", "EXTERNAL", name, data)}`;
      }
    },
    update: {
      version: async () => (await info)?.version ?? "",
      async check() { const l = await latestApk(); const cur = (await info)?.version ?? "0"; return { current: cur, latest: l.version, newer: newer(l.version, cur), notes: l.notes, url: l.html }; },
      // download the APK, check its SHA-256, then hand it to Android's installer (one tap to confirm, Android's rule)
      async download(onProgress: (p: number, bytes?: number) => void) {
        const l = await latestApk();
        // Android 13+ shows the download's notification only once allowed: ask now if it was never asked (the workout
        // flows ask the same way); a "no" changes nothing, the download runs without it
        if ((await notificationState()) === "prompt") await askNotificationPermission();
        // p is the share done (0-1), or -1 when the size is unknown
        const h = await P("MotusUpdater").addListener("progress", ({ loaded, total }: { loaded: number; total: number }) => onProgress(total > 0 ? loaded / total : -1, loaded));
        let res;
        try { res = await P("MotusUpdater").download({ url: l.url, sha256: l.sha256, version: l.version }); } finally { h?.remove?.(); }
        onProgress(1);
        staged = res.path;
        return l.version as string;
      },
      // a newer release replaced the one that was ready: its file is deleted
      async forget() { staged = null; await P("MotusUpdater")?.discard?.().catch(() => {}); },
      async install() { if (staged) await P("MotusUpdater").install({ path: staged }); },
      // mobile data or another metered connection: "Only on Wi-Fi" downloads wait
      // Android can always tell
      async metered(): Promise<{ metered: boolean; known: boolean }> { return { metered: !!(await P("MotusUpdater")?.metered?.().catch(() => null))?.metered, known: true }; },
      // an update downloaded before the app was last closed, still ready to install: its version, or null
      async staged(): Promise<string | null> {
        const r = await P("MotusUpdater")?.staged?.().catch(() => null);
        if (!r?.path || !r.version) return null;
        staged = r.path;
        return r.version;
      },
    },
  };
  // the hardware back button closes an open sheet, goes back in the app, and leaves it from the home page
  P("App")?.addListener?.("backButton", ({ canGoBack }: { canGoBack: boolean }) => { if (sheetIsOpen()) closeTopSheet(); else if (canGoBack && location.pathname !== "/") history.back(); else P("App").minimizeApp?.(); });
  // a tap on a notification that names a page (the interval timer's, the update download's) opens that page
  P("MotusWorkout")?.addListener?.("open", ({ path }: { path?: string }) => { if (typeof path === "string" && path.startsWith("/")) void router.push(path); });
  // the page runs behind clear status and navigation bars (MotusBarsPlugin), so its own background shows under the
  // clock and beside a side bar; it pads itself by the bars' sizes (--nst / --nsb / --nsl / --nsr, used by --st / --sb /
  // --sl / --sr in tokens.css)
  const pad = ({ top, bottom, left = 0, right = 0 }: { top: number; bottom: number; left?: number; right?: number }) => {
    const r = document.documentElement.style;
    r.setProperty("--nst", top + "px"); r.setProperty("--nsb", bottom + "px"); r.setProperty("--nsl", left + "px"); r.setProperty("--nsr", right + "px");
  };
  P("MotusBars")?.addListener?.("insets", pad);
  P("MotusBars")?.insets?.().then(pad, () => {});
  // the clock and icons follow the look, dark or light (theme.ts calls motusApp.setBars); phones before Android 6 also
  // colour the bars with it. Android reads only #rrggbb, so a short "#abc" is spelled out
  (globalThis as any).motusApp = {
    setBars: (bg: string, dark: boolean) => {
      const c = /^#[0-9a-f]{3}$/i.test(bg) ? "#" + [...bg.slice(1)].map((x) => x + x).join("") : bg;
      P("MotusBars")?.set?.({ bg: c, dark }).catch?.(() => {});
    },
  };
  // the look was put on the page before this bridge existed (main.ts starts the theme first), so the bars missed it:
  // give them the current one now
  applyTheme();
}
