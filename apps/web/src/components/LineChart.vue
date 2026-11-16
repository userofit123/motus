<script setup lang="ts">
// A line chart over time with a soft area, gridlines and a tooltip.
// domain: the time the x axis spans (a whole day) instead of the first to the last point; xt: where its time labels go
// instead of first, middle and last; gap: a longer break between two points (ms) leaves the line open there, so time
// without readings isn't drawn as a straight line; shade: spans of time set off behind the line (a day's workouts), in
// their own colour with a strip along the top when they have one (none when soft: a quieter span, a workout's rests),
// at least 8px wide so a short one still shows, named in the tip of a point inside it.
// It zooms sideways (useChartZoom.ts) until its points are about 32px apart (or an hour HOUR_PX wide, or 4x), the time labels
// coming closer as it spreads out; the value labels sit in their own strip on the left, which stays put while the
// plot scrolls. Charts sharing a zoom (a night's) zoom by their hours alone, so they stay lined up. Hovering, clicking or
// tapping shows the nearest point's tip; a chart never opens another page.
import { computed, ref } from "vue";
import { useWidth } from "./useWidth";
import { useTip } from "./useTip";
import { useChartZoom, timeTicks, tickRoom, TICK_CH, TICK_GAP, inChartGroup, HOUR_PX } from "./useChartZoom";
import { useFmt } from "../core/format";
import ChartShade from "./ChartShade.vue";
import { shadeSpan } from "./chartShade";

const props = defineProps<{ points: { x: number; y: number; label?: string }[]; height?: number; fmt?: (v: number) => string; xfmt?: (t: number) => string; color?: string; zero?: boolean; domain?: [number, number]; xt?: number[]; gap?: number; shade?: { a: number; b: number; color?: string; soft?: boolean; name?: string }[] }>();
const box = ref<HTMLElement | null>(null);
const W = useWidth(box), H = computed(() => props.height ?? 200), P = { l: 44, r: 12, t: 10, b: 22 };
// the plot's width at 1x: the card's, less the value labels' strip (P.l) and the right margin (P.r, which doesn't stretch)
const base = computed(() => Math.max(1, W.value - P.l - P.r));
const uid = Math.random().toString(36).slice(2);
const sorted = computed(() => [...props.points].sort((a, b) => a.x - b.x));
const dom = computed(() => {
  const ys = sorted.value.map((p) => p.y), xs = sorted.value.map((p) => p.x);
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
const { sc, cls, on, cw: CW, left, pinned, dragging } = useChartZoom({ box, base, pad: P.r,
  // a short span (a 40-minute workout's heart rate) is narrower than its card at HOUR_PX, yet its readings are seconds
  // apart: it still zooms up to 4x when it has the points for it
  max: () => (grouped ? hourCap() : Math.min(64, (sorted.value.length * 32) / base.value, Math.max(4, hourCap()))),
  // another day or period fits the card again; points added live (a workout's heart rate) keep the zoom
  range: () => (props.domain ? props.domain.join("-") : String(sorted.value[0]?.x)), clear: () => (hover.value = null) });
// across the plot strip, which starts right of the value labels
const sx = (x: number) => { const d = dom.value; return (d.x1 === d.x0 ? 0.5 : (x - d.x0) / (d.x1 - d.x0)) * (CW.value - P.r); };
const sy = (y: number) => { const d = dom.value; return P.t + (1 - (y - d.y0) / (d.y1 - d.y0)) * (H.value - P.t - P.b); };
// the runs of points without a break longer than gap (one run without a gap), each its own line and area
const runs = computed(() => { const out: (typeof sorted.value)[] = []; sorted.value.forEach((p, i) => { if (!i || (props.gap && p.x - sorted.value[i - 1]!.x > props.gap)) out.push([]); out.at(-1)!.push(p); }); return out; });
const line = (r: typeof sorted.value) => r.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join("");
const path = computed(() => runs.value.map(line).join(""));
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
const { el: tipEl, style: tipStyle } = useTip(W);
const shadeX = (z: { a: number; b: number }) => shadeSpan(sx(Math.max(z.a, dom.value.x0)), sx(Math.min(z.b, dom.value.x1)));
const svgX = (e: MouseEvent) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * CW.value; };
const nearest = (x: number) => { let best = 0, bd = Infinity; sorted.value.forEach((p, i) => { const d = Math.abs(sx(p.x) - x); if (d < bd) { bd = d; best = i; } }); return best; };
// the shaded sessions a point falls in, named in its tip as BarChart's bars name theirs
const shadeName = (t: number) => (props.shade ?? []).filter((z) => z.name && z.a <= t && z.b >= t).map((z) => z.name).join(", ");
// a click or a tap shows the nearest point's tip, as hovering does (useChartZoom keeps a finger's until a tap outside)
const click = (e: MouseEvent) => { hover.value = nearest(svgX(e)); };
// a finger's tip stays put while the compatibility mouse events a tap sends come and go; a drag shows none
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
  <div ref="box" style="position:relative">
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
      <path class="ln" :d="path" :style="color ? { stroke: color } : undefined" />
      <circle v-for="(p, i) in sorted" :key="i" class="pt" :cx="sx(p.x)" :cy="sy(p.y)" :r="hover === i ? 5 : sorted.length > 40 ? 0 : 3" :style="color ? { stroke: color } : undefined" />
    </svg>
    </div>
    </div>
    <div v-if="hover != null && sorted[hover]" class="ctip" ref="tipEl" :style="tipStyle(P.l + sx(sorted[hover]!.x) - left, (sy(sorted[hover]!.y) / H) * 100 + '%')">
      <b>{{ f(sorted[hover]!.y) }}</b> · {{ sorted[hover]!.label ?? xf(sorted[hover]!.x) }}<template v-if="shadeName(sorted[hover]!.x)"> · {{ shadeName(sorted[hover]!.x) }}</template>
    </div>
  </div>
</template>
