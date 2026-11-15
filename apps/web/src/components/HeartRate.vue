<script setup lang="ts">
// Heart rate during one activity or workout, from a band through Health Connect: average and highest as small tiles
// (laid out as Stats → Routines' cards, the value as a workout's Average rest), then the beats per minute over the
// session's time. Only the tiles when the band handed over an average and no readings. chart: the line alone, for a
// night's sheet (Stats → Sleep), whose numbers are already in its tiles above. sessions: a routine's (its page's History
// tab) average per session over the days instead of one session's readings; a point opens that workout (pick).
// day: a whole day's readings (Stats → Heart), drawn midnight to midnight with the hours under it, left open where the
// band read nothing, the day's workouts and activities shaded behind it; a reading in one names it and opens it (pick).
// inline: inside a card of its own (no card around it).
import { computed } from "vue";
import { useFmt } from "../core/format";
import LineChart from "./LineChart.vue";
import { hrPoints } from "../native/health";

const props = defineProps<{ avg?: number | null; max?: number | null; hr?: [number, number][] | null; chart?: boolean; height?: number; sessions?: { x: number; y: number; id: string }[];
  day?: { from: number; to: number; spans: { a: number; b: number; id: string; name: string }[] }; inline?: boolean }>();
const emit = defineEmits<{ pick: [id: string] }>();
const fmt = useFmt();
const t = (x: number) => fmt.value.time(new Date(x).toISOString());
// a day at most one point per 5 minutes (288), so a minute-by-minute band still draws a calm line
const points = computed(() => props.sessions ?? (!props.day ? hrPoints(props.hr, t) : hrPoints(props.hr, t, 288).map((p) => {
  const s = props.day!.spans.find((z) => p.x >= z.a && p.x < z.b);
  return s ? { ...p, label: `${p.label} · ${s.name}`, id: s.id } : p;
})));
// every 6 hours: midnight, 6:00, noon, 18:00, midnight
const dayTicks = computed(() => props.day ? [0, 6, 12, 18, 24].map((h) => { const d = new Date(props.day!.from); d.setHours(h, 0, 0, 0); return h === 24 ? props.day!.to : d.getTime(); }) : undefined);
const ys = computed(() => (props.hr ?? []).map((p) => p[1]));
const avgV = computed(() => props.avg ?? (ys.value.length ? Math.round(ys.value.reduce((t, v) => t + v, 0) / ys.value.length) : null));
const maxV = computed(() => props.max ?? (ys.value.length ? ys.value.reduce((m, v) => Math.max(m, v), 0) : null));
</script>

<template>
  <div v-if="chart ? points.length > 1 : avgV != null || points.length" :class="{ card: !inline }">
    <div class="lbl hgap">Heart rate{{ chart ? " (bpm)" : "" }}</div>
    <div v-if="!chart" class="grid g2 keep hr-tiles" :class="{ hgap: points.length > 1 }">
      <div v-if="avgV != null"><div class="lbl">Average (bpm)</div><div class="hr-v">{{ Math.round(avgV) }}</div></div>
      <div v-if="maxV != null"><div class="lbl">Highest (bpm)</div><div class="hr-v">{{ Math.round(maxV) }}</div></div>
    </div>
    <div v-if="sessions && points.length > 1" class="lbl hgap">Average per session (bpm)</div>
    <LineChart v-if="points.length > 1" :points="points" :height="height ?? 140" :fmt="(v) => fmt.num(v, 0)" :xfmt="sessions ? undefined : (x) => fmt.time(new Date(x).toISOString())"
      :domain="day ? [day.from, day.to] : undefined" :xt="dayTicks" :gap="day ? 15 * 60000 : undefined" :shade="day?.spans" @pick="(id) => emit('pick', id)" />
  </div>
</template>

<style scoped>
.hr-tiles { gap: 8px; }
.hr-v { font-weight: 600; font-size: 18px; }
</style>
