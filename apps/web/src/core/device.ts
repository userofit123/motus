// Phone or desktop layout: phone up to 860 px wide (or a touch screen up to 1100 px), unless chosen in Settings.
import { ref } from "vue";
import { readStr, writeStr } from "./prefs";

export const layoutChoice = ref<"auto" | "desktop" | "phone">((readStr("motusLayout", "auto") as any) || "auto");
const auto = () => {
  const w = Math.min(innerWidth, document.documentElement.clientWidth || innerWidth);
  return w <= 860 || (matchMedia("(pointer:coarse)").matches && w <= 1100);
};
export const isPhone = ref(layoutChoice.value === "auto" ? auto() : layoutChoice.value === "phone");
const update = () => {
  isPhone.value = layoutChoice.value === "auto" ? auto() : layoutChoice.value === "phone";
  document.documentElement.classList.toggle("phone", isPhone.value);
};
addEventListener("resize", update);
export function setLayout(v: "auto" | "desktop" | "phone") { layoutChoice.value = v; writeStr("motusLayout", v); update(); }
update();

/** The Android app (Capacitor) or the desktop app (Electron), when running inside one. */
export const native = {
  android: typeof (globalThis as any).Capacitor !== "undefined" && (globalThis as any).Capacitor?.getPlatform?.() === "android",
  desktop: typeof (globalThis as any).motusDesktop !== "undefined",
};
