<script setup lang="ts">
// Logging a workout after the fact (from a routine or from scratch), on any day. A sheet like the other Log entries
// (activity, body weight, daily log); wide like the program editor, since it holds exercises and their sets.
import { computed, ref, watch } from "vue";
import { usesWeight, usesReps, usesDuration } from "@motus/shared";
import { useRoutines, useExercises } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, localYmd } from "../core/format";
import { toastError, toast } from "../core/toast";
import { confirm } from "../core/ask";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import AppSelect from "../components/AppSelect.vue";
import DatePicker from "../components/DatePicker.vue";
import TimePicker from "../components/TimePicker.vue";

// date: the day to log on (a Calendar day); routineId: start from that routine (a planned workout's "Log it" on Home)
const props = defineProps<{ o: { date?: string; routineId?: string } }>();
const emit = defineEmits<{ close: [] }>();
const routines = useRoutines();
const all = useExercises();
const fmt = useFmt();
const exById = computed(() => new Map((all.data.value ?? []).map((e) => [e.id, e])));
const f = ref({ routineId: props.o.routineId ?? "", name: "", date: props.o.date ?? localYmd(new Date()), time: "18:00", minutes: 60, notes: "" });
const exs = ref<{ exerciseId: string; sets: { weight: number | null; reps: number | null; durationS: number | null }[] }[]>([]);
const picking = ref(false), busy = ref(false);
// what the sheet held once its routine was in: closing asks only when something was changed since
const snap = () => JSON.stringify([f.value, exs.value]);
let start = snap(), opening = !!props.o.routineId;
watch(() => f.value.routineId, async (id) => {
  if (!id) return;
  let r;
  try { r = await api.get(`/routines/${id}`); }
  // a stale link (a routine deleted since): start from no routine instead
  catch (e) { toastError(e); f.value.routineId = ""; if (opening) { opening = false; start = snap(); } return; }
  f.value.name = r.name;
  exs.value = r.exercises.map((e: any) => ({ exerciseId: e.exerciseId, sets: e.sets.filter((s: any) => s.kind !== "warmup").map((s: any) => ({ weight: s.weightKg != null ? Math.round(fmt.value.fromKg(s.weightKg) * 100) / 100 : null, reps: s.reps, durationS: s.durationS })) }));
  // only the routine it was opened with counts as the starting point; picking one later is a change
  if (opening) { opening = false; start = snap(); }
}, { immediate: true });
const add = (ids: string[]) => { for (const id of ids) exs.value.push({ exerciseId: id, sets: [{ weight: null, reps: null, durationS: null }, { weight: null, reps: null, durationS: null }, { weight: null, reps: null, durationS: null }] }); picking.value = false; };
// closing with changes asks first
async function close() {
  if (snap() !== start && !(await confirm("Discard this workout?", { ok: "Discard", danger: true, noHistory: true }))) return;
  emit("close");
}
async function save() {
  busy.value = true;
  try {
    const startedAt = new Date(`${f.value.date}T${f.value.time}`).toISOString();
    await api.post("/workouts/log", { routineId: f.value.routineId || null, name: f.value.name || "Workout", startedAt, durationS: f.value.minutes * 60, notes: f.value.notes,
      exercises: exs.value.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.filter((s) => s.reps != null || s.weight != null || s.durationS != null).map((s) => ({ kind: "normal", weightKg: s.weight != null ? fmt.value.toKg(s.weight) : null, reps: s.reps, durationS: s.durationS })) })) });
    invalidate(["*"]); toast("Workout logged"); emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet title="Log a past workout" size="wide" @close="close">
    <div class="frow"><div class="fld"><label>Routine</label><AppSelect v-model="f.routineId" :options="[{ value: '', label: 'None' }, ...(routines.data.value ?? []).filter((r) => !r.archived || r.id === f.routineId).map((r) => ({ value: r.id, label: r.name }))]" title="Routine" /></div><div class="fld"><label>Name</label><input v-model="f.name" placeholder="Workout" /></div></div>
    <div class="frow"><div class="fld"><label>Day</label><DatePicker v-model="f.date" title="Day" /></div><div class="fld"><label>Start</label><TimePicker v-model="f.time" title="Start" /></div><div class="fld"><label>Minutes</label><input v-model.number="f.minutes" type="number" inputmode="numeric" min="1" /></div></div>
    <div class="fld"><label>Notes</label><input v-model="f.notes" /></div>
    <div class="flbl">Exercises</div>
    <div v-for="(e, i) in exs" :key="i" class="card tight lex">
      <div class="row hgap"><b class="grow">{{ exById.get(e.exerciseId)?.name }}</b><Menu :items="[{ label: 'Remove this exercise', icon: 'trash', danger: true, run: () => exs.splice(i, 1) }]" /></div>
      <table class="sets"><thead><tr><th>Set</th><th v-if="usesWeight(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')">{{ fmt.wu }}</th><th v-if="usesReps(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')">Reps</th><th v-if="usesDuration(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')">Sec</th><th /></tr></thead>
        <tbody><tr v-for="(s, j) in e.sets" :key="j"><td><span class="sk">{{ j + 1 }}</span></td>
          <td v-if="usesWeight(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')"><input v-model.number="s.weight" class="vin" inputmode="decimal" /></td>
          <td v-if="usesReps(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')"><input v-model.number="s.reps" class="vin" inputmode="numeric" /></td>
          <td v-if="usesDuration(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')"><input v-model.number="s.durationS" class="vin" inputmode="numeric" /></td>
          <td><button class="ib sm plain" aria-label="Remove set" @click="e.sets.splice(j, 1)"><Icon name="minus" :size="16" /></button></td></tr></tbody></table>
      <button class="qb acc" @click="e.sets.push({ ...(e.sets.at(-1) ?? { weight: null, reps: null, durationS: null }) })"><Icon name="plus" :size="16" />Add set</button>
    </div>
    <button class="qb acc" @click="picking = true"><Icon name="plus" :size="16" />Add exercises</button>
    <ExercisePicker v-if="picking" multi @close="picking = false" @pick="add" />
    <template #foot><button class="btn o" @click="close">Cancel</button><button class="btn" :disabled="busy || !exs.length" @click="save">Save</button></template>
  </Sheet>
</template>

<style scoped>
/* each exercise's parts (name, sets, add a set) are spaced by one gap, the same as the program editor's weeks */
.lex { display: flex; flex-direction: column; gap: var(--hg); margin-bottom: var(--hg); }
.lex .row.hgap { margin: 0; }
.lex .qb { align-self: flex-start; }
</style>
