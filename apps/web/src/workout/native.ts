// What runs in the notification shade while something is going on (a workout, its rest, a recorded activity, the
// interval timer), with buttons to control it, plus keeping the screen on. The Android app shows these natively, on the
// lock screen too, with live clocks; a browser shows them through the service worker (sw.js), without a live clock.
import { confirm } from "../core/ask";
import { readJson, writeJson } from "../core/prefs";

const cap = () => (globalThis as any).Capacitor;
const plugin = (name: string) => cap()?.Plugins?.[name];

// A button on a notification: its id names what it does (handled by onNoticeAction), its title is what it says.
export interface NoticeButton { id: NoticeAction; title: string }
export type NoticeAction = "rest-more" | "rest-skip" | "workout-pause" | "workout-done" | "rec-pause" | "iv-pause" | "iv-skip";
const handlers = new Map<string, () => void>();
let listening = false;
/** What a notification button does. Android sends the tap as an "action" event, a browser's service worker as a message. */
export function onNoticeAction(id: NoticeAction, run: () => void) {
  handlers.set(id, run);
  if (listening) return;
  listening = true;
  const go = (a: unknown) => { if (typeof a === "string") handlers.get(a)?.(); };
  plugin("MotusWorkout")?.addListener?.("action", (e: any) => go(e?.action));
  try { navigator.serviceWorker?.addEventListener("message", (e) => go(e.data?.motusAction)); } catch { /* no service worker here */ }
}
// A browser notification through the service worker (only that kind can carry buttons, and a phone's browser allows
// no other); `tag` replaces the one shown before, quietly. Chrome shows at most two buttons.
async function webNotice(title: string, o: { body: string; tag: string; url: string; buttons?: NoticeButton[]; since?: number | null; silent?: boolean; sticky?: boolean }) {
  if (isNativeApp() || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.showNotification(title, { body: o.body, tag: o.tag, silent: o.silent ?? true, requireInteraction: o.sticky ?? true, icon: "/icon-192.png", timestamp: o.since ?? undefined, data: { url: o.url }, actions: (o.buttons ?? []).slice(0, 2).map((b) => ({ action: b.id, title: b.title })) } as NotificationOptions);
  } catch { /* not allowed here */ }
}
async function closeWebNotice(tag: string) {
  try { for (const n of (await (await navigator.serviceWorker?.getRegistration())?.getNotifications({ tag })) ?? []) n.close(); } catch { /* none shown */ }
}
// the rest countdown's buttons (Android): the same as the workout screen's +15 and Skip rest, a bit more at a time
const REST_BUTTONS: NoticeButton[] = [{ id: "rest-more", title: "+30s" }, { id: "rest-skip", title: "Skip rest" }];

