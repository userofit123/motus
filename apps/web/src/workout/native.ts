// What runs in the notification shade while something is going on (a workout, its rest, a recorded activity, the
// interval timer), with buttons to control it, plus keeping the screen on. The Android app shows these natively, on the
// lock screen too, with live clocks; a browser shows them through the service worker (sw.js), without a live clock.
import { confirm } from "../core/ask";
import { readJson, writeJson } from "../core/prefs";

const cap = () => (globalThis as any).Capacitor;
const plugin = (name: string) => cap()?.Plugins?.[name];

// A button on a notification: its id names what it does (handled by onNoticeAction), its title is what it says.
// Pause and Resume are separate ids, never one that flips: a quick double tap, or a tap on a notification that hasn't
// caught up yet, then can't land in the wrong state.
export interface NoticeButton { id: NoticeAction; title: string }
const NOTICE_ACTIONS = ["rest-more", "rest-skip", "workout-pause", "workout-resume", "workout-done", "rec-pause", "rec-resume", "iv-pause", "iv-resume", "iv-skip"] as const;
export type NoticeAction = (typeof NOTICE_ACTIONS)[number];
const isNoticeAction = (a: unknown): a is NoticeAction => typeof a === "string" && (NOTICE_ACTIONS as readonly string[]).includes(a);
const handlers = new Map<NoticeAction, { run: () => void; ready?: Promise<unknown> }>();
// Taps that came before their handler was registered (the app was still starting), each with when it came: run once it
// is, unless that took so long that the tap no longer means anything (a stale "Pause" would surprise). The same button
// tapped again while waiting counts once, and only the last few are kept.
const waiting: { a: NoticeAction; at: number }[] = [];
const WAIT_MAX = 10, HANDLER_WITHIN_MS = 10_000, READY_WITHIN_MS = 15_000;
let listening = false;
function dispatch(a: unknown) {
  if (!isNoticeAction(a)) return;
  const at = Date.now();
  if (handlers.has(a)) { deliver(a, at); return; }
  if (waiting.some((x) => x.a === a)) return;
  waiting.push({ a, at });
  if (waiting.length > WAIT_MAX) waiting.shift();
}
// a handler can say what it needs first (the workout's: the active workout loaded, or Pause would find none); the tap
// still runs if that comes within READY_WITHIN_MS of the tap
function deliver(a: NoticeAction, at: number) {
  const h = handlers.get(a);
  if (!h) return;
  if (!h.ready) { h.run(); return; }
  let late = false;
  const timer = setTimeout(() => { late = true; }, Math.max(0, at + READY_WITHIN_MS - Date.now()));
  void h.ready.then(() => { clearTimeout(timer); if (!late) h.run(); }, () => clearTimeout(timer));
}
// One listener for all of them, made at once: Android holds a tap back until the first listener, which then gets it,
// so every id has to go through this one.
function listen() {
  if (listening) return;
  listening = true;
  plugin("MotusWorkout")?.addListener?.("action", (e: { action?: unknown } | undefined) => dispatch(e?.action));
  try { navigator.serviceWorker?.addEventListener("message", (e: MessageEvent<{ motusAction?: unknown } | null>) => dispatch(e.data?.motusAction)); } catch { /* no service worker here */ }
}
/** What a notification button does. Android sends the tap as an "action" event, a browser's service worker as a message
 *  (or, with no window open, in the address of the one it opens: takeUrlAction). `ready`: what has to be there before
 *  a tap can do anything (taps wait for it). */
export function onNoticeAction(id: NoticeAction, run: () => void, ready?: Promise<unknown>) {
  handlers.set(id, { run, ready });
  listen();
  const now = Date.now();
  for (let i = waiting.findIndex((x) => x.a === id); i >= 0; i = waiting.findIndex((x) => x.a === id)) {
    const [w] = waiting.splice(i, 1);
    if (now - w!.at <= HANDLER_WITHIN_MS) deliver(id, w!.at);
  }
}
/** A button tapped while no window was open: the service worker opens the app with it in the address (?motusAction=…).
 *  Taken out of the address at once, so a reload doesn't do it again, and run once its handler is registered. */
export function takeUrlAction() {
  try {
    const u = new URL(location.href), a = u.searchParams.get("motusAction");
    if (a == null) return;
    u.searchParams.delete("motusAction");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    listen();
    dispatch(a);
  } catch { /* nothing to take */ }
}
// A browser notification through the service worker (only that kind can carry buttons, and a phone's browser allows
// no other); `tag` replaces the one shown before, quietly. Chrome shows at most two buttons.
// Showing and closing are both waits on the service worker; each tag's run one after the other, in the order asked, so a
// close that comes after a show can't finish first and leave the shown one behind.
const webQueue = new Map<string, Promise<void>>();
function inOrder(tag: string, job: () => Promise<void>): Promise<void> {
  const next = (webQueue.get(tag) ?? Promise.resolve()).then(job, job);
  webQueue.set(tag, next);
  return next;
}
function webNotice(title: string, o: { body: string; tag: string; url: string; buttons?: NoticeButton[]; since?: number | null; silent?: boolean; sticky?: boolean }) {
  if (isNativeApp() || !("Notification" in window) || Notification.permission !== "granted") return Promise.resolve();
  return inOrder(o.tag, async () => {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.showNotification(title, { body: o.body, tag: o.tag, silent: o.silent ?? true, requireInteraction: o.sticky ?? true, icon: "/icon-192.png", timestamp: o.since ?? undefined, data: { url: o.url }, actions: (o.buttons ?? []).slice(0, 2).map((b) => ({ action: b.id, title: b.title })) } as NotificationOptions);
    } catch { /* not allowed here */ }
  });
}
function closeWebNotice(tag: string) {
  return inOrder(tag, async () => {
    try { for (const n of (await (await navigator.serviceWorker?.getRegistration())?.getNotifications({ tag })) ?? []) n.close(); } catch { /* none shown */ }
  });
}
// the rest countdown's buttons (Android): the same as the workout screen's +15 and Skip rest, a bit more at a time
const REST_BUTTONS: NoticeButton[] = [{ id: "rest-more", title: "+30s" }, { id: "rest-skip", title: "Skip rest" }];

