// The running workout's clocks: the rest timer and the workout's elapsed time.
// Timers are end times, not counters, so they stay right after the phone sleeps or the app is closed and opened again
// (PLAN.md §8.6). The rest timer is kept on the device so a reload does not lose it.
import { reactive, ref } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { withDefaults } from "@motus/shared";
import { api } from "../api/client";
import { queryClient } from "../api/live";
import { showRestCountdown, clearRestCountdown, scheduleRestAlarm, cancelRestAlarm, notifyRestOverWeb, isNativeApp } from "./native";

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

export interface Cues { sound: boolean; vibrate: boolean; warn10: boolean; voice: boolean; countdown: boolean; next?: boolean }
let cues: Cues = { sound: true, vibrate: true, warn10: true, voice: false, countdown: true, next: true };
export const setCues = (c: Cues) => { cues = c; };
/** Sound and vibration as chosen in Settings → Workout, read from the settings the app has loaded, so they are right
 *  on any page (the cues above are only filled once a workout screen has been opened). */
export function savedCues(): { sound: boolean; vibrate: boolean } {
  const w = withDefaults(queryClient.getQueryData<{ settings?: unknown }>(["settings", "me"])?.settings ?? {}).workout;
  return { sound: w.sound, vibrate: w.vibrate };
}
export function vibrate(pattern: number | number[]) { try { navigator.vibrate?.(pattern); } catch { /* no vibration */ } }

let warned = false;
// the last second the 3-2-1 played, so each plays once however the timer's ticks fall (a hidden page ticks only once a
// second, so a check like "left between 3 and 2.75" would miss some)
let lastCount = 0;
setInterval(() => {
  now.value = Date.now();
  if (rest.endAt && !rest.done && rest.pausedLeftS == null) {
    const left = (rest.endAt - now.value) / 1000;
    // in the background with the alarm set, the alarm alone announces the end: no warning or 3-2-1 leading up to it
    const quiet = alarmCovers();
    if (left <= 10 && left > 9 && !warned && cues.warn10) { warned = true; if (!quiet) beep(1, 660); }
    // 3-2-1 in the last seconds (not on rests too short for it to mean anything); the end's own beep is the "now"
    const s = Math.ceil(left);
    if (s >= 1 && s <= 3 && s !== lastCount && rest.totalS > 5 && cues.sound && cues.countdown) { lastCount = s; if (!quiet) tick(false); }
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
  if (cues.sound) beep(3, 880);
  if (cues.vibrate) vibrate([300, 150, 300]);
  if (cues.voice && rest.next) speak(`Rest over. ${rest.next}`);
  // A browser's or the desktop app's own notification, when you're in another tab, window or app (the Android app has
  // its alarm); a phone's browser allows only the service worker's kind, which also carries a "+30s" button.
  if (hidden() || !document.hasFocus()) void notifyRestOverWeb(rest.next);
}

// The rest-over alarm (Android app, native.ts): scheduled for the rest's end only while the app is in the background,
// since a locked phone stops the app's own timers and beeps; back on screen it is taken off (with a "Rest over" it
// already showed) and the in-app cues carry on, so the end is never announced twice. Every change to the rest's end
// (+/- time, pause, skip, a new rest, the workout ending) while in the background schedules it again or takes it off.
let alarmOn = false;
const hidden = () => typeof document !== "undefined" && document.hidden;
const alarmCovers = () => alarmOn && hidden();
const resting = () => !!rest.endAt && !rest.done && rest.pausedLeftS == null && rest.endAt > Date.now();
function planAlarm() {
  if (!isNativeApp()) return;
  if (!resting()) { dropAlarm(); return; }
  // savedCues: the cues above are only filled once the workout screen has been opened
  void scheduleRestAlarm(rest.endAt!, rest.next, savedCues()); alarmOn = true;
}
function dropAlarm() {
  if (!alarmOn) return;
  void cancelRestAlarm(); alarmOn = false;
}
// a new end time: the countdown in the shade shows it, and in the background the alarm moves with it
function restTimeSet() {
  showRestCountdown(rest.endAt!, rest.next);
  if (hidden()) planAlarm();
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (hidden()) planAlarm(); else dropAlarm(); });
// one left from before the app was closed in the background would still sound with the app open again
if (isNativeApp() && !hidden()) void cancelRestAlarm();

// Sounds are made here rather than shipped as files. Each note is a few sine partials with a quick (but not instant)
// attack and an exponential fade, so it rings like a small bell instead of clicking on and off like a raw square
// beep; everything goes through one compressor so stacked notes never clip.
let ctx: AudioContext | null = null, out: AudioNode | null = null;
function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor(), master = ctx.createGain();
    master.gain.value = 0.8; comp.connect(master).connect(ctx.destination); out = comp;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ac: ctx, dest: out! };
}
// A browser (and Android's WebView) lets sound start only after a tap: a context first made by the timer, with no tap
// behind it, can stay silent. So every tap opens it (or wakes it after the phone slept), and the cues the timer plays
// later are heard.
for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => { if (!ctx || ctx.state !== "running") audio(); }, { capture: true, passive: true });
/** [frequency ratio, loudness, how long it rings as a share of the note] */
export type Overtone = readonly [number, number, number];
/** A struck bell: slightly out-of-tune overtones that die away faster than the note itself. */
const BELL: Overtone[] = [[1, 1, 1], [2, 0.32, 0.6], [2.76, 0.16, 0.4], [5.4, 0.05, 0.2]];
/** Round and soft: the note with a little warmth on top. */
export const SOFT: Overtone[] = [[1, 1, 1], [2, 0.18, 0.5]];
/** One note starting `delay` seconds from now that rings for `dur` seconds; `attack` is how long it takes to reach full
 *  loudness (a few ms for a struck note, longer for one that swells in). */
