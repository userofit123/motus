<script setup lang="ts">
// Bars per period (workouts per week, sets per muscle…), with an optional target band. A bar's `tip` names it in the
// hover tip when its axis label alone ("3") wouldn't say what it is; its `full` name ("8 Nov") is the axis label when the
// chart has only a few bars, its `short` one ("N") when a grouped chart is too narrow for the usual one. A bar's `group` ("2026") is a second axis line, shown
// where it changes, so a run of months says which year each is in; `values` prints each bar's value above it. A bar's
// `parts` stack inside it from the bottom (a night's sleep stages), each in its own colour; a bar with an `id` can be
// clicked (pick), as a LineChart's points.
import { computed, ref, useId } from "vue";
import { useWidth } from "./useWidth";
const props = defineProps<{ bars: { label: string; value: number; dim?: boolean; color?: string; tip?: string; group?: string; short?: string; full?: string; parts?: { value: number; color: string }[]; id?: string }[]; height?: number; fmt?: (v: number) => string; band?: [number, number]; horizontal?: boolean; goal?: number; values?: boolean }>();
const emit = defineEmits<{ pick: [id: string] }>();
const uid = useId();
// a stacked bar's parts, bottom up: where each starts and ends
const stack = (parts: { value: number; color: string }[]) => { let at = 0; return parts.filter((p) => p.value > 0).map((p) => ({ color: p.color, lo: at, hi: (at += p.value) })); };
const H = computed(() => props.height ?? 160);
const max = computed(() => Math.max(1, ...props.bars.map((b) => b.value), props.band?.[1] ?? 0, props.goal ?? 0));
const hover = ref<number | null>(null);
const box = ref<HTMLElement | null>(null);
const W = useWidth(box);
const slot = computed(() => W.value / Math.max(1, props.bars.length));
const bw = computed(() => Math.max(4, Math.min(28, slot.value * 0.6)));
const grouped = computed(() => props.bars.some((b) => b.group));
// a short range (a lone week) names its bars in full ("8 Nov"), since a bare "8" doesn't say what it is
const long = computed(() => props.bars.length <= 3 && props.bars.some((b) => b.full));
// skip labels when they would crowd each other. A chart with a group line (months over years) sizes the room by its
// labels' length (about 6.5px a character at the axis size), so every month gets its name on a phone; when even that
// doesn't fit, its narrow names ("J", "F") are used before any are skipped
const room = (text: (b: (typeof props.bars)[number]) => string) => Math.max(...props.bars.map((b) => text(b).length)) * 6.5 + 4;
const narrow = computed(() => grouped.value && props.bars.every((b) => b.short) && room((b) => b.label) > slot.value);
const text = (b: (typeof props.bars)[number]) => (long.value ? b.full ?? b.label : narrow.value ? b.short! : b.label);
const every = computed(() => Math.max(1, Math.ceil((grouped.value || long.value ? room(text) : 34) / slot.value)));
const named = (i: number) => i % every.value === (props.bars.length - 1) % every.value;
// room under the bars for the labels (and the group line), and over them for the values
const bottom = computed(() => (grouped.value ? 32 : 18));
const top = computed(() => (props.values ? 18 : 8));
const y = (v: number) => H.value - bottom.value - (v / max.value) * (H.value - bottom.value - top.value);
// the group's name sits under its first named bar (so it always has a label over it), left out when the next group's
// name comes too close for both to fit ("2025" over a lone December beside "2026" on a phone)
const begins = (i: number) => {
  const g = props.bars[i]?.group;
  if (!g || !named(i)) return false;
  for (let j = i - 1; j >= 0 && props.bars[j]!.group === g; j--) if (named(j)) return false;
  return true;
};
const starts = (i: number) => {
  if (!begins(i)) return false;
  const next = props.bars.findIndex((_, j) => j > i && begins(j));
  return next < 0 || (next - i) * slot.value >= 34;
};
// the group's name starts at its bar's left edge, or ends at its right edge when it would run past the chart's
const GW = 30;
const gx = (i: number) => (i * slot.value + (slot.value - bw.value) / 2 + GW > W.value ? { x: i * slot.value + (slot.value + bw.value) / 2, a: "end" } : { x: i * slot.value + (slot.value - bw.value) / 2, a: "start" });
const f = (v: number) => (props.fmt ? props.fmt(v) : String(Math.round(v * 10) / 10));
</script>

