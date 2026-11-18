<script setup lang="ts">
// When each night began and ended: one bar per night from bedtime (top) to getting up (bottom), on the hours of the
// night, so an even schedule reads as a level row of bars. Where bedtimes and wake times usually fall (bed, wake: from 5
// nights on) lies behind them as two shaded bands with dashed edges, plain to see yet quieter than the bars. Styled as BarChart (gridlines, axis text with the month under its first
// day, bars, tip). It zooms sideways as BarChart does (useChartZoom.ts), the hours staying put in their own strip on the
// left. Hovering, clicking or tapping a night shows its tip; a clicked or tapped one is pinned with the chevron, and
// tapping it opens the night (pick).
import { computed, ref } from "vue";
import { useWidth } from "../useWidth";
import { useTip, TIP_ROOM } from "../useTip";
import { useChartZoom } from "../useChartZoom";
import Icon from "../Icon.vue";
import { useFmt } from "../../core/format";
import { nightMin, nightIso } from "../../core/sleep";

type Span = { lo: number; hi: number; n: number } | null;
const props = defineProps<{ nights: { date: string; startAt: string; endAt: string }[]; height?: number; bed?: Span; wake?: Span }>();
const emit = defineEmits<{ pick: [date: string] }>();
const fmt = useFmt();
const box = ref<HTMLElement | null>(null);
// every night opens, so the chart keeps TIP_ROOM at its top for a pinned tip (useTip): the tip stays inside the chart,
// over no bar (under a header the room slides up behind it, charts.css .cht); the chart is that much taller than its height, its bars as tall
const P = { l: 44, t: TIP_ROOM, b: 32 };
/** The top margin the chart had before it kept TIP_ROOM; the room takes its place, so the chart is that much taller */
const MARGIN_T = 8;
const W = useWidth(box), H = computed(() => (props.height ?? 170) + TIP_ROOM - MARGIN_T);
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
const hover = ref<number | null>(null);
// the bars' strip beside the hours: the card's width less theirs at 1x, until a night has about 80px
const base = computed(() => Math.max(1, W.value - P.l));
const { sc, cls, on, cw: CW, left, pinned, pick, unpin } = useChartZoom({ box, base, max: () => (80 * rows.value.length) / base.value,
  range: () => `${rows.value.length}|${rows.value[0]?.date}|${rows.value.at(-1)?.date}`, clear: () => (hover.value = null) });
const slot = computed(() => CW.value / Math.max(1, rows.value.length));
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
const begins = (i: number) => named(i) && !rows.value.some((r, j) => j < i && named(j) && r.date.slice(0, 7) === rows.value[i]!.date.slice(0, 7));
// left out when the next month's name comes too close for both to fit
const starts = (i: number) => {
  if (!begins(i)) return false;
  const next = rows.value.findIndex((_, j) => j > i && begins(j));
  return next < 0 || (next - i) * slot.value >= 34;
};
// as BarChart's: from its bar's left edge, or back from its right edge when it would run past the chart's
const gx = (i: number) => { const l = i * slot.value + (slot.value - bw.value) / 2; return l + 30 > CW.value ? { x: l + bw.value, a: "end" } : { x: l, a: "start" }; };
// the usual range of bedtimes and of wake times, once there are enough nights to call it usual
const bands = computed(() => [props.bed, props.wake].filter((t): t is NonNullable<Span> => !!t && t.n >= 5).map((t) => ({ y: y(t.lo), h: Math.max(2, y(t.hi) - y(t.lo)) })));
// as BarChart's: near either edge the tip slides inwards, so it isn't cut off
const { el: tipEl, style: tipStyle, span: tipSpan } = useTip(W);
// where the tip's foot sits: over its bar's bedtime end; pinned, the tip is clicked, so it rises above every bar under its
// whole width, never covering one, into the room kept at the chart's top
const tipTop = (i: number) => {
  let t = y(rows.value[i]!.a);
  if (!pinned.value) return t;
  const { lo, hi } = tipSpan(P.l + (i + 0.5) * slot.value - left.value, true);
  rows.value.forEach((r, j) => { const x0 = P.l + j * slot.value - left.value; if (x0 + slot.value > lo && x0 < hi) t = Math.min(t, y(r.a)); });
  return t;
};
// a pinned tip stays put while the mouse moves on (or a tap's compatibility mouse events come and go)
const enter = (i: number) => { if (!pinned.value) hover.value = i; };
const leave = () => { if (!pinned.value) hover.value = null; };
// a click or a tap pins the night's tip (useChartZoom), which then opens the night
const svgY = (e: MouseEvent, h: number) => { const svg = (e.currentTarget as Element).closest("svg")!, r = svg.getBoundingClientRect(); return ((e.clientY - r.top) / r.height) * h; };
// a click in the room kept for the tip, above the bars, is empty space: it puts a pinned tip away
const click = (e: MouseEvent, i: number) => {
  if (svgY(e, H.value) < P.t) { pick(null); return; }
  pick(i); hover.value = i;
};
const openGo = () => { const n = hover.value != null ? rows.value[hover.value] : null; if (!pinned.value || !n) return; unpin(); emit("pick", n.date); };
</script>

