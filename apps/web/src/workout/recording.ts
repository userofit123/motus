// The walk, run, hike or ride being recorded (requirement 18). It lives here, not in its page, so it keeps recording
// while you use the rest of the app: a recording and a gym workout are different things and may run at the same time
// (a walk to the gym, then the workout), and the bars at the bottom of the screen show each one.
// Everything is saved on this device as it comes in, so a reload or closing the app never loses a walk.
//
// Steps: the Android app takes them from the phone's step counter, its own pedometer, which only counts real walking and
// keeps counting with the screen off (the recording's notification keeps the app going for it, as for the route:
// RecordingService); it reports every few seconds, so the count goes up in small bunches (MotusWorkoutPlugin). Browsers
// have no step counter, so there the steps are an estimate from the phone's motion sensor while Motus is open on screen
// (the same limit as the route: a browser stops both when the screen goes off), and the screen says so. A computer has no
// motion sensor, so the steps say so there.
// Which types count steps is the type's own "on foot" setting (walk, run and hike, and any type you add as on foot).
import { computed, ref, watch } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import type { SettingsMe } from "../api/queries";
import { makeFmt } from "../core/format";
import { keepAwake, showRecording, clearRecording, isNativeApp, onNoticeAction, askNotificationsOnce } from "./native";
import { fromM, clock, num, routeStats, takesPoint, addStepReading, stepsPaused, MotionSteps, ROUTE_ROUGH_M, type StepReading } from "@motus/shared";

export interface Rec {
  type: string; startedAt: number; route: number[][]; pausedMs: number; pauseAt: number | null;
  /** steps counted so far (not while paused) */
  steps: number;
  /** the Android app's step counter: which run of it the last reading came from (it starts again with the app) and its
   *  count then, so a reading adds only what's new (addStepReading) */
  stepSession: number | null; stepSeen: number;
  /** indexes of route points that start again after a pause: the way walked while paused isn't counted */
  breaks: number[];
}
const KEY = "motusRecording";
const typeInfo = (slug: string) => (queryClient.getQueryData<any[]>(["activities", "types"]) ?? []).find((x) => x.slug === slug) as { name: string; hasGps: boolean; hasDistance: boolean; hasSteps?: boolean } | undefined;
/** the type is on foot, so steps are counted; before the types have loaded, the built-in walk, run and hike are */
export const countsSteps = (slug: string) => typeInfo(slug)?.hasSteps ?? ["walk", "run", "hike"].includes(slug);

function load(): Rec | null {
  const r = readJson<any>(KEY, null);
  if (!r || !r.startedAt) return null;
  // a recording saved by an earlier version kept the phone's own step total; its steps so far stay, and counting goes on
  // from the next reading
  return { type: r.type ?? "walk", startedAt: r.startedAt, route: r.route ?? [], pausedMs: r.pausedMs ?? 0, pauseAt: r.pauseAt ?? null, steps: typeof r.steps === "number" ? r.steps : 0, stepSession: r.stepSession ?? null, stepSeen: r.stepSeen ?? 0, breaks: r.breaks ?? [] };
}

export const recording = ref<Rec | null>(load());
/** where Start goes for an activity: back to the recording already running (only one runs at a time), or a new one of this type */
export const recordPath = (type?: string | null) => (recording.value ? "/activities/record" : `/activities/record?type=${type ?? "walk"}`);
/** a clock tick while recording, so every screen showing the time moves together */
const recNow = ref(Date.now());
export const gpsError = ref("");
/** where you are now (the newest fix, rough ones too) and how sure the phone is of it, in metres; shown on the map */
export const here = ref<{ lat: number; lon: number; acc: number } | null>(null);
/** steps are counted on this device: the phone's step counter, or motion readings coming in */
export const stepsLive = ref(false);
/** steps are an estimate from the motion sensor, which only counts while Motus is on screen */
export const stepsOnScreen = ref(false);
/** why steps aren't counted here, shown in the steps block instead of a count that never moves */
export const stepsError = ref("");

