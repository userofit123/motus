<script setup lang="ts">
// A line chart over time with a soft area, gridlines and a tooltip.
// domain: the time the x axis spans (a whole day) instead of the first to the last point; xt: where its time labels go
// instead of first, middle and last; gap: a longer break between two points (ms) leaves the line open there, so time
// without readings isn't drawn as a straight line; shade: spans of time set off behind the line (a day's workouts), in
// their own colour with a strip along the top when they have one (none when soft: a quieter span, a workout's rests),
// at least 8px wide so a short one still shows, named in the tip of a point inside it. A point with an `id` (a workout,
// a day) opens it (pick) from its pinned tip; a shade with one, from the tip of a point clicked or tapped over it.
// It zooms sideways (useChartZoom.ts) until its points are about 32px apart (or an hour HOUR_PX wide, or 4x), the time labels
// coming closer as it spreads out; the value labels sit in their own strip on the left, which stays put while the
// plot scrolls. Charts sharing a zoom (a night's) zoom by their hours alone, so they stay lined up. Hovering, clicking or
// tapping shows the nearest point's tip; only a clicked or tapped tip opens (useChartZoom.ts).
// Points with a `trend` value (body weight's smoothed trend under its weigh-ins) also draw a second, quieter line through
// those values, without dots or area, so the line and its fill stay on what was logged; a point's tip names its trend
// value after `trendName`, unless the two read the same.
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { useWidth } from "./useWidth";
import { useTip, TIP_ROOM } from "./useTip";
import { useChartZoom, timeTicks, tickRoom, TICK_CH, TICK_GAP, inChartGroup, HOUR_PX } from "./useChartZoom";
import { useFmt } from "../core/format";
import ChartShade from "./ChartShade.vue";
import { shadeSpan } from "./chartShade";

const props = defineProps<{ points: { x: number; y: number; trend?: number; label?: string; id?: string }[]; trendName?: string; height?: number; fmt?: (v: number) => string; xfmt?: (t: number) => string; color?: string; zero?: boolean; domain?: [number, number]; xt?: number[]; gap?: number; shade?: { a: number; b: number; color?: string; soft?: boolean; name?: string; id?: string }[] }>();
const emit = defineEmits<{ pick: [id: string] }>();
const box = ref<HTMLElement | null>(null);
// every chart with tips keeps TIP_ROOM at its top for a pinned tip (P.t, useTip), so the tip stays inside the chart, over
// no point (under a header the room slides up behind it, charts.css .cht), and sibling charts have the same air over their plots: the chart is that much taller
// than its height, its plot as tall as the height alone gave it
const P = { l: 44, r: 12, t: TIP_ROOM, b: 22 };
/** The top margin the chart had before it kept TIP_ROOM; the room takes its place, so the chart is that much taller */
const MARGIN_T = 10;
const W = useWidth(box), H = computed(() => (props.height ?? 200) + TIP_ROOM - MARGIN_T);
// the plot's width at 1x: the card's, less the value labels' strip (P.l) and the right margin (P.r, which doesn't stretch)
const base = computed(() => Math.max(1, W.value - P.l - P.r));
const uid = Math.random().toString(36).slice(2);
const sorted = computed(() => [...props.points].sort((a, b) => a.x - b.x));
const dom = computed(() => {
  const ys = sorted.value.flatMap((p) => (p.trend == null ? [p.y] : [p.y, p.trend])), xs = sorted.value.map((p) => p.x);
  const min = Math.min(...ys);
  let lo = props.zero ? 0 : min, hi = Math.max(...ys);
  const flat = lo === hi;
  if (flat) { const m = Math.abs(hi) * 0.1 || 1; lo -= m; hi += m; }
  const pad = (hi - lo) * 0.1;
  return { x0: props.domain?.[0] ?? Math.min(...xs), x1: props.domain?.[1] ?? Math.max(...xs), y0: props.zero ? 0 : min >= 0 ? Math.max(0, lo - pad) : lo - pad, // values that can't be negative never get a negative axis
    y1: hi + pad, flat };
});
const span = computed(() => { const d = dom.value; return d.x1 - d.x0; });
const grouped = inChartGroup(), hourCap = () => ((span.value / 3600_000) * HOUR_PX) / base.value;
const { sc, cls, on, cw: CW, left, pinned, pick, unpin, dragging } = useChartZoom({ box, base, pad: P.r,
  // a short span (a 40-minute workout's heart rate) is narrower than its card at HOUR_PX, yet its readings are seconds
  // apart: it still zooms up to 4x when it has the points for it
  max: () => (grouped ? hourCap() : Math.min(64, (sorted.value.length * 32) / base.value, Math.max(4, hourCap()))),
  // another day or period fits the card again; points added live (a workout's heart rate) keep the zoom
  range: () => (props.domain ? props.domain.join("-") : String(sorted.value[0]?.x)), clear: () => { hover.value = null; go.value = null; } });
