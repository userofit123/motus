<script setup lang="ts">
// A night's stages across its hours, as tracker apps draw them: a lane each for awake, REM, light and deep (top to
// bottom, so deeper sleep sits lower), each stretch a block in its stage's colour in its lane, thin joins between one
// stretch and the next so the night reads as one line. Styled as LineChart (same margins, gridlines and axis text), so
// it lines up with the heart rate, blood oxygen and breathing charts under it; a stretch's tip gives its stage and times.
// It zooms sideways as they do (useChartZoom.ts), up to HOUR_PX an hour so a few minutes awake can be looked at, the lane
// names staying put in their own strip; on a night's page it shares their zoom and scroll, so all stay lined up.
// Hovering, clicking or tapping a stretch shows its tip.
import { computed, ref } from "vue";
import { useWidth } from "../useWidth";
import { useTip, TIP_ROOM } from "../useTip";
import { useChartZoom, timeTicks, tickRoom, TICK_CH, HOUR_PX } from "../useChartZoom";
import { useFmt } from "../../core/format";
import { LANES, laneOf, segColor, SEG_NAME, mins, type Seg } from "../../core/sleep";

const props = defineProps<{ segs: Seg[]; from: number; to: number; xt: number[]; height?: number }>();
const fmt = useFmt();
const box = ref<HTMLElement | null>(null);
// TIP_ROOM at the top for a pinned tip, as every chart with tips keeps (useTip), so the night's charts under it, which
// keep the same, still line up; its lanes as tall as the height alone gave them
const P = { l: 44, r: 12, t: TIP_ROOM, b: 22 };
/** The top margin the chart had before it kept TIP_ROOM; the room takes its place, so the chart is that much taller */
const MARGIN_T = 10;
const W = useWidth(box), H = computed(() => (props.height ?? 150) + TIP_ROOM - MARGIN_T);
const base = computed(() => Math.max(1, W.value - P.l - P.r));
const hover = ref<number | null>(null);
const { sc, cls, on, cw: CW, left, pinned, pick } = useChartZoom({ box, base, pad: P.r,
  max: () => ((props.to - props.from) / 3600_000) * HOUR_PX / base.value, range: () => `${props.from}-${props.to}`, clear: () => (hover.value = null) });
const lh = computed(() => (H.value - P.t - P.b) / LANES.length);
// across the plot strip, which starts right of the lane names
const sx = (t: number) => ((t - props.from) / Math.max(1, props.to - props.from)) * (CW.value - P.r);
// a block sits in the middle of its lane, a little short of it so neighbouring lanes stay apart
const bh = computed(() => Math.max(6, lh.value * 0.62));
const by = (i: number) => P.t + i * lh.value + (lh.value - bh.value) / 2;
const blocks = computed(() => props.segs.map((s) => { const i = laneOf(s.k), x = sx(Math.max(s.a, props.from)); return { ...s, i, x, w: Math.max(1.5, sx(Math.min(s.b, props.to)) - x), y: by(i) }; }));
// where one stretch hands over to the next in another lane: a hairline from one lane to the other
const joins = computed(() => blocks.value.slice(1).map((s, j) => { const p = blocks.value[j]!; return p.i === s.i ? null : { x: s.x, y1: Math.min(p.y, s.y) + bh.value / 2, y2: Math.max(p.y, s.y) + bh.value / 2 }; }).filter((x) => !!x));
const t = (x: number) => fmt.value.time(new Date(x).toISOString());
// the caller's hours at 1x (lined up with the charts under it); zoomed in, as many as fit, on the clock's whole hours
// or minutes
const ticks = computed(() => {
  if (!on.value) return props.xt.map((x) => ({ x, a: x <= props.from ? "start" : x >= props.to ? "end" : "middle" }));
  const end = CW.value - P.r;
  return timeTicks(props.from, props.to, end, tickRoom(t(props.from)), false).map((x) => { const w = t(x).length * TICK_CH, at = sx(x); return { x, a: at - w / 2 < 0 ? "start" : at + w / 2 > end ? "end" : "middle" }; });
});
const { el: tipEl, style: tipStyle, span: tipSpan } = useTip(W);
// where the tip's foot sits: over its stretch; pinned, it rises above every stretch under its whole width, into the room
// kept at the chart's top, never covering one
const tipTop = (i: number) => {
  const b = blocks.value[i]!, at = (x: { x: number; w: number }) => P.l + x.x - left.value;
  if (!pinned.value) return b.y;
  const { lo, hi } = tipSpan(at(b) + b.w / 2);
  return blocks.value.reduce((t, x) => (at(x) < hi && at(x) + x.w > lo ? Math.min(t, x.y) : t), b.y);
};
// a pinned tip stays put while the mouse moves on (or a tap's compatibility mouse events come and go)
const enter = (i: number) => { if (!pinned.value) hover.value = i; };
const leave = () => { if (!pinned.value) hover.value = null; };
// a click or a tap pins the stretch's tip (useChartZoom) until a click or tap outside or a scroll; a stretch opens nothing,
// so its tip has no chevron and never takes the pointer
const click = (i: number) => { pick(i); hover.value = i; };
</script>

