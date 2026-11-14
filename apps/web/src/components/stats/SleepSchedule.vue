<script setup lang="ts">
// When each night began and ended: one bar per night from bedtime (top) to getting up (bottom), on the hours of the
// night, so an even schedule reads as a level row of bars. Where most bedtimes and wake times fall (bed, wake: from 5
// nights on) lies behind them as two faint bands. Styled as BarChart (gridlines, axis text with the month under its first
// day, bars, tip); a night can be clicked (pick) to open it.
import { computed, ref } from "vue";
import { useWidth } from "../useWidth";
import { useFmt } from "../../core/format";
import { nightMin, nightIso } from "../../core/sleep";

type Span = { lo: number; hi: number; n: number } | null;
const props = defineProps<{ nights: { date: string; startAt: string; endAt: string }[]; height?: number; bed?: Span; wake?: Span }>();
const emit = defineEmits<{ pick: [date: string] }>();
const fmt = useFmt();
const box = ref<HTMLElement | null>(null);
const W = useWidth(box), H = computed(() => props.height ?? 170);
const P = { l: 44, t: 8, b: 32 };
// oldest on the left
const rows = computed(() => [...props.nights].sort((a, b) => a.date.localeCompare(b.date)).map((n) => {
  const a = nightMin(n.startAt);
  let b = nightMin(n.endAt);
  if (b < a) b += 1440; // got up after noon
  return { ...n, a, b };
}));
// whole hours around the earliest bedtime and the latest getting up, half an hour clear of both, so the usual-range
// bands sit inside the chart rather than reading as its edge
const dom = computed(() => {
  const r = rows.value;
  const lo = Math.floor((Math.min(...r.map((x) => x.a)) - 30) / 60) * 60, hi = Math.ceil((Math.max(...r.map((x) => x.b)) + 30) / 60) * 60;
  return { lo, hi: Math.max(hi, lo + 120) };
});
const slot = computed(() => (W.value - P.l) / Math.max(1, rows.value.length));
const bw = computed(() => Math.max(3, Math.min(14, slot.value * 0.6)));
const y = (m: number) => P.t + ((m - dom.value.lo) / (dom.value.hi - dom.value.lo)) * (H.value - P.t - P.b);
// a gridline every 2 hours (every 4 over a long span), labelled with the time of day
const ticks = computed(() => {
  const { lo, hi } = dom.value, step = hi - lo > 12 * 60 ? 240 : 120;
  const out: number[] = [];
  for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) out.push(m);
  return out;
});
const clock = (m: number) => fmt.value.time(nightIso(m));
const day = (d: string) => fmt.value.date(d, { weekday: "short", day: "numeric", month: "short" });
const num = (d: string) => fmt.value.date(d, { day: "numeric" });
const month = (d: string) => fmt.value.date(d, { month: "short" });
// as BarChart: a day's number every few nights, counted back from the newest so it always has one, and the month's name
// under the first named day of each month
const every = computed(() => Math.max(1, Math.ceil(34 / slot.value)));
const named = (i: number) => i % every.value === (rows.value.length - 1) % every.value;
const begins = (i: number) => named(i) && !rows.value.some((r, j) => j < i && named(j) && month(r.date) === month(rows.value[i]!.date));
// left out when the next month's name comes too close for both to fit
const starts = (i: number) => {
  if (!begins(i)) return false;
  const next = rows.value.findIndex((_, j) => j > i && begins(j));
  return next < 0 || (next - i) * slot.value >= 34;
};
// as BarChart's: from its bar's left edge, or back from its right edge when it would run past the chart's
const gx = (i: number) => { const l = P.l + i * slot.value + (slot.value - bw.value) / 2; return l + 30 > W.value ? { x: l + bw.value, a: "end" } : { x: l, a: "start" }; };
// the usual range of bedtimes and of wake times, once there are enough nights to call it usual
const bands = computed(() => [props.bed, props.wake].filter((t): t is NonNullable<Span> => !!t && t.n >= 5).map((t) => ({ y: y(t.lo), h: Math.max(2, y(t.hi) - y(t.lo)) })));
const hover = ref<number | null>(null);
// as BarChart's: near either edge the tip hangs inwards, so it isn't cut off
const tipShift = (at: number) => `translate(${at < 0.25 ? "-12px" : at > 0.75 ? "calc(-100% + 12px)" : "-50%"}, calc(-100% - 10px))`;
</script>

<template>
  <div ref="box" style="position:relative">
    <svg v-if="rows.length" class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }" @mouseleave="hover = null">
      <rect v-for="(b, i) in bands" :key="'b' + i" :x="P.l" :width="W - P.l" :y="b.y" :height="b.h" fill="var(--acc)" opacity=".16" />
      <g v-for="t in ticks" :key="t"><line class="gl" :x1="P.l" :x2="W" :y1="y(t)" :y2="y(t)" /><text class="ax" :x="P.l - 6" :y="y(t) + 3" text-anchor="end">{{ clock(t) }}</text></g>
      <g v-for="(r, i) in rows" :key="r.date" style="cursor:pointer" @mouseenter="hover = i" @click="emit('pick', r.date)">
        <rect :x="P.l + i * slot" :width="slot" :y="0" :height="H" fill="transparent" />
        <rect class="cbar" :x="P.l + i * slot + (slot - bw) / 2" :width="bw" :y="y(r.a)" :height="Math.max(2, y(r.b) - y(r.a))" :rx="Math.min(5, bw / 3)" />
        <text v-if="named(i)" class="ax" :x="P.l + i * slot + slot / 2" :y="H - P.b + 14" text-anchor="middle">{{ num(r.date) }}</text>
        <text v-if="starts(i)" class="ax grp" :x="gx(i).x" :y="H - 4" :text-anchor="gx(i).a">{{ month(r.date) }}</text>
      </g>
    </svg>
    <div v-if="hover != null && rows[hover]" class="ctip" :style="{ left: ((P.l + (hover + 0.5) * slot) / W) * 100 + '%', top: y(rows[hover]!.a) + 'px', transform: tipShift((P.l + (hover + 0.5) * slot) / W) }">
      <b>{{ fmt.time(rows[hover]!.startAt) }}-{{ fmt.time(rows[hover]!.endAt) }}</b> · {{ day(rows[hover]!.date) }}
    </div>
  </div>
</template>

<style scoped>
/* the month line as BarChart's group line */
.chart .grp { font-weight: 600; }
</style>
