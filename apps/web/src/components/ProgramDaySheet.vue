<script setup lang="ts">
// One day of a program set by hand (M-290): which of its routine's workouts counts for it, or that it was skipped, or
// back to counting automatically (the first workout of its routine that no earlier week uses).
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { ProgramDetail, WorkoutSummary } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, localYmd } from "../core/format";
import { toast, toastError } from "../core/toast";
import Sheet from "./Sheet.vue";
import RadioList from "./RadioList.vue";

type Day = ProgramDetail["plan"][number]["days"][number];
// used: which week each workout already counts for, so the list can say a choice takes it from there
const props = defineProps<{ programId: string; day: Day; used: Map<string, number> }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const d = props.day;
// "today" opens a radio label, so it starts with a capital as the other dates do
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const q = useQuery({ queryKey: ["workouts", "routine", d.routineId], queryFn: () => api.get<WorkoutSummary[]>("/workouts", { routineId: d.routineId, limit: 30 }) });
const pick = ref<string>(!d.byHand ? "auto" : d.status === "skipped" ? "skip" : d.workout!.id);
const options = computed(() => [
  { value: "auto", label: "Count automatically", hint: `The first ${d.name} workout not already counted for an earlier week` },
  ...(q.data.value ?? []).map((w) => {
    const wk = props.used.get(w.id);
    return { value: w.id, label: cap(fmt.value.day(localYmd(new Date(w.startedAt)))),
      hint: [fmt.value.dur(w.durationS ?? 0, true), fmt.value.vol(w.volumeKg), ...(wk && wk !== d.week ? [`counts for week ${wk} now`] : [])].join(" · ") };
  }),
  { value: "skip", label: "Skipped", hint: `Not done. Your next ${d.name} workout counts for a later week.` },
]);
async function save() {
  const was = !d.byHand ? "auto" : d.status === "skipped" ? "skip" : d.workout!.id;
  if (pick.value === was) return emit("close");
  const body = pick.value === "auto" ? { auto: true } : { workoutId: pick.value === "skip" ? null : pick.value };
  try {
    await api.put(`/programs/${props.programId}/days`, { week: d.week, day: d.day, ...body });
    invalidate(["routines", "home"]);
    toast(pick.value === "auto" ? "Counts automatically again" : pick.value === "skip" ? `Week ${d.week} · ${d.name} skipped` : `Workout set for week ${d.week} · ${d.name}`);
    emit("close");
  } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet title="Choose the workout" @close="emit('close')">
    <p class="tiny hgap">{{ q.data.value && !q.data.value.length ? `No finished ${d.name} workouts yet, so week ${d.week}, workout ${d.day} can count automatically or be marked skipped.`
      : `Choose the ${d.name} workout that counts for week ${d.week}, workout ${d.day}, or mark it skipped.` }}</p>
    <div class="fld"><label>Workout</label><RadioList v-model="pick" :options="options" /></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" @click="save">Save</button></template>
  </Sheet>
</template>
