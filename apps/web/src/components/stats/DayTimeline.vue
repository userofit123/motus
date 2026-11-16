<script setup lang="ts">
// One day at a glance (the Calendar's day card): the day from midnight to midnight as one chart, a lane for each part
// the band saved (only those), named on the left as the Sleep night's lanes are: the night's stretches in their stage
// colours, the steps as a small bar an hour and the heart rate as the charts' line, both in the day charts' own colour; the
// day's workouts and activities shaded across every lane in their Calendar colours with the strip along the top, as on
// the Stats day charts, and the same hour labels under it. The tip says what the band saved at that hour and names the
// session it falls in; like every chart it opens nothing (the day card's tiles and session list lead on). It shows only
// what Stats' days show in full, so it stays small. The night is a small hypnogram, a row per stage named on the left as
// Stats → Sleep's (M-253): its stretches are minutes long, a few pixels at a day's scale, so in one row they ran together
// into a barcode; in their own rows each stage reads as where in the night it fell. The rows sit under the lane's name
// "Sleep", which is set apart from the stage names as Steps' and Heart rate's are, so the night reads as one part.
// The sessions' spans are hatched here, not plainly tinted as on the Stats charts: an activity's teal is REM's and a
// routine's colour can be any stage's, so a plain tint across the rows would seem to be one more stretch of that stage.
// Stripes over every lane can't be read as a stage, and the legend's swatches are striped the same way.
// The names sit in their own strip on the left and the hours beside them in a strip that scrolls, so the chart can be
// zoomed in (useChartZoom.ts: pinched, ctrl+wheeled or with Day by hour's buttons, up to HOUR_PX an hour, a minute 3px
// wide, as a day's minutes-long stretches need) and scrolled while the names stay in place. Hovering, clicking or
// tapping shows the hour's tip.
import { computed, ref, useId } from "vue";
import { useWidth } from "../useWidth";
import { useTip } from "../useTip";
import { useChartZoom, HOUR_PX } from "../useChartZoom";
import { useFmt } from "../../core/format";
import { segColor, LANES, SEG_NAME, NO_STAGES_COLOR, type Seg } from "../../core/sleep";
import { zoomHours, legendOf, DAY_DATA_COLOR, type DaySession } from "./daySessions";
import type { DayTimeline } from "./dayTimeline";
import ChartShade from "../ChartShade.vue";
import { shadeSpan, shadeFill } from "../chartShade";

const props = defineProps<{ tl: DayTimeline; day: string; sessions: DaySession[] }>();
const fmt = useFmt();
const box = ref<HTMLElement | null>(null);
// margins as LineChart's and the night's lanes, so the hours line up with the Stats day charts; P.l is the names' strip
// the gap between lanes is wide enough that the night's rows, the steps' bars and the heart rate's line read as three charts
const W = useWidth(box), P = { l: 44, r: 12, t: 8, b: 22 }, GAP = 14;
const hours = computed(() => (props.tl.to - props.tl.from) / 3600_000);
// the hours' strip: the card's width beside the names at 1x; zoomed, the hours stretch and the right margin doesn't
const base = computed(() => Math.max(1, W.value - P.l - P.r));
const { sc, cls, zoom, most, on, cw: PW, left, set, by, scrollTo, pinned, dragging } = useChartZoom({ box, base, pad: P.r,
  max: () => (hours.value * HOUR_PX) / base.value, range: () => props.day, clear: () => (hover.value = null) });
