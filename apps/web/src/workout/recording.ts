// The walk, run, hike or ride being recorded (requirement 18). It lives here, not in its page, so it keeps recording
// while you use the rest of the app: a recording and a gym workout are different things and may run at the same time
// (a walk to the gym, then the workout), and the bars at the bottom of the screen show each one.
// Everything is saved on this device as it comes in, so a reload or closing the app never loses a walk.
//
// Steps: the Android app reads the phone's step counter, which keeps counting with the screen off. Browsers have no step
// counter, so there the steps are counted from the phone's motion sensor while Motus is open on screen (the same limit as
// the route: a browser stops both when the screen goes off). A computer has no motion sensor, so no steps are shown there.
import { computed, ref, watch } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import { keepAwake, showRecording, clearRecording, isNativeApp } from "./native";

export interface Rec {
  type: string; startedAt: number; route: number[][]; pausedMs: number; pauseAt: number | null;
  /** steps counted so far (not while paused) */
  steps: number;
  /** the phone's step counter total at the last reading (steps since the phone started), to add only what's new */
  stepLast: number | null;
}
const KEY = "motusRecording";
export const STEP_TYPES = ["walk", "run", "hike"];

function load(): Rec | null {
  const r = readJson<any>(KEY, null);
  if (!r || !r.startedAt) return null;
  // a recording saved by the earlier version kept the counter's start instead of a running count
  if (typeof r.steps !== "number") {
    r.steps = r.stepBase != null && r.stepNow != null ? Math.max(0, r.stepNow - r.stepBase - (r.stepPaused ?? 0)) : 0;
    r.stepLast = r.stepNow ?? null;
  }
  return { type: r.type ?? "walk", startedAt: r.startedAt, route: r.route ?? [], pausedMs: r.pausedMs ?? 0, pauseAt: r.pauseAt ?? null, steps: r.steps, stepLast: r.stepLast ?? null };
}

export const recording = ref<Rec | null>(load());
/** a clock tick while recording, so every screen showing the time moves together */
export const recNow = ref(Date.now());
export const gpsError = ref("");
/** where you are now (the newest fix, rough ones too) and how sure the phone is of it, in metres; shown on the map */
export const here = ref<{ lat: number; lon: number; acc: number } | null>(null);
/** a step source is giving readings on this device right now */
export const stepsLive = ref(false);
/** why steps aren't counted, when it's something you can change */
export const stepsError = ref("");

const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
const hav = (a: number[], b: number[]) => { const dLat = rad(b[0]! - a[0]!), dLon = rad(b[1]! - a[1]!); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0]!)) * Math.cos(rad(b[0]!)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
export const recDistM = computed(() => (recording.value?.route ?? []).reduce((t, p, i, a) => (i ? t + hav(a[i - 1]!, p) : 0), 0));
export const recElapsedS = computed(() => { const r = recording.value; return r ? Math.max(0, ((r.pauseAt ?? recNow.value) - r.startedAt - r.pausedMs) / 1000) : 0; });
/** steps are worth showing: counting now, or counted earlier in this recording */
export const recStepsShown = computed(() => !!recording.value && STEP_TYPES.includes(recording.value.type) && (stepsLive.value || recording.value.steps > 0));

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
  if (last && hav(last, pt) < 3) return; // standing still
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

// ---- steps: the phone's step counter (Android app) ----
const WP = () => (globalThis as any).Capacitor?.Plugins?.MotusWorkout;
let stepSub: any = null, nativeSteps = false;
function onTotal(total: number) {
  const r = recording.value;
  if (!r || !(total >= 0)) return;
  stepsLive.value = true;
  // only what's new since the last reading; a smaller total means the phone restarted, so it becomes the new start
  if (r.stepLast != null && total >= r.stepLast && !r.pauseAt) r.steps += total - r.stepLast;
  r.stepLast = total; persist(true);
}
async function startNativeSteps() {
  const p = WP(); if (nativeSteps) return;
  try {
    // asks for "Physical activity" the first time (Android 10+); without it, or without a step counter, no steps are shown
    const r = await p.startSteps();
    if (!r?.available) { if (r?.denied) stepsError.value = "Allow Physical activity to count steps"; return; }
    stepsError.value = "";
    nativeSteps = true;
    stepSub = await p.addListener("steps", (e: any) => onTotal(Number(e.total)));
    if (r.total >= 0) onTotal(Number(r.total));
  } catch { /* no step counter */ }
}

// ---- steps: the motion sensor (browsers) ----
// A step shows as a peak in how hard the phone is pushed (acceleration including gravity) above its slow average. Taps and
// shakes are ignored by waiting for four steps in a walking rhythm before counting them, and after a two-second stop.
let motionOn = false, ema = 0, base = 0, armed = true, lastStep = 0, run = 0;
function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  const m = Math.hypot(a.x, a.y, a.z);
  if (!base) { base = ema = m; }
  stepsLive.value = true;
  ema += (m - ema) * 0.3; // smooths sensor noise
  base += (m - base) * 0.02; // gravity plus how the phone is held
  const d = ema - base, t = e.timeStamp || performance.now();
  if (armed && d > 1.2 && t - lastStep > 280) { armed = false; step(t); } else if (!armed && d < 0.3) armed = true;
}
function step(t: number) {
  if (t - lastStep > 2000) run = 0;
  lastStep = t; run++;
  const n = run < 4 ? 0 : run === 4 ? 4 : 1;
  const r = recording.value;
  if (n && r && !r.pauseAt) { r.steps += n; persist(true); }
}
async function startMotion(fromTap: boolean) {
  if (motionOn || typeof DeviceMotionEvent === "undefined") return;
  // iPhones ask first, and only when asked from a tap; elsewhere the sensor is simply there (or never sends anything)
  const ask = (DeviceMotionEvent as any).requestPermission;
  if (typeof ask === "function") {
    if (!fromTap) return;
    try { if ((await ask()) !== "granted") return; } catch { return; }
  }
  motionOn = true; base = 0; run = 0;
  addEventListener("devicemotion", onMotion);
}
function stopSteps() {
  stepSub?.remove?.(); stepSub = null;
  if (nativeSteps) WP()?.stopSteps?.().catch?.(() => {});
  nativeSteps = false;
  if (motionOn) removeEventListener("devicemotion", onMotion);
  motionOn = false; stepsLive.value = false;
}

