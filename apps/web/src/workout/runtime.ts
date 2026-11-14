// The running workout's clocks: the rest timer and the workout's elapsed time.
// Timers are end times, not counters, so they stay right after the phone sleeps or the app is closed and opened again
// (PLAN.md §8.6). The rest timer is kept on the device so a reload does not lose it.
import { reactive, ref } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { withDefaults, cleanWorkoutSound, cleanCueVolume, SOUND_IDS, REST_OVER_SOUND_DEFAULT, COUNTDOWN_SOUND_DEFAULT, type SoundId, type WorkoutSound } from "@motus/shared";
import { soundUrl } from "../core/sounds";
import { api } from "../api/client";
import { queryClient } from "../api/live";
import { showRestCountdown, clearRestCountdown, scheduleRestAlarm, cancelRestAlarm, scheduleRestCues, cancelRestCues, notifyRestOverWeb, isNativeApp, backgroundTimers, nativeVibrate } from "./native";

export interface RestState {
  endAt: number | null; // ms
  startedAt: number;
  totalS: number;
  pausedLeftS: number | null;
  setId: string | null; // the set this rest follows (its actual rest is saved when the rest ends)
  label: string; // "Rest" or "Next exercise"
  next: string; // "Set 3 · 80 kg × 8"
  workoutId: string | null;
  done: boolean;
}
const EMPTY: RestState = { endAt: null, startedAt: 0, totalS: 0, pausedLeftS: null, setId: null, label: "", next: "", workoutId: null, done: false };
export const rest = reactive<RestState>({ ...EMPTY, ...readJson("motusRest", {}) });
export const now = ref(Date.now());
const save = () => writeJson("motusRest", rest);

/** The sounds the cues play (rest over, countdown), and how loud (10-100 %). `sound` false ("Workout sounds" off):
 *  none plays; a preview leaves it out. */
export interface CueVoice { cueSound: WorkoutSound; tickSound: WorkoutSound; cueVolume: number; sound?: boolean }
export interface Cues extends CueVoice { sound: boolean; vibrate: boolean; warn10: boolean; voice: boolean; countdown: boolean; next?: boolean }
let cues: Cues = { sound: true, cueSound: REST_OVER_SOUND_DEFAULT, tickSound: COUNTDOWN_SOUND_DEFAULT, cueVolume: 100, vibrate: true, warn10: true, voice: false, countdown: true, next: true };
// Whether `cues` holds a running workout's effective settings (account settings plus that workout's own overrides).
// Only then do the background alarm and RestCues use it; otherwise the saved account settings apply.
let workoutCues = false;
export const setCues = (c: Cues, forWorkout = true) => { cues = c; workoutCues = forWorkout; };
/** Sound and vibration as chosen in Settings → Workout, read from the settings the app has loaded, so they are right
 *  on any page (the cues above are only filled once a workout screen has been opened). */
export function savedCues(): CueVoice & { sound: boolean; vibrate: boolean; warn10: boolean; countdown: boolean } {
  const w = withDefaults(queryClient.getQueryData<{ settings?: unknown }>(["settings", "me"])?.settings ?? {}).workout;
  return { sound: w.sound, vibrate: w.vibrate, cueSound: w.cueSound, tickSound: w.tickSound, cueVolume: w.cueVolume, warn10: w.warn10, countdown: w.countdown };
}
/** Vibrates in a pattern of on/off milliseconds. In the Android app through the phone itself (MotusWorkoutPlugin.vibrate):
 *  the WebView's navigator.vibrate counts as touch feedback (off or faint on many phones), is refused until the page
 *  has been tapped since it loaded and does nothing in silent mode, so a rest's end often didn't vibrate. A browser on
 *  an Android phone has navigator.vibrate; an iPhone, a computer and the desktop app have no vibration. */
export function vibrate(pattern: number | number[]) {
  const p = typeof pattern === "number" ? [pattern] : pattern;
  if (nativeVibrate(p)) return;
  try { navigator.vibrate?.(p); } catch { /* no vibration */ }
}