export async function notifyRestEnd(endAt: number, body: string) {
  const ln = plugin("LocalNotifications");
  if (!ln) return;
  try {
    await ln.cancel({ notifications: [{ id: 7001 }] });
    await ln.schedule({ notifications: [{ id: 7001, title: "Rest over", body: body || "Time for the next set", schedule: { at: new Date(endAt), allowWhileIdle: true }, channelId: "rest", smallIcon: "ic_stat_motus", actionTypeId: logFromNotification ? "rest" : undefined }] });
  } catch { /* the in-app timer still runs */ }
  plugin("MotusWorkout")?.showRest?.({ endAt, body, actions: REST_BUTTONS }).catch?.(() => {});
}
// The rest is over, in a browser with the app in the background (the Android app has its alarm above): "+30s" rests a
// little longer. The page's timers are slowed down in the background, so this can come a few seconds late.
export function notifyRestOverWeb(body: string) {
  return webNotice("Rest over", { body: body || "Time for the next set", tag: "motus-rest", url: "/workout", buttons: [REST_BUTTONS[0]!], silent: false, sticky: false });
}
// The workout in progress as a notification (setting "sessionNotice"): its name, the exercise and set you're on, and
// a running clock in the Android app, with buttons (pause or go on, and tick the set with "Log from the notification").
// Updated when something changes, not every second; on Android the rest countdown takes its place while a rest runs.
export async function showSession(o: { title: string; body: string; since: number | null; actions: NoticeButton[] }) {
  const p = plugin("MotusWorkout");
  if (p?.showSession) { p.showSession(o).catch?.(() => {}); return; }
  await webNotice(o.title, { body: o.body, tag: "motus-session", url: "/workout", buttons: o.actions });
}
export async function clearSession() {
  plugin("MotusWorkout")?.clearSession?.().catch?.(() => {});
  await closeWebNotice("motus-session");
}
// An activity being recorded (workout/recording.ts), as its own notification next to the workout's, since both can run
// at once: the clock (Android), distance and steps so far, and Pause or Resume. In the Android app the location service
// that keeps recording with the screen off shows one more of its own while the app is in the background (Android
// requires it); this one is the one with the numbers and the button.
export async function showRecording(o: { title: string; body: string; since: number | null; actions: NoticeButton[] }) {
  const p = plugin("MotusWorkout");
  if (p?.showRecording) { p.showRecording(o).catch?.(() => {}); return; }
  await webNotice(o.title, { body: o.body, tag: "motus-recording", url: "/activities/record", buttons: o.actions, since: o.since });
}
export async function clearRecording() {
  plugin("MotusWorkout")?.clearRecording?.().catch?.(() => {});
  await closeWebNotice("motus-recording");
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
/** Whether this device lets Motus show notifications: the Android app asks Android (13+ needs the permission), a
 *  browser has its own; "unsupported" where there are none (a browser without them, such as Safari outside the home screen). */
export type NotificationState = "granted" | "denied" | "prompt" | "unsupported";
export async function notificationState(): Promise<NotificationState> {
  const ln = plugin("LocalNotifications");
  if (ln) {
    try { const d = (await ln.checkPermissions())?.display; return d === "granted" ? "granted" : d === "denied" ? "denied" : "prompt"; }
    catch { return "unsupported"; }
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}
// Starting a workout, an activity or the interval timer while notifications aren't allowed yet: ask once on this device,
// in the app's own words first, then the system's question. Whatever the answer, never again (Settings → Notifications
// can still turn them on).
const ASKED = "motusNotifAsked";
export async function askNotificationsOnce() {
  await restChannel(); // the rest alarm's sound channel, also when nothing needs asking (allowed already, Android 12 and older)
  if (readJson<boolean>(ASKED, false) || (await notificationState()) !== "prompt") return;
  writeJson(ASKED, true);
  const yes = await confirm("Show a notification while it runs?", { text: "The time, where you are and buttons to pause or skip, in the notification shade and on the lock screen. You can change this later in Settings → Notifications.", ok: "Turn on", no: "Not now" });
  if (yes) await askNotificationPermission();
}
async function restChannel() {
  try { await plugin("LocalNotifications")?.createChannel?.({ id: "rest", name: "Rest timer", importance: 5, vibration: true }); } catch { /* made next time */ }
}
export async function askNotificationPermission() {
  const ln = plugin("LocalNotifications");
  try {
    if (ln) { await ln.requestPermissions(); await restChannel(); }
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
// the lock screen: the part and round, a countdown to the end of the part (Android; none while paused), and Pause or
// Resume and Skip; tapping it opens the timer. A browser has no live countdown, so there it shows the part only.
export function showIntervalNotice(o: { title: string; body: string; endAt: number | null; actions: NoticeButton[] }) {
  const p = plugin("MotusWorkout");
  if (p?.showTimer) { p.showTimer(o).catch?.(() => {}); return; }
  void webNotice(o.title, { body: o.body, tag: "motus-timer", url: "/timer", buttons: o.actions });
}
export function clearIntervalNotice() {
  plugin("MotusWorkout")?.clearTimer?.().catch?.(() => {});
  void closeWebNotice("motus-timer");
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
