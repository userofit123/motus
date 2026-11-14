<script setup lang="ts">
// The right-hand column of a finished workout or activity in History (calendar day and list share it):
// duration on top, then what the session holds. Zero sets, volume, distance and steps are left out.
import { computed } from "vue";
import { useFmt } from "../core/format";
import DotLine from "./DotLine.vue";

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
  return parts.filter(Boolean);
});
</script>

<template>
  <div class="r tiny sstats"><div>{{ fmt.dur(x.durationS, true) }}</div><DotLine v-if="line.length" :parts="line" end /></div>
</template>

<style scoped>
/* the column takes what the title leaves over (the title keeps its 42%, .li > .grow); on a narrow phone the stats line
   wraps between whole parts with no dot at either end of a line (DotLine) rather than being cut */
.sstats.r { flex: 0 1 auto; min-width: 0; }
</style>
