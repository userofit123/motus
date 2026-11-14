<script setup lang="ts">
// A line chart over time with a soft area, gridlines and a tooltip; points can be clicked (e.g. to open that workout).
import { computed, ref } from "vue";
import { useWidth } from "./useWidth";
import { useTip } from "./useTip";
import { useFmt } from "../core/format";

const props = defineProps<{ points: { x: number; y: number; label?: string; id?: string }[]; height?: number; fmt?: (v: number) => string; xfmt?: (t: number) => string; color?: string; zero?: boolean }>();
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
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: props.zero ? 0 : min >= 0 ? Math.max(0, lo - pad) : lo - pad, // values that can't be negative never get a negative axis
    y1: hi + pad, flat };
});
const sx = (x: number) => { const d = dom.value; return P.l + (d.x1 === d.x0 ? 0.5 : (x - d.x0) / (d.x1 - d.x0)) * (W.value - P.l - P.r); };
const sy = (y: number) => { const d = dom.value; return P.t + (1 - (y - d.y0) / (d.y1 - d.y0)) * (H.value - P.t - P.b); };
const path = computed(() => sorted.value.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(""));
const area = computed(() => sorted.value.length ? `${path.value}L${sx(sorted.value.at(-1)!.x)},${H.value - P.b}L${sx(sorted.value[0]!.x)},${H.value - P.b}Z` : "");
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
  if (s.length < 2 || d.x0 === d.x1) { tryAdd(s[0]!.x, "middle"); return out; }
  tryAdd(d.x0, "start"); tryAdd(d.x1, "end"); tryAdd(mid, "middle");
  return out.sort((a, b) => a.x - b.x);
});
const hover = ref<number | null>(null);
// near either edge the tip slides inwards, so it isn't cut off
const { el: tipEl, style: tipStyle } = useTip(W);
function move(e: MouseEvent) {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W.value;
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
    <svg v-else class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }" @mousemove="move" @mouseleave="hover = null"
      @click="hover != null && sorted[hover]?.id && emit('pick', sorted[hover]!.id!)">
      <defs><linearGradient :id="'cg' + uid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="color ?? 'var(--acc)'" stop-opacity=".35" /><stop offset="1" :stop-color="color ?? 'var(--acc)'" stop-opacity="0" /></linearGradient></defs>
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
