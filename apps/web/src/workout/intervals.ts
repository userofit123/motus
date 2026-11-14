// The running interval timer (feature "intervalTimer"). Kept here, outside the page, so it keeps going while you use
// other pages, and saved on the device so a reload does not lose it. Like the rest timer it is a start time, not a
// counter: where you are comes from how long it has run, so it stays right after the phone sleeps (PLAN.md §8.6).
import { computed, reactive } from "vue";
import { intervalPhases, intervalAt, intervalTotalS, cleanInterval, INTERVAL_DEFAULT, type IntervalConfig, type IntervalKind, type IntervalSound } from "@motus/shared";
import { cueOfInterval } from "../core/sounds";
import { readJson, writeJson } from "../core/prefs";
import { now, tone as note, tick, restOver, levelOf, SOFT, PURE, WOOD, C5, G5, C6, E6, savedCues, vibrate } from "./runtime";
import { keepAwake, backgroundTimers, scheduleIntervalCues, cancelIntervalCues, showIntervalNotice, clearIntervalNotice, onNoticeAction, INTERVAL_CUE_MAX, type IntervalCue } from "./native";

interface IntervalRun {
  cfg: Required<IntervalConfig>; // sounds filled in
  name: string; // the preset it came from, or ""
  startedAt: number | null; // ms, moved forward by the time spent paused; null: not running
  pausedAt: number | null;
}
const KEY = "motusIntervals";
const saved = readJson<Partial<IntervalRun>>(KEY, {});
export const iv = reactive<IntervalRun>({ cfg: cleanInterval(saved.cfg ?? INTERVAL_DEFAULT), name: saved.name ?? "", startedAt: saved.startedAt ?? null, pausedAt: saved.pausedAt ?? null });
// every change of state is saved, and shown in the ongoing notification
const save = () => { writeJson(KEY, iv); notice(); };

export const PHASE_NAME: Record<IntervalKind, string> = { prep: "Get ready", work: "Work", rest: "Rest", setRest: "Rest between sets" };

/** Plays one of the sounds (also the preview when one is chosen), at the volume chosen in Settings → Workout defaults.
 *  The ids stay as saved in presets. Bell, Round, Digital and Marimba have their own form here, as a part's start; every
 *  other sound plays as it does at a rest's end (workout/runtime.ts restOver), the same sound wherever it is picked. */
export function playIntervalSound(sound: IntervalSound) {
  const c = savedCues(), level = levelOf(c.cueVolume), tone = (f: number, o: Parameters<typeof note>[1] = {}) => note(f, { ...o, level });
  if (sound === "beep") tone(G5, { dur: 0.9 }); // one bell
  else if (sound === "low") tone(C5, { dur: 1, vol: 0.34, partials: SOFT }); // round and gentle, no bright overtones
  else if (sound === "marimba") [G5, C6, G5, C6].forEach((f, i) => tone(f, { delay: i * 0.14, dur: i === 3 ? 0.7 : 0.45, vol: 0.32, partials: WOOD }));
  else if (sound === "digital") [0, 0.1, 0.38, 0.48].forEach((d) => tone(E6, { delay: d, dur: 0.07, vol: 0.16, partials: PURE, attack: 0.004 })); // a watch's double chirp, quieter
  else { const cue = cueOfInterval(sound); if (cue) restOver({ ...c, cueSound: cue, sound: true }); }
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
  if (hidden()) planCues(); // from the lock screen: its changes come as notifications again
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
  // (its changes still scheduled for the background are taken off first: they'd show a run that is over)
  if (to >= ph.length) { cancelIntervalCues(); scheduledForHide = false; iv.startedAt = Date.now() - startMs; iv.pausedAt = null; finish(true); return; }
  // setting lastIndex here is intentional: a jump you tapped plays no sound
  iv.startedAt = (iv.pausedAt ?? Date.now()) - startMs; lastIndex = to; lastSecond = -1; save();
  if (hidden()) planCues(); // from the lock screen: the changes scheduled before are now at the wrong times
}

// Cues at each change: the sound chosen for that part (by default two high beeps to work, one low beep to rest, three
// when it's all done), and a short tick in the last three seconds of each phase. Whether sound and vibration
// play at all follows Settings → Workout, read fresh each time, as for a rest.
// After the app was asleep nothing plays for a change that happened a while ago: on Android it already came as a
// notification, and a late beep would only confuse.
let lastIndex = ivNow.value.index, lastSecond = -1;
const FRESH_MS = 1000;
// True while the app is hidden and its coming changes sit in the notification shade: the notification is then the
// cue, so the in-app beep would only double it.
let scheduledForHide = false;
const hidden = () => typeof document !== "undefined" && document.hidden;
const inAppCues = () => !(scheduledForHide && hidden());
function finish(cue: boolean) {
  lastIndex = ivPhases.value.length; lastSecond = -1;
  if (cue && inAppCues()) { const c = savedCues(); if (c.sound) playIntervalSound(iv.cfg.sounds.done); if (c.vibrate) vibrate([400, 150, 400, 150, 400]); }
  keepAwake(false, "intervals"); save();
  // Only on screen: a run that ends while hidden must leave its "done" notification standing; the visibilitychange
  // handler below clears it (and scheduledForHide) when the app comes back, even though the run is no longer running.
  if (document.visibilityState === "visible") { cancelIntervalCues(); scheduledForHide = false; }
}
setInterval(() => {
  backgroundTimers("intervals", ivRunning.value && iv.pausedAt == null);
  if (iv.startedAt == null || iv.pausedAt != null) return;
  const ph = ivPhases.value, run = Date.now() - iv.startedAt, { index, leftMs } = intervalAt(ph, run);
  if (index !== lastIndex) {
    // how long ago this phase (or the finish) began
    const sinceMs = index >= ph.length ? run - intervalTotalS(ph) * 1000 : ph[index]!.durS * 1000 - leftMs;
    const fresh = sinceMs <= FRESH_MS;
    if (index >= ph.length) { finish(fresh); return; }
    lastIndex = index; lastSecond = -1; notice();
    if (!fresh) return;
    if (!inAppCues()) return;
    const c = savedCues();
    const kind = ph[index]!.kind;
    if (c.sound) playIntervalSound(iv.cfg.sounds[kind]);
    if (c.vibrate) vibrate(kind === "work" ? [300, 120, 300] : 400);
    return;
  }
  const s = Math.ceil(leftMs / 1000);
  if (index < ph.length && s <= 3 && s >= 1 && s !== lastSecond && ph[index]!.durS > 5) { lastSecond = s; const c = savedCues(); if (inAppCues() && c.sound) tick(s === 1, c); }
}, 200);

