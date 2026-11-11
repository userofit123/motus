<script setup lang="ts">
// The right-hand column of a finished workout or activity in History (calendar day and list share it):
// duration on top, then what the session holds. Zero sets, volume, distance and steps are left out.
import { computed } from "vue";
import { useFmt } from "../core/format";

const props = defineProps<{ x: any }>();
const fmt = useFmt();
const line = computed(() => {
  const x = props.x;
  const parts = x.kind === "workout"
    ? [(x.sets ?? x.setCount) > 0 ? `${x.sets ?? x.setCount} ${(x.sets ?? x.setCount) === 1 ? "set" : "sets"}` : "", x.volumeKg > 0 ? fmt.value.vol(x.volumeKg) : ""]
    : [x.distanceM > 0 ? fmt.value.dist(x.distanceM, 1) : "", x.steps > 0 ? `${fmt.value.num(x.steps, 0)} steps` : ""];
  return parts.filter(Boolean).join(" · ");
});
</script>

<template>
  <div class="r tiny sstats"><div>{{ fmt.dur(x.durationS, true) }}</div><div v-if="line" class="sline">{{ line }}</div></div>
</template>

<style scoped>
/* a wrap next to a dot would leave it dangling at a line end */
.sline { white-space: nowrap; }
</style>
