// The running workout's clocks: the rest timer and the workout's elapsed time.
// Timers are end times, not counters, so they stay right after the phone sleeps or the app is closed and opened again
// (PLAN.md §8.6). The rest timer is kept on the device so a reload does not lose it.
import { reactive, ref } from "vue";
import { readJson, writeJson } from "../core/prefs";
import { withDefaults } from "@motus/shared";
import { api } from "../api/client";
import { queryClient } from "../api/live";
import { notifyRestEnd, cancelRestNotification } from "./native";

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

export interface Cues { sound: boolean; vibrate: boolean; warn10: boolean; voice: boolean; next?: boolean }
let cues: Cues = { sound: true, vibrate: true, warn10: true, voice: false, next: true };
export const setCues = (c: Cues) => { cues = c; };
/** Sound and vibration as chosen in Settings → Workout, read from the settings the app has loaded, so they are right
 *  on any page (the cues above are only filled once a workout screen has been opened). */
export function savedCues(): { sound: boolean; vibrate: boolean } {
  const w = withDefaults(queryClient.getQueryData<{ settings?: unknown }>(["settings", "me"])?.settings ?? {}).workout;
  return { sound: w.sound, vibrate: w.vibrate };
}
export function vibrate(pattern: number | number[]) { try { navigator.vibrate?.(pattern); } catch { /* no vibration */ } }

let warned = false;
setInterval(() => {
  now.value = Date.now();
  if (rest.endAt && !rest.done && rest.pausedLeftS == null) {
    const left = (rest.endAt - now.value) / 1000;
    if (left <= 10 && left > 9 && !warned && cues.warn10) { warned = true; beep(1, 660); }
    // over: the cues play either way; then straight on to the next set, or "Rest over" until you tap Next set
    if (left <= 0) { rest.done = true; save(); restEnded(); if (cues.next) finishRest(true); }
  }
}, 250);

export const restLeft = () => (rest.pausedLeftS != null ? rest.pausedLeftS : rest.endAt ? Math.max(0, Math.ceil((rest.endAt - now.value) / 1000)) : 0);
export const restActive = () => !!rest.endAt && !rest.done;

export function startRest(seconds: number, o: { setId: string | null; label: string; next: string; workoutId: string }) {
  finishRest(false);
  if (seconds <= 0) return;
  Object.assign(rest, { ...EMPTY, endAt: Date.now() + seconds * 1000, startedAt: Date.now(), totalS: seconds, setId: o.setId, label: o.label, next: o.next, workoutId: o.workoutId });
  warned = false;
  save();
  notifyRestEnd(rest.endAt!, o.next);
}
export function adjustRest(deltaS: number) {
  if (!rest.endAt) return;
  if (rest.pausedLeftS != null) rest.pausedLeftS = Math.max(0, rest.pausedLeftS + deltaS);
  else { rest.endAt = Math.max(Date.now(), rest.endAt + deltaS * 1000); notifyRestEnd(rest.endAt, rest.next); }
  rest.totalS = Math.max(1, rest.totalS + deltaS);
  rest.done = false;
  warned = restLeft() <= 10;
  save();
}
export function setRest(seconds: number) {
  if (!rest.endAt) return;
  rest.endAt = Date.now() + seconds * 1000; rest.totalS = seconds; rest.pausedLeftS = null; rest.done = false; warned = seconds <= 10;
  save(); notifyRestEnd(rest.endAt, rest.next);
}
export function pauseRest() {
  if (!rest.endAt || rest.pausedLeftS != null) return;
  rest.pausedLeftS = restLeft(); save(); cancelRestNotification();
}
export function resumeRest() {
  if (rest.pausedLeftS == null) return;
  rest.endAt = Date.now() + rest.pausedLeftS * 1000; rest.pausedLeftS = null; save(); notifyRestEnd(rest.endAt, rest.next);
}
/** Ends the rest (skipped, or the next set was ticked) and saves how long it really was. */
export function finishRest(record = true) {
  if (!rest.endAt) return;
  if (record && rest.setId) {
    const actual = Math.round((Date.now() - rest.startedAt) / 1000);
    api.put(`/workout-sets/${rest.setId}`, { restActualS: Math.min(actual, 3 * 3600) }).catch(() => {});
  }
  cancelRestNotification();
  Object.assign(rest, EMPTY);
  save();
}

function restEnded() {
  if (cues.sound) beep(3, 880);
  if (cues.vibrate) vibrate([300, 150, 300]);
  if (cues.voice && rest.next) speak(`Rest over. ${rest.next}`);
  if (document.hidden && "Notification" in window && Notification.permission === "granted")
    try { new Notification("Rest over", { body: rest.next, tag: "motus-rest", icon: "/icon-192.png" }); } catch { /* not allowed here */ }
}

let ctx: AudioContext | null = null;
export function beep(times = 1, freq = 880) {
  try {
    ctx ??= new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.28;
      o.frequency.value = freq; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.24);
    }
  } catch { /* no sound */ }
}
export function speak(text: string) {
  try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no voice */ }
}
/** Elapsed seconds of a workout, without its paused time */
export function elapsed(w: { startedAt: string; pausedS: number; pauseStartedAt: string | null; endedAt?: string | null }) {
  const end = w.endedAt ? new Date(w.endedAt).getTime() : w.pauseStartedAt ? new Date(w.pauseStartedAt).getTime() : now.value;
  return Math.max(0, Math.round((end - new Date(w.startedAt).getTime()) / 1000) - (w.pausedS ?? 0));
}
