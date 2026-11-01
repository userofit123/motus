<script setup lang="ts">
// One exercise in the running workout: its reminders and pinned notes when it comes up, and the sets table
// (Previous · kg · Reps · ✓). Last time's numbers are already filled in; tap Previous to copy it, tick to log the set.
import { computed, ref, onBeforeUnmount } from "vue";
import { usesWeight, usesReps, usesDuration, usesDistance, toM, fromM, parseQuick, warmups, muscleName, type WorkoutExercise, type WorkoutSet } from "@motus/shared";
import { useWorkout } from "./useWorkout";
import { mediaUrl, api } from "../api/client";
import { exerciseSheet, noteSheet, reminderSheet } from "../core/ui";
import { choose, prompt } from "../core/ask";
import { toast } from "../core/toast";
import { invalidate } from "../api/live";
import { beep } from "./runtime";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import RestPicker from "../components/RestPicker.vue";
import PlateSheet from "./PlateSheet.vue";

const props = defineProps<{ e: WorkoutExercise; index: number }>();
const W = useWorkout();
const fmt = W.fmt, feat = computed(() => W.settings.value.features), prefs = W.prefs;
const tr = computed(() => props.e.exercise?.tracking ?? "weight_reps");
const showW = computed(() => usesWeight(tr.value)), showR = computed(() => usesReps(tr.value)), showD = computed(() => usesDuration(tr.value)), showDist = computed(() => usesDistance(tr.value));
const visibleSets = computed(() => props.e.sets.filter((s) => prefs.value.showWarmups || s.kind !== "warmup"));
const setNo = (s: WorkoutSet) => props.e.sets.slice(0, props.e.sets.indexOf(s) + 1).filter((x) => x.kind !== "warmup").length;
const kindShort = (s: WorkoutSet) => (s.kind === "warmup" ? "W" : s.kind === "drop" ? "D" : s.kind === "failure" ? "F" : String(setNo(s))) + (s.side ? s.side : "");
const sided = computed(() => !!feat.value.unilateral && !!props.e.exercise?.unilateral);
const prevText = (s: WorkoutSet) => {
  const p = s.prev; if (!p) return "–";
  return [showW.value && p.weightKg != null ? fmt.value.w(p.weightKg) : "", showR.value && p.reps != null ? p.reps : "", showD.value && p.durationS ? fmt.value.clock(p.durationS) : "", showDist.value && p.distanceM ? fmt.value.num(fromM(p.distanceM, fmt.value.du), 2) : ""].filter((x) => x !== "").join(" × ") || "–";
};
const copyPrev = (s: WorkoutSet) => { if (s.prev && !s.done) W.editSet(s, { weightKg: s.prev.weightKg, reps: s.prev.reps, durationS: s.prev.durationS, distanceM: s.prev.distanceM }); };
const wIn = (kg: number | null) => (kg == null ? "" : String(Math.round(fmt.value.fromKg(kg) * 100) / 100));
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const beat = (s: WorkoutSet) => {
  if (!s.done || !s.prev) return "";
  const dw = (s.weightKg ?? 0) - (s.prev.weightKg ?? 0), dr = (s.reps ?? 0) - (s.prev.reps ?? 0);
  if (dw > 0.01) return `+${fmt.value.w(dw)} ${fmt.value.wu}`;
  if (dw > -0.01 && dr > 0) return `+${dr} rep${dr > 1 ? "s" : ""}`;
  return "";
};
const remDone = async (id: string, status: string) => { await api.put(`/reminders/${id}`, { status }); props.e.reminders = props.e.reminders?.filter((r) => r.id !== id); invalidate(["reminders"]); };

// timed sets (planks, holds): 3-2-1, count down, then tick the set
const timer = ref<{ set: WorkoutSet; left: number; lead: number } | null>(null);
let tH: ReturnType<typeof setInterval> | null = null;
function startTimed(s: WorkoutSet) {
  stopTimed();
  timer.value = { set: s, left: s.durationS ?? 30, lead: prefs.value.countdown ? 3 : 0 };
  tH = setInterval(() => {
    const t = timer.value!;
    if (t.lead > 0) { beep(1, 520); t.lead--; return; }
    t.left--;
    if (t.left <= 0) { beep(3, 880); const set = t.set; stopTimed(); W.tick(props.e, props.e.sets.indexOf(set)); }
  }, 1000);
}
function stopTimed() { if (tH) clearInterval(tH); tH = null; timer.value = null; }
// rest between reps (cluster sets): a beep every N seconds while it runs
const repTimer = ref(false);
let rH: ReturnType<typeof setInterval> | null = null;
function toggleRepTimer() { repTimer.value = !repTimer.value; if (rH) clearInterval(rH); rH = null; if (repTimer.value) rH = setInterval(() => beep(1, 740), (props.e.repRestS ?? 15) * 1000); }
onBeforeUnmount(() => { stopTimed(); if (rH) clearInterval(rH); });

