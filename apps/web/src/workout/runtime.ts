// The running workout's clocks: the rest timer and the workout's elapsed time.
// Timers are end times, not counters, so they stay right after the phone sleeps or the app is closed and opened again
// (PLAN.md §8.6). The rest timer is kept on the device so a reload does not lose it.
import { reactive, ref } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { withDefaults, cleanWorkoutSound, cleanTickSound, cleanCueVolume, type WorkoutSound, type TickSound } from "@motus/shared";
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
export interface CueVoice { cueSound: WorkoutSound; tickSound: TickSound; cueVolume: number; sound?: boolean }
export interface Cues extends CueVoice { sound: boolean; vibrate: boolean; warn10: boolean; voice: boolean; countdown: boolean; next?: boolean }
let cues: Cues = { sound: true, cueSound: "beep", tickSound: "beep", cueVolume: 100, vibrate: true, warn10: true, voice: false, countdown: true, next: true };
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
    if (left <= 10 && left > 9 && !warned && cues.sound && cues.warn10) { warned = true; if (!quiet) beep(660); }
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
  scheduleRestCues(rest.endAt!, { warn10: c.sound && c.warn10, countdown: c.sound && c.countdown && rest.totalS > 5, tickSound: c.tickSound, cueVolume: c.cueVolume });
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

// Sounds are made here rather than shipped as files. Each note is a few sine partials with a quick (but not instant)
// attack and an exponential fade, so it rings like a small bell instead of clicking on and off like a raw square
// beep; everything goes through one limiter so stacked notes never clip. The workout's own cues (10 seconds, 3-2-1,
// rest over) are the exception: they must cut through a gym on a phone speaker, see CUE below.
let ctx: AudioContext | null = null, out: AudioNode | null = null;
function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor(), master = ctx.createGain();
    // used as a limiter that only catches the last few dB of a peak (its automatic makeup gain then adds about 1.5 dB),
    // so loud notes come out near full scale and stacked ones still don't clip
    comp.threshold.value = -3; comp.knee.value = 1; comp.ratio.value = 20; comp.attack.value = 0.001; comp.release.value = 0.1;
    master.gain.value = 1; comp.connect(master).connect(ctx.destination); out = comp;
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
/** Every note's `vol` is multiplied by this: the cues were written at 0.16-0.4 of full scale, far below what a phone's
 *  speaker needs to be heard over a gym; the limiter above keeps the sum clean. */
const LOUDER = 2.2;
/** A struck bell: slightly out-of-tune overtones that die away faster than the note itself. */
const BELL: Overtone[] = [[1, 1, 1], [2, 0.32, 0.6], [2.76, 0.16, 0.4], [5.4, 0.05, 0.2]];
/** Round and soft: the note with a little warmth on top. */
export const SOFT: Overtone[] = [[1, 1, 1], [2, 0.18, 0.5]];
/** A plain sine, like a watch's beep. */
export const PURE: Overtone[] = [[1, 1, 1]];
/** A wooden bar: the strong 4th and 10th overtones of a marimba, gone almost at once, so it knocks rather than rings. */
export const WOOD: Overtone[] = [[1, 1, 1], [4, 0.22, 0.12], [10, 0.04, 0.05]];
/** The workout's cues: a bright tone (the first harmonics, like a soft square wave) that stays at full loudness for a
 *  moment before it fades. A bell's quick fade leaves almost nothing for the ear to add up (it judges loudness over
 *  about 0.2 s), and a phone's small speaker barely plays notes below 1 kHz, so the old 660-880 Hz bells came out
 *  20-40 dB under full scale however much they were turned up. These sit at 1-3 kHz, where speaker and ear are both
 *  at their best. With `vol` 0.23 the harmonics add up to full scale. */
const CUE: Overtone[] = [[1, 1, 1], [2, 0.5, 1], [3, 0.3, 1], [4, 0.15, 1]];
/** One note starting `delay` seconds from now that rings for `dur` seconds; `attack` is how long it takes to reach full
 *  loudness (a few ms for a struck note, longer for one that swells in); `hold` keeps it at full loudness that long
 *  before the fade starts; `level` is the chosen volume as a gain (levelOf). */
