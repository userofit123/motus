<script setup lang="ts">
// Logging a workout after the fact (from a routine or from scratch), on any day.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usesWeight, usesReps, usesDuration } from "@motus/shared";
import { useRoutines, useExercises, loaded } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, localYmd } from "../core/format";
import { toastError, toast } from "../core/toast";
import Icon from "../components/Icon.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import AppSelect from "../components/AppSelect.vue";
import DatePicker from "../components/DatePicker.vue";
import TimePicker from "../components/TimePicker.vue";
import { useLeaveGuard, goBack } from "../core/leave";

const route = useRoute(), router = useRouter();
const routines = useRoutines();
const all = useExercises();
const fmt = useFmt();
const exById = computed(() => new Map((all.data.value ?? []).map((e) => [e.id, e])));
const f = ref({ routineId: "", name: "", date: String(route.query.date ?? localYmd(new Date())), time: "18:00", minutes: 60, notes: "" });
const exs = ref<{ exerciseId: string; sets: { weight: number | null; reps: number | null; durationS: number | null }[] }[]>([]);
const picking = ref(false), busy = ref(false), saved = ref(false);
// leaving with exercises filled in asks first
useLeaveGuard(() => !saved.value && exs.value.length > 0, { title: "Discard this workout?" });
watch(() => f.value.routineId, async (id) => {
  if (!id) return;
  const r = await api.get(`/routines/${id}`);
  f.value.name = r.name;
  exs.value = r.exercises.map((e: any) => ({ exerciseId: e.exerciseId, sets: e.sets.filter((s: any) => s.kind !== "warmup").map((s: any) => ({ weight: s.weightKg != null ? Math.round(fmt.value.fromKg(s.weightKg) * 100) / 100 : null, reps: s.reps, durationS: s.durationS })) }));
});
const add = (ids: string[]) => { for (const id of ids) exs.value.push({ exerciseId: id, sets: [{ weight: null, reps: null, durationS: null }, { weight: null, reps: null, durationS: null }, { weight: null, reps: null, durationS: null }] }); picking.value = false; };
async function save() {
  busy.value = true;
  try {
    const startedAt = new Date(`${f.value.date}T${f.value.time}`).toISOString();
    const r = await api.post("/workouts/log", { routineId: f.value.routineId || null, name: f.value.name || "Workout", startedAt, durationS: f.value.minutes * 60, notes: f.value.notes,
      exercises: exs.value.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets.filter((s) => s.reps != null || s.weight != null || s.durationS != null).map((s) => ({ kind: "normal", weightKg: s.weight != null ? fmt.value.toKg(s.weight) : null, reps: s.reps, durationS: s.durationS })) })) });
    saved.value = true; invalidate(["*"]); toast("Workout logged"); router.replace(`/workouts/${r.id}`);
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
// show the page once its data is in, all at once
await loaded(routines, all);
</script>

<template>
  <div class="page">
    <button class="back" @click="goBack(router, '/history')"><Icon name="left" :size="16" /><span>Back</span></button>
    <div class="ph"><div><h1>Log a past workout</h1><div class="sub">Something you did without the app</div></div><div class="acts"><button class="btn keep" :disabled="busy || !exs.length" @click="save">Save</button></div></div>
    <div class="card spb">
      <div class="frow"><div class="fld"><label>Routine</label><AppSelect v-model="f.routineId" :options="[{ value: '', label: 'None' }, ...(routines.data.value ?? []).map((r) => ({ value: r.id, label: r.name }))]" title="Routine" /></div><div class="fld"><label>Name</label><input v-model="f.name" placeholder="Workout" /></div></div>
      <div class="frow"><div class="fld"><label>Day</label><DatePicker v-model="f.date" title="Day" /></div><div class="fld"><label>Start</label><TimePicker v-model="f.time" title="Start" /></div><div class="fld"><label>Minutes</label><input v-model.number="f.minutes" type="number" min="1" /></div></div>
      <div class="fld" style="margin:0"><label>Notes</label><input v-model="f.notes" /></div>
    </div>
    <div v-for="(e, i) in exs" :key="i" class="card spb">
      <div class="row hgap"><b class="grow">{{ exById.get(e.exerciseId)?.name }}</b><button class="ib sm plain" aria-label="Remove" @click="exs.splice(i, 1)"><Icon name="close" :size="16" /></button></div>
      <table class="sets"><thead><tr><th>Set</th><th v-if="usesWeight(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')">{{ fmt.wu }}</th><th v-if="usesReps(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')">Reps</th><th v-if="usesDuration(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')">Sec</th><th /></tr></thead>
        <tbody><tr v-for="(s, j) in e.sets" :key="j"><td><span class="sk">{{ j + 1 }}</span></td>
          <td v-if="usesWeight(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')"><input v-model.number="s.weight" class="vin" inputmode="decimal" /></td>
          <td v-if="usesReps(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')"><input v-model.number="s.reps" class="vin" inputmode="numeric" /></td>
          <td v-if="usesDuration(exById.get(e.exerciseId)?.tracking ?? 'weight_reps')"><input v-model.number="s.durationS" class="vin" inputmode="numeric" /></td>
          <td><button class="ib sm plain" aria-label="Remove set" @click="e.sets.splice(j, 1)"><Icon name="minus" :size="16" /></button></td></tr></tbody></table>
      <button class="qb acc" @click="e.sets.push({ ...(e.sets.at(-1) ?? { weight: null, reps: null, durationS: null }) })"><Icon name="plus" :size="16" />Set</button>
    </div>
    <button class="btn tonal block lg" @click="picking = true"><Icon name="plus" />Add exercises</button>
    <ExercisePicker v-if="picking" multi @close="picking = false" @pick="add" />
  </div>
</template>