// The rest countdown in the notification shade (Android app), in place of the workout's while the rest runs.
export function showRestCountdown(endAt: number, body: string) {
  plugin("MotusWorkout")?.showRest?.({ endAt, body, actions: REST_BUTTONS }).catch?.(() => {});
}
export function clearRestCountdown() {
  plugin("MotusWorkout")?.clearRest?.().catch?.(() => {});
}
const REST_ALARM = 7001;
// The rest-over nudge in the Android app: an alarm at the rest's end that shows "Rest over" heads-up, with the rest
// channel's sound and vibration, also with the phone asleep and the app's own timers stopped. Scheduled only while
// the app is in the background (workout/runtime.ts), so on screen the in-app cues are the only alert. Each call
// replaces the one scheduled before. With sound and vibration both off (Settings → Workout) it goes on the quiet
// "running" channel of the workout's own notification (MotusWorkoutPlugin, made by the countdown shown first):
// in the shade, no heads-up, no sound (a channel's sound is fixed once made, and Capacitor can't make a silent one).
export async function scheduleRestAlarm(endAt: number, body: string, o: { sound: boolean; vibrate: boolean }) {
  const ln = plugin("LocalNotifications");
  if (!ln) return;
  try {
    await restChannel();
    await ln.cancel({ notifications: [{ id: REST_ALARM }] });
    await ln.schedule({ notifications: [{ id: REST_ALARM, title: "Rest over", body: body || "Time for the next set", schedule: { at: new Date(endAt), allowWhileIdle: true }, channelId: o.sound || o.vibrate ? "rest" : "running", smallIcon: "ic_stat_motus", actionTypeId: logFromNotification ? "rest" : undefined }] });
  } catch { /* the in-app timer still runs */ }
}
/** Takes the rest-over alarm off: the coming one, and the "Rest over" already shown. */
export async function cancelRestAlarm() {
  try { await plugin("LocalNotifications")?.cancel({ notifications: [{ id: REST_ALARM }] }); } catch { /* nothing scheduled */ }
}
// The rest is over, in a browser or the desktop app with Motus in the background (the Android app has its alarm
// above): in a browser "+30s" rests a little longer; the desktop app has no service worker, so its own notification
// (apps/desktop, without buttons). Background timers are slowed down, so this can come a second or so late.
export function notifyRestOverWeb(body: string) {
  const desk = (globalThis as any).motusNative?.notify;
  if (desk) return Promise.resolve(desk("Rest over", body || "Time for the next set", "/workout")).catch(() => {});
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
// at once: the clock (Android), distance and steps so far, and Pause or Resume. `keepAlive` (the Android app records a
// route or counts steps): it is the notification of the service that keeps them going with the screen off, so there is
// one notification, not that service's beside this one.
export async function showRecording(o: { title: string; body: string; since: number | null; actions: NoticeButton[]; keepAlive?: boolean }) {
  const p = plugin("MotusWorkout");
  if (p?.showRecording) { p.showRecording(o).catch?.(() => {}); return; }
  await webNotice(o.title, { body: o.body, tag: "motus-recording", url: "/activities/record", buttons: o.actions, since: o.since });
}
export async function clearRecording() {
  plugin("MotusWorkout")?.clearRecording?.().catch?.(() => {});
  await closeWebNotice("motus-recording");
}
export const isNativeApp = () => !!cap()?.isNativePlatform?.();
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
// High importance, so the rest-over notification comes heads-up, with the phone's notification sound and a vibration
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
// The interval timer's coming changes, for while the app is in the background (a locked phone pauses the app's own
// beeps): each, at its time, puts the timer's notification (showIntervalNotice) as it then is in place of the one shown,
// with the rest alarm's sound, so a run keeps one notification however many rounds it has. The Android app schedules
// them (alarms that come with the phone asleep); a browser can't schedule. Each call replaces those scheduled before.
// At most INTERVAL_CUE_MAX at a time; the caller passes only the next ones (see workout/intervals.ts).
export interface IntervalCue { at: number; title: string; body: string; endAt: number | null; actions: NoticeButton[]; done?: boolean }
export const INTERVAL_CUE_MAX = 60;
export function scheduleIntervalCues(cues: IntervalCue[]) {
  plugin("MotusWorkout")?.scheduleTimer?.({ cues: cues.slice(0, INTERVAL_CUE_MAX) }).catch?.(() => {});
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
// Its buttons go through the same dispatcher as every other notification button, so they wait for the workout like the
// rest and do nothing once it is over.
export async function enableNotificationActions(on: boolean) {
  logFromNotification = on;
  const ln = plugin("LocalNotifications");
  if (!ln || !on || registered) return;
  registered = true;
  try {
    await ln.registerActionTypes({ types: [{ id: "rest", actions: [{ id: "done", title: "Tick the next set" }, { id: "more", title: "+30s" }] }] });
    ln.addListener("localNotificationActionPerformed", (e: { actionId?: string } | undefined) => { if (e?.actionId === "done") dispatch("workout-done"); else if (e?.actionId === "more") dispatch("rest-more"); });
  } catch { /* buttons not available */ }
}
