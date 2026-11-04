// The running interval timer (feature "intervalTimer"). Kept here, outside the page, so it keeps going while you use
// other pages, and saved on the device so a reload does not lose it. Like the rest timer it is a start time, not a
// counter: where you are comes from how long it has run, so it stays right after the phone sleeps (PLAN.md §8.6).
import { computed, reactive } from "vue";
import { intervalPhases, intervalAt, intervalTotalS, cleanInterval, INTERVAL_DEFAULT, type IntervalConfig, type IntervalKind, type IntervalSound } from "@motus/shared";
import { readJson, writeJson } from "../core/prefs";
import { now, tone, SOFT, savedCues, vibrate } from "./runtime";
import { keepAwake, scheduleIntervalCues, cancelIntervalCues, INTERVAL_CUE_MAX } from "./native";

interface IntervalRun {
  cfg: Required<IntervalConfig>; // sounds filled in
  name: string; // the preset it came from, or ""
  startedAt: number | null; // ms, moved forward by the time spent paused; null: not running
  pausedAt: number | null;
}
const KEY = "motusIntervals";
const saved = readJson<Partial<IntervalRun>>(KEY, {});
export const iv = reactive<IntervalRun>({ cfg: cleanInterval(saved.cfg ?? INTERVAL_DEFAULT), name: saved.name ?? "", startedAt: saved.startedAt ?? null, pausedAt: saved.pausedAt ?? null });
const save = () => writeJson(KEY, iv);

export const PHASE_NAME: Record<IntervalKind, string> = { prep: "Get ready", work: "Work", rest: "Rest", setRest: "Rest between sets" };

export const SOUND_NAME: Record<IntervalSound, string> = { beep: "Beep", double: "Double beep", triple: "Three beeps", high: "High", low: "Low", rising: "Rising", none: "None" };
// notes of a C major chord, so every sound (and any two in a row) sits in tune with the others
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, G6 = 1567.98, C7 = 2093;
/** Plays one of the built-in sounds (also the preview when one is chosen). The ids stay as saved in presets. */
export function playIntervalSound(sound: IntervalSound) {
  if (sound === "beep") tone(G5, { dur: 0.9 }); // one bell
  else if (sound === "double") [C6, C6].forEach((f, i) => tone(f, { delay: i * 0.17, dur: i ? 0.7 : 0.35 }));
  else if (sound === "triple") [C6, C6, C6].forEach((f, i) => tone(f, { delay: i * 0.17, dur: i === 2 ? 0.8 : 0.3 }));
  else if (sound === "high") tone(G6, { dur: 0.8, vol: 0.24 });
  else if (sound === "low") tone(C5, { dur: 1, vol: 0.34, partials: SOFT }); // round and gentle, no bright overtones
  else if (sound === "rising") [C6, E6, G6, C7].forEach((f, i) => tone(f, { delay: i * 0.11, dur: i === 3 ? 1.1 : 0.45, vol: 0.24 })); // chime
}
/** The countdown in the last three seconds of a part: short soft blips, the last one higher so you know "now". */
export function playTick(last: boolean) {
  tone(last ? E6 : E5, { dur: last ? 0.18 : 0.09, vol: last ? 0.22 : 0.16, partials: SOFT });
}

export const ivPhases = computed(() => intervalPhases(iv.cfg));
export const ivTotalS = computed(() => intervalTotalS(ivPhases.value));
const runMs = () => (iv.startedAt == null ? 0 : (iv.pausedAt ?? now.value) - iv.startedAt);
/** Where the timer is now; index === phases.length once it has finished. */
export const ivNow = computed(() => intervalAt(ivPhases.value, runMs()));
export const ivRunning = computed(() => iv.startedAt != null && ivNow.value.index < ivPhases.value.length);
export const ivDone = computed(() => iv.startedAt != null && ivNow.value.index >= ivPhases.value.length);
export const ivElapsedS = computed(() => Math.min(ivTotalS.value, runMs() / 1000));

export function setIntervalConfig(c: Partial<IntervalConfig>, name = "") {
  if (iv.startedAt != null) return; // not while it runs
  iv.cfg = cleanInterval({ ...iv.cfg, ...c }); iv.name = name; save();
}
export function startIntervals() {
  iv.startedAt = Date.now(); iv.pausedAt = null; lastIndex = 0; lastSecond = -1;
  save(); keepAwake(true, "intervals");
  const first = ivPhases.value[0];
  if (first && savedCues().sound) playIntervalSound(iv.cfg.sounds[first.kind]);
}
// paused, the screen may sleep; going on keeps it on again
export function pauseIntervals() {
  if (iv.startedAt == null || iv.pausedAt != null) return;
  iv.pausedAt = Date.now(); save(); cancelIntervalCues(); scheduledForHide = false; keepAwake(false, "intervals");
}
export function resumeIntervals() {
  if (iv.startedAt == null || iv.pausedAt == null) return;
  iv.startedAt += Date.now() - iv.pausedAt; iv.pausedAt = null; save(); keepAwake(true, "intervals");
}
export function stopIntervals() {
  iv.startedAt = null; iv.pausedAt = null; save(); keepAwake(false, "intervals"); cancelIntervalCues(); scheduledForHide = false;
}
/** Jumps to the start of the next phase (or back to the start of this one). */
export function skipInterval(dir: 1 | -1) {
  if (iv.startedAt == null) return;
  const ph = ivPhases.value, { index, leftMs } = ivNow.value;
  // back: to the start of this part, or to the one before when it has only just begun
  const justBegun = index >= ph.length || leftMs > ph[index]!.durS * 1000 - 2000;
  const to = Math.max(0, Math.min(ph.length, dir > 0 ? index + 1 : justBegun ? index - 1 : index));
  const startMs = ph.slice(0, to).reduce((a, p) => a + p.durS * 1000, 0);
  // "Next" on the last part ends the run just as running out of time does (also when paused: it is over, not paused)
  if (to >= ph.length) { iv.startedAt = Date.now() - startMs; iv.pausedAt = null; finish(true); return; }
  // setting lastIndex here is intentional: a jump you tapped plays no sound
  iv.startedAt = (iv.pausedAt ?? Date.now()) - startMs; lastIndex = to; lastSecond = -1; save();
}

