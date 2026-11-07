// The running workout, as one shared object: a local copy that every change updates at once (so typing and ticking never
// wait for the network), with each change sent to the server (or kept for later when offline).
import { computed, effectScope, nextTick, reactive, watch } from "vue";
import { restAfterSet, restDefaultsOf, dropWeightKg, toKg, type Workout, type WorkoutExercise, type WorkoutSet, type WorkoutPrefs } from "@motus/shared";
import { useActive, useSettings } from "../api/queries";
import { send, endedHere, markEnded } from "../api/outbox";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import { toastError } from "../core/toast";
import { readJson, writeJson } from "../core/prefs";
import { startRest, finishRest, rest, setCues, restActive, adjustRest, setRest, pauseRest, resumeRest } from "./runtime";
import { haptic, enableNotificationActions, showSession, clearSession, isNativeApp, onNoticeAction, type NoticeButton } from "./native";
import { makeFmt } from "../core/format";
import { choose } from "../core/ask";

// cur: the exercise on screen (look around freely); active: the one being done now, which the action bar works on
const state = reactive<{ w: Workout | null; pending: number; cur: number; active: number }>({ w: null, pending: 0, cur: 0, active: 0 });
let wired = false;
let actionsWired = false;
// settled once the active workout has been asked for the first time (and state.w taken from it): a notification tap
// that opened the app waits for this, or Pause and Set done would find no workout yet
let activeLoaded!: () => void;
const activeReady = new Promise<void>((res) => { activeLoaded = res; });

// The watchers below run once for the whole app, in their own scope: made inside the first screen that asked, they
// would stop when that screen closed, and a workout started from elsewhere would then never reach the workout screen
const appScope = effectScope(true);

