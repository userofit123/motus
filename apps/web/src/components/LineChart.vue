<script setup lang="ts">
// A line chart over time with a soft area, gridlines and a tooltip; points can be clicked (e.g. to open that workout).
// domain: the time the x axis spans (a whole day) instead of the first to the last point; xt: where its time labels go
// instead of first, middle and last; gap: a longer break between two points (ms) leaves the line open there, so time
// without readings isn't drawn as a straight line; shade: spans of time set off behind the line (a day's workouts), in
// their own colour with a strip along the top when they have one (none when soft: a quieter span, a workout's rests), each with an id opening it when the chart is tapped
// anywhere over it, top to bottom (at least 8px wide, so a short one can be hit).
import { computed, ref } from "vue";
import { useWidth } from "./useWidth";
import { useTip } from "./useTip";
import { useFmt } from "../core/format";

const props = defineProps<{ points: { x: number; y: number; label?: string; id?: string }[]; height?: number; fmt?: (v: number) => string; xfmt?: (t: number) => string; color?: string; zero?: boolean; domain?: [number, number]; xt?: number[]; gap?: number; shade?: { a: number; b: number; color?: string; soft?: boolean; id?: string; name?: string }[] }>();
const emit = defineEmits<{ pick: [id: string] }>();
const box = ref<HTMLElement | null>(null);
const W = useWidth(box), H = computed(() => props.height ?? 200), P = { l: 44, r: 12, t: 10, b: 22 };
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
const sx = (x: number) => { const d = dom.value; return P.l + (d.x1 === d.x0 ? 0.5 : (x - d.x0) / (d.x1 - d.x0)) * (W.value - P.l - P.r); };
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
const LABEL_CH = 6, LABEL_GAP = 8; // about one character of .ax text in px, and the least room between two labels
const xticks = computed(() => {
  const s = sorted.value; if (!s.length) return [];
  const d = dom.value, mid = (d.x0 + d.x1) / 2;
  const out: { x: number; anchor: "start" | "middle" | "end"; lo: number; hi: number; text: string }[] = [];
  const tryAdd = (x: number, anchor: "start" | "middle" | "end") => {
    const text = xf(x), w = text.length * LABEL_CH, at = sx(x);
    const lo = anchor === "start" ? at : anchor === "end" ? at - w : at - w / 2, hi = lo + w;
    if (out.some((t) => t.text === text || (lo < t.hi + LABEL_GAP && hi > t.lo - LABEL_GAP))) return;
    out.push({ x, anchor, lo, hi, text });
  };
  if (props.xt?.length) { props.xt.forEach((x) => tryAdd(x, x <= d.x0 ? "start" : x >= d.x1 ? "end" : "middle")); return out.sort((a, b) => a.x - b.x); }
  if (s.length < 2 || d.x0 === d.x1) { tryAdd(s[0]!.x, "middle"); return out; }
  tryAdd(d.x0, "start"); tryAdd(d.x1, "end"); tryAdd(mid, "middle");
  return out.sort((a, b) => a.x - b.x);
});
const hover = ref<number | null>(null);
// near either edge the tip slides inwards, so it isn't cut off
const { el: tipEl, style: tipStyle } = useTip(W);
const SHADE_MIN = 8;
const shadeX = (z: { a: number; b: number }) => { const x = sx(Math.max(z.a, dom.value.x0)); return { x, w: Math.max(SHADE_MIN, sx(Math.min(z.b, dom.value.x1)) - x) }; };
const svgX = (e: MouseEvent) => { const r = (e.currentTarget as SVGElement).getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W.value; };
function click(e: MouseEvent) {
  const x = svgX(e), z = props.shade?.find((s) => s.id && s.b > dom.value.x0 && s.a < dom.value.x1 && x >= shadeX(s).x && x <= shadeX(s).x + shadeX(s).w);
  if (z?.id) emit("pick", z.id);
  else if (hover.value != null && sorted.value[hover.value]?.id) emit("pick", sorted.value[hover.value]!.id!);
}
function move(e: MouseEvent) {
  const x = svgX(e);
  let best = 0, bd = Infinity;
  sorted.value.forEach((p, i) => { const d = Math.abs(sx(p.x) - x); if (d < bd) { bd = d; best = i; } });
  hover.value = best;
}
const f = (v: number) => (props.fmt ? props.fmt(v) : String(Math.round(v * 10) / 10));
// dates as the lists write them (your date format: "13 Nov")
const df = useFmt();
const xf = (t: number) => (props.xfmt ? props.xfmt(t) : df.value.date(t));
</script>

<template>
  <div ref="box" style="position:relative">
    <div v-if="!points.length" class="empty" style="padding:calc(var(--cpy) * 2) 0">No data yet</div>
    <svg v-else class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px', ...(shade?.some((z) => z.id) ? { cursor: 'pointer' } : {}) }" @mousemove="move" @mouseleave="hover = null" @click="click">
      <defs><linearGradient :id="'cg' + uid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="color ?? 'var(--acc)'" stop-opacity=".35" /><stop offset="1" :stop-color="color ?? 'var(--acc)'" stop-opacity="0" /></linearGradient></defs>
      <g v-for="(z, i) in (shade ?? []).filter((s) => s.b > dom.x0 && s.a < dom.x1)" :key="'s' + i"><title v-if="z.name">{{ z.name }}</title>
        <rect class="shd" :x="shadeX(z).x" :y="P.t" :width="shadeX(z).w" :height="H - P.t - P.b" :rx="z.color ? 0 : 3" :style="z.color ? { fill: `color-mix(in srgb, ${z.color} 16%, transparent)` } : undefined" />
        <rect v-if="z.color && !z.soft" :x="shadeX(z).x" :y="P.t" :width="shadeX(z).w" height="3" rx="1.5" :style="{ fill: z.color }" />
      </g>
      <g v-for="t in ticks" :key="t"><line class="gl" :x1="P.l" :x2="W - P.r" :y1="sy(t)" :y2="sy(t)" /><text class="ax" :x="P.l - 6" :y="sy(t) + 3" text-anchor="end">{{ f(t) }}</text></g>
      <text v-for="t in xticks" :key="'x' + t.x" class="ax" :x="sx(t.x)" :y="H - 4" :text-anchor="t.anchor">{{ t.text }}</text>
      <path :d="area" :fill="`url(#cg${uid})`" />
      <path class="ln" :d="path" :style="color ? { stroke: color } : undefined" />
      <circle v-for="(p, i) in sorted" :key="i" class="pt" :cx="sx(p.x)" :cy="sy(p.y)" :r="hover === i ? 5 : sorted.length > 40 ? 0 : 3" :style="color ? { stroke: color } : undefined" />
    </svg>
    <div v-if="hover != null && sorted[hover]" class="ctip" ref="tipEl" :style="tipStyle(sx(sorted[hover]!.x), (sy(sorted[hover]!.y) / H) * 100 + '%')">
      <b>{{ f(sorted[hover]!.y) }}</b> · {{ sorted[hover]!.label ?? xf(sorted[hover]!.x) }}
    </div>
  </div>
</template>
