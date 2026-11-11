<script setup lang="ts">
// The right-hand column of a finished workout or activity in History (calendar day and list share it):
// duration on top, then what the session holds. Zero sets, volume, distance and steps are left out.
import { computed } from "vue";
import { useFmt } from "../core/format";

// What a History or Home entry carries: workouts have sets (or setCount) and volume, activities distance and steps.
interface Stats { kind: string; durationS: number; sets?: number; setCount?: number; volumeKg?: number; distanceM?: number | null; steps?: number | null }
const props = defineProps<{ x: Stats }>();
const fmt = useFmt();
const sets = computed(() => props.x.sets ?? props.x.setCount ?? 0);
const line = computed(() => {
  const x = props.x;
  const parts = x.kind === "workout"
    ? [sets.value > 0 ? `${sets.value} ${sets.value === 1 ? "set" : "sets"}` : "", (x.volumeKg ?? 0) > 0 ? fmt.value.vol(x.volumeKg!) : ""]
    : [(x.distanceM ?? 0) > 0 ? fmt.value.dist(x.distanceM!, 1) : "", (x.steps ?? 0) > 0 ? `${fmt.value.num(x.steps!, 0)} steps` : ""];
  return parts.filter(Boolean).join(" · ");
});
</script>

<template>
  <div class="r tiny sstats"><div>{{ fmt.dur(x.durationS, true) }}</div><div v-if="line" class="sline">{{ line }}</div></div>
</template>

<style scoped>
/* the column gives way before the title does (the title keeps its 42%); the stats line cuts with an ellipsis rather than wrap next to a dot */
.sstats.r { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; }
.sline { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