const picking = ref<null | "replace">(null), alts = ref<any[]>([]), restEdit = ref<null | "between" | "after">(null), plates = ref<number | null>(null);
async function skip() {
  if (prefs.value.confirmSkip || true) {
    const v = await choose(`Skip ${props.e.exercise.name}?`, [
      { label: "Skip it", value: "skip" }, { label: "Do it later (move to the end)", value: "later" },
      ...(props.e.sets.some((s) => s.done) ? [{ label: "Skip the remaining sets", value: "rest" }] : []),
    ]);
    if (!v) return;
    if (v === "later") { const ids = W.state.w!.exercises.map((x) => x.id).filter((x) => x !== props.e.id); ids.push(props.e.id); await W.reorder(ids); return; }
    const reason = await choose("Why? (optional)", [{ label: "Equipment busy", value: "Equipment busy" }, { label: "Pain or injury", value: "Pain or injury" }, { label: "Out of time", value: "Out of time" }, { label: "Don't feel like it", value: "Don't feel like it" }, { label: "No reason", value: "" }]);
    if (v === "rest") { for (const s of props.e.sets.filter((x) => !x.done)) await W.removeSet(props.e, s); await W.setStatus(props.e, "partial", reason || null); }
    else await W.setStatus(props.e, "skipped", reason || null);
    const next = W.state.w!.exercises.findIndex((x) => x.status === "pending");
    if (next >= 0) W.state.cur = next;
  }
}
async function openReplace() { alts.value = await api.get(`/exercises/${props.e.exerciseId}/alternatives`).catch(() => []); picking.value = "replace"; }
async function replace(ids: string[]) { picking.value = null; await W.patchExercise(props.e, { exerciseId: ids[0] }, true); toast("Exercise replaced"); }
async function quick() {
  const t = await prompt("Quick entry", { placeholder: 'e.g. 3x8 80 or 80x8,8,7', text: "Sets × reps and weight, or weight × each set's reps." });
  const parsed = t ? parseQuick(t) : null;
  if (!parsed) { if (t) toast("Didn't understand that", { kind: "err" }); return; }
  const open = props.e.sets.filter((s) => !s.done);
  for (const [i, p] of parsed.entries()) {
    const s = open[i];
    const patch = { reps: p.reps, ...(p.weight != null ? { weightKg: fmt.value.toKg(p.weight) } : {}) };
    if (s) await W.editSet(s, patch); else await api.post(`/workout-exercises/${props.e.id}/sets`, { kind: "normal", ...patch });
  }
  invalidate(["workouts"]);
}
async function addPair() {
  const last = props.e.sets.at(-1);
  await api.post(`/workout-exercises/${props.e.id}/sets`, { sets: ["L", "R"].map((side) => ({ kind: "normal", side, weightKg: last?.weightKg ?? null, reps: last?.reps ?? null })) });
  invalidate(["workouts"]);
}
async function addWarmups() {
  const work = props.e.sets.find((s) => s.kind !== "warmup" && s.weightKg);
  if (!work?.weightKg) { toast("Set a working weight first", { kind: "err" }); return; }
  const ws = warmups(work.weightKg, W.settings.value.barKg, W.incKg.value);
  await api.post(`/workout-exercises/${props.e.id}/sets`, { atStart: true, sets: ws.map((x) => ({ kind: "warmup", weightKg: x.weightKg, reps: x.reps, restPlannedS: 60 })) });
  invalidate(["workouts"]);
}
const menu = computed(() => [
  { label: "About this exercise", icon: "info", run: () => (exerciseSheet.value = props.e.exerciseId) },
  { label: "Skip", icon: "skip", run: skip, hidden: props.e.status === "skipped" },
  { label: "Bring it back", icon: "refresh", run: () => W.setStatus(props.e, props.e.sets.every((s) => s.done) && props.e.sets.length ? "done" : "pending"), hidden: props.e.status !== "skipped" },
  { label: "Replace", icon: "swap", run: openReplace },
  { label: "Remind me next time", icon: "bell", run: () => (reminderSheet.value = { targetType: "exercise", targetId: props.e.exerciseId, label: props.e.exercise.name, scopeRoutineId: W.state.w?.routineId, workoutId: W.state.w?.id }) },
  { label: "Rest between sets", icon: "timer", run: () => (restEdit.value = "between") },
  { label: "Rest after this exercise", icon: "timer", run: () => (restEdit.value = "after") },
  { label: "Add warm-up sets", icon: "flame", run: addWarmups, hidden: !feat.value.warmupCalc || !showW.value },
  { label: "Plate calculator", icon: "layers", run: () => (plates.value = props.e.sets.find((s) => !s.done)?.weightKg ?? props.e.sets[0]?.weightKg ?? 60), hidden: !feat.value.plates || !showW.value },
  { label: "Quick entry", icon: "edit", run: quick, hidden: !feat.value.quickEntry },
  { label: "Remove from workout", icon: "trash", danger: true, sep: true, run: () => W.removeExercise(props.e) },
]);
const setMenu = (s: WorkoutSet) => [
  ...(feat.value.setTypes ? ([["normal", "Normal"], ["warmup", "Warm-up"], ["drop", "Drop set"], ["failure", "To failure"]] as const).map(([k, l]) => ({ label: l, icon: s.kind === k ? "check" : undefined, run: () => W.editSet(s, { kind: k }) })) : []),
  ...(s.prev ? [{ label: "Copy last time", icon: "copy", run: () => copyPrev(s) }] : []),
  ...(sided.value ? [{ label: "Left side", icon: s.side === "L" ? "check" : undefined, run: () => W.editSet(s, { side: s.side === "L" ? null : "L" }) }, { label: "Right side", icon: s.side === "R" ? "check" : undefined, run: () => W.editSet(s, { side: s.side === "R" ? null : "R" }) }] : []),
  { label: "Remove set", icon: "trash", danger: true, sep: feat.value.setTypes, run: () => W.removeSet(props.e, s) },
];
const isCur = computed(() => W.state.cur === props.index);
</script>

