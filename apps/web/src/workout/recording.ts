// The walk, run, hike or ride being recorded (requirement 18). It lives here, not in its page, so it keeps recording
// while you use the rest of the app: a recording and a gym workout are different things and may run at the same time
// (a walk to the gym, then the workout), and the bars at the bottom of the screen show each one.
// Everything is saved on this device as it comes in, so a reload or closing the app never loses a walk.
//
// Steps: the Android app reads the phone's step detector and step counter, which keep counting with the screen off. Browsers have no step
// counter, so there the steps are counted from the phone's motion sensor while Motus is open on screen (the same limit as
// the route: a browser stops both when the screen goes off). A computer has no motion sensor, so the steps say so there.
// Which types count steps is the type's own "on foot" setting (walk, run and hike, and any type you add as on foot).
import { computed, ref, watch } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import type { SettingsMe } from "../api/queries";
import { keepAwake, showRecording, clearRecording, isNativeApp, onNoticeAction, askNotificationsOnce } from "./native";
import { fromM, haversine, routeStats } from "@motus/shared";

export interface Rec {
  type: string; startedAt: number; route: number[][]; pausedMs: number; pauseAt: number | null;
  /** steps counted so far (not while paused) */
  steps: number;
  /** the phone's step counter total at the last reading (steps since the phone started), to add only what's new */
  stepLast: number | null;
  /** steps the step detector already added that the step counter hasn't reported yet, so they aren't added twice */
  stepAhead: number;
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
  // a recording saved by the earlier version kept the counter's start instead of a running count
  if (typeof r.steps !== "number") {
    r.steps = r.stepBase != null && r.stepNow != null ? Math.max(0, r.stepNow - r.stepBase - (r.stepPaused ?? 0)) : 0;
    r.stepLast = r.stepNow ?? null;
  }
  return { type: r.type ?? "walk", startedAt: r.startedAt, route: r.route ?? [], pausedMs: r.pausedMs ?? 0, pauseAt: r.pauseAt ?? null, steps: r.steps, stepLast: r.stepLast ?? null, stepAhead: r.stepAhead ?? 0, breaks: r.breaks ?? [] };
}

export const recording = ref<Rec | null>(load());
/** a clock tick while recording, so every screen showing the time moves together */
export const recNow = ref(Date.now());
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
export const recStepsCounted = computed(() => !!recording.value && (stepsLive.value || recording.value.steps > 0));

// Saving the whole route on every step reading would be wasteful; points are saved as they come, steps a moment later.
let saveT: ReturnType<typeof setTimeout> | null = null;
function persist(soon = false) {
  if (saveT) { clearTimeout(saveT); saveT = null; }
  if (soon) { saveT = setTimeout(() => persist(), 3000); return; }
  if (recording.value) writeJson(KEY, recording.value); else { try { localStorage.removeItem(KEY); } catch { /* not stored */ } }
}