export function tone(freq: number, o: ToneOptions = {}) {
  try {
    const { ac } = audio();
    if (ac.state === "running") { play(freq, o); return; }
    // A context that isn't running (the page was hidden, the phone slept) holds its clock still, so notes put on it now
    // would all sound at once when it wakes, long after their moment. So wait for it, and drop the note if that took
    // longer than a second: a cue is only worth playing on time.
    const asked = Date.now();
    void ac.resume().then(() => { if (Date.now() - asked <= LATE_MS) play(freq, o); }, () => {});
  } catch { /* no sound */ }
}
/** How late a cue may still play; later than this it is dropped (a beep for a moment long gone only confuses). */
export const LATE_MS = 1000;
type ToneOptions = { delay?: number; dur?: number; vol?: number; partials?: readonly Overtone[]; attack?: number; hold?: number; level?: number };
function play(freq: number, { delay = 0, dur = 0.5, vol = 0.3, partials = BELL, attack = 0.005, hold = 0, level = 1 }: ToneOptions) {
  try {
    const { ac, dest } = audio(), t = ac.currentTime + 0.01 + delay;
    for (const [ratio, amp, ring] of partials) {
      const f = freq * ratio;
      if (f > 16000) continue;
      const o = ac.createOscillator(), g = ac.createGain(), peak = Math.max(0.0002, vol * amp * LOUDER * level), end = t + hold + Math.max(attack + 0.05, dur * ring);
      o.type = "sine"; o.frequency.value = f;
      // a rise of at least 5 ms takes the click off the start; the exponential fall to near silence takes it off the end
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack);
      if (hold > 0) g.gain.setValueAtTime(peak, t + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g).connect(dest); o.start(t); o.stop(end + 0.02);
    }
  } catch { /* no sound */ }
}
/** The volume setting (10-100 %) as a gain. Squared, because the ear hears loudness roughly by the square: 50 % is
 *  then about half as loud (-12 dB) rather than barely quieter (-6 dB). */
export const levelOf = (volume: number) => (cleanCueVolume(volume) / 100) ** 2;
/** How each sound plays one countdown note; `long` is a "now" note (the last of 3-2-1, a single beep), held a little
 *  longer. The short ones keep the bright CUE notes' 1-3 kHz pitches, where a phone speaker is loud; the softer ones (a
 *  bell fades fast, a wooden knock is short) are a choice for those who find the beep harsh. The ringing ones play as a
 *  single short strike at their own pitch (the hand bell a quick shake), cut to fade out within RING_TICK_S so a note
 *  has died away before the next second's; they move with `freq` as the others do, so the 3-2-1's last note is an
 *  octave up in every sound. The Android app plays the same notes in the background (RestCues.java play()): a change
 *  here goes there too. */
