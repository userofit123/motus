<script setup lang="ts">
// A night's numbers as a report's tiles (icon and label, value with its unit set small, a line under it): time asleep
// (unless the sheet shows it above), the heart rate, blood oxygen and breathing while asleep, each only when read.
// Stats → Sleep's last-night card and a night's sheet share it, so the same numbers look the same in both.
import { computed } from "vue";
import type { SleepNight } from "../../api/queries";
import { useFmt } from "../../core/format";
import { asleepMin, inBedMin, mins } from "../../core/sleep";
import Icon from "../Icon.vue";

const props = defineProps<{ night: SleepNight; noAsleep?: boolean }>();
const fmt = useFmt();
// a percent to a tenth only when the band gave one
const p = (v: number) => fmt.value.num(v, Number.isInteger(v) ? 0 : 1);
const n = computed(() => props.night);
const count = computed(() => (props.noAsleep ? 0 : 1) + [n.value.avgHr, n.value.avgSpo2, n.value.respRate].filter((v) => v != null).length);
</script>

<template>
  <div v-if="count" class="wstats" :class="{ n4: count === 4 }">
    <div v-if="!noAsleep" class="ws"><div class="wlb"><Icon name="moon" :size="14" />Asleep</div><div class="wv">{{ mins(asleepMin(n)) }}</div><div class="wd">of {{ mins(inBedMin(n)) }} in bed</div></div>
    <div v-if="n.avgHr != null" class="ws"><div class="wlb"><Icon name="heart" :size="14" />Heart rate</div><div class="wv">{{ n.avgHr }}<small>bpm</small></div><div class="wd">{{ n.minHr != null ? `lowest ${n.minHr} bpm` : "average" }}</div></div>
    <div v-if="n.avgSpo2 != null" class="ws"><div class="wlb"><Icon name="water" :size="14" />Blood oxygen</div><div class="wv">{{ p(n.avgSpo2) }}<small>%</small></div><div class="wd">{{ n.minSpo2 != null ? `lowest ${p(n.minSpo2)}%` : "average" }}</div></div>
    <div v-if="n.respRate != null" class="ws"><div class="wlb"><Icon name="activity" :size="14" />Breathing</div><div class="wv">{{ fmt.num(n.respRate, 0) }}<small>/min</small></div><div class="wd">average</div></div>
  </div>
</template>