// ---- running it ----
let tick: ReturnType<typeof setInterval> | null = null;
const typeInfo = (slug: string) => (queryClient.getQueryData<any[]>(["activities", "types"]) ?? []).find((x) => x.slug === slug) as { name: string; hasGps: boolean; hasDistance: boolean } | undefined;
const typeName = (slug: string) => ((queryClient.getQueryData<any[]>(["activities", "types"]) ?? []).find((x) => x.slug === slug)?.name as string | undefined) ?? (slug[0]?.toUpperCase() + slug.slice(1));
function startSensors(fromTap: boolean) {
  const r = recording.value; if (!r) return;
  recNow.value = Date.now();
  if (!tick) tick = setInterval(() => (recNow.value = Date.now()), 1000);
  // the motion sensor's permission (iPhone) has to be asked straight from the tap, so nothing is awaited before it
  if (STEP_TYPES.includes(r.type)) { if (WP()?.startSteps) startNativeSteps(); else startMotion(fromTap); }
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
  recording.value = { type, startedAt: Date.now(), route: [], pausedMs: 0, pauseAt: null, steps: 0, stepLast: null };
  persist(); startSensors(true);
}
export function togglePause() {
  const r = recording.value; if (!r) return;
  if (r.pauseAt) { r.pausedMs += Date.now() - r.pauseAt; r.pauseAt = null; } else r.pauseAt = Date.now();
  persist();
}
/** saves it as an activity and returns its id */
export async function finishRecording(): Promise<string> {
  const r = recording.value!;
  if (saveT) persist();
  const end = r.pauseAt ?? Date.now();
  const res = await api.post("/activities", { type: r.type, startedAt: new Date(r.startedAt).toISOString(), endedAt: new Date(end).toISOString(), durationS: Math.round(recElapsedS.value), route: r.route, steps: recStepsShown.value ? r.steps : null, source: "gps", clientId: `gps:${r.startedAt}` });
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

// In a browser, the recording as a notification too (same setting as the workout's), so it's one tap away from other apps.
// A browser notification can't run a clock, so it says when it started.
watch(() => recording.value && { type: recording.value.type, paused: !!recording.value.pauseAt, startedAt: recording.value.startedAt }, (n) => {
  if (!n || isNativeApp()) return;
  const me = queryClient.getQueryData<any>(["settings", "me"]);
  if (me?.settings?.workout?.sessionNotice === false) return;
  const at = new Date(n.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  showRecording({ title: `${typeName(n.type)}${n.paused ? " (paused)" : ": recording"}`, body: `Started ${at}. Keep Motus open on screen to record the route.`, since: n.paused ? null : n.startedAt });
}, { immediate: true });