<template>
  <div v-if="horizontal" class="col" style="gap:8px">
    <div v-for="(b, i) in bars" :key="i" class="row" style="gap:10px">
      <span class="tiny" style="width:96px;flex:none;text-transform:capitalize">{{ b.label }}</span>
      <div class="pbar grow" style="height:10px;position:relative">
        <i :style="{ width: (b.value / max) * 100 + '%', background: b.color }" />
        <span v-if="band" :style="{ position: 'absolute', top: 0, bottom: 0, left: (band[0] / max) * 100 + '%', width: ((band[1] - band[0]) / max) * 100 + '%', border: '1px dashed var(--ol)', borderRadius: '6px' }" />
      </div>
      <span class="num tiny" style="width:42px;text-align:end;color:var(--tx)">{{ f(b.value) }}</span>
    </div>
  </div>
  <div v-else ref="box" style="position:relative">
    <svg class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }">
      <rect v-if="band" x="0" :width="W" :y="y(band[1])" :height="y(band[0]) - y(band[1])" fill="var(--pos)" opacity=".08" />
      <line class="gl" x1="0" :x2="W" :y1="H - bottom" :y2="H - bottom" />
      <line v-if="goal" class="goal" x1="0" :x2="W" :y1="y(goal)" :y2="y(goal)" />
      <g v-for="(b, i) in bars" :key="i" :style="b.id ? { cursor: 'pointer' } : undefined" @mouseenter="hover = i" @mouseleave="hover = null" @click="b.id && emit('pick', b.id)">
        <rect :x="i * slot" :width="slot" y="0" :height="H" fill="transparent" />
        <template v-if="b.parts && b.value > 0">
          <clipPath :id="`${uid}-${i}`"><rect :x="i * slot + (slot - bw) / 2" :width="bw" :y="y(b.value)" :height="Math.max(2, H - bottom - y(b.value))" :rx="Math.min(5, bw / 3)" /></clipPath>
          <g :clip-path="`url(#${uid}-${i})`"><rect v-for="(p, j) in stack(b.parts)" :key="j" :x="i * slot + (slot - bw) / 2" :width="bw" :y="y(p.hi)" :height="y(p.lo) - y(p.hi)" :style="{ fill: p.color }" /></g>
        </template>
        <rect v-else-if="b.value > 0" class="cbar" :data-dim="b.dim ? 1 : undefined" :x="i * slot + (slot - bw) / 2" :width="bw" :y="y(b.value)" :height="Math.max(2, H - bottom - y(b.value))" :rx="Math.min(5, bw / 3)" :style="b.color ? { fill: b.color } : undefined" />
        <text v-if="values && b.value > 0" class="ax bv" :x="i * slot + slot / 2" :y="y(b.value) - 5" text-anchor="middle">{{ f(b.value) }}</text>
        <text v-if="named(i)" class="ax" :x="i * slot + slot / 2" :y="H - bottom + 14" text-anchor="middle">{{ text(b) }}</text>
        <text v-if="starts(i)" class="ax grp" :x="gx(i).x" :y="H - 4" :text-anchor="gx(i).a">{{ b.group }}</text>
      </g>
    </svg>
    <div v-if="hover != null" class="ctip" :style="{ left: ((hover + 0.5) / bars.length) * 100 + '%', top: y(bars[hover]!.value) + 'px' }"><b>{{ f(bars[hover]!.value) }}</b> · {{ bars[hover]!.tip ?? bars[hover]!.full ?? bars[hover]!.label }}</div>
  </div>
</template>

<style scoped>
/* a bar's value reads as the number it is, the year line as the heading of the months above it */
.chart .bv { fill: var(--tx); font-weight: 600; font-variant-numeric: tabular-nums; }
.chart .grp { font-weight: 600; }
</style>