<template>
  <div class="aw-ex">
    <div class="exh">
      <div class="thumb lg click" @click="exerciseSheet = e.exerciseId"><img v-if="e.exercise?.images?.[0]" :src="mediaUrl(e.exercise.images[0])" alt="" /><Icon v-else name="dumbbell" /></div>
      <div class="grow">
        <h3 @click="exerciseSheet = e.exerciseId">{{ e.exercise?.name }}</h3>
        <div class="tiny" style="margin-top:3px">{{ e.exercise?.primaryMuscles.map(muscleName).join(", ") }}{{ e.superset ? ` · superset ${e.superset}` : "" }}{{ e.status === "skipped" ? ` · skipped${e.skipReason ? " (" + e.skipReason + ")" : ""}` : "" }}</div>
      </div>
      <Menu :items="menu" />
    </div>
    <template v-if="prefs.showReminders && isCur">
      <div v-for="r in e.reminders" :key="r.id" class="banner"><Icon name="bell" /><div class="grow"><b>{{ r.body }}</b>
        <div class="acts"><button class="qb acc" style="padding:4px 8px" @click="remDone(r.id, 'done')">Done</button><button class="qb" style="padding:4px 8px" @click="remDone(r.id, 'pending'); e.reminders = e.reminders?.filter((x) => x.id !== r.id)">Next time</button><button class="qb" style="padding:4px 8px" @click="remDone(r.id, 'dismissed')">Dismiss</button></div></div></div>
      <div v-for="n in e.notes?.filter((x) => x.pinned || x.workoutId === W.state.w?.id)" :key="n.id" class="banner note"><Icon name="note" /><div class="grow" style="white-space:pre-wrap">{{ n.body }}<span v-for="t in n.tags" :key="t" class="mchip" style="margin-inline-start:6px">{{ t }}</span></div></div>
    </template>

    <table class="sets">
      <thead><tr><th>Set</th><th v-if="prefs.showPrevious">Previous</th><th v-if="showW">{{ fmt.wu }}</th><th v-if="showR">Reps</th><th v-if="showD">Time</th><th v-if="showDist">{{ fmt.du }}</th><th v-if="feat.rpe">RPE</th><th style="width:44px" /></tr></thead>
      <tbody>
        <tr v-for="s in visibleSets" :key="s.id" :class="{ done: s.done }">
          <td><button class="sk" :class="{ w: s.kind === 'warmup', d: s.kind === 'drop', f: s.kind === 'failure' }" @click.stop>{{ kindShort(s) }}</button></td>
          <td v-if="prefs.showPrevious" class="prev" @click="copyPrev(s)">{{ prevText(s) }}<span v-if="s.pr?.length" class="pr" style="margin-inline-start:6px">PR</span><span v-else-if="beat(s)" class="pos tiny" style="margin-inline-start:6px">{{ beat(s) }}</span></td>
          <td v-if="showW"><input class="vin" :class="{ pre: s.prefilled && !s.done }" inputmode="decimal" :value="wIn(s.weightKg)" placeholder="–" @change="W.editSet(s, { weightKg: num(($event.target as HTMLInputElement).value) == null ? null : fmt.toKg(num(($event.target as HTMLInputElement).value)!) })" @focus="($event.target as HTMLInputElement).select()" /></td>
          <td v-if="showR"><input class="vin" :class="{ pre: s.prefilled && !s.done }" inputmode="numeric" :value="s.reps ?? ''" :placeholder="s.targetReps != null ? String(s.targetReps) : '–'" @change="W.editSet(s, { reps: num(($event.target as HTMLInputElement).value) })" @focus="($event.target as HTMLInputElement).select()" /></td>
          <td v-if="showD">
            <button v-if="!s.done && timer?.set !== s && !showR" class="btn tonal s" style="min-width:76px" @click="startTimed(s)"><Icon name="play" :size="14" />{{ fmt.clock(s.durationS ?? 30) }}</button>
            <button v-else-if="timer?.set === s" class="btn s" style="min-width:76px" @click="stopTimed">{{ timer.lead > 0 ? timer.lead : fmt.clock(timer.left) }}</button>
            <input v-else class="vin" inputmode="numeric" :value="s.durationS ?? ''" placeholder="sec" @change="W.editSet(s, { durationS: num(($event.target as HTMLInputElement).value) })" />
          </td>
          <td v-if="showDist"><input class="vin" inputmode="decimal" :value="s.distanceM != null ? Math.round(fromM(s.distanceM, fmt.du) * 100) / 100 : ''" placeholder="–" @change="W.editSet(s, { distanceM: num(($event.target as HTMLInputElement).value) == null ? null : toM(num(($event.target as HTMLInputElement).value)!, fmt.du) })" /></td>
          <td v-if="feat.rpe"><input class="vin" inputmode="decimal" :value="s.rpe ?? ''" placeholder="–" style="max-width:56px" @change="W.editSet(s, { rpe: num(($event.target as HTMLInputElement).value) })" /></td>
          <td><button class="tick" :class="{ on: s.done }" :aria-label="s.done ? 'Undo' : 'Done'" @click="W.tick(e, e.sets.indexOf(s))"><Icon name="check" :size="20" /></button></td>
          <td style="width:30px;padding:0"><Menu :items="setMenu(s)" /></td>
        </tr>
      </tbody>
    </table>
    <div class="row" style="margin-top:8px">
      <button class="qb acc" @click="W.addSet(e)"><Icon name="plus" :size="16" />Add set</button>
      <button v-if="sided" class="qb" title="Add a left and a right set" @click="addPair"><Icon name="plus" :size="16" />Left + right</button>
      <button v-if="e.repRestS" class="qb" :class="{ acc: repTimer }" @click="toggleRepTimer"><Icon name="timer" :size="16" />{{ repTimer ? "Stop rep timer" : `Rep timer ${e.repRestS}s` }}</button>
      <div class="grow" />
      <button class="qb" @click="noteSheet = { targets: [{ type: 'exercise', id: e.exerciseId, label: `${e.exercise.name} (always)` }, ...(e.routineExerciseId ? [{ type: 'routine_exercise', id: e.routineExerciseId, label: `${e.exercise.name} in this routine only` }] : []), ...(W.state.w?.routineId ? [{ type: 'routine', id: W.state.w.routineId, label: 'This routine' }] : []), { type: 'workout_exercise', id: e.id, label: 'Just this workout' }], workoutId: W.state.w?.id }"><Icon name="note" :size="16" />Note</button>
    </div>
    <ExercisePicker v-if="picking" title="Replace with" :suggest="alts" @close="picking = null" @pick="replace" />
    <RestPicker v-if="restEdit" :title="restEdit === 'between' ? 'Rest between sets' : 'Rest after this exercise'" :value="restEdit === 'between' ? e.restS : e.restAfterS" :default-label="'Default'" @close="restEdit = null"
      @pick="(v) => { W.patchExercise(e, restEdit === 'between' ? { restS: v } : { restAfterS: v }); restEdit = null; }" />
    <PlateSheet v-if="plates != null" :kg="plates" @close="plates = null" />
  </div>
</template>
