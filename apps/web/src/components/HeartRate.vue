<script setup lang="ts">
// Heart rate during one activity or workout, from a band through Health Connect: average and highest as small tiles
// (laid out as Stats → Routines' cards, the value as a workout's Average rest), then the beats per minute over the
// session's time. Only the tiles when the band handed over an average and no readings. chart: the line alone, for a
// day card (Stats → Heart), whose numbers are already in its tiles above. sessions: a routine's (its page's History
// tab) average per session over the days instead of one session's readings; a point's pinned tip opens that workout (pick).
// day: a whole day's readings (Stats → Heart), drawn midnight to midnight with the hours under it, left open where the
// band read nothing, the day's workouts and activities shaded behind it in their colours (spans) and the hours given in
// ticks; a reading in one names it in its tip (LineChart), which opens the session (pick). color: the line's own colour.
// inline: inside a card of its own (no card around it). title: the header in place of "Heart rate", for a section that
// names what the chart covers (a day card's "Heart rate by hour"), so the section has one header, right over its chart.
import { computed } from "vue";
import { useFmt } from "../core/format";
import LineChart from "./LineChart.vue";
import { hrPoints } from "../native/health";

const props = defineProps<{ avg?: number | null; max?: number | null; hr?: [number, number][] | null; chart?: boolean; height?: number; sessions?: { x: number; y: number; id: string }[];
  day?: { from: number; to: number; spans: { a: number; b: number; id: string; name: string; color: string }[]; ticks: number[]; color: string }; inline?: boolean; title?: string }>();
const emit = defineEmits<{ pick: [id: string] }>();
const fmt = useFmt();
const t = (x: number) => fmt.value.time(new Date(x).toISOString());
// a day as one point per 5 minutes it has readings in (their average), so a minute-by-minute band still draws a calm
// line, and a workout's second-by-second readings stay one stretch of it instead of eating the day's points
const BUCKET_S = 300;
const buckets = (hr: [number, number][] | null | undefined): [number, number][] => {
  const m = new Map<number, [number, number]>();
  for (const [ts, v] of hr ?? []) { const k = Math.floor(ts / BUCKET_S) * BUCKET_S, b = m.get(k); if (b) { b[0] += v; b[1]++; } else m.set(k, [v, 1]); }
  return [...m].sort((a, b) => a[0] - b[0]).map(([k, [sum, n]]) => [k, sum / n]);
};
const points = computed(() => props.sessions ?? (!props.day ? hrPoints(props.hr, t) : hrPoints(buckets(props.hr), t, Infinity)));
const ys = computed(() => (props.hr ?? []).map((p) => p[1]));
const avgV = computed(() => props.avg ?? (ys.value.length ? Math.round(ys.value.reduce((t, v) => t + v, 0) / ys.value.length) : null));
const maxV = computed(() => props.max ?? (ys.value.length ? ys.value.reduce((m, v) => Math.max(m, v), 0) : null));
</script>

<template>
  <div v-if="chart ? points.length > 1 : avgV != null || points.length" :class="{ card: !inline }">
    <div class="lbl hgap">{{ title ?? "Heart rate" }}{{ chart ? " (bpm)" : "" }}</div>
    <div v-if="!chart" class="grid g2 keep hr-tiles" :class="{ hgap: points.length > 1 }">
      <div v-if="avgV != null"><div class="lbl">Average (bpm)</div><div class="hr-v">{{ Math.round(avgV) }}</div></div>
      <div v-if="maxV != null"><div class="lbl">Highest (bpm)</div><div class="hr-v">{{ Math.round(maxV) }}</div></div>
    </div>
    <div v-if="sessions && points.length > 1" class="lbl hgap">Average per session (bpm)</div>
    <LineChart v-if="points.length > 1" :points="points" :height="height ?? 140" :fmt="(v) => fmt.num(v, 0)" :xfmt="sessions ? undefined : (x) => fmt.time(new Date(x).toISOString())"
      :domain="day ? [day.from, day.to] : undefined" :xt="day?.ticks" :gap="day ? 15 * 60000 : undefined" :shade="day?.spans" :color="day?.color" @pick="(id) => emit('pick', id)" />
  </div>
</template>

<style scoped>
.hr-tiles { gap: 8px; }
.hr-v { font-weight: 600; font-size: 18px; }
</style>