let warned = false;
// the last second the 3-2-1 played, so each plays once however the timer's ticks fall (a hidden page ticks only once a
// second, so a check like "left between 3 and 2.75" would miss some)
let lastCount = 0;
setInterval(() => {
  now.value = Date.now();
  backgroundTimers("rest", restActive() && rest.pausedLeftS == null);
  if (rest.endAt && !rest.done && rest.pausedLeftS == null) {
    const left = (rest.endAt - now.value) / 1000;
    // in the background with the alarm set, the alarm alone announces the end: no warning or 3-2-1 leading up to it
    const quiet = alarmCovers();
    if (left <= 10 && left > 9 && !warned && cues.sound && cues.warn10) { warned = true; if (!quiet) beep(); }
    // 3-2-1 in the last seconds (not on rests too short for it to mean anything); the end's own beep is the "now"
    const s = Math.ceil(left);
    if (s >= 1 && s <= 3 && s !== lastCount && rest.totalS > 5 && cues.sound && cues.countdown) { lastCount = s; if (!quiet) beep(); }
    // over: the cues play either way; then straight on to the next set, or "Rest over" until you tap Next set
    if (left <= 0) { rest.done = true; save(); restEnded(); if (cues.next) finishRest(true, true); }
  }
}, 250);

export const restLeft = () => (rest.pausedLeftS != null ? rest.pausedLeftS : rest.endAt ? Math.max(0, Math.ceil((rest.endAt - now.value) / 1000)) : 0);
export const restActive = () => !!rest.endAt && !rest.done;

export function startRest(seconds: number, o: { setId: string | null; label: string; next: string; workoutId: string }) {
  finishRest(false);
  if (seconds <= 0) return;
  Object.assign(rest, { ...EMPTY, endAt: Date.now() + seconds * 1000, startedAt: Date.now(), totalS: seconds, setId: o.setId, label: o.label, next: o.next, workoutId: o.workoutId });
  warned = false; lastCount = 0;
  save();
  restTimeSet();
}
export function adjustRest(deltaS: number) {
  if (!rest.endAt) return;
  if (rest.pausedLeftS != null) rest.pausedLeftS = Math.max(0, rest.pausedLeftS + deltaS);
  else { rest.endAt = Math.max(Date.now(), rest.endAt + deltaS * 1000); restTimeSet(); }
  rest.totalS = Math.max(1, rest.totalS + deltaS);
  rest.done = false;
  warned = restLeft() <= 10; if (restLeft() > 3) lastCount = 0;
  save();
}
export function setRest(seconds: number) {
  if (!rest.endAt) return;
  rest.endAt = Date.now() + seconds * 1000; rest.totalS = seconds; rest.pausedLeftS = null; rest.done = false; warned = seconds <= 10; lastCount = 0;
  save(); restTimeSet();
}
export function pauseRest() {
  if (!rest.endAt || rest.pausedLeftS != null) return;
  rest.pausedLeftS = restLeft(); save(); clearRestCountdown(); dropAlarm();
}
export function resumeRest() {
  if (rest.pausedLeftS == null) return;
  rest.endAt = Date.now() + rest.pausedLeftS * 1000; rest.pausedLeftS = null; save(); restTimeSet();
}
/** Ends the rest (skipped, or the next set was ticked) and saves how long it really was. `ranOut`: it ended by itself
 *  (straight on to the next set), which in the background leaves its "Rest over" standing until the app is back. */
export function finishRest(record = true, ranOut = false) {
  if (!rest.endAt) return;
  if (record && rest.setId) {
    const actual = Math.round((Date.now() - rest.startedAt) / 1000);
    api.put(`/workout-sets/${rest.setId}`, { restActualS: Math.min(actual, 3 * 3600) }).catch(() => {});
  }
  clearRestCountdown();
  if (!(ranOut && hidden())) dropAlarm();
  Object.assign(rest, EMPTY);
  save();
}

function restEnded() {
  // in the background the Android app's alarm is the alert (it sounds with the phone asleep); the in-app cues too would
  // only double it
  if (alarmCovers()) return;
  // Found over only now, long after the end (the app's timers were stopped in the background): no late beeps on
  // return. The end was announced by the Android app's alarm or the notification below (shown even when late).
  const late = Date.now() - rest.endAt! > LATE_MS;
  if (late) { if (hidden() || !document.hasFocus()) void notifyRestOverWeb(rest.next); return; }
  if (cues.sound) restOver();
  if (cues.vibrate) vibrate([300, 150, 300]);
  if (cues.voice && rest.next) speak(`Rest over. ${rest.next}`);
  // A browser's or the desktop app's own notification, when you're in another tab, window or app (the Android app has
  // its alarm); a phone's browser allows only the service worker's kind, which also carries a "+30s" button.
  if (hidden() || !document.hasFocus()) void notifyRestOverWeb(rest.next);
}

