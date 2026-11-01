// What only the installed apps can do during a workout: a notification when the rest ends while the phone is locked,
// an ongoing countdown in the notification shade, and keeping the screen on. In a browser these quietly do nothing
// (the web app beeps and shows a system notification instead, see runtime.ts).
const cap = () => (globalThis as any).Capacitor;
const plugin = (name: string) => cap()?.Plugins?.[name];

export async function notifyRestEnd(endAt: number, body: string) {
  const ln = plugin("LocalNotifications");
  if (!ln) return;
  try {
    await ln.cancel({ notifications: [{ id: 7001 }] });
    await ln.schedule({ notifications: [{ id: 7001, title: "Rest over", body: body || "Time for the next set", schedule: { at: new Date(endAt), allowWhileIdle: true }, channelId: "rest", smallIcon: "ic_stat_motus" }] });
  } catch { /* the in-app timer still runs */ }
  plugin("MotusWorkout")?.showRest?.({ endAt, body }).catch?.(() => {});
}
export async function cancelRestNotification() {
  try { await plugin("LocalNotifications")?.cancel({ notifications: [{ id: 7001 }] }); } catch { /* nothing scheduled */ }
  plugin("MotusWorkout")?.clearRest?.().catch?.(() => {});
}
export async function keepAwake(on: boolean) {
  const k = plugin("KeepAwake");
  try { if (k) await (on ? k.keepAwake() : k.allowSleep()); else if (on) await (navigator as any).wakeLock?.request("screen"); } catch { /* the screen may dim */ }
}
export async function askNotificationPermission() {
  const ln = plugin("LocalNotifications");
  try {
    if (ln) { await ln.requestPermissions(); await ln.createChannel?.({ id: "rest", name: "Rest timer", importance: 5, vibration: true, sound: "beep.wav" }); }
    else if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  } catch { /* the in-app timer still works */ }
}
export const haptic = (style: "light" | "medium" = "light") => {
  const h = plugin("Haptics");
  try { if (h) h.impact({ style: style === "light" ? "LIGHT" : "MEDIUM" }); else navigator.vibrate?.(style === "light" ? 12 : 25); } catch { /* none */ }
};