const TICK_NOTE: Record<TickSound, (freq: number, delay: number, long: boolean, level: number) => void> = {
  beep: (f, delay, long, level) => tone(f, { delay, hold: long ? 0.2 : 0.14, dur: long ? 0.12 : 0.08, vol: 0.23, partials: CUE, level }),
  bell: (f, delay, long, level) => tone(f, { delay, dur: long ? 0.7 : 0.45, vol: 0.4, level }),
  soft: (f, delay, long, level) => tone(f, { delay, attack: 0.02, hold: long ? 0.16 : 0.1, dur: long ? 0.2 : 0.14, vol: 0.4, partials: SOFT, level }),
  // a watch's double chirp, as the interval timer's Digital, so it is never taken for the single Bright beep
  digital: (f, delay, long, level) => { for (const d of [0, 0.1]) tone(f, { delay: delay + d, hold: 0.05, dur: 0.03, vol: 0.45, partials: PURE, attack: 0.003, level }); },
  wood: (f, delay, long, level) => tone(f / 2, { delay, dur: long ? 0.35 : 0.22, vol: 0.45, partials: WOOD, attack: 0.002, level }),
  click: (f, delay, long, level) => tone(f / 1.5, { delay, dur: long ? 0.1 : 0.06, vol: 0.5, partials: CLICK, attack: 0.001, level }),
  handBell: (f, delay, _l, level) => { for (let i = 0; i < 3; i++) tone(2093 * (f / TICK_F), { delay: delay + i * 0.07, dur: 0.2, vol: 0.3, level }); },
  shipBell: (f, delay, _l, level) => ringTick(880, BRONZE, 0.36, 0.003, f, delay, level),
  tubular: (f, delay, _l, level) => ringTick(784, TUBE, 0.4, 0.003, f, delay, level),
  temple: (f, delay, _l, level) => ringTick(330, TEMPLE, 0.42, 0.004, f, delay, level),
  bowl: (f, delay, _l, level) => ringTick(587, BOWL, 0.4, 0.04, f, delay, level),
  gong: (f, delay, _l, level) => ringTick(98, DEEP_GONG, 0.42, 0.06, f, delay, level),
};
/** The countdown's own pitch (E6): a ringing sound's note at this pitch is its usual one. */
const TICK_F = 1318.5;
/** How long a ringing sound's countdown note lasts at most, its longest overtone included: gone before the next one. */
const RING_TICK_S = 0.85;
function ringTick(base: number, partials: readonly Overtone[], vol: number, attack: number, f: number, delay: number, level: number) {
  const longest = Math.max(...partials.map((p) => p[2]));
  tone(base * (f / TICK_F), { delay, dur: RING_TICK_S / longest, vol, partials, attack, level });
}
/** A wood block: off-key overtones gone at once, so it clicks rather than rings. */
const CLICK: Overtone[] = [[1, 1, 1], [2.4, 0.45, 0.4], [4.7, 0.2, 0.25]];
// The ringing sounds: bronze and brass with their off-key overtones, each dying away at its own pace. The hum below a
// bell's note rings longest; two partials a hair apart beat against each other, the wobble of a bowl or a temple bell.
const BRONZE: Overtone[] = [[0.5, 0.3, 1.4], [1, 1, 1], [1.19, 0.45, 0.8], [1.5, 0.25, 0.6], [2, 0.4, 0.5], [2.5, 0.12, 0.35], [2.98, 0.1, 0.25], [4.1, 0.05, 0.15]];
const TUBE: Overtone[] = [[1, 1, 1], [2.76, 0.45, 0.6], [5.4, 0.25, 0.4], [8.93, 0.12, 0.25], [13.34, 0.05, 0.15]];
const TEMPLE: Overtone[] = [[1, 1, 1], [1.003, 0.5, 1], [2.1, 0.55, 0.75], [3.15, 0.4, 0.55], [4.6, 0.28, 0.4], [6.3, 0.16, 0.28], [8.2, 0.08, 0.18]];
const BOWL: Overtone[] = [[1, 1, 1], [1.005, 0.7, 1], [2.71, 0.5, 0.8], [2.722, 0.35, 0.8], [5.15, 0.2, 0.5], [5.17, 0.12, 0.5]];
// a low note a phone barely plays, so its many overtones (up to 1.5 kHz) carry it; a slow attack, as a gong blooms
const DEEP_GONG: Overtone[] = [[1, 0.7, 1], [1.48, 0.5, 0.9], [2.1, 0.6, 0.85], [2.9, 0.55, 0.7], [3.9, 0.45, 0.6], [5.2, 0.35, 0.5], [6.8, 0.25, 0.4], [8.9, 0.18, 0.3], [11.6, 0.12, 0.25], [15.2, 0.08, 0.2]];
export type RingSound = "handBell" | "shipBell" | "tubular" | "temple" | "bowl" | "gong";
/** The sounds that ring out, played once (the ship's bell twice, the hand bell shaken): three in a row would only blur
 *  into one. Also offered by the interval timer (workout/intervals.ts). */
export const RINGS: Record<RingSound, (level: number) => void> = {
  handBell: (level) => { for (let i = 0; i < 5; i++) tone(2093, { delay: i * 0.11, dur: i === 4 ? 0.9 : 0.4, vol: 0.3 - i * 0.02, level }); },
  shipBell: (level) => { for (let i = 0; i < 2; i++) tone(880, { delay: i * 0.42, dur: 1.6, vol: 0.36, partials: BRONZE, attack: 0.003, level }); },
  tubular: (level) => tone(784, { dur: 3, vol: 0.4, partials: TUBE, attack: 0.003, level }),
  temple: (level) => tone(330, { dur: 4.5, vol: 0.42, partials: TEMPLE, attack: 0.004, level }),
  bowl: (level) => tone(587, { dur: 5, vol: 0.4, partials: BOWL, attack: 0.04, level }),
  gong: (level) => tone(98, { dur: 5, vol: 0.42, partials: DEEP_GONG, attack: 0.06, level }),
};
// notes of a C major chord, so every tune (and any two in a row) sits in tune with the others
export const C4 = 261.63, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1567.98, C7 = 2093;
// a small gong: a low note with off-key overtones that shimmer and die away slowly
const GONG: Overtone[] = [[1, 1, 1], [1.5, 0.22, 0.8], [2, 0.3, 0.65], [2.76, 0.16, 0.45], [4.07, 0.05, 0.25]];
export type TuneSound = "double" | "triple" | "high" | "rising" | "chime" | "pulse" | "softAlarm" | "wake" | "smallGong";
/** The tunes, first made for the interval timer and also a rest over sound: each plays once, as it is already a whole
 *  call. (Ids as the rest timer saves them; core/sounds.ts pairs them with the interval timer's.) */