// The rest-over alarm (Android app, native.ts): scheduled for the rest's end only while the app is in the background,
// since a locked phone stops the app's own timers and beeps; back on screen it is taken off (with a "Rest over" it
// already showed) and the in-app cues carry on, so the end is never announced twice. The 10 seconds and 3-2-1 leading
// up to it go with it, played by the Android app itself (scheduleRestCues). Every change to the rest's end (+/- time,
// pause, skip, a new rest, the workout ending) while in the background schedules them again or takes them off.
let alarmOn = false;
const hidden = () => typeof document !== "undefined" && document.hidden;
// Back in the foreground: the Android app played the cues already due while hidden, so mark them played here or the
// next tick would play them again.
function catchUpCues() {
  if (!rest.endAt || rest.done || rest.pausedLeftS != null) return;
  const left = (rest.endAt - Date.now()) / 1000;
  if (left <= 10) warned = true;
  const s = Math.ceil(left);
  if (s >= 1 && s <= 3) lastCount = s;
}
const alarmCovers = () => alarmOn && hidden();
const resting = () => !!rest.endAt && !rest.done && rest.pausedLeftS == null && rest.endAt > Date.now();
function planAlarm() {
  if (!isNativeApp()) return;
  if (!resting()) { dropAlarm(); return; }
  // the running workout's own settings when it has set them; else savedCues (the cues above are only filled once the
  // workout screen has been opened)
  const c = workoutCues ? cues : savedCues();
  void scheduleRestAlarm(rest.endAt!, rest.next, c); alarmOn = true;
  // the same choices as the in-app cues above: the 10 seconds and the 3-2-1 each have their own switch, and both need
  // the workout sounds on
  scheduleRestCues(rest.endAt!, { warn10: c.sound && c.warn10, countdown: c.sound && c.countdown && rest.totalS > 5, tickSound: cleanWorkoutSound(c.tickSound, COUNTDOWN_SOUND_DEFAULT), cueVolume: c.cueVolume });
}
function dropAlarm() {
  if (!alarmOn) return;
  void cancelRestAlarm(); cancelRestCues(); alarmOn = false;
}
// a new end time: the countdown in the shade shows it, and in the background the alarm moves with it
function restTimeSet() {
  showRestCountdown(rest.endAt!, rest.next);
  if (hidden()) planAlarm();
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (hidden()) planAlarm(); else { dropAlarm(); catchUpCues(); } });
// one left from before the app was closed in the background would still sound with the app open again
if (isNativeApp() && !hidden()) { void cancelRestAlarm(); cancelRestCues(); }

// The sounds are recorded cues (core/sounds.ts), fetched once at start (so the service worker keeps them for offline
// use) and decoded into buffers the first time sound is wanted. They play through Web Audio rather than <audio>
// elements: on the moment, at any level, and allowed once a tap has opened the context.
let ctx: AudioContext | null = null;
function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}
// A browser (and Android's WebView) lets sound start only after a tap: a context first made by the timer, with no tap
// behind it, can stay silent. So every tap opens it (or wakes it after the phone slept), and the cues the timer plays
// later are heard.
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => { if (!ctx || ctx.state !== "running") audio(); }, { capture: true, passive: true });
const files = new Map<SoundId, Promise<ArrayBuffer | null>>(), buffers = new Map<SoundId, Promise<AudioBuffer | null>>();
function fileOf(id: SoundId) {
  let f = files.get(id);
  if (!f) { f = fetch(soundUrl(id)).then((r) => (r.ok ? r.arrayBuffer() : null), () => null); files.set(id, f); }
  return f;
}
function bufferOf(ac: AudioContext, id: SoundId) {
  let b = buffers.get(id);
  if (!b) {
    // decoding takes the bytes over, so it gets a copy; one that failed is tried again next time
    b = fileOf(id).then((d) => (d ? ac.decodeAudioData(d.slice(0)) : null)).catch(() => null);
    b.then((x) => { if (!x) { buffers.delete(id); files.delete(id); } });
    buffers.set(id, b);
  }
  return b;
}
// all of them at start, a little after the page is up, so each is there offline and plays at once when first picked
if (typeof window !== "undefined") setTimeout(() => SOUND_IDS.forEach((id) => void fileOf(id)), 2000);
/** How late a cue may still play; later than this it is dropped (a beep for a moment long gone only confuses). */
export const LATE_MS = 1000;
/** A countdown sound is cut off after this long (fading out over the last FADE_S), so it is over before the next
 *  second's: of the library only Achievement is longer, and only its fading tail goes. */
