// Inside the Android app (Capacitor): accounts, backups to a folder on the phone, the in-app updater, the status bar
// colours, and the back button. Exposed as window.motusNative, like the desktop app.
import { accounts, addLocal, addServer, open, remove, chooser } from "./accounts";

const cap = () => (globalThis as any).Capacitor;
const P = (n: string) => cap()?.Plugins?.[n];
export const isAndroid = () => cap()?.getPlatform?.() === "android";

const REPO = "userofit123/motus";
async function latestApk() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error("Could not reach GitHub");
  const j = await r.json();
  const manifest = j.assets?.find((a: any) => a.name === "android-latest.json");
  const meta = manifest ? await (await fetch(manifest.browser_download_url)).json() : null;
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
      addLocal, addServer, open, remove, chooser,
    },
    // backups go to Documents/Motus on the phone (the Filesystem plugin), newest `keep` are kept
    async saveBackup(name: string, bytes: Uint8Array, keep: number) {
      const fs = P("Filesystem");
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await fs.writeFile({ path: `Motus/${name}`, data: btoa(bin), directory: "DOCUMENTS", recursive: true });
      const list = (await fs.readdir({ path: "Motus", directory: "DOCUMENTS" })).files.map((f: any) => f.name ?? f).filter((n: string) => n.endsWith(".motusbackup")).sort().reverse();
      for (const old of list.slice(Math.max(1, keep))) await fs.deleteFile({ path: `Motus/${old}`, directory: "DOCUMENTS" }).catch(() => {});
      return `Documents/Motus/${name}`;
    },
    backupFolder: async () => "Documents/Motus",
    update: {
      version: async () => (await info)?.version ?? "",
      async check() { const l = await latestApk(); const cur = (await info)?.version ?? "0"; return { current: cur, latest: l.version, newer: newer(l.version, cur), notes: l.notes, url: l.html }; },
      // download the APK, check its SHA-256, then hand it to Android's installer (one tap to confirm, Android's rule)
      async download(onProgress: (p: number) => void) {
        const l = await latestApk();
        const res = await P("MotusUpdater").download({ url: l.url, sha256: l.sha256 });
        onProgress(1);
        staged = res.path;
      },
      async install() { if (staged) await P("MotusUpdater").install({ path: staged }); },
    },
  };
  // the hardware back button goes back in the app, and leaves it from the home page
  P("App")?.addListener?.("backButton", ({ canGoBack }: { canGoBack: boolean }) => { if (canGoBack && location.pathname !== "/") history.back(); else P("App").minimizeApp?.(); });
  // the status bar follows the look (theme.ts calls motusApp.setBars)
  (globalThis as any).motusApp = { setBars: (bg: string, dark: boolean) => { P("StatusBar")?.setBackgroundColor?.({ color: bg }).catch?.(() => {}); P("StatusBar")?.setStyle?.({ style: dark ? "DARK" : "LIGHT" }).catch?.(() => {}); } };
}

function newer(a: string, b: string) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}
