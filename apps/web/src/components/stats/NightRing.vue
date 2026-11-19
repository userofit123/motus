<script setup lang="ts">
// A night's ring, the same on Home's Last night and Stats → Sleep's night (M-264, M-272): how much of the time the band
// tracked was asleep. On Stats → Sleep its percent sits in the hole as the workout's ring holds its own (WorkoutSoFar
// .wsf-ring). The percent turns the accent from 85%, the National Sleep Foundation's mark, as Today at a glance's
// icons do once reached (the ring's own check would sit on the number). A night the band didn't split into asleep and
// awake would read 100% whatever it was, so its ring stays empty (with "-" in the hole on Stats → Sleep).
import { computed } from "vue";
import Ring from "../Ring.vue";
import type { SleepNight } from "../../api/queries";
import { asleepPct, awakeKnown, efficiency, nightRingLine } from "../../core/sleep";
import { GOOD_EFFICIENCY } from "@motus/shared";

const props = defineProps<{ night: SleepNight; size: number; stroke?: number }>();
const known = computed(() => awakeKnown(props.night));
const pct = computed(() => (known.value ? efficiency(props.night) : 0));
const whole = computed(() => asleepPct(props.night));
// Home's ring is the size of its other blocks' (40px, a 30px hole), and none of those hold a number: "100%" doesn't fit
// there with room to spare even at the smallest text size, and a bare "92" read as a score next to the Sleep score block.
// So at that size the hole stays empty and the line under the ring gives the percent (M-264)
const roomy = computed(() => props.size >= 56);
</script>

<template>
  <span class="nring" role="img" :aria-label="nightRingLine(night)">
    <Ring aria-hidden="true" :pct="pct" :size="size" :stroke="stroke" />
    <!-- one inline span inside the grid cell: the grid made the number and the "%" two items, one above the other -->
    <span v-if="roomy" aria-hidden="true" :class="{ done: known && pct >= GOOD_EFFICIENCY, none: !known }"><span v-if="known">{{ whole }}<small>%</small></span><span v-else>-</span></span>
  </span>
</template>

<style scoped>
.nring { position: relative; flex: none; display: grid; }
.nring > span { position: absolute; inset: 0; display: grid; place-items: center; font-size: var(--fs-sm); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1; }
.nring small { font-size: 1em; }
.nring .done { color: var(--acc); }
.nring .none { color: var(--tx2); }
</style>
