<script setup lang="ts">
// One exercise in the running workout: its reminders and pinned notes when it comes up (and the notes written in it), and the sets table
// (Previous · kg · Reps · ✓). The routine's numbers are already filled in (last time's in an empty workout); tap Previous to copy it, tick to log the set.
import { computed, ref, watch, nextTick, onBeforeUnmount } from "vue";
import { exerciseComplete, nextSet, usesWeight, usesReps, usesDuration, usesDistance, toM, fromM, parseQuick, warmups, muscleName, sideJoins, restDefaultsOf, refitSet, keepsWeight, type Tracking, type WorkoutExercise, type WorkoutSet } from "@motus/shared";
import { joinRest } from "../core/plannedRest";
import { SET_KINDS, setNo as setNoOf, sideJoinCls } from "../core/format";
import { useWorkout } from "./useWorkout";
import { mediaUrl, api } from "../api/client";
import { exerciseSheet, noteSheet, reminderSheet } from "../core/ui";
import { prompt } from "../core/ask";
import { toast } from "../core/toast";
import { invalidate } from "../api/live";
import { beep, restOver } from "./runtime";
import { sidesItem } from "../core/sides";
import { useNoteMenu } from "../core/noteMenu";
import { trackItem } from "../core/track";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import NoteItem from "../components/NoteItem.vue";
import ReminderItem from "../components/ReminderItem.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import RestPicker from "../components/RestPicker.vue";
import PlateSheet from "./PlateSheet.vue";