// In the background the app's own beeps may stop (a locked phone), so the coming changes are scheduled to come as the
// timer's notification instead (one notification, updated in place at each change, with a sound); back on screen they
// are taken off again and the in-app cues carry on. Only the next INTERVAL_CUE_MAX changes are scheduled: a run left in
// the background past those goes on silently until the app is opened again (every return cancels and the next hide
// schedules afresh).
function planCues() {
  if (!ivRunning.value || iv.pausedAt != null) return;
  const ph = ivPhases.value, out: IntervalCue[] = [];
  let at = iv.startedAt!;
  for (let i = 0; i <= ph.length && out.length < INTERVAL_CUE_MAX; i++) {
    const end = i < ph.length ? at + ph[i]!.durS * 1000 : at;
    if (i > 0 && at > Date.now()) out.push(i < ph.length ? { at, ...noticeFor(i, end, false) } : { at, title: "Interval timer done", body: iv.name || "All rounds finished", endAt: null, actions: [], done: true });
    at = end;
  }
  scheduleIntervalCues(out); scheduledForHide = out.length > 0;
}
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Checked before the running guard: a run that finished while hidden is no longer running, but its scheduled
    // changes (the "done" one) still have to be taken off on return, and the notification shown as it now is (or
    // taken off, once done).
    if (scheduledForHide) { cancelIntervalCues(); scheduledForHide = false; notice(); }
    if (ivRunning.value && iv.pausedAt == null) keepAwake(true, "intervals");
    return;
  }
  planCues();
});
// The ongoing notification: the preset's name, the part and round, a countdown to the end of the part (Android app), and
// Pause or Resume and Skip. Shown again at each change of part, pause or skip, and taken off once the run stops or is done.
let noticeShown = false;
function noticeFor(i: number, endAt: number | null, paused: boolean) {
  const p = ivPhases.value[i]!, sets = iv.cfg.sets > 1 ? ` · Set ${p.set} of ${iv.cfg.sets}` : "";
  return { title: iv.name || "Interval timer", body: `${paused ? "Paused · " : ""}${PHASE_NAME[p.kind]} · Round ${p.round} of ${iv.cfg.rounds}${sets}`, endAt,
    actions: [paused ? { id: "iv-resume", title: "Resume" } : { id: "iv-pause", title: "Pause" }, { id: "iv-skip", title: "Skip" }] as IntervalCue["actions"] };
}
function notice() {
  // worked out from the clock now, not the shared `now` (up to a tick behind, which would be wrong just after a skip)
  const paused = iv.pausedAt != null, ph = ivPhases.value;
  const { index, leftMs } = intervalAt(ph, iv.startedAt == null ? 0 : (iv.pausedAt ?? Date.now()) - iv.startedAt);
  if (iv.startedAt == null || !ph[index]) {
    // done while hidden: the scheduled "done" change is (or is about to be) the notification, left standing until return
    if (iv.startedAt != null && scheduledForHide && hidden()) return;
    if (noticeShown) { clearIntervalNotice(); noticeShown = false; }
    return;
  }
  showIntervalNotice(noticeFor(index, paused ? null : Date.now() + leftMs, paused));
  noticeShown = true;
}
// each does nothing when already so (pauseIntervals and resumeIntervals check)
onNoticeAction("iv-pause", pauseIntervals);
onNoticeAction("iv-resume", resumeIntervals);
onNoticeAction("iv-skip", () => skipInterval(1));
// a timer left running from before a reload keeps the screen on again, and its notification shows again
if (ivRunning.value && iv.pausedAt == null) keepAwake(true, "intervals");
// Changes scheduled by an earlier run of the app (killed while hidden, or reloaded) are taken off at start: this copy
// doesn't know of them (scheduledForHide starts false), so they would sound over the in-app cues, or bring back the
// notification of a run since stopped. The next hide schedules afresh. Does nothing outside the Android app.
cancelIntervalCues();
// counted as shown at start, so one left behind by an app that was closed mid-run is taken off when nothing runs
noticeShown = true; notice();
