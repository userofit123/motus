import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { router } from "./router";
import { queryClient } from "./api/live";
import { startTheme } from "./core/theme";
import "./styles/index.css";

startTheme();
createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount("#app");

// The service worker makes the web app installable on a phone ("Add to Home screen") and able to open offline.
// The Android and desktop apps carry their own files, so they don't need it.
if ("serviceWorker" in navigator && !(globalThis as any).Capacitor?.isNativePlatform?.() && !(globalThis as any).motusNative) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { /* not installable here, nothing else changes */ }));
}
