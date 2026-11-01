<script setup lang="ts">
// Bars per period (workouts per week, sets per muscle…), with an optional target band.
import { computed, ref } from "vue";
const props = defineProps<{ bars: { label: string; value: number; dim?: boolean; color?: string }[]; height?: number; fmt?: (v: number) => string; band?: [number, number]; horizontal?: boolean }>();
const H = computed(() => props.height ?? 160);
const max = computed(() => Math.max(1, ...props.bars.map((b) => b.value), props.band?.[1] ?? 0));
const hover = ref<number | null>(null);
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
  <div v-else style="position:relative">
    <svg class="chart" :viewBox="`0 0 ${bars.length * 40} ${H}`" preserveAspectRatio="none" :style="{ height: H + 'px' }">
      <rect v-if="band" :x="0" :width="bars.length * 40" :y="H - 18 - (band[1] / max) * (H - 26)" :height="((band[1] - band[0]) / max) * (H - 26)" fill="var(--pos)" opacity=".08" />
      <g v-for="(b, i) in bars" :key="i" @mouseenter="hover = i" @mouseleave="hover = null">
        <rect v-if="b.value > 0" class="bar" :class="{ dim: b.dim }" :x="i * 40 + 8" :width="24" :y="H - 18 - (b.value / max) * (H - 26)" :height="Math.max(b.value ? 2 : 0, (b.value / max) * (H - 26))" rx="5" :style="b.color ? { fill: b.color } : undefined" />
        <text class="ax" :x="i * 40 + 20" :y="H - 4" text-anchor="middle">{{ b.label }}</text>
      </g>
    </svg>
    <div v-if="hover != null" class="ctip" :style="{ left: ((hover + 0.5) / bars.length) * 100 + '%', top: '20%' }"><b>{{ f(bars[hover]!.value) }}</b></div>
  </div>
</template>
