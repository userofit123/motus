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
    await ln.schedule({ notifications: [{ id: 7001, title: "Rest over", body: body || "Time for the next set", schedule: { at: new Date(endAt), allowWhileIdle: true }, channelId: "rest", smallIcon: "ic_stat_motus", actionTypeId: logFromNotification ? "rest" : undefined }] });
  } catch { /* the in-app timer still runs */ }
  plugin("MotusWorkout")?.showRest?.({ endAt, body }).catch?.(() => {});
}
// The workout in progress as a notification (setting "sessionNotice"): its name, the exercise and set you're on, and
// a running clock in the Android app. Updated when something changes, not every second; on Android the rest countdown
// takes its place while a rest runs. In a browser it goes through the service worker, so it can be updated in place.
export async function showSession(o: { title: string; body: string; since: number | null }) {
  const p = plugin("MotusWorkout");
  if (p?.showSession) { p.showSession(o).catch?.(() => {}); return; }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.showNotification(o.title, { body: o.body, tag: "motus-session", silent: true, requireInteraction: true, icon: "/icon-192.png", data: { url: "/workout" } } as NotificationOptions);
  } catch { /* not allowed here */ }
}
export async function clearSession() {
  plugin("MotusWorkout")?.clearSession?.().catch?.(() => {});
  try { for (const n of (await (await navigator.serviceWorker?.getRegistration())?.getNotifications({ tag: "motus-session" })) ?? []) n.close(); } catch { /* none shown */ }
}
// A walk being recorded (workout/recording.ts), as its own notification next to the workout's, since both can run at once.
// Only in a browser: in the Android app the location service that keeps recording with the screen off already shows
// one ("Recording your walk"), and a second would just repeat it.
export async function showRecording(o: { title: string; body: string; since: number | null }) {
  if (isNativeApp() || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.showNotification(o.title, { body: o.body, tag: "motus-recording", silent: true, requireInteraction: true, icon: "/icon-192.png", timestamp: o.since ?? undefined, data: { url: "/activities/record" } } as NotificationOptions);
  } catch { /* not allowed here */ }
}
export async function clearRecording() {
  try { for (const n of (await (await navigator.serviceWorker?.getRegistration())?.getNotifications({ tag: "motus-recording" })) ?? []) n.close(); } catch { /* none shown */ }
}
export const isNativeApp = () => !!cap()?.isNativePlatform?.();
export async function cancelRestNotification() {
  try { await plugin("LocalNotifications")?.cancel({ notifications: [{ id: 7001 }] }); } catch { /* nothing scheduled */ }
  plugin("MotusWorkout")?.clearRest?.().catch?.(() => {});
}
// the screen stays on while a workout or a recording wants it; one ending doesn't let the screen sleep under the other.
// In a browser the lock is let go when the page is hidden, so asking again on return takes it back.
const awake = new Set<string>();
let wake: any = null;
export async function keepAwake(on: boolean, who: "workout" | "recording" | "intervals" = "workout") {
  if (on) awake.add(who); else awake.delete(who);
  const want = awake.size > 0, k = plugin("KeepAwake");
  try {
    if (k) await (want ? k.keepAwake() : k.allowSleep());
    else if (want) { if (!wake || wake.released) wake = await (navigator as any).wakeLock?.request("screen"); }
    else { await wake?.release(); wake = null; }
  } catch { /* the screen may dim */ }
}
export async function askNotificationPermission() {
  const ln = plugin("LocalNotifications");
  try {
    if (ln) { await ln.requestPermissions(); await ln.createChannel?.({ id: "rest", name: "Rest timer", importance: 5, vibration: true }); }
    else if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  } catch { /* the in-app timer still works */ }
}
// The interval timer's phase changes as notifications, scheduled only while the app is in the background (a locked phone
// pauses the app's own beeps); ids 7100+ so they never touch the rest timer's. Android app only: a browser can't schedule.
// At most INTERVAL_CUE_MAX at a time; the caller passes only the next ones (see workout/intervals.ts).
export const INTERVAL_CUE_MAX = 60;
const INTERVAL_IDS = Array.from({ length: INTERVAL_CUE_MAX }, (_, i) => ({ id: 7100 + i }));
export async function scheduleIntervalCues(cues: { at: number; title: string; body: string }[]) {
  const ln = plugin("LocalNotifications");
  if (!ln) return;
  try {
    await ln.cancel({ notifications: INTERVAL_IDS });
    if (cues.length) await ln.schedule({ notifications: cues.slice(0, INTERVAL_CUE_MAX).map((c, i) => ({ id: 7100 + i, title: c.title, body: c.body, schedule: { at: new Date(c.at), allowWhileIdle: true }, channelId: "rest", smallIcon: "ic_stat_motus" })) });
  } catch { /* the in-app timer still runs */ }
}
export const cancelIntervalCues = () => scheduleIntervalCues([]);
// The running interval timer as its own ongoing notification (beside the workout's, since both can run at once), also on
// the lock screen: the part and round, and a countdown to the end of the part (none while paused); tapping it opens the
// timer. Android app only: a browser has no live countdown in a notification, so there the phase-change cues are all.
export function showIntervalNotice(o: { title: string; body: string; endAt: number | null }) {
  plugin("MotusWorkout")?.showTimer?.(o).catch?.(() => {});
}
export function clearIntervalNotice() {
  plugin("MotusWorkout")?.clearTimer?.().catch?.(() => {});
}
export const haptic = (style: "light" | "medium" = "light") => {
  const h = plugin("Haptics");
  try { if (h) h.impact({ style: style === "light" ? "LIGHT" : "MEDIUM" }); else navigator.vibrate?.(style === "light" ? 12 : 25); } catch { /* none */ }
};

// "Log from the notification" (optional feature): the rest-over notification gets buttons to tick the next set or rest longer
let logFromNotification = false;
let registered = false;
export async function enableNotificationActions(on: boolean, handlers: { done: () => void; more: () => void }) {
  logFromNotification = on;
  const ln = plugin("LocalNotifications");
  if (!ln || !on || registered) return;
  registered = true;
  try {
    await ln.registerActionTypes({ types: [{ id: "rest", actions: [{ id: "done", title: "Tick the next set" }, { id: "more", title: "+30s" }] }] });
    ln.addListener("localNotificationActionPerformed", (e: any) => { if (e.actionId === "done") handlers.done(); else if (e.actionId === "more") handlers.more(); });
  } catch { /* buttons not available */ }
}