// a lane's name as its lines: "Heart rate" is too wide for the margin on one, so it takes two, centred on its middle (ny)
// what: the lane's name for a screen reader, listed in the chart's label
type Lane = { key: "sleep" | "steps" | "heart"; name: string[]; what: string; y: number; h: number; ny: number };
const LINE = 11;
// the night's rows in the Sleep tab hypnogram's order (awake on top, deep at the foot), only the stages the night has; a
// stretch only "asleep" sits in Light's row as there. The rows come from the day's summary, there before the stretches
// load, so the card keeps its height. A night without stages is one lane of the Sleep tab's stripes, its times awake
// left out. No joins between rows as the hypnogram has: at a day's scale a night's dozens of changes would fill the rows
// with grey lines, the barcode again. HEAD is the line above the rows that holds the lane's name.
const ROW = 19, BH = 12, HEAD = 14;
const uid = useId();
const rows = computed(() => { const ks = props.tl.night?.rows ?? []; return LANES.filter((l) => ks.includes(l.k)); });
const rowOf = (k: Seg["k"]) => rows.value.findIndex((l) => l.k === (k === "asleep" ? "light" : k));
const lanes = computed<Lane[]>(() => {
  const out: Lane[] = [];
  let y = P.t;
  const add = (key: Lane["key"], name: string[], what: string, h: number, ny = y + h / 2) => { out.push({ key, name, what, y, h, ny }); y += h + GAP; };
  // the night that ended this morning (the day's sleep is the night before it, as everywhere); with stages its name sits above its rows
  const night = "Sleep, the night before this day";
  if (props.tl.night) { if (rows.value.length) add("sleep", ["Sleep"], night, HEAD + rows.value.length * ROW, y + HEAD / 2); else add("sleep", ["Sleep"], night, BH + 4); }
  // Steps and Heart rate as the day's summary promises them, drawn empty while their hours load (dayTimeline.ts)
  if (props.tl.lanes.steps) add("steps", ["Steps"], "Steps on this day", 36);
  if (props.tl.lanes.heart) add("heart", ["Heart", "rate"], "Heart rate on this day", 40);
  return out;
});
const lane = (k: Lane["key"]) => lanes.value.find((l) => l.key === k);
const H = computed(() => { const l = lanes.value.at(-1); return (l ? l.y + l.h : P.t) + P.b; });
const sx = (t: number) => ((t - props.tl.from) / Math.max(1, props.tl.to - props.tl.from)) * (PW.value - P.r);
const hourW = computed(() => sx(props.tl.from + 3600_000) - sx(props.tl.from));
const t = (ms: number) => fmt.value.time(new Date(ms).toISOString());

// each row's line runs only across the night's hours, not the whole day
const sleepRows = computed(() => { const l = lane("sleep"), n = props.tl.night; return l && n ? rows.value.map((r, i) => ({ ...r, y: l.y + HEAD + i * ROW + ROW / 2, x1: sx(n.a), x2: sx(n.b) })) : []; });
// a stretch at least 2px wide, so a few minutes awake still shows; a night without stages in the Sleep tab's stripes,
// its stretches in the rows in the hypnogram's own colours
const sleepBlocks = computed(() => {
  const l = lane("sleep"); if (!l) return [];
  const staged = rows.value.length > 0;
  return props.tl.sleep.filter((s) => (staged ? rowOf(s.k) >= 0 : s.k !== "awake")).map((s) => ({ ...s, x: sx(s.a), w: Math.max(2, sx(s.b) - sx(s.a)),
    y: staged ? l.y + HEAD + rowOf(s.k) * ROW + (ROW - BH) / 2 : l.y + 2, fill: !staged && s.k === "asleep" ? `url(#${uid}-ns)` : segColor(s.k) }));
});
const stepBars = computed(() => {
  const l = lane("steps"); if (!l) return [];
  const top = Math.max(1, ...props.tl.steps.map((s) => s.value)), bw = Math.max(2, Math.min(14, hourW.value * 0.6));
  return props.tl.steps.map((s) => { const h = Math.max(2, (s.value / top) * l.h); return { x: sx(s.a) + (hourW.value - bw) / 2, y: l.y + l.h - h, w: bw, h, rx: Math.min(5, bw / 3) }; });
});
// the line breaks where the band read nothing for over 15 minutes, as the Heart day's line
const hrPath = computed(() => {
  const l = lane("heart"); if (!l || !props.tl.hr.length) return "";
  const ys = props.tl.hr.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), pad = 2, span = Math.max(1, hi - lo);
  const y = (v: number) => l.y + pad + (1 - (v - lo) / span) * (l.h - 2 * pad);
  return props.tl.hr.map(([x, v], i) => `${!i || x - props.tl.hr[i - 1]![0] > 15 * 60000 ? "M" : "L"}${sx(x).toFixed(1)},${y(v).toFixed(1)}`).join("");
});
// each session's span as on the day charts (chartShade.ts: at least 8px wide, so a 5-minute walk can still be tapped)
const shades = computed(() => props.sessions.filter((s) => s.b > s.a && s.b > props.tl.from && s.a < props.tl.to).map((s) => ({ ...s, ...shadeSpan(sx(Math.max(s.a, props.tl.from)), sx(Math.min(s.b, props.tl.to))) })));
// one stripe pattern per session colour: the span's usual tint with thin stripes of its colour across it
const hatches = computed(() => [...new Set(shades.value.map((z) => z.color))].map((color, i) => ({ color, id: `${uid}-h${i}`, tint: shadeFill(color), line: `color-mix(in srgb, ${color} 40%, transparent)` })));
const hatchOf = (c: string) => `url(#${hatches.value.find((h) => h.color === c)?.id})`;
// the lanes and the night's rows are named on the left, so the legend names only the sessions' colours, each swatch
// striped as its spans are, so it never seems to name a row
const legend = computed(() => legendOf(shades.value).map((k) => ({ ...k, swatch: `repeating-linear-gradient(-45deg, ${k.color} 0 2px, ${shadeFill(k.color)} 2px 4px)` })));
// an hour label every 6 hours on the card, as the Stats day charts; zoomed in, closer as the hours spread out
const xt = computed(() => zoomHours(props.day, fmt.value, on.value ? hourW.value : 0));