// ---- route ----
const BG = () => (globalThis as any).Capacitor?.Plugins?.BackgroundGeolocation;
let watchId: number | null = null, bgId: string | null = null;
const ROUGH_M = 50;
function onPoint(lat: number, lon: number, time: number, alt: number | null | undefined, acc: number) {
  const r = recording.value;
  here.value = { lat, lon, acc };
  // a rough fix would zig-zag the route and add distance you didn't go: say why nothing is drawn yet
  gpsError.value = acc > ROUGH_M ? `Weak GPS signal (±${Math.round(acc)} m), waiting for a better one` : "";
  if (!r || r.pauseAt) return;
  if (acc > ROUGH_M) return;
  const pt = [lat, lon, Math.round(time / 1000), alt ?? undefined] as number[];
  const last = r.route.at(-1);
  if (last && haversine(last, pt) < 3) return; // standing still
  r.route.push(pt); persist();
}
async function startGps(name: string) {
  if (watchId != null || bgId) return;
  if (BG()) {
    try {
      // in the Android app a foreground service keeps recording with the screen off; it shows its own notification
      bgId = await BG().addWatcher({ backgroundTitle: "Recording your " + name.toLowerCase(), backgroundMessage: "Motus is tracking your route", requestPermissions: true, stale: false, distanceFilter: 3 },
        (loc: any, err: any) => { if (err) { gpsError.value = err.code === "NOT_AUTHORIZED" ? "Allow location to record the route" : "Looking for GPS…"; return; } if (loc) onPoint(loc.latitude, loc.longitude, loc.time ?? Date.now(), loc.altitude, loc.accuracy ?? 0); });
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
  bgId = null; watchId = null; gpsError.value = "";
}

// ---- steps: the phone's step detector and step counter (Android app) ----
// The step counter is the accurate total, but it holds back the first ten or so steps after you've stood still until it
// is sure you're walking, then reports them in one go, sometimes seconds later. The step detector reports each step
// as it happens. So each detected step counts at once, and the counter's readings only add what the detector missed.
const WP = () => (globalThis as any).Capacitor?.Plugins?.MotusWorkout;
let stepSubs: any[] = [], nativeSteps = false, hasCounter = true;
/** how far the detector may run ahead of the counter: past that it is counting things the counter doesn't see as steps */
const AHEAD_MAX = 30;
function onDetected() {
  const r = recording.value;
  if (!r || r.pauseAt) return;
  stepsLive.value = true;
  if (hasCounter && r.stepAhead >= AHEAD_MAX) return;
  r.steps++; if (hasCounter) r.stepAhead++;
  persist(true);
}
function onTotal(total: number) {
  const r = recording.value;
  if (!r || !(total >= 0)) return;
  stepsLive.value = true;
  // only what's new since the last reading; a smaller total means the phone restarted, so it becomes the new start.
  // The first reading is only the start: steps detected before it stay counted.
  if (r.stepLast == null || total < r.stepLast) r.stepAhead = 0;
  else {
    const n = total - r.stepLast, ahead = Math.min(n, r.stepAhead);
    r.stepAhead -= ahead;
    if (!r.pauseAt) r.steps += n - ahead;
  }
  r.stepLast = total; persist(true);
}
async function startNativeSteps() {
  const p = WP(); if (nativeSteps) return;
  try {
    // asks for "Physical activity" the first time (Android 10+); without it, or without a step counter, no steps are shown
    const r = await p.startSteps();
    if (r?.denied) { stepsError.value = "Allow Physical activity for Motus in Android settings to count steps"; return; }
    // a phone without a step counter still has a motion sensor; it counts while Motus is on screen
    if (!r?.available) { startMotion(false); return; }
    stepsError.value = "";
    nativeSteps = true; stepsLive.value = true; // the sensors only report once you take a step, so show 0 until then
    hasCounter = r.counter !== false;
    stepSubs = [await p.addListener("steps", (e: any) => onTotal(Number(e.total))), await p.addListener("step", () => onDetected())];
    // a reading from before this recording is no start for it; only resumed ones (stepLast set) continue from theirs
    if (r.total >= 0 && recording.value?.stepLast != null) onTotal(Number(r.total));
  } catch { startMotion(false); }
}

// ---- steps: the motion sensor (browsers) ----
// A step shows as a peak in how hard the phone is pushed (acceleration including gravity) above its slow average. Taps and
// shakes are ignored by waiting for a second peak within two seconds of the first before counting both, and again after
// a two-second stop; waiting for more made the count lag well behind your first steps each time you set off.
let motionOn = false, ema = 0, base = 0, armed = true, lastStep = 0, run = 0;
let motionWait: ReturnType<typeof setTimeout> | null = null;
function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  const m = Math.hypot(a.x, a.y, a.z);
  if (!base) { base = ema = m; }
  if (!stepsLive.value) { stepsLive.value = true; stepsError.value = ""; }
  ema += (m - ema) * 0.3; // smooths sensor noise
  base += (m - base) * 0.02; // gravity plus how the phone is held
  const d = ema - base, t = e.timeStamp || performance.now();
  if (armed && d > 1.2 && t - lastStep > 280) { armed = false; step(t); } else if (!armed && d < 0.3) armed = true;
}
function step(t: number) {
  if (t - lastStep > 2000) run = 0;
  lastStep = t; run++;
  const n = run < 2 ? 0 : run === 2 ? 2 : 1;
  const r = recording.value;
  if (n && r && !r.pauseAt) { r.steps += n; persist(true); }
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
  motionOn = true; stepsOnScreen.value = true; base = 0; run = 0;
  addEventListener("devicemotion", onMotion);
  // a computer has the browser feature but no sensor behind it: nothing ever arrives, so say so
  motionWait = setTimeout(() => { motionWait = null; if (motionOn && !stepsLive.value) stepsError.value = NO_SENSOR; }, 5000);
}
function stopSteps() {
  for (const s of stepSubs) s?.remove?.();
  stepSubs = [];
  if (nativeSteps) WP()?.stopSteps?.().catch?.(() => {});
  nativeSteps = false;
  if (motionOn) removeEventListener("devicemotion", onMotion);
  if (motionWait) clearTimeout(motionWait);
  motionOn = false; motionWait = null; stepsLive.value = false; stepsOnScreen.value = false; stepsError.value = "";
}

// ---- running it ----
let tick: ReturnType<typeof setInterval> | null = null;
const typeName = (slug: string) => ((queryClient.getQueryData<any[]>(["activities", "types"]) ?? []).find((x) => x.slug === slug)?.name as string | undefined) ?? (slug[0]?.toUpperCase() + slug.slice(1));
function startSensors(fromTap: boolean) {
  const r = recording.value; if (!r) return;
  recNow.value = Date.now();
  if (!tick) tick = setInterval(() => (recNow.value = Date.now()), 1000);
  // the motion sensor's permission (iPhone) has to be asked straight from the tap, so nothing is awaited before it
  if (countsSteps(r.type)) { if (WP()?.startSteps) startNativeSteps(); else startMotion(fromTap); }
  // a type without a route (yoga, a spin class, climbing) records time only, so location is never asked for
  if (typeInfo(r.type)?.hasGps !== false) startGps(typeName(r.type));
  keepAwake(true, "recording");
}
function stopAll() {
  stopGps(); stopSteps();
  if (tick) clearInterval(tick); tick = null;
  keepAwake(false, "recording"); clearRecording();
}

export function startRecording(type: string) {
  previewLocation(false);
  recording.value = { type, startedAt: Date.now(), route: [], pausedMs: 0, pauseAt: null, steps: 0, stepLast: null, stepAhead: 0, breaks: [] };
  persist(); startSensors(true);
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
if (recording.value) startSensors(false);
// a browser lets go of "keep the screen on" whenever the page is hidden; take it again on coming back
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (recording.value && document.visibilityState === "visible") keepAwake(true, "recording"); });

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
watch(() => JSON.stringify([recNotice.value, noticeOn()]), () => {
  const n = recNotice.value;
  if (!n || !noticeOn()) { if (recShown) { void clearRecording(); recShown = false; } return; }
  recShown = true;
  const at = new Date(n.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const so = [n.dist > 0 ? `${n.dist.toFixed(1)} ${n.du}` : "", n.steps ? `${n.steps.toLocaleString()} steps` : ""].filter(Boolean).join(" · ");
  showRecording({
    title: `${typeName(n.type)}${n.paused ? " (paused)" : ": recording"}`,
    body: isNativeApp() ? so || `Started ${at}` : [so, `Started ${at}. Keep Motus open on screen to record the route.`].filter(Boolean).join("\n"),
    since: n.paused ? null : n.since,
    actions: [n.paused ? { id: "rec-resume", title: "Resume" } : { id: "rec-pause", title: "Pause" }],
  });
}, { immediate: true });
onNoticeAction("rec-pause", () => setPaused(true));
onNoticeAction("rec-resume", () => setPaused(false));
