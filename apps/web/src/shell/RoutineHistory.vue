<script setup lang="ts">
// A routine's History (PLAN.md §8.7), opened from its ⋮ menu on the list or on its own page: every version, newest
// first, each saying why it was made ("After workout · Push Day · 8 Nov", "Edited · 8 Nov"), with each exercise's
// weight over time in this routine above. Tapping a version shows the routine as it was then, read-only, with
// "Restore this version".
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { Routine } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { confirm } from "../core/ask";
import { toast, toastError } from "../core/toast";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import MuscleFig from "../components/MuscleFig.vue";
import LineChart from "../components/LineChart.vue";
import AppSelect from "../components/AppSelect.vue";

interface Version { id: string; createdAt: string; reason: "edit" | "workout"; workoutId: string | null; workoutName: string | null; name: string; exercises: number; top: { exerciseId: string; name: string; kg: number | null }[] }
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const versions = useQuery({ queryKey: ["routines", "versions", props.id], queryFn: () => api.get<Version[]>(`/routines/${props.id}/versions`) });
const list = computed(() => versions.data.value ?? []);
const day = (t: string) => fmt.value.date(t, { day: "numeric", month: "short", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const title = (v: Version) => (v.reason === "workout" ? `After workout · ${v.workoutName ?? v.name} · ${day(v.createdAt)}` : `Edited · ${day(v.createdAt)}`);

// the weight trend: one exercise at a time, the ones the routine has now first
const trendOpts = computed(() => {
  const seen = new Map<string, string>();
  for (const v of list.value) for (const t of v.top) if (t.kg != null && !seen.has(t.exerciseId)) seen.set(t.exerciseId, t.name);
  return [...seen].map(([value, label]) => ({ value, label }));
});
const pick = ref<string | null>(null);
const trendEx = computed(() => (trendOpts.value.some((o) => o.value === pick.value) ? pick.value : trendOpts.value[0]?.value ?? null));
const trend = computed(() => [...list.value].reverse().flatMap((v) => {
  const kg = v.top.find((t) => t.exerciseId === trendEx.value)?.kg;
  return kg == null ? [] : [{ x: new Date(v.createdAt).getTime(), y: fmt.value.fromKg(kg), id: v.id }];
}));

// one version, as it was
const open = ref<Version | null>(null);
const snap = useQuery({ queryKey: computed(() => ["routines", "versions", props.id, open.value?.id ?? ""]), enabled: computed(() => !!open.value),
  queryFn: () => api.get<Routine>(`/routines/${props.id}/versions/${open.value!.id}`) });
const setLine = (e: Routine["exercises"][number]) => {
  const w = e.sets.filter((s) => s.kind !== "warmup");
  const reps = w.map((s) => (s.repsMax ? `${s.reps}-${s.repsMax}` : s.durationS ? fmt.value.clock(s.durationS) : s.reps ?? "-"));
  const same = reps.every((x) => x === reps[0]);
  return `${w.length} × ${same ? reps[0] ?? "-" : reps.join(", ")}${w[0]?.weightKg ? " @ " + fmt.value.wu_(w[0].weightKg) : ""}`;
};
const isCurrent = computed(() => open.value?.id === list.value[0]?.id);
async function restore() {
  if (!open.value || !(await confirm("Restore this version?", { text: "The routine gets this version's exercises and numbers. History keeps the one it has now too.", ok: "Restore" }))) return;
  try { await api.post(`/routines/${props.id}/versions/${open.value.id}/restore`); invalidate(["routines"]); emit("close"); toast("Version restored"); } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet :title="open ? title(open) : 'History'" @close="emit('close')">
    <template v-if="!open">
      <div v-if="trend.length > 1" class="card spb">
        <div class="row hgap"><span class="lbl grow">Weight ({{ fmt.wu }})</span>
          <AppSelect v-if="trendOpts.length > 1" :model-value="trendEx" :options="trendOpts" title="Exercise" style="width:auto" @update:model-value="(v) => (pick = v)" /></div>
        <LineChart :points="trend" :height="150" :fmt="(v) => fmt.num(v, 1)" @pick="(vid) => (open = list.find((v) => v.id === vid) ?? null)" />
      </div>
      <div v-if="!list.length" class="empty"><b>No history yet</b>Each time a workout or an edit changes this routine, the routine as it was is kept here.</div>
      <div v-else class="card"><div class="list">
        <button v-for="(v, i) in list" :key="v.id" type="button" class="li click rh-row" @click="open = v">
          <Icon :name="v.reason === 'workout' ? 'dumbbell' : 'edit'" :size="18" class="rh-i" />
          <div class="grow" style="min-width:0"><div class="t ellipsis">{{ title(v) }}</div><div class="s">{{ fmt.time(v.createdAt) }}<span class="sep">·</span>{{ v.exercises }} exercise{{ v.exercises === 1 ? "" : "s" }}</div></div>
          <span v-if="i === 0" class="mchip">Current</span>
          <Icon name="right" class="muted" />
        </button>
      </div></div>
    </template>
    <template v-else>
      <button class="back" @click="open = null"><Icon name="left" :size="16" /><span>History</span></button>
      <div v-if="snap.data.value" class="card"><div class="list">
        <div v-for="e in snap.data.value.exercises" :key="e.id ?? e.exerciseId" class="li">
          <MuscleFig sm :muscles="e.exercise?.primaryMuscles" :helpers="e.exercise?.secondaryMuscles" />
          <div class="grow" style="min-width:0"><div class="t ellipsis">{{ e.exercise?.name }}</div><div class="s">{{ setLine(e) }}</div></div>
        </div>
        <div v-if="!snap.data.value.exercises.length" class="empty"><b>No exercises</b></div>
      </div></div>
    </template>
    <template v-if="open && !isCurrent" #foot><button class="btn o" @click="open = null">Back</button><button class="btn" @click="restore">Restore this version</button></template>
  </Sheet>
</template>

<style scoped>
.rh-row { width: 100%; border: 0; background: none; color: inherit; text-align: start; font: inherit; }
.rh-i { flex: none; color: var(--tx2); }
</style>