export function tone(freq: number, { delay = 0, dur = 0.5, vol = 0.3, partials = BELL, attack = 0.005 }: { delay?: number; dur?: number; vol?: number; partials?: readonly Overtone[]; attack?: number } = {}) {
  try {
    const { ac, dest } = audio(), t = ac.currentTime + 0.01 + delay;
    for (const [ratio, amp, ring] of partials) {
      const f = freq * ratio;
      if (f > 16000) continue;
      const o = ac.createOscillator(), g = ac.createGain(), end = t + Math.max(attack + 0.05, dur * ring);
      o.type = "sine"; o.frequency.value = f;
      // a rise of at least 5 ms takes the click off the start; the exponential fall to near silence takes it off the end
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * amp, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g).connect(dest); o.start(t); o.stop(end + 0.02);
    }
  } catch { /* no sound */ }
}
/** The countdown in the last seconds of a rest or an interval part: a short soft blip, the last one higher so you
 *  know "now". */
export function tick(last: boolean) {
  tone(last ? 1318.5 : 659.25, { dur: last ? 0.18 : 0.09, vol: last ? 0.22 : 0.16, partials: SOFT }); // E6, E5
}
/** The plain cue used by the rest timer and timed sets: `times` soft bell notes. */
export function beep(times = 1, freq = 880) {
  for (let i = 0; i < times; i++) tone(freq, { delay: i * 0.2, dur: 0.45 });
}
function speak(text: string) {
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no voice */ }
}
/** Elapsed seconds of a workout, without its paused time */
export function elapsed(w: { startedAt: string; pausedS: number; pauseStartedAt: string | null; endedAt?: string | null }) {
  const end = w.endedAt ? new Date(w.endedAt).getTime() : w.pauseStartedAt ? new Date(w.pauseStartedAt).getTime() : now.value;
  return Math.max(0, Math.round((end - new Date(w.startedAt).getTime()) / 1000) - (w.pausedS ?? 0));
}