export function useWorkout() {
  const active = useActive();
  const settings = useSettings();
  if (!wired) {
    wired = true;
    appScope.run(() => {
    const active = useActive(queryClient);
    // take the server's copy whenever nothing of ours is still on its way
    // also when the copy here was dropped (another workout started in its place) while the server's is already the new one
    watch([() => active.data.value, () => state.w === null], ([v]) => {
      // changes still on their way hold back the server's copy of the same workout; a different workout (one started in
      // its place) is taken at once
      if (state.pending > 0 && v?.id === state.w?.id) return;
      // finished or cancelled here, but the server hasn't heard yet (offline): it's over all the same
      if (v && endedHere(v.id)) v = null;
      state.w = v ? JSON.parse(JSON.stringify(v)) : null;
      if (v) {
        const firstPending = Math.max(0, v.exercises.findIndex((e: any) => e.status === "pending"));
        const saved = readJson<Record<string, number>>("motusCur", {})[v.id], act = readJson<Record<string, number>>("motusActive", {})[v.id];
        state.cur = saved != null && saved < v.exercises.length ? saved : firstPending;
        state.active = act != null && act < v.exercises.length ? act : firstPending;
      }
    }, { immediate: true });
    // after the watcher above has taken the answer (nextTick), also when it failed (offline: whatever is kept here counts)
    watch(() => active.isFetched.value || active.data.value !== undefined, (ok) => { if (ok) void nextTick(activeLoaded); }, { immediate: true });
    watch(() => state.cur, (c) => { if (state.w) writeJson("motusCur", { [state.w.id]: c }); });
    watch(() => state.active, (c) => { if (state.w) writeJson("motusActive", { [state.w.id]: c }); });
    // the same as prefs and fmt below, kept here so the notification lives as long as the app
    const appSettings = useSettings();
    const appPrefs = computed<WorkoutPrefs>(() => ({ ...appSettings.value.workout, ...((state.w?.settings ?? {}) as Partial<WorkoutPrefs>) }));
    const appFmt = computed(() => makeFmt(appSettings.value));
    watch(appPrefs, (p) => setCues({ sound: p.sound, vibrate: p.vibrate, warn10: p.warn10, voice: p.voice && !!appSettings.value.features.voice, next: p.restEndNext }), { immediate: true });
    // the workout as a notification: what you're on now; in the Android app the rest countdown replaces it while resting
    // (not while the rest is paused, which takes the countdown off). A browser can't run a clock in a notification, so
    // it says when the workout started instead
    const notice = computed(() => {
      const w = state.w;
      if (!w || w.status !== "in_progress" || !appPrefs.value.sessionNotice) return null;
      if (restActive() && rest.pausedLeftS == null && isNativeApp()) return "rest";
      const e = w.exercises[state.active], sets = w.exercises.filter((x) => x.status !== "skipped").flatMap((x) => x.sets);
      const work = e?.sets.filter((x) => x.kind !== "warmup") ?? [], cur = e?.sets.find((x) => !x.done);
      const setTxt = !e ? "" : !cur ? "all sets done" : cur.kind === "warmup" ? "warm-up set" : `set ${work.indexOf(cur) + 1} of ${work.length}`;
      return {
        title: w.pauseStartedAt ? `${w.name} (paused)` : `${w.name}: workout in progress`,
        body: [e ? `Exercise ${state.active + 1} of ${w.exercises.length}: ${e.exercise.name}, ${setTxt}` : "", `${sets.filter((x) => x.done).length} of ${sets.length} sets done, started ${appFmt.value.time(w.startedAt)}`].filter(Boolean).join("\n"),
        since: w.pauseStartedAt ? null : new Date(w.startedAt).getTime() + (w.pausedS ?? 0) * 1000,
        // ticking from the notification is the optional "Log from the notification"; pausing is always there
        actions: [
          ...(appSettings.value.features.notifLogging && cur && !w.pauseStartedAt ? [{ id: "workout-done", title: "Set done" } as NoticeButton] : []),
          (w.pauseStartedAt ? { id: "workout-resume", title: "Resume" } : { id: "workout-pause", title: "Pause" }) as NoticeButton,
        ],
      };
    });
    let t: ReturnType<typeof setTimeout> | null = null;
    watch(notice, (n) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { if (n === "rest") return; if (n) showSession(n); else clearSession(); }, 300);
    }, { deep: true, immediate: true });
    // an app-wide copy of everything below, living as long as the app: the notification buttons go to it (first to get
    // there, see actionsWired), so they work on any screen, also straight after a reload
    useWorkout();
    });
  }
  const prefs = computed<WorkoutPrefs>(() => ({ ...settings.value.workout, ...((state.w?.settings ?? {}) as Partial<WorkoutPrefs>) }));
  const fmt = computed(() => makeFmt(settings.value));
  // the weight step in your units (5 lb or 2.5 kg), kept in kg
  const incKg = computed(() => settings.value.units.weight === "lb" ? toKg(settings.value.increments.lb, "lb") : settings.value.increments.kg);
  const tickNext = () => { const e = state.w?.exercises.find((x) => x.status === "pending" && x.sets.some((y) => !y.done)); if (e) tick(e, e.sets.findIndex((y) => !y.done)); };
  const restLonger = () => startRest(30, { setId: null, label: "Rest", next: "", workoutId: state.w?.id ?? "" });
  watch(() => settings.value.features.notifLogging, (on) => enableNotificationActions(!!on), { immediate: true });
  // the buttons on the workout's and the rest's notifications (native.ts), registered once; a rest that is over (still
  // saying "Rest over") gets 30 seconds from now, one that runs 30 more, and with none a new one starts; all of them
  // only during a workout. Pause and Resume do nothing when the workout already is so. Each waits for the workout to
  // load (activeReady), for a tap that opened the app.
  if (!actionsWired) {
    actionsWired = true;
    const going = () => state.w?.status === "in_progress";
    onNoticeAction("workout-done", () => { if (going()) tickNext(); }, activeReady);
    onNoticeAction("workout-pause", () => { if (going() && !state.w!.pauseStartedAt) togglePause(); }, activeReady);
    onNoticeAction("workout-resume", () => { if (going() && state.w!.pauseStartedAt) togglePause(); }, activeReady);
    onNoticeAction("rest-more", () => { if (!going()) return; if (!rest.endAt) restLonger(); else if (rest.done) setRest(30); else adjustRest(30); }, activeReady);
    onNoticeAction("rest-skip", () => finishRest(true), activeReady);
  }

  async function call(method: "post" | "put" | "del", path: string, body?: unknown, refresh = false) {
    state.pending++;
    try { await send(method, path, body); }
    catch (e) {
      // never quietly: say what went wrong, and reload the workout so the screen shows what was really saved
      toastError(e); refresh = true;
    }
    finally {
      state.pending--;
      if (refresh || state.pending === 0) invalidate(["workouts"]);
    }
  }
  const ex = (i = state.cur) => state.w?.exercises[i];

  function restFor(e: WorkoutExercise, si: number) {
    const s = e.sets[si]!;
    const last = si === e.sets.length - 1 || e.sets.slice(si + 1).every((x) => x.done);
    const d = restDefaultsOf(prefs.value);
    let secs = s.restPlannedS ?? restAfterSet({ kind: s.kind, nextKind: e.sets[si + 1]?.kind, exRestS: e.restS, isLastSet: last, exRestAfterS: e.restAfterS }, d);
    if (last && e.restAfterS != null) secs = e.restAfterS;
    // superset: no rest until the round is complete
    const nx = state.w!.exercises[state.w!.exercises.indexOf(e) + 1];
    if (e.superset && nx?.superset === e.superset) secs = 0;
    if (settings.value.features.adaptiveRest && s.targetReps && (s.reps ?? 0) < s.targetReps) secs += 30;
    // a drop set follows straight on, even one added during the workout
    if (e.sets[si + 1]?.kind === "drop" && !e.sets[si + 1]!.done) secs = 0;
    return { secs, last };
  }
  function describeNext(after: WorkoutExercise, si: number): string {
    const w = state.w!;
    const i = w.exercises.indexOf(after);
    const nextSet = after.sets.slice(si + 1).find((x) => !x.done);
    const f = fmt.value;
    const txt = (e: WorkoutExercise, s: WorkoutSet) => `${e.exercise.name}${s.weightKg != null ? ` · ${f.w(s.weightKg)} ${f.wu}` : ""}${s.reps != null ? ` × ${s.reps}` : ""}${s.durationS ? ` · ${f.clock(s.durationS)}` : ""}`;
    if (nextSet) return `Set ${after.sets.indexOf(nextSet) + 1} · ${txt(after, nextSet)}`;
    const ne = w.exercises.slice(i + 1).find((e) => e.status === "pending") ?? w.exercises.find((e) => e.status === "pending" && e !== after);
    const ns = ne?.sets.find((x) => !x.done);
    return ne && ns ? `Next: ${txt(ne, ns)}` : "Last set done";
  }

  /** Make exercise i the one being done; the screen follows unless you were looking at another exercise */
  /** Makes exercise i the one being done. The screen follows when it was showing the one being done, or `from`. */
  function activate(i: number, from?: number) {
    if (i < 0 || !state.w || i >= state.w.exercises.length) return;
    if (state.cur === state.active || state.cur === from) state.cur = i;
    state.active = i;
  }
  async function tick(e: WorkoutExercise, si: number) {
    const s = e.sets[si]!;
    const done = !s.done;
    s.done = done; s.doneAt = done ? new Date().toISOString() : null; s.prefilled = false;
    haptic(done ? "medium" : "light");
    // the rest that was running ends now: it belonged to the set before this one
    if (done && rest.endAt) finishRest(true);
    const allDone = e.sets.every((x) => x.done);
    e.status = e.status === "skipped" ? "skipped" : allDone ? "done" : "pending";
    await call("put", `/workout-sets/${s.id}`, { done, weightKg: s.weightKg, reps: s.reps, durationS: s.durationS, distanceM: s.distanceM, rpe: s.rpe, rir: s.rir, kind: s.kind });
    if (!done) return;
    const { secs } = restFor(e, si);
    const isFinal = state.w!.exercises.every((x) => x.status !== "pending");
    if (prefs.value.autoRest && secs > 0 && !isFinal) startRest(secs, { setId: s.id, label: allDone ? "Next exercise" : "Rest", next: describeNext(e, si), workoutId: state.w!.id });
    if (allDone && prefs.value.autoAdvance) {
      // the next exercise still to do, by id: the workout may be reloaded from the server before the moment below
      const ws = state.w!.exercises, i = ws.indexOf(e);
      const to = (ws.find((x, j) => j > i && x.status === "pending") ?? ws.find((x) => x.status === "pending"))?.id;
      setTimeout(() => {
        const list = state.w?.exercises ?? [], at = list.findIndex((x) => x.id === to);
        if (at >= 0) activate(at, list.findIndex((x) => x.id === e.id));
      }, 450);
    } else if (e.superset && !allDone) {
      // supersets alternate: after a set, go to the partner exercise
      const partners = state.w!.exercises.map((x, j) => [x, j] as const).filter(([x]) => x.superset === e.superset && x.status === "pending");
      const at = partners.findIndex(([x]) => x === e);
      const nxt = partners[(at + 1) % partners.length];
      if (nxt && nxt[0] !== e) setTimeout(() => activate(nxt[1]), 450);
    }
  }
  async function editSet(s: WorkoutSet, patch: Partial<WorkoutSet>) {
    Object.assign(s, patch, { prefilled: false });
    await call("put", `/workout-sets/${s.id}`, patch);
  }
  async function addSet(e: WorkoutExercise) {
    const last = e.sets.at(-1);
    // the id is made here, so the new set can be ticked or changed straight away, even offline
    const s = { ...(last ?? ({} as any)), id: crypto.randomUUID(), done: false, doneAt: null, kind: last?.kind === "warmup" || last?.kind === "drop" ? "normal" : last?.kind ?? "normal", position: e.sets.length, prefilled: true, pr: [] };
    e.sets.push(s);
    if (e.status === "done") e.status = "pending";
    await call("post", `/workout-exercises/${e.id}/sets`, { id: s.id, kind: s.kind, weightKg: s.weightKg ?? null, reps: s.reps ?? null, durationS: s.durationS ?? null, distanceM: s.distanceM ?? null, restPlannedS: s.restPlannedS ?? null, prefilled: true }, true);
  }
  /** A drop set: straight after this set (or its last drop), about 20% lighter, with no rest before it. */
  async function addDrop(e: WorkoutExercise, from: WorkoutSet) {
    let at = e.sets.indexOf(from) + 1;
    while (e.sets[at]?.kind === "drop") at++;
    const prev = e.sets[at - 1]!;
    const s = { ...prev, id: crypto.randomUUID(), done: false, doneAt: null, kind: "drop", weightKg: dropWeightKg(prev.weightKg, fmt.value.wu), reps: prev.reps, restActualS: null, prefilled: true, pr: [] } as WorkoutSet;
    e.sets.splice(at, 0, s);
    e.sets.forEach((x, i) => (x.position = i));
    if (e.status === "done") e.status = "pending";
    await call("post", `/workout-exercises/${e.id}/sets`, { id: s.id, afterId: prev.id, kind: "drop", weightKg: s.weightKg ?? null, reps: s.reps ?? null, durationS: s.durationS ?? null, distanceM: s.distanceM ?? null, restPlannedS: s.restPlannedS ?? null, prefilled: true }, true);
  }
  async function removeSet(e: WorkoutExercise, s: WorkoutSet) {
    e.sets.splice(e.sets.indexOf(s), 1);
    await call("del", `/workout-sets/${s.id}`, undefined, true);
  }
  async function setStatus(e: WorkoutExercise, status: string, reason?: string | null) {
    e.status = status as any; e.skipReason = reason ?? null;
    await call("put", `/workout-exercises/${e.id}`, { status, skipReason: reason ?? null });
  }
  async function reorder(ids: string[]) {
    const w = state.w!;
    const curId = w.exercises[state.cur]?.id, actId = w.exercises[state.active]?.id;
    w.exercises.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    state.cur = Math.max(0, w.exercises.findIndex((x) => x.id === curId));
    state.active = Math.max(0, w.exercises.findIndex((x) => x.id === actId));
    await call("post", `/workouts/${w.id}/reorder`, { ids });
  }
  async function patchExercise(e: WorkoutExercise, patch: Record<string, unknown>, refresh = false) {
    Object.assign(e, patch);
    await call("put", `/workout-exercises/${e.id}`, patch, refresh);
  }
  async function addExercises(ids: string[]) {
    for (const id of ids) await api.post(`/workouts/${state.w!.id}/exercises`, { exerciseId: id });
    invalidate(["workouts"]);
  }
  async function removeExercise(e: WorkoutExercise) {
    const i = state.w!.exercises.indexOf(e);
    const actId = state.w!.exercises[state.active]?.id;
    state.w!.exercises.splice(i, 1);
    state.cur = Math.max(0, Math.min(state.cur, state.w!.exercises.length - 1));
    const a = state.w!.exercises.findIndex((x) => x.id === actId);
    state.active = a >= 0 ? a : Math.max(0, state.w!.exercises.findIndex((x) => x.status === "pending"));
    await call("del", `/workout-exercises/${e.id}`, undefined, true);
  }
  /** Skip an exercise: now, later (moved to the end), or just its remaining sets; then on to the next one */
  async function skipExercise(e: WorkoutExercise) {
    const v = await choose(`Skip ${e.exercise.name}?`, [
      { label: "Skip it", value: "skip" }, { label: "Do it later (move to the end)", value: "later" },
      ...(e.sets.some((s) => s.done) ? [{ label: "Skip the remaining sets", value: "rest" }] : []),
    ]);
    if (!v) return;
    const wasActive = state.w!.exercises.indexOf(e) === state.active;
    // the next exercise to do once this one is out of the way
    const onward = () => { const ws = state.w!.exercises; const i = ws.findIndex((x) => x !== e && x.status === "pending"); if (wasActive && i >= 0) activate(i); };
    if (v === "later") { const ids = state.w!.exercises.map((x) => x.id).filter((x) => x !== e.id); ids.push(e.id); await reorder(ids); onward(); return; }
    const reason = await choose("Why? (optional)", [{ label: "Equipment busy", value: "Equipment busy" }, { label: "Pain or injury", value: "Pain or injury" }, { label: "Out of time", value: "Out of time" }, { label: "Don't feel like it", value: "Don't feel like it" }, { label: "No reason", value: "" }]);
    if (v === "rest") { for (const s of e.sets.filter((x) => !x.done)) await removeSet(e, s); await setStatus(e, "partial", reason || null); }
    else await setStatus(e, "skipped", reason || null);
    onward();
  }
  // the rest running now was changed (±15 s…): offer to make it this exercise's rest from now on
  const restSet = () => { for (const e of state.w?.exercises ?? []) { const s = e.sets.find((x) => x.id === rest.setId); if (s) return { e, s }; } return null; };
  const restChanged = computed(() => { const f = rest.setId ? restSet() : null; return !!f && Math.abs(rest.totalS - (f.s.restPlannedS ?? rest.totalS)) >= 1; });
  function keepRest() {
    const f = restSet(); if (!f) return;
    const last = f.e.sets.indexOf(f.s) === f.e.sets.length - 1;
    patchExercise(f.e, last ? { restAfterS: rest.totalS } : { restS: rest.totalS });
    for (const x of f.e.sets) if (!x.done) x.restPlannedS = null;
  }
  async function patchWorkout(patch: Record<string, unknown>) {
    Object.assign(state.w!, patch);
    await call("put", `/workouts/${state.w!.id}`, patch, true);
  }
  // pausing the workout pauses everything: its clock and a rest that's running
  function togglePause() {
    const p = !state.w!.pauseStartedAt;
    if (p) pauseRest(); else resumeRest();
    patchWorkout({ pause: p, pauseStartedAt: p ? new Date().toISOString() : null });
  }
  return { state, prefs, settings, fmt, incKg, ex, activate, restChanged, keepRest, skipExercise, tick, editSet, addSet, addDrop, removeSet, setStatus, reorder, patchExercise, addExercises, removeExercise, patchWorkout, togglePause, restFor, call, active };
}

/**
 * Starting another workout in place of the running one: call before starting the new one, and the function it returns
 * once that worked. The old one is then over here at once, its rest timer too. Which one is old is taken before the
 * start, because the new one can already be on screen by the time the start answers (the offline copy updates first).
 */
export function replacingWorkout(): () => void {
  const old = state.w?.id;
  return () => {
    if (!old) return;
    markEnded(old);
    if (rest.workoutId === old) finishRest(false);
    if (state.w?.id === old) state.w = null;
  };
}

/**
 * The workout is over (finished or cancelled): every screen drops it now, not when the next reload comes back, so no
 * "workout in progress" bar lingers and Start doesn't find it running.
 */
export function endWorkout(id: string) {
  markEnded(id);
  // its rest goes with it, with the "Rest over" alarm the Android app has scheduled for it
  if (rest.workoutId === id) finishRest(false);
  if (state.w?.id === id) state.w = null;
  queryClient.setQueryData(["workouts", "active"], null);
  invalidate(["*"]);
}
