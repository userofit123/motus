<script setup lang="ts">
// Heart rate during one activity or workout, from a band through Health Connect: average and highest as small tiles
// (laid out as Stats → Routines' cards, the value as a workout's Average rest), then the beats per minute over the
// session's time. Only the tiles when the band handed over an average and no readings. chart: the line alone, for a
// night's sheet (Stats → Sleep), whose numbers are already in its tiles above. sessions: a routine's (its page's History
// tab) average per session over the days instead of one session's readings; a point opens that workout (pick).
import { computed } from "vue";
import { useFmt } from "../core/format";
import LineChart from "./LineChart.vue";
import { hrPoints } from "../native/health";

const props = defineProps<{ avg?: number | null; max?: number | null; hr?: [number, number][] | null; chart?: boolean; height?: number; sessions?: { x: number; y: number; id: string }[] }>();
const emit = defineEmits<{ pick: [id: string] }>();
const fmt = useFmt();
const points = computed(() => props.sessions ?? hrPoints(props.hr, (x) => fmt.value.time(new Date(x).toISOString())));
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
    <div v-if="sessions && points.length > 1" class="lbl hgap">Average per session (bpm)</div>
    <LineChart v-if="points.length > 1" :points="points" :height="height ?? 140" :fmt="(v) => fmt.num(v, 0)" :xfmt="sessions ? undefined : (t) => fmt.time(new Date(t).toISOString())" @pick="(id) => emit('pick', id)" />
  </div>
</template>

<style scoped>
.hr-tiles { gap: 8px; }
.hr-v { font-weight: 600; font-size: 18px; }
</style>