// Cues at each change: the sound chosen for that part (by default two high beeps to work, one low beep to rest, three
// when it's all done), and a short tick in the last three seconds of each phase. Whether sound and vibration play at
// all follows Settings → Workout, read fresh each time.
// After the app was asleep nothing plays for a change that happened a while ago: on Android it already came as a
// notification, and a late beep would only confuse.
let lastIndex = ivNow.value.index, lastSecond = -1;
const FRESH_MS = 1000;
// True while the app is hidden and its coming changes sit in the notification shade: the notification is then the
// cue, so the in-app beep would only double it.
let scheduledForHide = false;
const inAppCues = () => !(scheduledForHide && document.hidden);
function finish(cue: boolean) {
  lastIndex = ivPhases.value.length; lastSecond = -1;
  if (cue && inAppCues()) { const c = savedCues(); if (c.sound) playIntervalSound(iv.cfg.sounds.done); if (c.vibrate) vibrate([400, 150, 400, 150, 400]); }
  keepAwake(false, "intervals"); save();
  // Only on screen: a run that ends while hidden must leave its "done" notification standing; the visibilitychange
  // handler below clears it (and scheduledForHide) when the app comes back, even though the run is no longer running.
  if (document.visibilityState === "visible") { cancelIntervalCues(); scheduledForHide = false; }
}
setInterval(() => {
  if (iv.startedAt == null || iv.pausedAt != null) return;
  const ph = ivPhases.value, run = Date.now() - iv.startedAt, { index, leftMs } = intervalAt(ph, run);
  if (index !== lastIndex) {
    // how long ago this phase (or the finish) began
    const sinceMs = index >= ph.length ? run - intervalTotalS(ph) * 1000 : ph[index]!.durS * 1000 - leftMs;
    const fresh = sinceMs <= FRESH_MS;
    if (index >= ph.length) { finish(fresh); return; }
    lastIndex = index; lastSecond = -1;
    if (!fresh) return;
    if (!inAppCues()) return;
    const c = savedCues();
    const kind = ph[index]!.kind;
    if (c.sound) playIntervalSound(iv.cfg.sounds[kind]);
    if (c.vibrate) vibrate(kind === "work" ? [300, 120, 300] : 400);
    return;
  }
  const s = Math.ceil(leftMs / 1000);
  if (index < ph.length && s <= 3 && s >= 1 && s !== lastSecond && ph[index]!.durS > 5) { lastSecond = s; if (inAppCues() && savedCues().sound) playTick(s === 1); }
}, 200);

// In the background the app's own beeps may stop (a locked phone), so the coming changes go to the notification
// shade instead; back on screen they are taken off again and the in-app cues carry on. Only the next
// INTERVAL_CUE_MAX changes are scheduled: a run left in the background past those goes on silently until the app is
// opened again (every return cancels and the next hide schedules afresh).
function phaseTitle(i: number) {
  const ph = ivPhases.value, p = ph[i];
  if (!p) return { title: "Interval timer done", body: iv.name || "All rounds finished" };
  const sets = iv.cfg.sets > 1 ? ` · Set ${p.set} of ${iv.cfg.sets}` : "";
  return { title: PHASE_NAME[p.kind], body: `Round ${p.round} of ${iv.cfg.rounds}${sets}` };
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Checked before the running guard: a run that finished while hidden is no longer running, but its scheduled
    // notifications (the "done" one) still have to be cleared on return.
    if (scheduledForHide) { cancelIntervalCues(); scheduledForHide = false; }
    if (ivRunning.value && iv.pausedAt == null) keepAwake(true, "intervals");
    return;
  }
  if (!ivRunning.value || iv.pausedAt != null) return;
  const ph = ivPhases.value, out: { at: number; title: string; body: string }[] = [];
  let at = iv.startedAt!;
  for (let i = 0; i <= ph.length && out.length < INTERVAL_CUE_MAX; i++) {
    if (i > 0 && at > Date.now()) out.push({ at, ...phaseTitle(i) });
    if (i < ph.length) at += ph[i]!.durS * 1000;
  }
  scheduleIntervalCues(out); scheduledForHide = out.length > 0;
});
// a timer left running from before a reload keeps the screen on again
if (ivRunning.value && iv.pausedAt == null) keepAwake(true, "intervals");