const props = defineProps<{ e: WorkoutExercise; index: number }>();
const W = useWorkout();
const fmt = W.fmt, feat = computed(() => W.settings.value.features), prefs = W.prefs;
const tr = computed(() => props.e.exercise?.tracking ?? "weight_reps");
const showW = computed(() => usesWeight(tr.value)), showR = computed(() => usesReps(tr.value)), showD = computed(() => usesDuration(tr.value)), showDist = computed(() => usesDistance(tr.value));
// three numbers a set (reps + time + weight, distance + time + weight) don't fit beside Previous at phone width (app.css .v3)
const three = computed(() => [showW.value, showR.value, showD.value, showDist.value].filter(Boolean).length >= 3);
const visibleSets = computed(() => props.e.sets.filter((s) => prefs.value.showWarmups || s.kind !== "warmup"));
// with sides shown, a left and right round (either order) shares a number (1L, 1R)
const setNo = (s: WorkoutSet) => setNoOf(props.e.sets, props.e.sets.indexOf(s), !!feat.value.unilateral);
// drops are numbered within their set: D1, D2…
const dropNo = (s: WorkoutSet) => { const a = props.e.sets; let i = a.indexOf(s), n = 0; while (a[i]?.kind === "drop") { n++; i--; } return n; };
// warm-ups keep a plain "W": the side letter is for the sets that count
const kindShort = (s: WorkoutSet) => (s.kind === "warmup" ? "W" : s.kind === "drop" ? `D${dropNo(s)}` : s.kind === "failure" ? "F" : String(setNo(s))) + (s.kind !== "drop" && s.kind !== "warmup" && feat.value.unilateral && s.side ? s.side : "");
// the exercise's own setting (left and right sets by default); any set of any exercise can still be made left or right
const sided = computed(() => !!feat.value.unilateral && !!props.e.exercise?.unilateral);
// a left set and its right one done with no rest between (the usual round, unless a rest was set on the first side)
// are one split set: a bar joins the two badges, by the rule every list of sets uses (sideJoins), with this workout's rests
const joins = computed(() => (feat.value.unilateral ? sideJoins(props.e.sets, (j) => joinRest(props.e, j, restDefaultsOf(W.prefs.value))) : []));
const joinCls = (s: WorkoutSet) => sideJoinCls(props.e.sets, joins.value, props.e.sets.indexOf(s));
// the weight column says "/ side" only when every set that counts is for one side; in a mix the L and R badges say it
const perSide = computed(() => { const w = props.e.sets.filter((s) => s.kind !== "warmup" && s.kind !== "drop"); return !!feat.value.unilateral && w.length > 0 && w.every((s) => s.side); });
// the set menu's side items: always on a one-sided exercise, else once it has a side set (the exercise menu adds the first)
const sideItems = computed(() => sided.value || (!!feat.value.unilateral && props.e.sets.some((s) => s.side)));
const prevText = (s: WorkoutSet) => {
  const p = s.prev; if (!p) return "-";
  return [showW.value && p.weightKg != null ? fmt.value.w(p.weightKg) : "", showR.value && p.reps != null ? p.reps : "", showD.value && p.durationS ? fmt.value.clock(p.durationS) : "", showDist.value && p.distanceM ? fmt.value.num(fromM(p.distanceM, fmt.value.du), 2) : ""].filter((x) => x !== "").join(" × ") || "-";
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

// timed sets (planks, holds): 3-2-1, count down, then tick the set. Reps against the clock still need their reps typed,
// so there the timer only fills in the time (the full time, or as far as it got when stopped) and the set stays to tick
const timer = ref<{ set: WorkoutSet; left: number; lead: number; of: number } | null>(null);
const timedRan = ref(new Set<string>()); // reps + time sets whose timer has run: their time shows as a number to correct
let tH: ReturnType<typeof setInterval> | null = null;
function startTimed(s: WorkoutSet) {
  stopTimed();
  // the 3-2-1 lead-in is one of the workout sounds (its switch shows only with them on)
  timer.value = { set: s, left: s.durationS ?? 30, lead: prefs.value.sound && prefs.value.countdown ? 3 : 0, of: s.durationS ?? 30 };
  tH = setInterval(() => {
    const t = timer.value!;
    if (t.lead > 0) { beep(); t.lead--; return; }
    t.left--;
    if (t.left <= 0) { restOver(); const set = t.set; stopTimed(); if (!showR.value) W.tick(props.e, props.e.sets.indexOf(set)); }
  }, 1000);
}
function stopTimed(keep: unknown = true) {
  const t = timer.value;
  if (tH) clearInterval(tH); tH = null; timer.value = null;
  if (keep && t && showR.value && t.lead <= 0 && t.of - t.left > 0) { timedRan.value.add(t.set.id); W.editSet(t.set, { durationS: t.of - Math.max(0, t.left) }); }
}
// rest between reps (cluster sets): a beep every N seconds while it runs
const repTimer = ref(false);
let rH: ReturnType<typeof setInterval> | null = null;
function toggleRepTimer() { repTimer.value = !repTimer.value; if (rH) clearInterval(rH); rH = null; if (repTimer.value) rH = setInterval(() => beep(), (props.e.repRestS ?? 15) * 1000); }
onBeforeUnmount(() => { stopTimed(false); if (rH) clearInterval(rH); });

const picking = ref<null | "replace">(null), alts = ref<any[]>([]), restEdit = ref<null | "between" | "after">(null), plates = ref<number | null>(null);
const skip = () => W.skipExercise(props.e);
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
async function addWarmups() {
  const work = props.e.sets.find((s) => s.kind !== "warmup" && s.weightKg);
  if (!work?.weightKg) { toast("Set a working weight first", { kind: "err" }); return; }
  const ws = warmups(work.weightKg, W.settings.value.barKg, W.incKg.value);
  await api.post(`/workout-exercises/${props.e.id}/sets`, { atStart: true, sets: ws.map((x) => ({ kind: "warmup", weightKg: x.weightKg, reps: x.reps, restPlannedS: 60 })) });
  invalidate(["workouts"]);
}
// tracked by something else: the server has already converted the sets still to do (8 reps, 30 seconds, 400 m, weight
// kept while it stays the same kind; done ones keep what was logged), so this copy only shows the same until the
// refetch, without saving again
function retrack(before: Tracking, after: Tracking) {
  if (props.e.exercise) props.e.exercise.tracking = after;
  for (const s of props.e.sets) {
    if (s.done) continue;
    Object.assign(s, refitSet(s, before, after));
    // as the server does: sets with no reps lose their rep target and start; new reps are what the set starts with
    if (!usesReps(after)) Object.assign(s, { targetReps: null, targetRepsMax: null, startReps: null });
    else if (!usesReps(before)) Object.assign(s, { startReps: s.reps, startWeightKg: s.startWeightKg ?? s.targetWeightKg });
    if (!keepsWeight(before, after)) Object.assign(s, { targetWeightKg: null, startWeightKg: null });
  }
}
// in groups: what it is and reminders, doing it or not, its rests and tools, then Remove on its own
const menu = computed(() => [
  { label: "About this exercise", icon: "info", run: () => (exerciseSheet.value = props.e.exerciseId) },
  { label: "Remind me next time", icon: "bell", run: () => (reminderSheet.value = { targetType: "exercise", targetId: props.e.exerciseId, label: props.e.exercise.name, scopeRoutineId: props.e.routineExerciseId && !props.e.swapped ? W.state.w?.routineId : null, routineName: W.state.w?.name, workoutId: W.state.w?.id }) },
  { label: "Skip", sep: true, icon: "skip", run: skip, hidden: props.e.status === "skipped" },
  { label: "Bring it back", icon: "refresh", run: () => W.setStatus(props.e, exerciseComplete(props.e.sets) ? "done" : "pending"), hidden: props.e.status !== "skipped" },
  { label: "Swap for another exercise", icon: "swap", run: openReplace },
  // what it is counted by: the exercise's own way, chosen for every workout from now on (and its sets in every routine)
  { ...trackItem(props.e.exerciseId, tr.value, !!feat.value.timedSets, retrack), sep: true },
  // any exercise can be switched to left and right sets (the exercise's default is only a start)
  { ...sidesItem(props.e.exerciseId, sided.value, (on) => { if (props.e.exercise) props.e.exercise.unilateral = on; }), hidden: !feat.value.unilateral },
  // one-sided exercises have this as a button under the sets; any other exercise can still get a left and a right set
  { label: "Add a left and right set", hint: "One set for each side, beside the others", icon: "plus", run: () => W.addPair(props.e), hidden: !feat.value.unilateral || sided.value },
  { label: "Rest between sets", sep: true, icon: "timer", run: () => (restEdit.value = "between") },
  { label: "Rest after this exercise", icon: "timer", run: () => (restEdit.value = "after") },
  { label: "Add warm-up sets", icon: "flame", run: addWarmups, hidden: !feat.value.warmupCalc || !showW.value },
  { label: "Plate calculator", icon: "layers", run: () => (plates.value = props.e.sets.find((s) => !s.done)?.weightKg ?? props.e.sets[0]?.weightKg ?? 60), hidden: !feat.value.plates || !showW.value },
  { label: "Quick entry", icon: "edit", run: quick, hidden: !feat.value.quickEntry },
  { label: "Remove from workout", icon: "trash", danger: true, sep: true, run: () => W.removeExercise(props.e) },
]);
const setMenu = (s: WorkoutSet) => [
  // a drop is added under the set it drops from, not made by relabelling a set
  ...(feat.value.setTypes && s.kind !== "drop" ? SET_KINDS.map(([k, l, ic]) => ({ label: l, icon: ic, checked: s.kind === k, run: () => W.editSet(s, { kind: k }) })) : []),
  ...(feat.value.setTypes && s.kind !== "warmup" ? [{ label: s.kind === "drop" || props.e.sets[props.e.sets.indexOf(s) + 1]?.kind === "drop" ? "Add another drop" : "Add a drop set", hint: "Straight after this set: lower the weight and keep going", icon: "arrowDown", sep: s.kind !== "drop", run: () => W.addDrop(props.e, s) }] : []),
  ...(s.prev ? [{ label: "Copy last time", icon: "copy", run: () => copyPrev(s) }] : []),
  // any set can be for one side, or both together, whatever the exercise's own setting (drops follow their set)
  ...(sideItems.value && s.kind !== "drop" ? [
    { label: "Both sides", icon: "dumbbell", sep: true, checked: !s.side, run: () => W.editSet(s, { side: null }) },
    { label: "Left side", icon: "left", checked: s.side === "L", run: () => W.editSet(s, { side: "L" }) },
    { label: "Right side", icon: "right", checked: s.side === "R", run: () => W.editSet(s, { side: "R" }) }] : []),
  { label: "Remove set", icon: "trash", danger: true, sep: true, run: () => W.removeSet(props.e, s) },
];
const isCur = computed(() => W.state.cur === props.index);
// notes under the exercise: the ones that come back (pinned), when reminders are shown, and every note written in this
// workout, always: one just written must show here (the setting hides what comes back, not what you wrote today)
const shownNotes = computed(() => (props.e.notes ?? []).filter((x) => x.workoutId === W.state.w?.id || (prefs.value.showReminders && x.pinned)));
const noteMenu = useNoteMenu();
// a note just written lands under the sets, on the phone behind the action bar: bring that note itself into view
// (not the whole list: with pinned notes above it, the list's top could fit while the new one stays under the bar)
const notesEl = ref<HTMLElement | null>(null);
let seenNotes = new Set(shownNotes.value.map((n) => n.id));
watch(() => shownNotes.value.map((n) => n.id), async (ids) => {
  const fresh = shownNotes.value.find((n) => !seenNotes.has(n.id) && n.workoutId === W.state.w?.id);
  seenNotes = new Set(ids);
  if (fresh) { await nextTick(); notesEl.value?.querySelector(`[data-note="${fresh.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
});
// the set to do now, marked in the table (the same one the action bar shows)
// sets are logged only in the exercise being done: in one you're just looking at, the ticks are locked against stray taps
const isActive = computed(() => W.state.active === props.index);
const nowId = computed(() => (W.state.active === props.index ? nextSet(visibleSets.value)?.id ?? null : null));
</script>

<template>
  <div class="aw-ex">
    <div class="exh">
      <div class="thumb lg click" @click="exerciseSheet = e.exerciseId"><img v-if="e.exercise?.images?.[0]" :src="mediaUrl(e.exercise.images[0])" alt="" /><Icon v-else name="dumbbell" /></div>
      <div class="grow">
        <h3 @click="exerciseSheet = e.exerciseId">{{ e.exercise?.name }}</h3>
        <div class="tiny" style="margin-top:3px">{{ e.exercise?.primaryMuscles.map(muscleName).join(", ") }}{{ sided ? " · one side at a time" : "" }}{{ e.superset ? ` · superset ${e.superset}` : "" }}{{ e.status === "skipped" ? ` · skipped${e.skipReason ? " (" + e.skipReason + ")" : ""}` : "" }}</div>
      </div>
      <Menu :items="menu" />
    </div>

    <!-- reminders come first, before the sets they are about; notes go under the exercise -->
    <div v-if="prefs.showReminders && isCur && e.reminders?.length" class="exrem nlist">
      <ReminderItem v-for="r in e.reminders" :key="r.id" :reminder="r" @gone="e.reminders = e.reminders?.filter((x) => x.id !== r.id)" live :workout-id="W.state.w?.id" />
    </div>

    <table class="sets" :class="{ v3: three }">
      <thead><tr><th>Set</th><th v-if="prefs.showPrevious" class="prevh">Previous</th><th v-if="showW">{{ fmt.wu }}<span v-if="perSide" class="thside"> / side</span></th><th v-if="showW && showR" class="sx" /><th v-if="showR">Reps</th><th v-if="showD">Time</th><th v-if="showDist">{{ fmt.du }}</th><th v-if="feat.rpe">RPE</th><th style="width:44px" /></tr></thead>
      <tbody>
        <tr v-for="s in visibleSets" :key="s.id" :class="{ done: s.done, drop: s.kind === 'drop', now: s.id === nowId && e.status !== 'skipped' }" :aria-current="s.id === nowId ? 'step' : undefined">
          <td :class="joinCls(s)"><button class="sk" :class="{ w: s.kind === 'warmup', d: s.kind === 'drop', f: s.kind === 'failure' }" @click.stop>{{ kindShort(s) }}</button></td>
          <td v-if="prefs.showPrevious" class="prev" @click="copyPrev(s)">{{ prevText(s) }}<span v-if="s.pr?.length" class="pr pvx">PR</span><span v-else-if="beat(s)" class="pos tiny pvx">{{ beat(s) }}</span></td>
          <td v-if="showW"><input class="vin" :class="{ pre: s.prefilled && !s.done }" inputmode="decimal" :value="wIn(s.weightKg)" placeholder="-" @change="W.editSet(s, { weightKg: num(($event.target as HTMLInputElement).value) == null ? null : fmt.toKg(num(($event.target as HTMLInputElement).value)!) })" @focus="($event.target as HTMLInputElement).select()" /></td>
          <td v-if="showW && showR" class="sx" aria-hidden="true">×</td>
          <td v-if="showR" class="rcell"><input class="vin" :class="{ pre: s.prefilled && !s.done }" inputmode="numeric" :value="s.reps ?? ''" :placeholder="s.targetReps != null ? String(s.targetReps) : '-'" @change="W.editSet(s, { reps: num(($event.target as HTMLInputElement).value) })" @focus="($event.target as HTMLInputElement).select()" /><span v-if="three && s.pr?.length" class="pr pvx v3pr">PR</span></td>
          <td v-if="showD">
            <button v-if="!s.done && timer?.set !== s && !timedRan.has(s.id)" :disabled="!isActive" class="btn tonal s tbtn" @click="startTimed(s)"><Icon name="play" :size="14" />{{ fmt.clock(s.durationS ?? 30) }}</button>
            <button v-else-if="timer?.set === s" class="btn s tbtn" @click="stopTimed">{{ timer.lead > 0 ? timer.lead : fmt.clock(timer.left) }}</button>
            <input v-else class="vin" inputmode="numeric" :value="s.durationS ?? ''" placeholder="sec" @change="W.editSet(s, { durationS: num(($event.target as HTMLInputElement).value) })" />
          </td>
          <td v-if="showDist"><input class="vin" inputmode="decimal" :value="s.distanceM != null ? Math.round(fromM(s.distanceM, fmt.du) * 100) / 100 : ''" placeholder="-" @change="W.editSet(s, { distanceM: num(($event.target as HTMLInputElement).value) == null ? null : toM(num(($event.target as HTMLInputElement).value)!, fmt.du) })" /><span v-if="three && !showR && s.pr?.length" class="pr pvx v3pr">PR</span></td>
          <td v-if="feat.rpe" class="rpecell"><input class="vin" inputmode="decimal" :value="s.rpe ?? ''" placeholder="-" @change="W.editSet(s, { rpe: num(($event.target as HTMLInputElement).value) })" /></td>
          <td><button class="tick" :class="{ on: s.done }" :disabled="!isActive" :aria-label="s.done ? 'Undo' : 'Done'" :title="isActive ? undefined : 'Make this the exercise you\'re doing to log it'" @click="W.tick(e, e.sets.indexOf(s))"><Icon v-if="s.done" name="check" :size="20" /></button></td>
          <td style="width:36px;padding:0"><Menu :items="setMenu(s)" /></td>
        </tr>
      </tbody>
    </table>
    <div class="row aw-add">
      <!-- secondary pills (the bottom bar has the one main button); a one-sided exercise adds both sides as its main
           step, the others add one set. "and", not a second "+": a text plus beside the icon read as a smaller icon -->
      <button v-if="sided" class="fchip acc" title="Add a left and a right set" @click="W.addPair(e)"><Icon name="plus" :size="14" />Left and right</button>
      <button class="fchip" :class="{ acc: !sided }" @click="W.addSet(e)"><Icon name="plus" :size="14" />Set</button>
      <button v-if="e.repRestS" class="fchip" :class="{ on: repTimer }" @click="toggleRepTimer"><Icon name="timer" :size="14" />{{ repTimer ? "Stop rep timer" : `Rep timer ${e.repRestS}s` }}</button>
      <div class="grow" />
      <button class="fchip" @click="noteSheet = { targets: [...(e.routineExerciseId && !e.swapped ? [{ type: 'routine_exercise', id: e.routineExerciseId, label: `${e.exercise.name} in ${W.state.w?.name || 'this routine'}` }] : []), { type: 'exercise', id: e.exerciseId, label: `${e.exercise.name}, every time` }, ...(W.state.w?.routineId ? [{ type: 'routine', id: W.state.w.routineId, label: `The whole routine` }] : []), { type: 'workout_exercise', id: e.id, label: 'Just today' }], workoutId: W.state.w?.id }"><Icon name="note" :size="14" />Note</button>
    </div>
    <!-- notes for this exercise: under it, where you look after a set -->
    <div v-if="isCur && shownNotes.length" ref="notesEl" class="exnotes">
      <NoteItem v-for="n in shownNotes" :key="n.id" :data-note="n.id" :note="n" :menu="noteMenu(n, e.exercise?.name ?? '')" />
    </div>
    <ExercisePicker v-if="picking" title="Replace with" :suggest="alts" @close="picking = null" @pick="replace" />
    <RestPicker v-if="restEdit" :title="restEdit === 'between' ? 'Rest between sets' : 'Rest after this exercise'" :value="restEdit === 'between' ? e.restS : e.restAfterS" :default-label="'Default'" @close="restEdit = null"
      @pick="(v) => { W.patchExercise(e, restEdit === 'between' ? { restS: v } : { restAfterS: v }); restEdit = null; }" />
    <PlateSheet v-if="plates != null" :kg="plates" @close="plates = null" />
  </div>
</template>

<style scoped>
/* the pills under the sets: the gap the rows use between blocks */
.aw-add { margin-top: var(--hg); flex-wrap: wrap; }
.exrem { margin-bottom: var(--hg); }
</style>