const TUNES: Record<TuneSound, (level: number) => void> = {
  double: (level) => [C6, C6].forEach((f, i) => tone(f, { delay: i * 0.17, dur: i ? 0.7 : 0.35, level })),
  triple: (level) => [C6, C6, C6].forEach((f, i) => tone(f, { delay: i * 0.17, dur: i === 2 ? 0.8 : 0.3, level })),
  high: (level) => tone(G6, { dur: 0.8, vol: 0.24, level }),
  rising: (level) => [C6, E6, G6, C7].forEach((f, i) => tone(f, { delay: i * 0.11, dur: i === 3 ? 1.1 : 0.45, vol: 0.24, level })),
  // The soft alarms: meant to be noticed across the room, but rounded off (slower attacks, few bright overtones) so
  // none of them is shrill.
  softAlarm: (level) => [E5, C5, E5, C5].forEach((f, i) => tone(f, { delay: i * 0.3, dur: 0.38, vol: 0.3, partials: SOFT, attack: 0.03, level })), // two-tone, twice
  chime: (level) => [E6, C6, G5].forEach((f, i) => tone(f, { delay: i * 0.22, dur: i === 2 ? 1.1 : 0.6, vol: 0.24, level })), // three bells, falling
  pulse: (level) => [C5, E5, G5].forEach((f, i) => tone(f, { delay: i * 0.3, dur: 0.32, vol: 0.28 + i * 0.03, partials: SOFT, attack: 0.05, level })), // three soft swells, rising
  wake: (level) => { tone(G5, { dur: 1.6, vol: 0.24, partials: SOFT, attack: 0.6, level }); tone(C6, { delay: 0.35, dur: 1.4, vol: 0.16, partials: SOFT, attack: 0.6, level }); }, // fades in, no edge
  smallGong: (level) => tone(C4, { dur: 2.2, vol: 0.4, partials: GONG, attack: 0.02, level }), // long, so it sits under an interval's next part
};
const note = (v: CueVoice, f: number, delay: number, long: boolean) => TICK_NOTE[cleanTickSound(v.tickSound)](f, delay, long, levelOf(v.cueVolume));
/** A countdown note in the last seconds of a rest or an interval part. A rest's 3-2-1 is three identical short notes
 *  (the same as the Android app plays in the background); only the interval timer passes `last` for a higher, longer
 *  final note that marks the change to the next part. `v`: the sound and volume (the running workout's, unless given). */
export function tick(last: boolean, v: CueVoice = cues) {
  if (v.sound !== false) note(v, last ? TICK_F * 2 : TICK_F, 0, last); // E7, E6
}
/** One countdown note: the 10 seconds warning, a timed set's start, the rep timer. `freq` keeps the callers' pitches
 *  apart (10 seconds 660, …); each sounds an octave higher, where a phone's speaker is loud. */
export function beep(freq = 880, v: CueVoice = cues) {
  if (v.sound !== false) note(v, freq * 2, 0, true);
}
/** The end of a rest or a timed set, in the rest over sound: a short sound three times in a row, a ringing one or a
 *  tune once. */
export function restOver(v: CueVoice = cues) {
  if (v.sound === false) return;
  const id = cleanWorkoutSound(v.cueSound), level = levelOf(v.cueVolume);
  if (id in RINGS) { RINGS[id as RingSound](level); return; }
  if (id in TUNES) { TUNES[id as TuneSound](level); return; }
  for (let i = 0; i < 3; i++) TICK_NOTE[id as TickSound](1760, i * 0.25, false, level);
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
 *  sound as the 3-2-1 of a rest: three identical short notes, a second apart. */
export const previewCue = (v: CueVoice) => restOver({ ...v, sound: true });
export function previewTick(v: CueVoice) {
  const w = { ...v, sound: true };
  [0, 1, 2].forEach((d) => note(w, TICK_F, d, false));
}