<template>
  <div ref="box" class="cht" style="position:relative" :style="{ '--tipup': TIP_ROOM - MARGIN_T + 'px' }">
    <div class="zrow">
      <!-- the lane names, still while the night scrolls -->
      <svg class="chart zfix" :viewBox="`0 0 ${P.l} ${H}`" :style="{ width: P.l + 'px', height: H + 'px' }" aria-hidden="true">
        <text v-for="(l, i) in LANES" :key="l.k" class="ax" :x="P.l - 6" :y="P.t + (i + 0.5) * lh + 3" text-anchor="end">{{ l.name }}</text>
      </svg>
      <div ref="sc" class="zsc" :class="cls">
        <svg class="chart" :viewBox="`0 0 ${CW} ${H}`" :style="{ height: H + 'px', ...(on ? { width: CW + 'px' } : {}) }" role="img" :aria-label="`Sleep stages, ${t(from)}-${t(to)}`" @mouseleave="leave" @click.self="pick(null)">
          <!-- gridlines, hours and joins let a tap through to the chart, so a tap on them is empty space, as on every chart -->
          <line v-for="(l, i) in LANES" :key="l.k" class="gl" :x1="0" :x2="CW - P.r" :y1="P.t + (i + 0.5) * lh" :y2="P.t + (i + 0.5) * lh" pointer-events="none" />
          <text v-for="x in ticks" :key="x.x" class="ax" :x="sx(x.x)" :y="H - 4" :text-anchor="x.a" pointer-events="none">{{ t(x.x) }}</text>
          <line v-for="(j, i) in joins" :key="'j' + i" class="hy-j" :x1="j.x" :x2="j.x" :y1="j.y1" :y2="j.y2" pointer-events="none" />
          <rect v-for="(b, i) in blocks" :key="i" :x="b.x" :y="b.y" :width="b.w" :height="bh" rx="2" :style="{ fill: segColor(b.k) }" :opacity="hover != null && hover !== i ? 0.55 : 1" @mouseenter="enter(i)" @click="click(i)" />
        </svg>
      </div>
    </div>
    <div v-if="hover != null && blocks[hover]" class="ctip" ref="tipEl" :style="tipStyle(P.l + blocks[hover]!.x + blocks[hover]!.w / 2 - left, tipTop(hover), false, pinned)">
      <b>{{ SEG_NAME[blocks[hover]!.k] }}</b><span class="sep">·</span><span class="ctip-r">{{ t(blocks[hover]!.a) }}-{{ t(blocks[hover]!.b) }} · {{ mins((blocks[hover]!.b - blocks[hover]!.a) / 60000) }}</span>
    </div>
  </div>
</template>

<style scoped>
.hy-j { stroke: var(--ol); stroke-width: 1; }
</style>
