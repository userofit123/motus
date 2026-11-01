// The running workout, as one shared object: a local copy that every change updates at once (so typing and ticking never
// wait for the network), with each change sent to the server (or kept for later when offline).
import { computed, reactive, ref, watch } from "vue";
import { restAfterSet, type Workout, type WorkoutExercise, type WorkoutSet, type WorkoutPrefs } from "@motus/shared";
import { useActive, useSettings } from "../api/queries";
import { send } from "../api/outbox";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { readJson, writeJson } from "../core/prefs";
import { startRest, finishRest, rest, setCues } from "./runtime";
import { haptic } from "./native";
import { makeFmt } from "../core/format";

const state = reactive<{ w: Workout | null; pending: number; cur: number }>({ w: null, pending: 0, cur: 0 });
let wired = false;

export function useWorkout() {
  const active = useActive();
  const settings = useSettings();
  if (!wired) {
    wired = true;
    // take the server's copy whenever nothing of ours is still on its way
    watch(() => active.data.value, (v) => {
      if (state.pending > 0) return;
      state.w = v ? JSON.parse(JSON.stringify(v)) : null;
      if (v) {
        const saved = readJson<Record<string, number>>("motusCur", {})[v.id];
        state.cur = saved != null && saved < v.exercises.length ? saved : Math.max(0, v.exercises.findIndex((e: any) => e.status === "pending"));
      }
    }, { immediate: true });
    watch(() => state.cur, (c) => { if (state.w) writeJson("motusCur", { [state.w.id]: c }); });
  }
  const prefs = computed<WorkoutPrefs>(() => ({ ...settings.value.workout, ...((state.w?.settings ?? {}) as Partial<WorkoutPrefs>) }));
  watch(prefs, (p) => setCues({ sound: p.sound, vibrate: p.vibrate, warn10: p.warn10, voice: p.voice && !!settings.value.features.voice }), { immediate: true });
  const fmt = computed(() => makeFmt(settings.value));

  async function call(method: "post" | "put" | "del", path: string, body?: unknown, refresh = false) {
    state.pending++;
    try { await send(method, path, body); }
    finally {
      state.pending--;
      if (refresh || state.pending === 0) invalidate(["workouts"]);
    }
  }
  const ex = (i = state.cur) => state.w?.exercises[i];

  function restFor(e: WorkoutExercise, si: number) {
    const s = e.sets[si]!;
    const last = si === e.sets.length - 1 || e.sets.slice(si + 1).every((x) => x.done);
    const d = { betweenSetsS: prefs.value.restBetweenSetsS, afterExerciseS: prefs.value.restAfterExerciseS };
    let secs = s.restPlannedS ?? restAfterSet({ exRestS: e.restS, isLastSet: last, exRestAfterS: e.restAfterS }, d);
    if (last && e.restAfterS != null) secs = e.restAfterS;
    // superset: no rest until the round is complete
    const nx = state.w!.exercises[state.w!.exercises.indexOf(e) + 1];
    if (e.superset && nx?.superset === e.superset) secs = 0;
    if (settings.value.features.adaptiveRest && s.targetReps && (s.reps ?? 0) < s.targetReps) secs += 30;
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
      const i = state.w!.exercises.indexOf(e);
      // in a superset, go on to the partner; otherwise to the next exercise still to do
      const next = state.w!.exercises.findIndex((x, j) => j > i && x.status === "pending");
      const first = state.w!.exercises.findIndex((x) => x.status === "pending");
      setTimeout(() => { state.cur = next >= 0 ? next : first >= 0 ? first : i; }, 450);
    } else if (e.superset && !allDone) {
      // supersets alternate: after a set, go to the partner exercise
      const partners = state.w!.exercises.map((x, j) => [x, j] as const).filter(([x]) => x.superset === e.superset && x.status === "pending");
      const at = partners.findIndex(([x]) => x === e);
      const nxt = partners[(at + 1) % partners.length];
      if (nxt && nxt[0] !== e) setTimeout(() => { state.cur = nxt[1]; }, 450);
    }
  }
  async function editSet(s: WorkoutSet, patch: Partial<WorkoutSet>) {
    Object.assign(s, patch, { prefilled: false });
    await call("put", `/workout-sets/${s.id}`, patch);
  }
  async function addSet(e: WorkoutExercise) {
    const last = e.sets.at(-1);
    await call("post", `/workout-exercises/${e.id}/sets`, {}, true);
    e.sets.push({ ...(last ?? ({} as any)), id: "tmp" + Date.now(), done: false, doneAt: null, kind: last?.kind === "warmup" ? "normal" : last?.kind ?? "normal", position: e.sets.length, prefilled: true, pr: [] });
    if (e.status === "done") e.status = "pending";
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
    const curId = w.exercises[state.cur]?.id;
    w.exercises.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    state.cur = Math.max(0, w.exercises.findIndex((x) => x.id === curId));
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
    state.w!.exercises.splice(i, 1);
    state.cur = Math.min(state.cur, state.w!.exercises.length - 1);
    await call("del", `/workout-exercises/${e.id}`, undefined, true);
  }
  async function patchWorkout(patch: Record<string, unknown>) {
    Object.assign(state.w!, patch);
    await call("put", `/workouts/${state.w!.id}`, patch, true);
  }
  return { state, prefs, settings, fmt, ex, tick, editSet, addSet, removeSet, setStatus, reorder, patchExercise, addExercises, removeExercise, patchWorkout, restFor, call, active };
}

export const curExercise = computed(() => state.w?.exercises[state.cur] ?? null);
export const isEmptyWorkout = ref(false);
