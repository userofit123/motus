<script setup lang="ts">
// A night's stages across its hours, as tracker apps draw them: a lane each for awake, REM, light and deep (top to
// bottom, so deeper sleep sits lower), each stretch a block in its stage's colour in its lane, thin joins between one
// stretch and the next so the night reads as one line. Styled as LineChart (same margins, gridlines and axis text), so
// it lines up with the heart rate, blood oxygen and breathing charts under it; a stretch's tip gives its stage and times.
import { computed, ref } from "vue";
import { useWidth } from "../useWidth";
import { useTip } from "../useTip";
import { useFmt } from "../../core/format";
import { LANES, laneOf, segColor, SEG_NAME, mins, type Seg } from "../../core/sleep";

const props = defineProps<{ segs: Seg[]; from: number; to: number; xt: number[]; height?: number }>();
const fmt = useFmt();
const box = ref<HTMLElement | null>(null);
const W = useWidth(box), H = computed(() => props.height ?? 150), P = { l: 44, r: 12, t: 10, b: 22 };
const lh = computed(() => (H.value - P.t - P.b) / LANES.length);
const sx = (t: number) => P.l + ((t - props.from) / Math.max(1, props.to - props.from)) * (W.value - P.l - P.r);
// a block sits in the middle of its lane, a little short of it so neighbouring lanes stay apart
const bh = computed(() => Math.max(6, lh.value * 0.62));
const by = (i: number) => P.t + i * lh.value + (lh.value - bh.value) / 2;
const blocks = computed(() => props.segs.map((s) => { const i = laneOf(s.k), x = sx(Math.max(s.a, props.from)); return { ...s, i, x, w: Math.max(1.5, sx(Math.min(s.b, props.to)) - x), y: by(i) }; }));
// where one stretch hands over to the next in another lane: a hairline from one lane to the other
const joins = computed(() => blocks.value.slice(1).map((s, j) => { const p = blocks.value[j]!; return p.i === s.i ? null : { x: s.x, y1: Math.min(p.y, s.y) + bh.value / 2, y2: Math.max(p.y, s.y) + bh.value / 2 }; }).filter((x) => !!x));
const t = (x: number) => fmt.value.time(new Date(x).toISOString());
const hover = ref<number | null>(null);
const { el: tipEl, style: tipStyle } = useTip(W);
</script>

<template>
  <div ref="box" style="position:relative">
    <svg class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }" role="img" :aria-label="`Sleep stages, ${t(from)}-${t(to)}`" @mouseleave="hover = null">
      <g v-for="(l, i) in LANES" :key="l.k"><line class="gl" :x1="P.l" :x2="W - P.r" :y1="P.t + (i + 0.5) * lh" :y2="P.t + (i + 0.5) * lh" /><text class="ax" :x="P.l - 6" :y="P.t + (i + 0.5) * lh + 3" text-anchor="end">{{ l.name }}</text></g>
      <text v-for="x in xt" :key="x" class="ax" :x="sx(x)" :y="H - 4" :text-anchor="x <= from ? 'start' : x >= to ? 'end' : 'middle'">{{ t(x) }}</text>
      <line v-for="(j, i) in joins" :key="'j' + i" class="hy-j" :x1="j.x" :x2="j.x" :y1="j.y1" :y2="j.y2" />
      <rect v-for="(b, i) in blocks" :key="i" :x="b.x" :y="b.y" :width="b.w" :height="bh" rx="2" :style="{ fill: segColor(b.k) }" :opacity="hover != null && hover !== i ? 0.55 : 1" @mouseenter="hover = i" />
    </svg>
    <div v-if="hover != null && blocks[hover]" class="ctip" ref="tipEl" :style="tipStyle(blocks[hover]!.x + blocks[hover]!.w / 2, blocks[hover]!.y + 'px')">
      <b>{{ SEG_NAME[blocks[hover]!.k] }}</b> · {{ t(blocks[hover]!.a) }}-{{ t(blocks[hover]!.b) }} · {{ mins((blocks[hover]!.b - blocks[hover]!.a) / 60000) }}
    </div>
  </div>
</template>

<style scoped>
.hy-j { stroke: var(--ol); stroke-width: 1; }
</style>