// Day by hour's buttons: twice or half the zoom around the middle of what's in view; the first step in starts at the
// night (or the day's first record), not at midnight with the day out of view
const first = () => props.tl.night?.a ?? Math.min(...props.tl.steps.map((s) => s.a), ...props.tl.hr.map((p) => p[0]), ...props.sessions.map((s) => s.a));
function zoomIn() {
  const from1 = !on.value;
  by(2);
  const at = first();
  if (from1 && Number.isFinite(at)) scrollTo(sx(at) - 24);
}
const zoomOut = () => (zoom.value / 2 < 1.02 ? set(1) : by(0.5));
defineExpose({ zoom, most, zoomIn, zoomOut });

// the tip: what the band read in the hour under the pointer (the night's stage, the steps, the heart rate), the first in
// bold as every chart's tip, then the session it falls in and the hour
const hover = ref<number | null>(null);
const { el: tipEl, style: tipStyle } = useTip(W);
const timeAt = (e: MouseEvent) => {
  const svg = (e.currentTarget as Element).closest("svg")!, r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * PW.value;
  return x < 0 || x > PW.value - P.r ? null : props.tl.from + (x / (PW.value - P.r)) * (props.tl.to - props.tl.from);
};
// a finger's tip stays put while the compatibility mouse events a tap sends come and go; a drag shows none
const move = (e: MouseEvent) => { if (!pinned.value) hover.value = dragging() ? null : timeAt(e); };
const leave = () => { if (!pinned.value) hover.value = null; };
// a click or a tap shows the hour's tip, as hovering does (useChartZoom keeps a finger's until a tap outside)
const click = (e: MouseEvent) => { hover.value = timeAt(e); };
const tip = computed(() => {
  const at = hover.value; if (at == null) return null;
  const h0 = new Date(at); h0.setMinutes(0, 0, 0);
  const a = h0.getTime(), parts: string[] = [];
  const seg = props.tl.sleep.find((s) => at >= s.a && at < s.b); if (seg) parts.push(SEG_NAME[seg.k]);
  const st = props.tl.steps.find((s) => s.a === a); if (st) parts.push(`${fmt.value.num(st.value, 0)} steps`);
  const near = props.tl.hr.reduce<[number, number] | null>((m, p) => (Math.abs(p[0] - at) <= 10 * 60000 && (!m || Math.abs(p[0] - at) < Math.abs(m[0] - at)) ? p : m), null); if (near) parts.push(`${fmt.value.num(near[1], 0)} bpm`);
  for (const z of shades.value) if (at >= z.a && at <= z.b) parts.push(z.name);
  // the tip is placed over the whole chart (it may rise above the scrolling strip), so by where the hour is on screen
  return parts.length ? { x: sx(at), at: P.l + sx(at) - left.value, head: parts[0]!, rest: [...parts.slice(1), `${t(a)}-${t(a + 3600_000)}`] } : null;
});
</script>

