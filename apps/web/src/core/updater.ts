// In-app updates for the installed apps. The desktop app (Electron) and the Android app (Capacitor) each provide
// window.motusNative.update; in a browser there is nothing to install (the page simply loads the new version).
import { reactive } from "vue";

const nat = () => (globalThis as any).motusNative?.update;
export const updater = reactive({
  appVersion: "" as string,
  status: "" as string,
  ready: false,
  async install() {
    const u = nat(); if (!u) return;
    try {
      if (!updater.ready) { updater.status = "Downloading…"; await u.download((p: number) => (updater.status = `Downloading… ${Math.round(p * 100)}%`)); updater.ready = true; updater.status = "Ready to install"; }
      else await u.install();
    } catch (e) { updater.status = (e as Error).message; }
  },
});
nat()?.version?.().then((v: string) => (updater.appVersion = v)).catch?.(() => {});