// across the plot strip, which starts right of the value labels
const sx = (x: number) => { const d = dom.value; return (d.x1 === d.x0 ? 0.5 : (x - d.x0) / (d.x1 - d.x0)) * (CW.value - P.r); };
const sy = (y: number) => { const d = dom.value; return P.t + (1 - (y - d.y0) / (d.y1 - d.y0)) * (H.value - P.t - P.b); };
// the runs of points without a break longer than gap (one run without a gap), each its own line and area
const runs = computed(() => { const out: (typeof sorted.value)[] = []; sorted.value.forEach((p, i) => { if (!i || (props.gap && p.x - sorted.value[i - 1]!.x > props.gap)) out.push([]); out.at(-1)!.push(p); }); return out; });
const line = (r: typeof sorted.value) => r.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join("");
const path = computed(() => runs.value.map(line).join(""));
// the second line through the points that have a trend, broken where the main line is
const trendPath = computed(() => runs.value.map((r) => r.filter((p) => p.trend != null).map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.trend!)}`).join("")).join(""));
const area = computed(() => runs.value.map((r) => `${line(r)}L${sx(r.at(-1)!.x)},${H.value - P.b}L${sx(r[0]!.x)},${H.value - P.b}Z`).join(""));
// three gridlines, unless the labels would repeat (flat or tiny ranges), then one per distinct label
const ticks = computed(() => { const d = dom.value; if (d.flat) return [sorted.value[0]!.y]; const t = [0, 0.5, 1].map((k) => d.y0 + (d.y1 - d.y0) * k); return t.filter((v, i) => t.findIndex((u) => f(u) === f(v)) === i); });
// first, last and middle date, the middle one halfway in time (not the middle entry: entries bunched at one end put
// it on top of the last label). A label that would touch one already placed, or repeat it, is left out.
// about one character of .ax text in px, and the least room between two labels, at 1x; zoomed, useChartZoom's TICK_CH
// and TICK_GAP, as every zoomed time axis spaces its labels
const LABEL_CH = 6, LABEL_GAP = 8;
const xticks = computed(() => {
  const s = sorted.value; if (!s.length) return [];
  const d = dom.value, mid = (d.x0 + d.x1) / 2;
  const out: { x: number; anchor: "start" | "middle" | "end"; lo: number; hi: number; text: string }[] = [];
  const ch = on.value ? TICK_CH : LABEL_CH, gap = on.value ? TICK_GAP : LABEL_GAP;
  const tryAdd = (x: number, anchor: "start" | "middle" | "end") => {
    const text = xf(x), w = text.length * ch, at = sx(x);
    const lo = anchor === "start" ? at : anchor === "end" ? at - w : at - w / 2, hi = lo + w;
    if (out.some((t) => t.text === text || (lo < t.hi + gap && hi > t.lo - gap))) return;
    out.push({ x, anchor, lo, hi, text });
  };
  // zoomed in: a label every so often, as often as they fit (the caller's own labels are for the chart at 1x)
  if (on.value && d.x1 > d.x0) {
    const end = CW.value - P.r;
    for (const x of timeTicks(d.x0, d.x1, CW.value - P.r, tickRoom(xf(d.x0)), !props.xfmt)) { const w = xf(x).length * TICK_CH, at = sx(x); tryAdd(x, at - w / 2 < 0 ? "start" : at + w / 2 > end ? "end" : "middle"); }
    return out.sort((a, b) => a.x - b.x);
  }
  if (props.xt?.length) { props.xt.forEach((x) => tryAdd(x, x <= d.x0 ? "start" : x >= d.x1 ? "end" : "middle")); return out.sort((a, b) => a.x - b.x); }
  if (s.length < 2 || d.x0 === d.x1) { tryAdd(s[0]!.x, "middle"); return out; }
  tryAdd(d.x0, "start"); tryAdd(d.x1, "end"); tryAdd(mid, "middle");
  return out.sort((a, b) => a.x - b.x);
});
const hover = ref<number | null>(null);
// near either edge the tip slides inwards, so it isn't cut off
const { el: tipEl, style: tipStyle, span: tipSpan } = useTip(W);
// where the tip's foot sits: over its point (useTip's 10px gap clears the 5px dot); pinned, the tip is clicked, so it
// rises above every point under its whole width, and the ones just beyond, whose lines run in under it, into the room
// kept at the chart's top
const tipTop = (i: number) => {
  const at = (p: { x: number }) => P.l + sx(p.x) - left.value, s = sorted.value;
  // the higher of a point's two lines (its value and its trend), so the tip covers neither
  const top = (p: { y: number; trend?: number }) => sy(p.trend == null ? p.y : Math.max(p.y, p.trend));
  let t = top(s[i]!);
  if (!pinned.value) return t;
  const { lo, hi } = tipSpan(at(s[i]!), !!go.value);
  s.forEach((p, j) => { const x = at(p); if ((x >= lo && x <= hi) || (x < lo && at(s[j + 1] ?? p) >= lo) || (x > hi && at(s[j - 1] ?? p) <= hi)) t = Math.min(t, top(p)); });
  // nor inside a session's tint: over one, it sits in the room above the plot, where every day chart's shading starts
  if (props.shade?.some((z) => { const s = shadeX(z); return P.l + s.x - left.value < hi && P.l + s.x + s.w - left.value > lo; })) t = Math.min(t, P.t);
  return t;
};
const shadeX = (z: { a: number; b: number }) => shadeSpan(sx(Math.max(z.a, dom.value.x0)), sx(Math.min(z.b, dom.value.x1)));
const svgX = (e: MouseEvent) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * CW.value; };
const nearest = (x: number) => { let best = 0, bd = Infinity; sorted.value.forEach((p, i) => { const d = Math.abs(sx(p.x) - x); if (d < bd) { bd = d; best = i; } }); return best; };
// the shaded sessions a point falls in, named in its tip as BarChart's bars name theirs
const shadeName = (t: number) => (props.shade ?? []).filter((z) => z.name && z.a <= t && z.b >= t).map((z) => z.name).join(", ");
// a click or a tap pins the nearest point's tip (useChartZoom); what its tip opens: the session shaded where it was
// tapped, else the point
const go = ref<string | null>(null);
/** How far from a point a click still counts as on it; further, and outside any session, it's empty chart space */
const REACH = 24;
const svgY = (e: MouseEvent, h: number) => { const svg = (e.currentTarget as Element).closest("svg")!, r = svg.getBoundingClientRect(); return ((e.clientY - r.top) / r.height) * h; };
function click(e: MouseEvent) {
  const x = svgX(e), z = props.shade?.find((s) => s.id && s.b > dom.value.x0 && s.a < dom.value.x1 && x >= shadeX(s).x && x <= shadeX(s).x + shadeX(s).w);
  // the room kept for the tip above the plot, and the time labels under it, are empty space too
  const y = svgY(e, H.value), i = nearest(x), near = y >= P.t && y <= H.value - P.b && (z || Math.abs(sx(sorted.value[i]!.x) - x) <= REACH);
  pick(near ? `${z?.id ?? ""}@${i}` : null);
  if (!near) return;
  hover.value = i; go.value = z?.id ?? sorted.value[i]?.id ?? null;
}
const openGo = () => { const id = go.value; if (!pinned.value || !id) return; unpin(); emit("pick", id); };
// a pinned tip stays put while the mouse moves on (or a tap's compatibility mouse events come and go); a drag shows none
function move(e: MouseEvent) {
  if (pinned.value) return;
  hover.value = dragging() ? null : nearest(svgX(e));
}
const leave = () => { if (!pinned.value) hover.value = null; };
const f = (v: number) => (props.fmt ? props.fmt(v) : String(Math.round(v * 10) / 10));
// dates as the lists write them (your date format: "13 Nov")
const df = useFmt();
const xf = (t: number) => (props.xfmt ? props.xfmt(t) : df.value.date(t));
</script>

<template>
  <div ref="box" style="position:relative" :class="{ cht: points.length }" :style="{ '--tipup': TIP_ROOM + 'px' }">
    <div v-if="!points.length" class="empty" style="padding:calc(var(--cpy) * 2) 0">No data yet</div>
    <div v-else class="zrow">
    <!-- the value labels, still while the plot scrolls -->
    <svg class="chart zfix" :viewBox="`0 0 ${P.l} ${H}`" :style="{ width: P.l + 'px', height: H + 'px' }" aria-hidden="true">
      <text v-for="t in ticks" :key="t" class="ax" :x="P.l - 6" :y="sy(t) + 3" text-anchor="end">{{ f(t) }}</text>
    </svg>
    <div ref="sc" class="zsc" :class="cls">
    <svg class="chart" :viewBox="`0 0 ${CW} ${H}`" :style="{ height: H + 'px', ...(on ? { width: CW + 'px' } : {}) }" @mousemove="move" @mouseleave="leave" @click="click">
      <defs><linearGradient :id="'cg' + uid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="color ?? 'var(--acc)'" stop-opacity=".35" /><stop offset="1" :stop-color="color ?? 'var(--acc)'" stop-opacity="0" /></linearGradient></defs>
      <ChartShade v-for="(z, i) in (shade ?? []).filter((s) => s.b > dom.x0 && s.a < dom.x1)" :key="'s' + i" v-bind="shadeX(z)" :y="P.t" :h="H - P.t - P.b" :color="z.color" :soft="z.soft" />
      <line v-for="t in ticks" :key="t" class="gl" :x1="0" :x2="CW - P.r" :y1="sy(t)" :y2="sy(t)" />
      <text v-for="t in xticks" :key="'x' + t.x" class="ax" :x="sx(t.x)" :y="H - 4" :text-anchor="t.anchor">{{ t.text }}</text>
      <path :d="area" :fill="`url(#cg${uid})`" />
      <path v-if="trendPath" class="lc-tr" :d="trendPath" />
      <path class="ln" :d="path" :style="color ? { stroke: color } : undefined" />
      <circle v-for="(p, i) in sorted" :key="i" class="pt" :cx="sx(p.x)" :cy="sy(p.y)" :r="hover === i ? 5 : sorted.length > 40 ? 0 : 3" :style="color ? { stroke: color } : undefined" />
    </svg>
    </div>
    </div>
    <div v-if="hover != null && sorted[hover]" class="ctip" :class="{ go: pinned && go }" ref="tipEl" :role="pinned && go ? 'button' : undefined" :tabindex="pinned && go ? 0 : undefined" :style="tipStyle(P.l + sx(sorted[hover]!.x) - left, tipTop(hover), !!(pinned && go), pinned)" @pointerdown="pinned && go ? $event.preventDefault() : undefined" @click.stop.prevent="openGo" @keydown.enter.prevent="openGo" @keydown.space.prevent="openGo">
      <b>{{ f(sorted[hover]!.y) }}</b><span class="sep">·</span><span class="ctip-r"><template v-if="sorted[hover]!.trend != null && f(sorted[hover]!.trend!) !== f(sorted[hover]!.y)">{{ trendName ?? "Trend" }} {{ f(sorted[hover]!.trend!) }} · </template>{{ sorted[hover]!.label ?? xf(sorted[hover]!.x) }}<template v-if="shadeName(sorted[hover]!.x)"> · {{ shadeName(sorted[hover]!.x) }}</template></span><Icon v-if="pinned && go" name="right" :size="13" class="ctip-go" />
    </div>
  </div>
</template>

<style scoped>
/* the trend under the main line: thinner and in the quiet text colour, so it reads as a guide, not as the data */
.lc-tr { fill: none; stroke: var(--tx2); stroke-width: 1.5; opacity: .85; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
</style>
