// The walk, run, hike or ride being recorded (requirement 18). It lives here, not in its page, so it keeps recording
// while you use the rest of the app: a recording and a gym workout are different things and may run at the same time
// (a walk to the gym, then the workout), and the bars at the bottom of the screen show each one.
// Everything is saved on this device as it comes in, so a reload or closing the app never loses a walk.
//
// Steps: the Android app counts with the phone's step counter, which keeps counting with the screen off (the recording's
// notification keeps the app going for it, as for the route: RecordingService), and fills in the steps it hasn't reported
// yet from the step detector or the motion sensor, so the count keeps up as you walk (MotusWorkoutPlugin). Browsers have no step
// counter, so there the steps are counted from the phone's motion sensor while Motus is open on screen (the same limit as
// the route: a browser stops both when the screen goes off). A computer has no motion sensor, so the steps say so there.
// Which types count steps is the type's own "on foot" setting (walk, run and hike, and any type you add as on foot).
import { computed, ref, watch } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import type { SettingsMe } from "../api/queries";
import { keepAwake, showRecording, clearRecording, isNativeApp, onNoticeAction, askNotificationsOnce } from "./native";
import { fromM, routeStats, takesPoint, addStepReading, MotionSteps, ROUTE_ROUGH_M, type StepReading } from "@motus/shared";

