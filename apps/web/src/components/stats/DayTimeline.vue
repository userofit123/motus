<script setup lang="ts">
// One day at a glance (the Calendar's day card): the day from midnight to midnight as one chart, a lane for each part
// the band saved (only those), named on the left as the Sleep night's lanes are: the night's stretches in their stage
// colours, the steps as a small bar an hour and the heart rate as a thin line, both in the day charts' own colour; the
// day's workouts and activities shaded across every lane in their Calendar colours with the strip along the top, as on
// the Stats day charts, and the same hour labels under it. A lane opens its Stats tab on this day (open), a shaded
// session opens the session (pick); the tip says what the band saved at that hour. It shows only what Stats' days show
// in full, so it stays small and points into them.
import { computed, ref } from "vue";
import { useWidth } from "../useWidth";
import { useTip } from "../useTip";
import { useFmt } from "../../core/format";
import { segColor, SEG_NAME } from "../../core/sleep";
import { dayHours, legendOf, DAY_DATA_COLOR, type DaySession } from "./daySessions";
import type { DayTimeline } from "./dayTimeline";

const props = defineProps<{ tl: DayTimeline; day: string; sessions: DaySession[] }>();
const emit = defineEmits<{ open: [tab: "sleep" | "steps" | "heart"]; pick: [id: string] }>();
const fmt = useFmt();
const box = ref<HTMLElement | null>(null);
// margins as LineChart's and the night's lanes, so the hours line up with the Stats day charts
const W = useWidth(box), P = { l: 44, r: 12, t: 8, b: 22 }, GAP = 6;
type Lane = { key: "sleep" | "steps" | "heart"; name: string; what: string; y: number; h: number };
const lanes = computed<Lane[]>(() => {
  const out: Lane[] = [];
  let y = P.t;
  const add = (key: Lane["key"], name: string, what: string, h: number) => { out.push({ key, name, what, y, h }); y += h + GAP; };
  if (props.tl.sleep.length) add("sleep", "Sleep", "Sleep", 20);
  if (props.tl.steps.length) add("steps", "Steps", "Steps", 34);
  if (props.tl.hr.length) add("heart", "Heart", "Heart rate", 34);
  return out;
});
const lane = (k: Lane["key"]) => lanes.value.find((l) => l.key === k);
const H = computed(() => { const l = lanes.value.at(-1); return (l ? l.y + l.h : P.t) + P.b; });
const sx = (t: number) => P.l + ((t - props.tl.from) / Math.max(1, props.tl.to - props.tl.from)) * (W.value - P.l - P.r);
const hourW = computed(() => sx(props.tl.from + 3600_000) - sx(props.tl.from));
const t = (ms: number) => fmt.value.time(new Date(ms).toISOString());

const sleepBlocks = computed(() => { const l = lane("sleep"); return l ? props.tl.sleep.map((s) => ({ ...s, x: sx(s.a), w: Math.max(1.5, sx(s.b) - sx(s.a)), y: l.y, h: l.h })) : []; });
const stepBars = computed(() => {
  const l = lane("steps"); if (!l) return [];
  const top = Math.max(1, ...props.tl.steps.map((s) => s.value)), bw = Math.max(2, Math.min(14, hourW.value * 0.6));
  return props.tl.steps.map((s) => { const h = Math.max(2, (s.value / top) * l.h); return { x: sx(s.a) + (hourW.value - bw) / 2, y: l.y + l.h - h, w: bw, h, rx: Math.min(5, bw / 3) }; });
});
// the line breaks where the band read nothing for over 15 minutes, as the Heart day's line
const hrPath = computed(() => {
  const l = lane("heart"); if (!l) return "";
  const ys = props.tl.hr.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys), pad = 2, span = Math.max(1, hi - lo);
  const y = (v: number) => l.y + pad + (1 - (v - lo) / span) * (l.h - 2 * pad);
  return props.tl.hr.map(([x, v], i) => `${!i || x - props.tl.hr[i - 1]![0] > 15 * 60000 ? "M" : "L"}${sx(x).toFixed(1)},${y(v).toFixed(1)}`).join("");
});
// a session at least 8px wide, so a 5-minute walk can still be tapped, as on the day charts
const SHADE_MIN = 8;
const shades = computed(() => props.sessions.filter((s) => s.b > s.a && s.b > props.tl.from && s.a < props.tl.to).map((s) => { const x = sx(Math.max(s.a, props.tl.from)); return { ...s, x, w: Math.max(SHADE_MIN, sx(Math.min(s.b, props.tl.to)) - x) }; }));
// the stages the night's lane shows, in the night's lane order, then a colour per kind of session, as the day charts' legends
const legend = computed(() => [
  ...(["awake", "rem", "light", "deep", "asleep"] as const).filter((k) => props.tl.sleep.some((s) => s.k === k)).map((k) => ({ color: segColor(k), name: SEG_NAME[k] })),
  ...legendOf(shades.value),
]);
const xt = computed(() => dayHours(props.day, fmt.value));