<template>
  <div ref="box" class="dtl">
    <div class="dtl-row">
      <!-- the names: each lane's and the night's stages', fixed while the hours scroll -->
      <svg class="chart dtl-names" :viewBox="`0 0 ${P.l} ${H}`" :style="{ width: P.l + 'px', height: H + 'px' }" aria-hidden="true">
        <text v-for="l in lanes" :key="l.key" class="ax dtl-name" :y="l.ny + 3 - ((l.name.length - 1) * LINE) / 2" text-anchor="end"><tspan v-for="(w, i) in l.name" :key="w" :x="P.l - 6" :dy="i ? LINE : 0">{{ w }}</tspan></text>
        <text v-for="r in sleepRows" :key="r.k" class="ax" :x="P.l - 6" :y="r.y + 3" text-anchor="end">{{ r.name }}</text>
      </svg>
      <div ref="sc" class="zsc" :class="cls">
        <svg class="chart" :viewBox="`0 0 ${PW} ${H}`" :style="{ width: PW + 'px', height: H + 'px' }" role="img" :aria-label="`Day by hour: ${lanes.map((l) => l.what).join(', ')}`" @mousemove="move" @mouseleave="leave" @click="click">
          <!-- the whole plot answers the pointer (an svg's empty parts don't), and each lane has a faint line along its foot -->
          <rect :x="0" :y="0" :width="Math.max(0, PW - P.r)" :height="H" fill="transparent" />
          <line v-for="l in lanes" :key="l.key" class="gl" :x1="0" :x2="PW - P.r" :y1="l.y + l.h" :y2="l.y + l.h" />
          <!-- the Sleep tab's no-stages stripes (BarChart's hatch) -->
          <defs><pattern :id="`${uid}-ns`" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" :style="{ fill: NO_STAGES_COLOR, opacity: 0.3 }" /><rect width="2" height="4" :style="{ fill: NO_STAGES_COLOR }" /></pattern>
            <!-- the sessions' stripes: wider and fainter than the night's, a background across every lane -->
            <pattern v-for="h in hatches" :id="h.id" :key="h.id" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" :style="{ fill: h.tint }" /><rect width="2" height="6" :style="{ fill: h.line }" /></pattern></defs>
          <!-- the night's rows: a faint line through each stage's row across the night, as the Sleep tab's hypnogram -->
          <line v-for="r in sleepRows" :key="r.k" class="gl" :x1="r.x1" :x2="r.x2" :y1="r.y" :y2="r.y" pointer-events="none" />
          <g pointer-events="none">
            <rect v-for="(b, i) in sleepBlocks" :key="'z' + i" :x="b.x" :y="b.y" :width="b.w" :height="BH" rx="2" :style="{ fill: b.fill }" />
            <rect v-for="(b, i) in stepBars" :key="'s' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" :rx="b.rx" :style="{ fill: DAY_DATA_COLOR }" />
            <path v-if="hrPath" :d="hrPath" class="ln" :style="{ stroke: DAY_DATA_COLOR }" />
          </g>
          <ChartShade v-for="z in shades" :key="z.key" :x="z.x" :w="z.w" :y="0" :h="H - P.b" :color="z.color" :fill="hatchOf(z.color)" />
          <line v-if="tip" class="gl" :x1="tip.x" :x2="tip.x" :y1="P.t" :y2="H - P.b" pointer-events="none" />
          <text v-for="h in xt" :key="h.at" class="ax" :x="sx(h.at)" :y="H - 4" :text-anchor="h.at <= tl.from ? 'start' : 'middle'">{{ h.text }}</text>
        </svg>
      </div>
    </div>
    <div v-if="tip" ref="tipEl" class="ctip" :style="tipStyle(tip.at, P.t + 'px')"><b>{{ tip.head }}</b><template v-for="p in tip.rest" :key="p"> · {{ p }}</template></div>
    <div v-if="legend.length" class="bmlegend dtl-leg"><span v-for="k in legend" :key="k.name + k.color"><i :style="{ background: k.swatch }" />{{ k.name }}</span></div>
  </div>
</template>

<style scoped>
.dtl { position: relative; }
.dtl-row { display: flex; }
.dtl-names { flex: none; user-select: none; }
/* the hours' strip (.zsc, app.css) is drawn as wide as the zoom makes it, not the card's width */
.zsc .chart { width: auto; }
.dtl-leg { margin-top: var(--hg); }
/* a lane's name over its stage names: the stronger text, so the night's stage rows read as one part named Sleep */
.chart .dtl-name { fill: var(--tx); font-weight: 600; }
</style>