export interface Rec {
  type: string; startedAt: number; route: number[][]; pausedMs: number; pauseAt: number | null;
  /** steps counted so far (not while paused) */
  steps: number;
  /** the Android app's step sensors: which run of them the last reading came from (they start again with the app) and
   *  their count then, so a reading adds only what's new (addStepReading) */
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
/** a clock tick while recording, so every screen showing the time moves together */
const recNow = ref(Date.now());
export const gpsError = ref("");
/** where you are now (the newest fix, rough ones too) and how sure the phone is of it, in metres; shown on the map */
export const here = ref<{ lat: number; lon: number; acc: number } | null>(null);
/** a step source is running on this device: the phone's step counter, or motion readings coming in */
export const stepsLive = ref(false);
/** steps come from the motion sensor, which only counts while Motus is on screen */
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

// ---- steps: the phone's step counter plus its quick steps (step detector or motion sensor; Android app) ----
// The app counts both itself (MotusWorkoutPlugin) and sends the counts so far with each step; the recording adds what
// they grew by (addStepReading). So nothing is lost while this page is held up with the screen off, or reloaded.
const WP = () => (globalThis as any).Capacitor?.Plugins?.MotusWorkout;
// (the web app doesn't depend on Capacitor, so this is the shape of its PluginListenerHandle)
let stepSub: { remove: () => Promise<void> | void } | null = null;
/** the Android app's step sensors count for this recording (and the recording's notification keeps them going) */
const nativeSteps = ref(false);
/** what the Android plugin sends: counts since `session`, the counter -1 before its first reading */
interface NativeReading { session?: number; counter?: number; detector?: number; atCounter?: number; sinceCounter?: number }
function onReading(e: NativeReading | null | undefined) {
  const r = recording.value;
  const x: StepReading = { session: Number(e?.session), counter: Number(e?.counter ?? -1), detector: Number(e?.detector ?? 0), atCounter: e?.atCounter == null ? undefined : Number(e.atCounter), sinceCounter: e?.sinceCounter == null ? undefined : Number(e.sinceCounter) };
  if (!r || !Number.isFinite(x.session) || !Number.isFinite(x.counter) || !Number.isFinite(x.detector) || (x.atCounter != null && !Number.isFinite(x.atCounter)) || (x.sinceCounter != null && !Number.isFinite(x.sinceCounter))) return;
  const s = addStepReading({ steps: r.steps, session: r.stepSession, seen: r.stepSeen }, x, !!r.pauseAt);
  r.steps = s.steps; r.stepSession = s.session; r.stepSeen = s.seen;
  persist(true);
}
async function startNativeSteps(fresh: boolean) {
  const p = WP(); if (nativeSteps.value) return;
  try {
    // asks for "Physical activity" the first time (Android 10+); without it, or without step sensors, no steps are shown
    const r = await p.startSteps({ fresh });
    if (r?.denied) { stepsError.value = "Allow Physical activity for Motus in Android settings to count steps"; return; }
    // a phone without step sensors still has a motion sensor; it counts while Motus is on screen
    if (!r?.available) { startMotion(false); return; }
    if (!recording.value) { WP()?.stopSteps?.().catch?.(() => {}); return; } // ended while the permission was asked
    stepsError.value = "";
    nativeSteps.value = true; stepsLive.value = true; // the sensors only report once you take a step, so show 0 until then
    stepSub = await p.addListener("steps", onReading);
    onReading(r); // the steps taken since a reload, before this page listened again
  } catch { startMotion(false); }
}
/** back on screen: the counts as they are now, in case this page was held up while the screen was off */
async function catchUpSteps() {
  if (!nativeSteps.value) return;
  try { onReading(await WP()?.getSteps?.()); } catch { /* the next step brings it */ }
}

// ---- steps: the motion sensor (browsers) ----
// Each step counts as you take it (MotionSteps); one the detector takes back (a tap, no second step) is taken off again,
// unless it came while paused and so was never counted.
let motionOn = false, motion = new MotionSteps(), loneCounted = false;
let motionWait: ReturnType<typeof setTimeout> | null = null;
function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  if (!stepsLive.value) { stepsLive.value = true; stepsError.value = ""; }
  const n = motion.push(Math.hypot(a.x, a.y, a.z), e.timeStamp || performance.now());
  const r = recording.value;
  if (!n || !r) return;
  if (n < 0) { if (loneCounted) { r.steps = Math.max(0, r.steps - 1); persist(true); } loneCounted = false; }
  if (n > 0 && !r.pauseAt) { r.steps += n; persist(true); }
  if (n > 0) loneCounted = !r.pauseAt;
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
  motionOn = true; stepsOnScreen.value = true; motion = new MotionSteps(); loneCounted = false;
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
/** `fresh`: a new recording, so the step sensors count from zero; otherwise one left running picks up where it was */
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
  if (r.pauseAt) { r.pausedMs += Date.now() - r.pauseAt; r.pauseAt = null; if (r.route.length) r.breaks.push(r.route.length); } else r.pauseAt = Date.now();
  persist();
}
/** saves it as an activity and returns its id */
export async function finishRecording(): Promise<string> {
  const r = recording.value!;
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
// clock there (a browser's can't run one, so it says when it started), the distance in your units and the steps so far,
// and Pause or Resume. Shown again when those change: the distance by a tenth, the steps by fifty, so not all the time.
const recNotice = computed(() => {
  const r = recording.value;
  if (!r) return null;
  const du = queryClient.getQueryData<SettingsMe>(["settings", "me"])?.settings?.units?.distance === "mi" ? "mi" : "km";
  return { type: r.type, paused: !!r.pauseAt, since: r.startedAt + r.pausedMs, startedAt: r.startedAt, du, dist: Math.floor(fromM(recDistM.value, du) * 10) / 10, steps: countsSteps(r.type) ? Math.floor(r.steps / 50) * 50 : null };
});
// compared as text, so a new GPS point that changes none of it shows nothing again. The setting is part of it, so
// turning it off mid-recording takes the notification off. The settings come from the query cache, which isn't
// reactive by itself: a count bumped on each change to them lets this follow.
const settingsSeen = ref(0);
queryClient.getQueryCache().subscribe((e) => { if (e.query.queryKey[0] === "settings" && e.query.queryKey[1] === "me") settingsSeen.value++; });
const noticeOn = () => { void settingsSeen.value; return queryClient.getQueryData<SettingsMe>(["settings", "me"])?.settings?.workout?.sessionNotice !== false; };
let recShown = !recording.value; // with nothing saved, one left behind by an app closed mid-recording is taken off below
// While the Android app records a route or counts steps it is shown even with the setting off: Android requires a
// notification to keep the route and the step sensors going with the screen off, and this one is it.
const keepAlive = computed(() => bgOn.value || nativeSteps.value);
watch(() => JSON.stringify([recNotice.value, noticeOn(), keepAlive.value]), () => {
  const n = recNotice.value;
  if (!n || !(noticeOn() || keepAlive.value)) { if (recShown) { void clearRecording(); recShown = false; } return; }
  recShown = true;
  const at = new Date(n.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const so = [n.dist > 0 ? `${n.dist.toFixed(1)} ${n.du}` : "", n.steps ? `${n.steps.toLocaleString()} steps` : ""].filter(Boolean).join(" · ");
  showRecording({
    title: `${typeName(n.type)}${n.paused ? " (paused)" : ": recording"}`,
    body: isNativeApp() ? so || `Started ${at}` : [so, `Started ${at}. Keep Motus open on screen to record the route.`].filter(Boolean).join("\n"),
    since: n.paused ? null : n.since,
    actions: [n.paused ? { id: "rec-resume", title: "Resume" } : { id: "rec-pause", title: "Pause" }],
    keepAlive: keepAlive.value,
  });
}, { immediate: true });
onNoticeAction("rec-pause", () => setPaused(true));
onNoticeAction("rec-resume", () => setPaused(false));
