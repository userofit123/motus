<script setup lang="ts">
// A night's stages as one bar (deep, light, REM, awake side by side, each as long as its share of the night) with the
// minutes under it, each with its colour dot. Only the stages the band told apart. parts: other minutes shown the same
// way instead of a night's (a day's time in heart rate zones, Stats → Heart), each with where it starts (from, "130+")
// after its name. A part under a minute stays, as "<1m", so a short spike still shows.
import { computed } from "vue";
import type { SleepNight } from "../../api/queries";
import { STAGES, mins } from "../../core/sleep";

type Part = { key: string; name: string; color: string; from?: string; min: number };
const props = defineProps<{ night?: SleepNight; parts?: Part[] }>();
const parts = computed<Part[]>(() => (props.parts ?? STAGES.map((s) => ({ key: s.key as string, name: s.name, color: s.color as string, min: props.night?.[s.key] ?? 0 }))).filter((p) => p.min > 0));
const total = computed(() => parts.value.reduce((t, p) => t + p.min, 0));
const dur = (m: number) => (Math.round(m) ? mins(m) : "<1m");
const pc = (m: number) => { const v = Math.round((m / total.value) * 100); return v ? `${v}%` : "<1%"; };
</script>

<template>
  <div v-if="total" class="stg">
    <div class="stg-bar" role="img" :aria-label="parts.map((p) => `${p.name}${p.from ? ` ${p.from} bpm` : ''} ${dur(p.min)}`).join(', ')">
      <i v-for="p in parts" :key="p.key" :style="{ flexGrow: p.min, background: p.color }" :title="`${p.name} ${dur(p.min)}`" />
    </div>
    <div class="stg-leg tiny">
      <span v-for="p in parts" :key="p.key" class="stg-k"><i :style="{ background: p.color }" />{{ p.name }}<template v-if="p.from"><span class="stg-from">{{ p.from }}</span><span class="sep">·</span></template><b>{{ dur(p.min) }}</b><span class="stg-pc">{{ pc(p.min) }}</span></span>
    </div>
  </div>
</template>

<style scoped>
/* the bar is as thick as the app's progress bars doubled, so the short stages still show; a hairline of the card
   between the parts keeps two pale ones apart */
.stg-bar { display: flex; gap: 2px; height: 16px; border-radius: 8px; overflow: hidden; background: var(--s2); }
.stg-bar i { display: block; min-width: 3px; flex-basis: 0; }
.stg-leg { display: flex; flex-wrap: wrap; gap: var(--tdy) var(--hg); margin-top: var(--hg); }
.stg-k { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.stg-k b { color: var(--tx); font-weight: 600; font-variant-numeric: tabular-nums; }
.stg-pc, .stg-from { font-variant-numeric: tabular-nums; }
/* the swatch as a chart legend's (.bmlegend) */
.stg-k i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
</style>
