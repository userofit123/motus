<script setup lang="ts">
// Heart rate during one activity or workout, from a band through Health Connect: average and highest as small tiles
// (laid out as Stats → Routines' cards, the value as a workout's Average rest), then the beats per minute over the
// session's time. Only the tiles when the band handed over an average and no readings. chart: the line alone, for a
// night's sheet (Stats → Sleep), whose numbers are already in its tiles above.
import { computed } from "vue";
import { useFmt } from "../core/format";
import LineChart from "./LineChart.vue";

const props = defineProps<{ avg?: number | null; max?: number | null; hr?: [number, number][] | null; chart?: boolean }>();
const fmt = useFmt();
// a band reads every few seconds: an hour is over a thousand points, so they're averaged down to at most 240 (the line
// looks the same and the tooltip stays quick)
const MAX_POINTS = 240;
const points = computed(() => {
  const hr = props.hr ?? [];
  const step = Math.max(1, Math.ceil(hr.length / MAX_POINTS));
  const out: { x: number; y: number; label: string }[] = [];
  for (let i = 0; i < hr.length; i += step) {
    const part = hr.slice(i, i + step), x = part[0]![0] * 1000;
    out.push({ x, y: Math.round(part.reduce((t, p) => t + p[1], 0) / part.length), label: fmt.value.time(new Date(x).toISOString()) });
  }
  return out;
});
const ys = computed(() => (props.hr ?? []).map((p) => p[1]));
const avgV = computed(() => props.avg ?? (ys.value.length ? Math.round(ys.value.reduce((t, v) => t + v, 0) / ys.value.length) : null));
const maxV = computed(() => props.max ?? (ys.value.length ? ys.value.reduce((m, v) => Math.max(m, v), 0) : null));
</script>

<template>
  <div v-if="chart ? points.length > 1 : avgV != null || points.length" class="card">
    <div class="lbl hgap">Heart rate{{ chart ? " (bpm)" : "" }}</div>
    <div v-if="!chart" class="grid g2 keep hr-tiles" :class="{ hgap: points.length > 1 }">
      <div v-if="avgV != null"><div class="lbl">Average (bpm)</div><div class="hr-v">{{ Math.round(avgV) }}</div></div>
      <div v-if="maxV != null"><div class="lbl">Highest (bpm)</div><div class="hr-v">{{ Math.round(maxV) }}</div></div>
    </div>
    <LineChart v-if="points.length > 1" :points="points" :height="140" :fmt="(v) => fmt.num(v, 0)" :xfmt="(t) => fmt.time(new Date(t).toISOString())" />
  </div>
</template>

<style scoped>
.hr-tiles { gap: 8px; }
.hr-v { font-weight: 600; font-size: 18px; }
</style>
