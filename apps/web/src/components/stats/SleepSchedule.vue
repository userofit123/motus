<script setup lang="ts">
// When each night began and ended: one bar per night from bedtime (top) to getting up (bottom), on the hours of the
// night, so an even schedule reads as a level row of bars. Styled as BarChart (gridlines, axis text, bars, tip); a
// night can be clicked (pick) to open it.
import { computed, ref } from "vue";
import { useWidth } from "../useWidth";
import { useFmt } from "../../core/format";
import { nightMin, nightIso } from "../../core/sleep";

const props = defineProps<{ nights: { date: string; startAt: string; endAt: string }[]; height?: number }>();
const emit = defineEmits<{ pick: [date: string] }>();
const fmt = useFmt();
const box = ref<HTMLElement | null>(null);
const W = useWidth(box), H = computed(() => props.height ?? 170);
const P = { l: 44, t: 8, b: 20 };
// oldest on the left
const rows = computed(() => [...props.nights].sort((a, b) => a.date.localeCompare(b.date)).map((n) => {
  const a = nightMin(n.startAt);
  let b = nightMin(n.endAt);
  if (b < a) b += 1440; // got up after noon
  return { ...n, a, b };
}));
// whole hours around the earliest bedtime and the latest getting up
const dom = computed(() => {
  const r = rows.value;
  const lo = Math.floor(Math.min(...r.map((x) => x.a)) / 60) * 60, hi = Math.ceil(Math.max(...r.map((x) => x.b)) / 60) * 60;
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
const day = (d: string) => fmt.value.date(d, { day: "numeric", month: "short" });
// first and last night under the axis, and the middle one when there is room
const named = computed(() => {
  const n = rows.value.length, out = new Set([0, n - 1]);
  if (n > 2 && W.value - P.l > 220) out.add(Math.floor((n - 1) / 2));
  return out;
});
const hover = ref<number | null>(null);
</script>

<template>
  <div ref="box" style="position:relative">
    <svg v-if="rows.length" class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }" @mouseleave="hover = null">
      <g v-for="t in ticks" :key="t"><line class="gl" :x1="P.l" :x2="W" :y1="y(t)" :y2="y(t)" /><text class="ax" :x="P.l - 6" :y="y(t) + 3" text-anchor="end">{{ clock(t) }}</text></g>
      <g v-for="(r, i) in rows" :key="r.date" style="cursor:pointer" @mouseenter="hover = i" @click="emit('pick', r.date)">
        <rect :x="P.l + i * slot" :width="slot" :y="0" :height="H" fill="transparent" />
        <rect class="cbar" :x="P.l + i * slot + (slot - bw) / 2" :width="bw" :y="y(r.a)" :height="Math.max(2, y(r.b) - y(r.a))" :rx="Math.min(5, bw / 3)" />
        <text v-if="named.has(i)" class="ax" :x="P.l + i * slot + slot / 2" :y="H - 4" :text-anchor="i === 0 && rows.length > 1 ? 'start' : i === rows.length - 1 && rows.length > 1 ? 'end' : 'middle'">{{ day(r.date) }}</text>
      </g>
    </svg>
    <div v-if="hover != null && rows[hover]" class="ctip" :style="{ left: ((P.l + (hover + 0.5) * slot) / W) * 100 + '%', top: y(rows[hover]!.a) + 'px' }">
      <b>{{ fmt.time(rows[hover]!.startAt) }}-{{ fmt.time(rows[hover]!.endAt) }}</b> · {{ day(rows[hover]!.date) }}
    </div>
  </div>
</template>