<template>
  <div ref="box" style="position:relative" :class="{ cht: rows.length }" :style="{ '--tipup': TIP_ROOM - MARGIN_T + 'px' }">
    <div v-if="rows.length" class="zrow">
      <!-- the hours, still while the nights scroll -->
      <svg class="chart zfix" :viewBox="`0 0 ${P.l} ${H}`" :style="{ width: P.l + 'px', height: H + 'px' }" aria-hidden="true">
        <text v-for="t in ticks" :key="t" class="ax" :x="P.l - 6" :y="y(t) + 3" text-anchor="end">{{ clock(t) }}</text>
      </svg>
      <div ref="sc" class="zsc" :class="cls">
        <svg class="chart" :viewBox="`0 0 ${CW} ${H}`" :style="{ height: H + 'px', ...(on ? { width: CW + 'px' } : {}) }" @mouseleave="leave">
          <g v-for="(b, i) in bands" :key="'b' + i" class="uband"><rect :x="0" :width="CW" :y="b.y" :height="b.h" /><line :x1="0" :x2="CW" :y1="b.y" :y2="b.y" /><line :x1="0" :x2="CW" :y1="b.y + b.h" :y2="b.y + b.h" /></g>
          <line v-for="t in ticks" :key="t" class="gl" :x1="0" :x2="CW" :y1="y(t)" :y2="y(t)" />
          <g v-for="(r, i) in rows" :key="r.date" @mouseenter="enter(i)" @click="click($event, i)">
            <rect :x="i * slot" :width="slot" :y="0" :height="H" fill="transparent" />
            <rect class="cbar" :x="i * slot + (slot - bw) / 2" :width="bw" :y="y(r.a)" :height="Math.max(2, y(r.b) - y(r.a))" :rx="Math.min(5, bw / 3)" />
            <text v-if="named(i)" class="ax" :x="i * slot + slot / 2" :y="H - P.b + 14" text-anchor="middle">{{ num(r.date) }}</text>
            <text v-if="starts(i)" class="ax grp" :x="gx(i).x" :y="H - 4" :text-anchor="gx(i).a">{{ month(r.date) }}</text>
          </g>
        </svg>
      </div>
    </div>
    <div v-if="hover != null && rows[hover]" class="ctip" :class="{ go: pinned }" ref="tipEl" :role="pinned ? 'button' : undefined" :tabindex="pinned ? 0 : undefined" :style="tipStyle(P.l + (hover + 0.5) * slot - left, tipTop(hover), pinned, pinned)" @pointerdown="pinned ? $event.preventDefault() : undefined" @click.stop.prevent="openGo" @keydown.enter.prevent="openGo" @keydown.space.prevent="openGo">
      <b>{{ fmt.time(rows[hover]!.startAt) }}-{{ fmt.time(rows[hover]!.endAt) }}</b><span class="sep">·</span><span class="ctip-r">{{ day(rows[hover]!.date) }}</span><Icon v-if="pinned" name="right" :size="13" class="ctip-go" />
    </div>
  </div>
</template>

<style scoped>
/* the month line as BarChart's group line */
.chart .grp { font-weight: 600; }
/* a usual range: a soft accent wash with dashed accent edges, so it reads in light and dark themes without matching the bars */
.uband rect { fill: color-mix(in srgb, var(--acc) 20%, transparent); }
.uband line { stroke: color-mix(in srgb, var(--acc) 60%, transparent); stroke-width: 1; stroke-dasharray: 3 3; }
</style>
