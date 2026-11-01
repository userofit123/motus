<script setup lang="ts">
// One finished workout (requirement 2): when, how long (active and resting), what was done set by set, records,
// how it compares with last time, muscles worked, notes and reminders. Everything can be edited, duplicated,
// turned into a routine, repeated, exported or deleted (requirement 6).
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usesWeight, usesReps, muscleName, type WorkoutExercise, type WorkoutSet } from "@motus/shared";
import { useWorkout as useWorkoutQuery, useSettings } from "../api/queries";
import { api, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, localYmd } from "../core/format";
import { exerciseSheet, noteSheet } from "../core/ui";
import { confirm, prompt } from "../core/ask";
import { toast, toastError } from "../core/toast";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import BodyMap from "../components/BodyMap.vue";
import ExercisePicker from "../components/ExercisePicker.vue";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const q = useWorkoutQuery(id);
const s = useSettings();
const fmt = useFmt();
const w = computed<any>(() => q.data.value);
const rep = computed<any>(() => w.value?.report);
const editing = ref(false), adding = ref(false);
const verdict = (weId: string) => rep.value?.perExercise.find((p: any) => p.workoutExerciseId === weId);
const setText = (e: WorkoutExercise, x: WorkoutSet) => [x.weightKg != null && usesWeight(e.exercise.tracking) ? `${fmt.value.w(x.weightKg)} ${fmt.value.wu}` : "", x.reps != null && usesReps(e.exercise.tracking) ? `× ${x.reps}` : "", x.durationS ? fmt.value.clock(x.durationS) : "", x.distanceM ? fmt.value.dist(x.distanceM) : ""].filter(Boolean).join(" ");
const delta = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || !b ? null : a - b);

