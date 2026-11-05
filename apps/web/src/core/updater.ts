// In-app updates for the installed apps. The desktop app (Electron) and the Android app (Capacitor) each provide
// window.motusNative.update; in a browser there is nothing to install (the page simply loads the new version).
import { reactive } from "vue";

const nat = () => (globalThis as any).motusNative?.update;
export const updater = reactive({
  appVersion: "" as string,
  status: "" as string,
  ready: false,
  // share downloaded (0-1) while a download runs; null when idle or when the size is unknown
  progress: null as number | null,
  async install() {
    const u = nat(); if (!u) return;
    try {
      if (!updater.ready) {
        updater.status = "Downloading"; updater.progress = null;
        // p < 0 means the size is unknown: show the megabytes so far instead of a percentage
        await u.download((p: number, bytes?: number) => {
          updater.progress = p >= 0 ? p : null;
          updater.status = p >= 0 ? `Downloading ${Math.round(p * 100)}%` : bytes ? `Downloading ${(bytes / 1e6).toFixed(1)} MB` : "Downloading";
        });
        updater.progress = null; updater.ready = true; updater.status = "Ready to install";
      }
      else await u.install();
    } catch (e) { updater.progress = null; updater.status = (e as Error).message; }
  },
});
nat()?.version?.().then((v: string) => (updater.appVersion = v)).catch?.(() => {});