// the tip: what the band read in the hour under the pointer (the night's stage, the steps, the heart rate), the first in
// bold as every chart's tip, then the hour; a session names itself on its shade, so the tip stays one line on a phone
const hover = ref<number | null>(null);
const { el: tipEl, style: tipStyle } = useTip(W);
const move = (e: MouseEvent) => {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W.value;
  hover.value = x < P.l || x > W.value - P.r ? null : props.tl.from + ((x - P.l) / (W.value - P.l - P.r)) * (props.tl.to - props.tl.from);
};
const tip = computed(() => {
  const at = hover.value; if (at == null) return null;
  const h0 = new Date(at); h0.setMinutes(0, 0, 0);
  const a = h0.getTime(), parts: string[] = [];
  const seg = props.tl.sleep.find((s) => at >= s.a && at < s.b); if (seg) parts.push(SEG_NAME[seg.k]);
  const st = props.tl.steps.find((s) => s.a === a); if (st) parts.push(`${fmt.value.num(st.value, 0)} steps`);
  const near = props.tl.hr.reduce<[number, number] | null>((m, p) => (Math.abs(p[0] - at) <= 10 * 60000 && (!m || Math.abs(p[0] - at) < Math.abs(m[0] - at)) ? p : m), null); if (near) parts.push(`${near[1]} bpm`);
  return parts.length ? { x: sx(at), head: parts[0]!, rest: [...parts.slice(1), `${t(a)}-${t(a + 3600_000)}`] } : null;
});
</script>

<template>
  <div ref="box" class="dtl">
    <svg class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }" role="group" aria-label="Day by hour" @mousemove="move" @mouseleave="hover = null">
      <!-- each lane: its name, a faint line along its foot, and the whole lane a button into its Stats tab -->
      <g v-for="l in lanes" :key="l.key" class="dtl-lane" role="button" tabindex="0" :aria-label="`${l.what} on this day`" @click="emit('open', l.key)" @keydown.enter="emit('open', l.key)">
        <rect :x="P.l" :y="l.y - GAP / 2" :width="Math.max(0, W - P.l - P.r)" :height="l.h + GAP" fill="transparent" />
        <text class="ax" :x="P.l - 6" :y="l.y + l.h / 2 + 3" text-anchor="end">{{ l.name }}</text>
        <line v-if="l.key !== 'sleep'" class="gl" :x1="P.l" :x2="W - P.r" :y1="l.y + l.h" :y2="l.y + l.h" />
      </g>
      <g pointer-events="none">
        <rect v-for="(b, i) in sleepBlocks" :key="'z' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" rx="2" :style="{ fill: segColor(b.k) }" />
        <rect v-for="(b, i) in stepBars" :key="'s' + i" :x="b.x" :y="b.y" :width="b.w" :height="b.h" :rx="b.rx" :style="{ fill: DAY_DATA_COLOR }" />
        <path v-if="hrPath" :d="hrPath" class="dtl-hr" :style="{ stroke: DAY_DATA_COLOR }" />
      </g>
      <g v-for="z in shades" :key="z.key" class="dtl-sess" role="button" tabindex="0" :aria-label="`${z.name}, ${t(z.a)}-${t(z.b)}`" @click="emit('pick', z.key)" @keydown.enter="emit('pick', z.key)">
        <title>{{ z.name }}</title>
        <rect :x="z.x" :width="z.w" y="0" :height="H - P.b" :style="{ fill: `color-mix(in srgb, ${z.color} 16%, transparent)` }" />
        <rect :x="z.x" :width="z.w" y="0" height="3" rx="1.5" :style="{ fill: z.color }" />
      </g>
      <line v-if="tip" class="gl" :x1="tip.x" :x2="tip.x" :y1="P.t" :y2="H - P.b" pointer-events="none" />
      <text v-for="h in xt" :key="h.at" class="ax" :x="sx(h.at)" :y="H - 4" :text-anchor="h.at <= tl.from ? 'start' : 'middle'">{{ h.text }}</text>
    </svg>
    <div v-if="tip" ref="tipEl" class="ctip" :style="tipStyle(tip.x, P.t + 'px')"><b>{{ tip.head }}</b><template v-for="p in tip.rest" :key="p"> · {{ p }}</template></div>
    <div v-if="legend.length" class="bmlegend dtl-leg"><span v-for="k in legend" :key="k.name + k.color"><i :style="{ background: k.color }" />{{ k.name }}</span></div>
  </div>
</template>

<style scoped>
.dtl { position: relative; }
.dtl-lane, .dtl-sess { cursor: pointer; outline: none; }
.dtl-lane:focus-visible rect, .dtl-sess:focus-visible rect:first-of-type { stroke: var(--acc); stroke-width: 2; }
.dtl-hr { fill: none; stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
.dtl-leg { margin-top: var(--hg); }
</style>