async function save(path: string, body: unknown, method: "put" | "del" | "post" = "put") {
  try { await (api as any)[method](path, body); invalidate(["workouts", "stats", "home", "goals", "calendar", "exercises"]); } catch (e) { toastError(e); }
}
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
async function editTimes() {
  const st = await prompt("Started at", { value: w.value.startedAt.slice(0, 16).replace("T", " "), text: "Date and time, e.g. 2026-11-01 18:30" });
  if (!st) return;
  const en = await prompt("Ended at", { value: (w.value.endedAt ?? w.value.startedAt).slice(0, 16).replace("T", " ") });
  if (!en) return;
  await save(`/workouts/${id.value}`, { startedAt: new Date(st.replace(" ", "T")).toISOString(), endedAt: new Date(en.replace(" ", "T")).toISOString() });
}
async function rename() { const n = await prompt("Workout name", { value: w.value.name }); if (n) await save(`/workouts/${id.value}`, { name: n }); }
async function del() {
  if (!(await confirm("Delete this workout?", { text: "Its sets leave your history, records and stats.", ok: "Delete", danger: true }))) return;
  await api.del(`/workouts/${id.value}`); invalidate(["*"]); router.replace("/history");
}
async function duplicate() {
  const d = await prompt("Copy to which day?", { value: localYmd(new Date()), text: "The copy is logged as done on that day." });
  if (!d) return;
  const r = await api.post(`/workouts/${id.value}/duplicate`, { startedAt: new Date(d + "T" + new Date(w.value.startedAt).toTimeString().slice(0, 8)).toISOString() });
  invalidate(["*"]); router.push(`/workouts/${r.id}`);
}
async function saveAsRoutine() {
  const n = await prompt("Name the routine", { value: w.value.name });
  if (!n) return;
  const r = await api.post("/routines", { fromWorkoutId: id.value, name: n }); invalidate(["routines"]); toast("Routine created"); router.push(`/routines/${r.id}`);
}
async function updateRoutine() {
  if (!(await confirm("Update the routine with this workout?", { text: "Its exercises and sets become this workout's. The previous version is kept.", ok: "Update" }))) return;
  await api.post(`/routines/${w.value.routineId}/from-workout`, { workoutId: id.value }); invalidate(["routines"]); toast("Routine updated");
}
async function repeat() {
  try {
    if (w.value.routineId) { router.push(`/routines/${w.value.routineId}/start`); return; }
    await api.post("/workouts/start", { name: w.value.name, exerciseIds: w.value.exercises.filter((e: any) => e.status !== "skipped").map((e: any) => e.exerciseId) });
    invalidate(["workouts"]); router.push("/workout");
  } catch (e) { toastError(e); }
}
async function copyText() {
  const t = await api.get(`/workouts/${id.value}/text`);
  await navigator.clipboard?.writeText(t.text); toast("Copied. Paste it into Claude or any assistant.");
}
function exportJson() { const b = new Blob([JSON.stringify(w.value, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${w.value.name}-${w.value.startedAt.slice(0, 10)}.json`; a.click(); }
async function addExercises(ids: string[]) {
  adding.value = false;
  for (const ex of ids) await api.post(`/workouts/${id.value}/exercises`, { exerciseId: ex, sets: [{ kind: "normal", done: true }] });
  invalidate(["*"]);
}
const menu = computed(() => [
  { label: editing.value ? "Done editing" : "Edit", icon: "edit", run: () => (editing.value = !editing.value) },
  { label: "Rename", icon: "edit", run: rename },
  { label: "Change times", icon: "clock", run: editTimes },
  { label: "Repeat now", icon: "play", run: repeat },
  { label: "Duplicate to another day", icon: "copy", run: duplicate },
  { label: "Save as a routine", icon: "routines", run: saveAsRoutine },
  { label: "Update the routine from this", icon: "refresh", run: updateRoutine, hidden: !w.value?.routineId },
  { label: "Add a note", icon: "note", run: () => (noteSheet.value = { targets: [{ type: "workout", id: id.value, label: "This workout" }], workoutId: id.value }) },
  { label: "Copy for an AI assistant", icon: "copy", run: copyText, hidden: !s.value.features.mcp },
  { label: "Export (JSON)", icon: "download", run: exportJson },
  { label: "Delete", icon: "trash", danger: true, sep: true, run: del },
]);
const RATE = ["Awful", "Meh", "OK", "Good", "Great"];
</script>

<template>
  <div v-if="w" class="page">
    <div class="row" style="margin-bottom:8px">
      <button class="back" style="margin:0" @click="router.back()"><Icon name="left" :size="16" />Back</button>
      <div class="grow" />
      <button class="ib sm plain" :disabled="!w.prevId" aria-label="Earlier workout" @click="router.push(`/workouts/${w.prevId}`)"><Icon name="left" :size="18" /></button>
      <button class="ib sm plain" :disabled="!w.nextId" aria-label="Later workout" @click="router.push(`/workouts/${w.nextId}`)"><Icon name="right" :size="18" /></button>
    </div>
    <div class="ph">
      <div><h1>{{ w.name }}</h1><div class="sub">{{ fmt.dateLong(w.startedAt) }} · {{ fmt.time(w.startedAt) }}–{{ fmt.time(w.endedAt) }}<template v-if="w.routineId"> · <a class="acc click" @click="router.push(`/routines/${w.routineId}`)">routine</a></template><template v-if="w.rating"> · felt {{ RATE[w.rating - 1]?.toLowerCase() }}</template></div></div>
      <div class="acts"><button v-if="editing" class="btn keep" @click="editing = false">Done</button><Menu :items="menu" /></div>
    </div>

    <div class="grid g4">
      <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Duration</div><div class="val">{{ fmt.dur(rep.totals.durationS, true) }}</div><div class="sub">{{ fmt.dur(rep.totals.activeS, true) }} active · {{ fmt.dur(rep.totals.restS, true) }} rest</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Volume</div><div class="val">{{ fmt.vol(rep.totals.volumeKg) }}</div>
        <div class="sub">{{ rep.previous ? `${rep.totals.volumeKg >= rep.previous.volumeKg ? "+" : ""}${fmt.vol(rep.totals.volumeKg - rep.previous.volumeKg)} vs last time` : `${rep.totals.reps} reps` }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="dumbbell" :size="15" /></span>Sets</div><div class="val">{{ rep.totals.workingSets }}</div><div class="sub">{{ rep.totals.exercises }} exercises{{ rep.totals.skipped ? ` · ${rep.totals.skipped} skipped` : "" }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="trophy" :size="15" /></span>Records</div><div class="val">{{ rep.totals.records }}</div><div class="sub">{{ rep.compared ? `Beat last time on ${rep.beat} of ${rep.compared}` : "First time for these" }}</div></div>
    </div>

    <div v-if="w.notes" class="banner note" style="margin-top:var(--spg)"><Icon name="note" /><div style="white-space:pre-wrap">{{ w.notes }}</div></div>
    <div v-for="n in w.routineNotes?.filter((x: any) => x.workoutId === w.id)" :key="n.id" class="banner note"><Icon name="note" /><div style="white-space:pre-wrap">{{ n.body }}</div></div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start;margin-top:var(--spg)">
      <div class="col" style="gap:var(--spg)">
        <div v-for="(e, i) in w.exercises" :key="e.id" class="card">
          <div class="row" style="margin-bottom:8px">
            <span class="tiny" style="width:16px">{{ i + 1 }}</span>
            <div class="thumb sm click" @click="exerciseSheet = e.exerciseId"><img v-if="e.exercise?.images?.[0]" :src="mediaUrl(e.exercise.images[0])" alt="" /><Icon v-else name="dumbbell" :size="16" /></div>
            <div class="grow click" @click="exerciseSheet = e.exerciseId"><div style="font-weight:600" :style="e.status === 'skipped' ? { textDecoration: 'line-through', opacity: .6 } : undefined">{{ e.exercise?.name }}</div>
              <div class="tiny">{{ e.status === "skipped" ? `Skipped${e.skipReason ? " · " + e.skipReason : ""}` : verdict(e.id)?.verdict === "better" ? "Better than last time" : verdict(e.id)?.verdict === "worse" ? "Below last time" : verdict(e.id)?.verdict === "first" ? "First time" : "Same as last time" }}</div></div>
            <span v-if="verdict(e.id)?.verdict === 'better'" class="pos"><Icon name="arrowUp" :size="18" /></span>
            <span v-else-if="verdict(e.id)?.verdict === 'worse'" class="neg"><Icon name="arrowDown" :size="18" /></span>
            <Menu v-if="editing" :items="[{ label: 'Add a set', icon: 'plus', run: () => save(`/workout-exercises/${e.id}/sets`, { kind: 'normal', done: true }, 'post') }, { label: e.status === 'skipped' ? 'Mark as done' : 'Mark as skipped', icon: 'skip', run: () => save(`/workout-exercises/${e.id}`, { status: e.status === 'skipped' ? 'done' : 'skipped' }) }, { label: 'Remove', icon: 'trash', danger: true, run: () => save(`/workout-exercises/${e.id}`, undefined, 'del') }]" />
          </div>
          <table v-if="e.sets.length" class="sets">
            <tbody>
              <tr v-for="(x, j) in e.sets" :key="x.id">
                <td><span class="sk" :class="{ w: x.kind === 'warmup', d: x.kind === 'drop', f: x.kind === 'failure' }">{{ x.kind === "warmup" ? "W" : x.kind === "drop" ? "D" : x.kind === "failure" ? "F" : e.sets.slice(0, j + 1).filter((y: any) => y.kind !== "warmup").length }}</span></td>
                <template v-if="!editing">
                  <td style="text-align:start;font-weight:500">{{ setText(e, x) }}<span v-if="x.rpe" class="tiny"> @ {{ x.rpe }}</span></td>
                  <td class="tiny">{{ x.restActualS != null ? `rested ${fmt.clock(x.restActualS)}` : "" }}{{ x.restPlannedS != null && x.restActualS != null ? ` / ${fmt.clock(x.restPlannedS)}` : "" }}</td>
                  <td style="text-align:end"><span v-for="p in x.pr" :key="p" class="pr" style="margin-inline-start:4px">{{ p === "e1rm" ? "1RM PR" : p === "weight" ? "Heaviest" : p === "reps" ? "Rep PR" : p === "volume" ? "Volume PR" : "PR" }}</span></td>
                </template>
                <template v-else>
                  <td v-if="usesWeight(e.exercise.tracking)"><input class="vin" inputmode="decimal" :value="x.weightKg != null ? Math.round(fmt.fromKg(x.weightKg) * 100) / 100 : ''" @change="save(`/workout-sets/${x.id}`, { weightKg: num(($event.target as HTMLInputElement).value) == null ? null : fmt.toKg(num(($event.target as HTMLInputElement).value)!) })" /></td>
                  <td v-if="usesReps(e.exercise.tracking)"><input class="vin" inputmode="numeric" :value="x.reps ?? ''" @change="save(`/workout-sets/${x.id}`, { reps: num(($event.target as HTMLInputElement).value) })" /></td>
                  <td v-if="e.exercise.tracking === 'duration'"><input class="vin" inputmode="numeric" :value="x.durationS ?? ''" @change="save(`/workout-sets/${x.id}`, { durationS: num(($event.target as HTMLInputElement).value) })" /></td>
                  <td><button class="ib sm plain" aria-label="Remove set" @click="save(`/workout-sets/${x.id}`, undefined, 'del')"><Icon name="trash" :size="16" /></button></td>
                </template>
              </tr>
            </tbody>
          </table>
          <div v-if="verdict(e.id)?.last && e.status !== 'skipped'" class="tiny" style="margin-top:6px">
            Last time {{ fmt.date(verdict(e.id).last.startedAt) }}: {{ verdict(e.id).last.e1rm ? `1RM ${fmt.w(verdict(e.id).last.e1rm)}` : `${verdict(e.id).last.reps} reps` }} · {{ fmt.vol(verdict(e.id).last.volumeKg) }}
            <template v-if="delta(verdict(e.id).now.e1rm, verdict(e.id).last.e1rm)"> · <span :class="delta(verdict(e.id).now.e1rm, verdict(e.id).last.e1rm)! > 0 ? 'pos' : 'neg'">{{ delta(verdict(e.id).now.e1rm, verdict(e.id).last.e1rm)! > 0 ? "+" : "" }}{{ fmt.w(delta(verdict(e.id).now.e1rm, verdict(e.id).last.e1rm)!) }} {{ fmt.wu }} 1RM</span></template>
          </div>
          <div v-for="n in e.notes?.filter((x: any) => x.workoutId === w.id)" :key="n.id" class="banner note" style="margin:8px 0 0"><Icon name="note" />{{ n.body }}</div>
        </div>
        <button v-if="editing" class="btn tonal block" @click="adding = true"><Icon name="plus" />Add exercise</button>
      </div>
      <div class="col" style="gap:var(--spg)">
        <div class="card"><div class="lbl" style="margin-bottom:6px">Muscles worked</div><BodyMap :values="rep.muscles" :height="170" />
          <div class="col" style="gap:3px;margin-top:8px"><div v-for="[m, n] in Object.entries(rep.muscles).sort((a: any, b: any) => b[1] - a[1])" :key="m" class="row tiny"><span class="grow" style="color:var(--tx)">{{ muscleName(m) }}</span>{{ n }} sets</div></div></div>
        <div v-if="rep.previous" class="card click" @click="router.push(`/workouts/${rep.previous.id}`)"><div class="lbl">Last time ({{ fmt.date(rep.previous.startedAt) }})</div>
          <div class="tiny" style="margin-top:6px">{{ fmt.dur(rep.previous.durationS, true) }} · {{ fmt.vol(rep.previous.volumeKg) }}</div>
          <div class="tiny" :class="rep.totals.durationS <= rep.previous.durationS ? 'pos' : ''">{{ rep.totals.durationS <= rep.previous.durationS ? `${fmt.dur(rep.previous.durationS - rep.totals.durationS, true)} faster` : `${fmt.dur(rep.totals.durationS - rep.previous.durationS, true)} longer` }}</div></div>
        <div v-if="w.createdReminders?.length" class="card"><div class="lbl" style="margin-bottom:6px">Reminders set</div><div v-for="m in w.createdReminders" :key="m.id" class="row tiny" style="padding:3px 0"><Icon name="bell" :size="14" />{{ m.body }}</div></div>
        <div v-if="rep.totals.avgRestS" class="card tight"><div class="lbl">Average rest</div><div style="font-weight:600;font-size:18px">{{ fmt.clock(rep.totals.avgRestS) }}</div></div>
      </div>
    </div>
    <ExercisePicker v-if="adding" multi @close="adding = false" @pick="addExercises" />
  </div>
  <div v-else class="page"><div class="empty">{{ q.isError.value ? "Workout not found" : "Loading…" }}</div></div>
</template>

<style scoped>
@media (max-width: 860px) { .grid[style*="300px"] { grid-template-columns: 1fr !important; } }
</style>
