<script setup lang="ts">
// A night's ring, the same on Home's Last night and Stats → Sleep's night (M-264, M-272): how much of the time the band
// tracked was asleep, its percent in the hole as the workout's ring holds its own (WorkoutSoFar .wsf-ring). The percent
// turns the accent from 85%, the National Sleep Foundation's mark, as Today at a glance's icons do once reached (the
// ring's own check would sit on the number). A night the band didn't split into asleep and awake would read 100%
// whatever it was, so its ring stays empty with "-" in the hole.
import { computed } from "vue";
import Ring from "../Ring.vue";
import type { SleepNight } from "../../api/queries";
import { asleepPct, awakeKnown, efficiency, nightRingLine } from "../../core/sleep";
import { GOOD_EFFICIENCY } from "@motus/shared";

const props = defineProps<{ night: SleepNight; size: number; stroke?: number }>();
const known = computed(() => awakeKnown(props.night));
const pct = computed(() => (known.value ? efficiency(props.night) : 0));
const whole = computed(() => asleepPct(props.night));
// Home's 40px ring has a smaller hole than Stats → Sleep's 64px one: a smaller number and "%" keep clear of the stroke
const small = computed(() => props.size < 56);
</script>

<template>
  <span class="nring" :class="{ sm: small }" role="img" :aria-label="nightRingLine(night)">
    <Ring aria-hidden="true" :pct="pct" :size="size" :stroke="stroke" />
    <span aria-hidden="true" :class="{ done: known && pct >= GOOD_EFFICIENCY, none: !known }"><template v-if="known">{{ whole }}<small>%</small></template><template v-else>-</template></span>
  </span>
</template>

<style scoped>
.nring { position: relative; flex: none; display: grid; }
.nring > span { position: absolute; inset: 0; display: grid; place-items: center; font-size: var(--fs-sm); font-weight: 700; font-variant-numeric: tabular-nums; }
.nring small { font-size: 1em; }
.nring.sm > span { font-size: var(--fs-xs); }
.nring.sm small { font-size: 0.75em; }
.nring .done { color: var(--acc); }
.nring .none { color: var(--tx2); }
</style>