/** the route's distance, moving time and climb, worked out as the server does, without the way covered while paused */
const recStats = computed(() => routeStats(recording.value?.route ?? [], recording.value?.breaks));
export const recDistM = computed(() => recStats.value.distanceM);
export const recElapsedS = computed(() => { const r = recording.value; return r ? Math.max(0, ((r.pauseAt ?? recNow.value) - r.startedAt - r.pausedMs) / 1000) : 0; });
/** steps are worth saving: a step source ran, or steps were counted earlier in this recording */
const recStepsCounted = computed(() => !!recording.value && (stepsLive.value || recording.value.steps > 0));

// Saving the whole route on every step reading would be wasteful; points are saved as they come, steps within a few
// seconds. A later step doesn't put that off again: while you walk on, steps come every second, so they'd never be saved.
let saveT: ReturnType<typeof setTimeout> | null = null;
function persist(soon = false) {
  if (soon) { saveT ??= setTimeout(() => persist(), 3000); return; }
  if (saveT) { clearTimeout(saveT); saveT = null; }
  if (recording.value) writeJson(KEY, recording.value); else { try { localStorage.removeItem(KEY); } catch { /* not stored */ } }
}

// ---- route ----
const BG = () => (globalThis as any).Capacitor?.Plugins?.BackgroundGeolocation;
let watchId: number | null = null, bgId: string | null = null;
/** the route comes from the Android app's location plugin, kept going with the screen off by the recording's notification */
const bgOn = ref(false);
function onPoint(lat: number, lon: number, time: number, alt: number | null | undefined, acc: number) {
  const r = recording.value;
  here.value = { lat, lon, acc };
  // a rough fix would zig-zag the route and add distance you didn't go: say why nothing is drawn yet. Much rougher than
  // any GPS is the phone's approximate location, which never gets better on its own.
  gpsError.value = acc > 500 ? "Allow precise location for Motus to record the route" : acc > ROUTE_ROUGH_M ? `Weak GPS signal (±${Math.round(acc)} m), waiting for a better one` : "";
  if (!r) return;
  const pt = [lat, lon, Math.round(time / 1000), alt ?? undefined] as number[];
  if (!takesPoint(r.route, pt, acc, !!r.pauseAt)) return;
  r.route.push(pt); persist();
}
async function startGps() {
  if (watchId != null || bgId) return;
  if (BG()) {
    try {
      // No backgroundMessage, so the plugin shows no notification of its own: in the Android app the recording's
      // notification is the one of the foreground service that keeps the route going with the screen off (keepAlive below).
      bgId = await BG().addWatcher({ requestPermissions: true, stale: false, distanceFilter: 3 },
        (loc: any, err: any) => { if (err) { gpsError.value = err.code === "NOT_AUTHORIZED" ? "Allow location to record the route" : "Looking for GPS…"; return; } if (loc) onPoint(loc.latitude, loc.longitude, loc.time ?? Date.now(), loc.altitude, loc.accuracy ?? 0); });
      bgOn.value = true;
      return;
    } catch { /* fall back to the browser's location */ }
  }
  if (!("geolocation" in navigator)) { gpsError.value = "Location is not available here"; return; }
  watchId = navigator.geolocation.watchPosition((p) => onPoint(p.coords.latitude, p.coords.longitude, p.timestamp, p.coords.altitude, p.coords.accuracy),
    (e) => (gpsError.value = e.code === 1 ? "Allow location to record the route" : "Looking for GPS…"), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
/** Before you start: show where you are, so the map isn't somewhere else and the GPS has warmed up by the time you go. */
let previewId: number | null = null;
export function previewLocation(on: boolean) {
  if (!on || recording.value) { if (previewId != null) navigator.geolocation.clearWatch(previewId); previewId = null; return; }
  if (previewId != null || !("geolocation" in navigator)) return;
  previewId = navigator.geolocation.watchPosition((p) => { here.value = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; gpsError.value = ""; },
    (e) => (gpsError.value = e.code === 1 ? "Allow location to record the route" : "Looking for GPS…"), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function stopGps() {
  if (bgId) BG()?.removeWatcher({ id: bgId }).catch?.(() => {});
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  bgId = null; watchId = null; bgOn.value = false; gpsError.value = "";
}

// ---- steps: the phone's step counter (Android app) ----
// The app counts itself (MotusWorkoutPlugin) and sends the count so far with each report; the recording adds what it
// grew by (addStepReading). So nothing is lost while this page is held up with the screen off, or reloaded.
const WP = () => (globalThis as any).Capacitor?.Plugins?.MotusWorkout;
// (the web app doesn't depend on Capacitor, so this is the shape of its PluginListenerHandle)
let stepSub: { remove: () => Promise<void> | void } | null = null;
/** the Android app's step counter counts for this recording (and the recording's notification keeps it going) */
const nativeSteps = ref(false);
/** what the Android plugin sends: the count since `session`, -1 before the counter's first report */
interface NativeReading { session?: number; counter?: number }
/** `counting`: the reading has steps from before the pause, so they count even though it is paused now; `skip`: it has
 *  steps from a pause just ended, so they don't */
function onReading(e: NativeReading | null | undefined, counting = false, skip = false) {
  const r = recording.value;
  const x: StepReading = { session: Number(e?.session), counter: Number(e?.counter ?? -1) };
  if (!r || !Number.isFinite(x.session) || !Number.isFinite(x.counter)) return;
  // reports while Pause's reading is on its way count (taken before it), and while Resume's is they don't; with both on
  // their way, the one asked first decides (the other waits for it)
  const paused = skip || (!counting && stepsPaused(!!r.pauseAt, settling ? settleNo : null, resuming ? resumeNo : null));
  const s = addStepReading({ steps: r.steps, session: r.stepSession, seen: r.stepSeen }, x, paused);
  r.steps = s.steps; r.stepSession = s.session; r.stepSeen = s.seen;
  persist(true);
}
async function startNativeSteps(fresh: boolean) {
  const p = WP(); if (nativeSteps.value) return;
  try {
    // asks for "Physical activity" the first time (Android 10+); without it no steps are counted
    const r = await p.startSteps({ fresh });
    if (r?.denied) { stepsError.value = "Allow Physical activity for Motus in Android settings to count steps"; return; }
    // a phone without a step counter still has a motion sensor: an estimate from it while Motus is on screen
    if (!r?.available) { startMotion(false); return; }
    if (!recording.value) { WP()?.stopSteps?.().catch?.(() => {}); return; } // ended while the permission was asked
    stepsError.value = "";
    nativeSteps.value = true; stepsLive.value = true; // 0 until the counter's first report
    stepSub = await p.addListener("steps", onReading);
    onReading(r); // the steps taken since a reload, before this page listened again
  } catch { startMotion(false); }
}
/** The count with the steps the counter still holds back (it reports up to ten seconds late). At most three seconds;
 *  null without an answer. */
function lastSteps(): Promise<NativeReading | null> {
  const p = WP();
  const last = p?.getLastSteps ? p.getLastSteps() : p?.getSteps?.(); // an older Android app has no getLastSteps
  return Promise.race([Promise.resolve(last), new Promise<null>((ok) => setTimeout(ok, 3000, null))]).catch(() => null);
}
/** The steps held back, asked for on Pause and Finish: they were taken before it, so they count, as do reports that
 *  come in meanwhile. */
let settling: Promise<void> | null = null;
/** the order Pause's and Resume's readings were asked in, so the older one on its way decides (stepsPaused) */
let asked = 0, settleNo = 0, resumeNo = 0;
function settleSteps(): Promise<void> {
  if (!nativeSteps.value) return Promise.resolve();
  if (settling) return settling;
  settleNo = ++asked;
  // after a Resume's reading still on its way, so the steps of that pause stay out
  settling = (resuming ?? Promise.resolve()).then(lastSteps).then((x) => onReading(x, true)).finally(() => { settling = null; });
  return settling;
}
/** The steps held back, asked for on Resume: taken while paused (the last seconds of it), so they only move the count's
 *  start on, as do reports that come in meanwhile. The clock goes on at once. */
let resuming: Promise<void> | null = null;
function resumeSteps(): Promise<void> {
  if (!nativeSteps.value) return Promise.resolve();
  // after Pause's own reading, which counts the steps from before it
  const after = settling ?? Promise.resolve();
  resumeNo = ++asked;
  const me: Promise<void> = (resuming = after.then(lastSteps).then((x) => onReading(x, false, true)).finally(() => { if (resuming === me) resuming = null; }));
  return me;
}
/** The Record screen is open, before you start: the Android app listens to the step counter already, so the walk's
 *  first steps count even on phones whose counter reports them only once you're walking (MotusWorkoutPlugin). */
export function previewSteps(on: boolean) {
  try { WP()?.previewSteps?.({ on })?.catch?.(() => {}); } catch { /* no step counter here */ }
}
/** back on screen: the counts as they are now, in case this page was held up while the screen was off */
async function catchUpSteps() {
  if (!nativeSteps.value) return;
  try { onReading(await WP()?.getSteps?.()); } catch { /* the next step brings it */ }
}

// ---- steps: an estimate from the motion sensor (browsers) ----
// Steps count once you walk in a steady rhythm, the first few at once then each as it comes (MotionSteps).
let motionOn = false, motion = new MotionSteps();
let motionWait: ReturnType<typeof setTimeout> | null = null;
function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  if (!stepsLive.value) { stepsLive.value = true; stepsError.value = ""; }
  const n = motion.push(Math.hypot(a.x, a.y, a.z), e.timeStamp || performance.now());
  const r = recording.value;
  if (!n || !r || r.pauseAt) return;
  r.steps += n; persist(true);
}
const NO_SENSOR = "This device has no motion sensor, so steps aren't counted";
async function startMotion(fromTap: boolean) {
  if (motionOn) return;
  if (typeof DeviceMotionEvent === "undefined") { stepsError.value = NO_SENSOR; return; }
  // iPhones ask first, and only when asked from a tap; elsewhere the sensor is simply there (or never sends anything)
  const ask = (DeviceMotionEvent as any).requestPermission;
  if (typeof ask === "function") {
    if (!fromTap) { stepsError.value = "Steps stopped when Motus was reopened"; return; }
    try { if ((await ask()) !== "granted") { stepsError.value = "Allow Motion & Orientation access to count steps"; return; } } catch { stepsError.value = NO_SENSOR; return; }
  }
  motionOn = true; stepsOnScreen.value = true; motion = new MotionSteps();
  addEventListener("devicemotion", onMotion);
  // a computer has the browser feature but no sensor behind it: nothing ever arrives, so say so
  motionWait = setTimeout(() => { motionWait = null; if (motionOn && !stepsLive.value) stepsError.value = NO_SENSOR; }, 5000);
}
function stopSteps() {
  stepSub?.remove?.(); stepSub = null;
  if (nativeSteps.value) WP()?.stopSteps?.().catch?.(() => {});
  nativeSteps.value = false;
  if (motionOn) removeEventListener("devicemotion", onMotion);
  if (motionWait) clearTimeout(motionWait);
  motionOn = false; motionWait = null; stepsLive.value = false; stepsOnScreen.value = false; stepsError.value = "";
}

// ---- running it ----
let tick: ReturnType<typeof setInterval> | null = null;
const typeName = (slug: string) => ((queryClient.getQueryData<any[]>(["activities", "types"]) ?? []).find((x) => x.slug === slug)?.name as string | undefined) ?? (slug[0]?.toUpperCase() + slug.slice(1));
/** `fresh`: a new recording, so the step counter counts from zero; otherwise one left running picks up where it was */
async function startSensors(fromTap: boolean, fresh: boolean) {
  const r = recording.value; if (!r) return;
  recNow.value = Date.now();
  if (!tick) tick = setInterval(() => (recNow.value = Date.now()), 1000);
  // the motion sensor's permission (iPhone) has to be asked straight from the tap, so nothing is awaited before it
  keepAwake(true, "recording");
  // Android shows one permission question at a time, so the steps' (physical activity) is answered before location is asked
  if (countsSteps(r.type)) { if (WP()?.startSteps) await startNativeSteps(fresh); else void startMotion(fromTap); }
  // a type without a route (yoga, a spin class, climbing) records time only, so location is never asked for
  if (recording.value && typeInfo(r.type)?.hasGps !== false) startGps();
}
function stopAll() {
  stopGps(); stopSteps();
  if (tick) clearInterval(tick); tick = null;
  keepAwake(false, "recording"); clearRecording();
}

export function startRecording(type: string) {
  previewLocation(false);
  recording.value = { type, startedAt: Date.now(), route: [], pausedMs: 0, pauseAt: null, steps: 0, stepSession: null, stepSeen: 0, breaks: [] };
  persist(); void startSensors(true, true);
  void askNotificationsOnce();
}
export function togglePause() {
  setPaused(!recording.value?.pauseAt);
}
// paused or going on; nothing when it already is (a second tap on a notification that hadn't caught up yet)
function setPaused(on: boolean) {
  const r = recording.value; if (!r || !!r.pauseAt === on) return;
  // going on again: the next point starts a new stretch, so the way between where you paused and where you go on isn't counted
  // going on: the steps the counter still holds back were taken while paused (resumeSteps)
  // either way the notification is shown again once the held-back steps are in: Pause's count was short of them, and
  // Resume's start of the count (stepSeen) was still before the steps taken while paused
  if (r.pauseAt) { void resumeSteps().then(stepsSettled); r.pausedMs += Date.now() - r.pauseAt; r.pauseAt = null; if (r.route.length) r.breaks.push(r.route.length); } else { r.pauseAt = Date.now(); void settleSteps().then(stepsSettled); }
  persist();
}
/** bumped once Pause's or Resume's held-back steps are in, so the notification is shown again with them */
const stepsRev = ref(0);
const stepsSettled = () => { stepsRev.value++; };
/** saves it as an activity and returns its id */
export async function finishRecording(): Promise<string> {
  const r = recording.value!;
  // the last steps before Finish (or before a Pause just pressed); none taken while paused
  if (!r.pauseAt || settling) await settleSteps();
  if (saveT) persist();
  const end = r.pauseAt ?? Date.now();
  // the server works these out from the route too, but can't know where the pauses were
  const rs = r.route.length > 1 ? recStats.value : null;
  const res = await api.post("/activities", { type: r.type, startedAt: new Date(r.startedAt).toISOString(), endedAt: new Date(end).toISOString(), durationS: Math.round(recElapsedS.value), route: r.route, distanceM: rs?.distanceM, movingS: rs?.movingS, elevationM: rs?.elevationM, steps: recStepsCounted.value ? r.steps : null, source: "gps", clientId: `gps:${r.startedAt}` });
  recording.value = null; persist(); stopAll();
  invalidate(["activities", "stats", "goals", "home", "calendar"]);
  return res.id;
}
export function discardRecording() { recording.value = null; persist(); stopAll(); }

export const recTypeName = () => typeName(recording.value?.type ?? "walk");

// a recording left running (a reload, or the app was closed) picks up where it was
if (recording.value) void startSensors(false, false);
// a browser lets go of "keep the screen on" whenever the page is hidden; take it again on coming back
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (recording.value && document.visibilityState === "visible") { keepAwake(true, "recording"); void catchUpSteps(); } });

// The recording as a notification too (same setting as the workout's), also on the lock screen in the Android app: its
// clock there (a browser's can't run one, so it says when it started; while paused the time so far is in the text), the
// distance in your units and the steps where they're counted, and Pause or Resume. Shown again when those change: the
// distance by a tenth, the steps by fifty, so not all the time. With the screen off this page is held up, so the Android
// app carries the steps and distance on itself from where this one left them (`live`).
const recNotice = computed(() => {
  const r = recording.value;
  if (!r) return null;
  const du: "km" | "mi" = queryClient.getQueryData<SettingsMe>(["settings", "me"])?.settings?.units?.distance === "mi" ? "mi" : "km";
  return { type: r.type, paused: !!r.pauseAt, since: r.startedAt + r.pausedMs, startedAt: r.startedAt, du, dist: Math.floor(fromM(recDistM.value, du) * 10) / 10,
    steps: countsSteps(r.type) && recStepsCounted.value ? Math.floor(r.steps / 50) * 50 : null, pausedFor: r.pauseAt ? clock(recElapsedS.value) : null, stepsRev: stepsRev.value };
});
// compared as text, so a new GPS point that changes none of it shows nothing again. The setting is part of it, so
// turning it off mid-recording takes the notification off. The settings come from the query cache, which isn't
// reactive by itself: a count bumped on each change to them lets this follow.
const settingsSeen = ref(0);
queryClient.getQueryCache().subscribe((e) => { if (e.query.queryKey[0] === "settings" && e.query.queryKey[1] === "me") settingsSeen.value++; });
const noticeOn = () => { void settingsSeen.value; return queryClient.getQueryData<SettingsMe>(["settings", "me"])?.settings?.workout?.sessionNotice !== false; };
let recShown = !recording.value; // with nothing saved, one left behind by an app closed mid-recording is taken off below
// While the Android app records a route or counts steps it is shown even with the setting off: Android requires a
// notification to keep the route and the step counter going with the screen off, and this one is it.
const keepAlive = computed(() => bgOn.value || nativeSteps.value);
watch(() => JSON.stringify([recNotice.value, noticeOn(), keepAlive.value]), () => {
  const n = recNotice.value;
  if (!n || !(noticeOn() || keepAlive.value)) { if (recShown) { void clearRecording(); recShown = false; } return; }
  recShown = true;
  // the exact counts as they are now (the rounded ones above only decide when to show it again)
  const r = recording.value!, steps = n.steps == null ? null : r.steps;
  const me = queryClient.getQueryData<SettingsMe>(["settings", "me"])?.settings;
  const at = me ? makeFmt(me).time(new Date(n.startedAt).toISOString()) : new Date(n.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  // the distance once there is some (10 m, as in the bar at the bottom), the steps from the first
  const so = [n.pausedFor, recDistM.value >= 10 ? `${num(n.dist, 1)} ${n.du}` : "", steps == null ? "" : `${num(steps, 0)} steps`].filter(Boolean).join(" · ");
  // the first point after a pause starts a new stretch (routeStats): the Android app goes on from none, not across the pause
  const last = r.route.length && !r.breaks.includes(r.route.length) ? r.route.at(-1)! : null;
  showRecording({
    title: `${typeName(n.type)}${n.paused ? " (paused)" : ": recording"}`,
    body: isNativeApp() ? so || `Started ${at}` : [so, `Started ${at}. Keep Motus open on screen to record the route.`].filter(Boolean).join("\n"),
    since: n.paused ? null : n.since,
    actions: [n.paused ? { id: "rec-resume", title: "Resume" } : { id: "rec-pause", title: "Pause" }],
    keepAlive: keepAlive.value,
    // the Android app goes on with the distance only from the route plugin's own fixes: none for a type without a route,
    // or without that plugin's watcher (a browser's location stops with the page anyway)
    live: { distM: bgOn.value && typeInfo(n.type)?.hasGps !== false ? recDistM.value : null, unit: n.du, last, steps, stepSession: r.stepSession, stepSeen: r.stepSeen, elapsedS: Math.round(recElapsedS.value) },
  });
}, { immediate: true });
onNoticeAction("rec-pause", () => setPaused(true));
onNoticeAction("rec-resume", () => setPaused(false));