const COUNT_MAX_S = 0.8, FADE_S = 0.08;
/** Plays a sound once, `delay` seconds from now at `level` (levelOf), cut to `maxS` when given. A context that isn't running (the page was hidden, the phone slept) holds its clock still, so it is woken
 *  first, and the sound dropped if that (or loading it) took longer than LATE_MS: a cue is only worth playing on time. */
function playSound(id: SoundId, o: { level: number; delay?: number; maxS?: number }) {
  try {
    const ac = audio(), asked = Date.now();
    void bufferOf(ac, id).then(async (buf) => {
      if (!buf) return;
      if (ac.state !== "running") await ac.resume().catch(() => {});
      const late = Date.now() - asked;
      if (ac.state !== "running" || late > LATE_MS) return;
      const start = ac.currentTime + 0.01 + Math.max(0, (o.delay ?? 0) - late / 1000);
      const t = start, src = ac.createBufferSource(), g = ac.createGain();
      src.buffer = buf; g.gain.value = o.level;
      if (o.maxS && buf.duration > o.maxS) {
        g.gain.setValueAtTime(o.level, t + o.maxS - FADE_S); g.gain.linearRampToValueAtTime(0.0001, t + o.maxS);
        src.stop(t + o.maxS + 0.01);
      }
      src.connect(g).connect(ac.destination); src.start(t);
    }).catch(() => { /* a sound is optional: an error here must not become an unhandled rejection */ });
  } catch { /* no sound */ }
}
/** The volume setting (10-100 %) as a gain. Squared, because the ear hears loudness roughly by the square: 50 % is
 *  then about half as loud (-12 dB) rather than barely quieter (-6 dB). The Android app does the same (RestCues.java). */
export const levelOf = (volume: number) => (cleanCueVolume(volume) / 100) ** 2;
const note = (v: CueVoice, delay: number) => playSound(cleanWorkoutSound(v.tickSound, COUNTDOWN_SOUND_DEFAULT), { delay, maxS: COUNT_MAX_S, level: levelOf(v.cueVolume) });
/** One countdown note: the 10 seconds warning, each 3-2-1 of a rest or an interval part, a timed set's lead-in, the rep
 *  timer. Always the countdown sound, the same each time (the interval timer's next part has its own sound a second
 *  after its "1" to mark the change), as the Android app plays it in the background. `v`: the sound and volume (the
 *  running workout's, unless given). */
export function beep(v: CueVoice = cues) {
  if (v.sound !== false) note(v, 0);
}
/** The end of a rest or a timed set, and the start of an interval part, in the rest over sound (or the one given):
 *  played once, whole. */
export function restOver(v: CueVoice = cues) {
  if (v.sound === false) return;
  playSound(cleanWorkoutSound(v.cueSound), { level: levelOf(v.cueVolume) });
}
function speak(text: string) {
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no voice */ }
}
/** Elapsed seconds of a workout, without its paused time */
export function elapsed(w: { startedAt: string; pausedS: number; pauseStartedAt: string | null; endedAt?: string | null }) {
  const end = w.endedAt ? new Date(w.endedAt).getTime() : w.pauseStartedAt ? new Date(w.pauseStartedAt).getTime() : now.value;
  return Math.max(0, Math.round((end - new Date(w.startedAt).getTime()) / 1000) - (w.pausedS ?? 0));
}
/** Lets a sound and volume be heard where they are chosen: the rest over sound as at a rest's end, the countdown
 *  sound as one of the 3-2-1 beeps: each plays once. */
export const previewCue = (v: CueVoice) => restOver({ ...v, sound: true });
export const previewTick = (v: CueVoice) => note({ ...v, sound: true }, 0);
