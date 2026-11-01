<script setup lang="ts">
// Finishing: how it felt, notes, body weight, whether to update the routine with today's sets, and one-tap reminders
// to add weight next time where every target was hit.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkout } from "./useWorkout";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { finishRest } from "./runtime";
import { keepAwake } from "./native";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";

const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const W = useWorkout();
const w = computed(() => W.state.w!);
const fmt = W.fmt;
const rating = ref<number | null>(null), notes = ref(w.value.notes ?? ""), bw = ref<number | null>(null), busy = ref(false);
const updateRoutine = ref(W.prefs.value.updateRoutine === "always");
const done = computed(() => w.value.exercises.flatMap((e) => e.sets.filter((s) => s.done)));
const records = computed(() => done.value.filter((s) => s.pr?.length).length);
const changedFromPlan = computed(() => w.value.routineId && w.value.exercises.some((e) => !e.routineExerciseId || e.sets.some((s) => s.done && (s.weightKg !== s.targetWeightKg || (s.targetReps != null && s.reps !== s.targetReps)))));
// exercises where every working set reached its target reps: offer "add weight next time"
const hitAll = computed(() => w.value.exercises.filter((e) => e.status !== "skipped" && e.sets.some((s) => s.done && s.kind !== "warmup") && e.sets.filter((s) => s.kind !== "warmup").every((s) => s.done && (s.targetReps == null || (s.reps ?? 0) >= s.targetReps)) && e.sets.some((s) => s.weightKg)));
const reminded = ref<string[]>([]);
async function remind(e: any) {
  const inc = W.settings.value.increments.kg;
  await api.post("/reminders", { targetType: "exercise", targetId: e.exerciseId, body: `Add ${fmt.value.w(inc)} ${fmt.value.wu}`, action: { weightKg: inc }, workoutId: w.value.id });
  reminded.value.push(e.id);
}
const unticked = computed(() => w.value.exercises.reduce((a, e) => a + (e.status === "skipped" ? 0 : e.sets.filter((s) => !s.done).length), 0));
async function finish() {
  busy.value = true;
  try {
    finishRest(true);
    await api.post(`/workouts/${w.value.id}/finish`, { rating: rating.value, notes: notes.value, bodyweightKg: bw.value ? fmt.value.toKg(bw.value) : null, updateRoutine: updateRoutine.value });
    keepAwake(false);
    invalidate(["*"]);
    if (records.value) toast(`${records.value} new record${records.value > 1 ? "s" : ""}!`, { kind: "pr" });
    router.replace(`/workouts/${w.value.id}`);
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet title="Finish workout" @close="emit('close')">
    <div class="grid g3" style="margin-bottom:16px;gap:8px">
      <div class="card tight"><div class="lbl">Sets</div><div style="font-size:22px;font-weight:600">{{ done.length }}</div></div>
      <div class="card tight"><div class="lbl">Volume</div><div style="font-size:22px;font-weight:600">{{ fmt.vol(done.filter((s) => s.kind !== "warmup").reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0)) }}</div></div>
      <div class="card tight"><div class="lbl">Records</div><div style="font-size:22px;font-weight:600">{{ records }}</div></div>
    </div>
    <div v-if="unticked" class="banner note"><Icon name="info" />{{ unticked }} set{{ unticked > 1 ? "s were" : " was" }} not ticked. They will be left out.</div>
    <div class="fld"><label>How did it feel?</label><div class="seg block"><button v-for="n in 5" :key="n" :class="{ on: rating === n }" @click="rating = rating === n ? null : n">{{ ["Awful", "Meh", "OK", "Good", "Great"][n - 1] }}</button></div></div>
    <div class="fld"><label>Notes</label><textarea v-model="notes" rows="3" placeholder="Anything to remember about this workout" /></div>
    <div class="fld"><label>Body weight today ({{ fmt.wu }}, optional)</label><input v-model.number="bw" type="number" inputmode="decimal" step="0.1" /></div>
    <label v-if="changedFromPlan && W.prefs.value.updateRoutine !== 'never'" class="tgl"><div class="grow"><div class="t">Update the routine with today's sets</div><div class="s">Next time starts from these numbers and exercises</div></div><span class="tg"><input v-model="updateRoutine" type="checkbox" /></span></label>
    <template v-if="hitAll.length">
      <h2>Every target hit</h2>
      <div class="list"><div v-for="e in hitAll" :key="e.id" class="li"><div class="grow"><div class="t">{{ e.exercise.name }}</div></div>
        <button class="btn s" :class="reminded.includes(e.id) ? 'o' : 'tonal'" :disabled="reminded.includes(e.id)" @click="remind(e)"><Icon :name="reminded.includes(e.id) ? 'check' : 'bell'" :size="14" />{{ reminded.includes(e.id) ? "Reminder set" : `Add ${fmt.w(W.settings.value.increments.kg)} ${fmt.wu} next time` }}</button></div></div>
    </template>
    <template #foot><button class="btn o" @click="emit('close')">Keep going</button><button class="btn" :disabled="busy" @click="finish">Finish</button></template>
  </Sheet>
</template>
