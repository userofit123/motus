<script setup lang="ts">
// Stats → Scores (the Health scores feature, M-247): each score of the last 7 days as a tile, then its parts as rows with
// the guideline it is based on, as Home's score blocks show them. Recovery is Readiness (from your own usual), shown
// beside them rather than worked out a second way. Only scores whose data is there; the tab is absent without any.
import { computed } from "vue";
import { SCORE_SOURCES } from "@motus/shared";
import { useHealthScores, useReadiness, type ReadinessPart } from "../../api/queries";
import { useFmt } from "../../core/format";
import { mins } from "../../core/sleep";
import { SCORE_META, SCORE_KEYS, scoreRow, scoreWhy, type ScoreRow } from "../../core/scores";
import Icon from "../Icon.vue";

const fmt = useFmt();
const num = (v: number) => fmt.value.num(v, 0);
const sq = useHealthScores();
const rq = useReadiness();
const scores = computed(() => SCORE_KEYS.flatMap((k) => { const s = sq.data.value?.[k]; return s ? [{ ...s, meta: SCORE_META[k] }] : []; }));
const ready = computed(() => (rq.data.value?.score != null ? rq.data.value : null));
const tiles = computed(() => [
  ...scores.value.map((s) => ({ key: s.key, icon: s.meta.icon, label: s.meta.name, value: s.score, unit: s.label, sub: s.meta.span })),
  ...(ready.value ? [{ key: "recovery", icon: "gauge", label: "Readiness", value: ready.value.score!, unit: ready.value.label ?? "", sub: "Today" }] : []),
]);
// Readiness's parts as rows, in the words Home's Readiness block uses: the value against your usual and how far off it is
const PART: Record<ReadinessPart["key"], { icon: string; t: string; f: (v: number) => string }> = {
  sleep: { icon: "moon", t: "Sleep", f: (h) => mins(h * 60) }, restingHr: { icon: "heartPulse", t: "Resting heart rate", f: (v) => `${Math.round(v)} bpm` },
  hrv: { icon: "wave", t: "HRV", f: (v) => `${Math.round(v)} ms` }, load: { icon: "load", t: "Training load", f: (v) => `${num(v)} in 7 days` },
};
const readyRows = computed<ScoreRow[]>(() => (ready.value?.parts ?? []).filter((x) => x.value != null && x.baseline != null).map((x) => {
  const p = PART[x.key];
  const off = x.key === "load" ? `${x.change! < 0 ? "-" : "+"}${Math.abs(Math.round(x.change!))}%` : `${x.value! - x.baseline! < 0 ? "-" : "+"}${p.f(Math.abs(x.value! - x.baseline!))}`;
  return { key: x.key, icon: p.icon, t: p.t, s: `${p.f(x.value!)} · usual ${x.key === "load" ? `${num(x.baseline!)} a week` : p.f(x.baseline!)}`,
    r: x.effect === "flat" ? "As usual" : off, tone: x.effect === "up" ? "pos" : x.effect === "down" ? "neg" : undefined };
}));
</script>

<template>
  <div v-if="sq.isLoading.value" class="empty">Loading…</div>
  <div v-else-if="!tiles.length" class="card empty"><Icon name="gauge" :size="34" /><b>No scores yet</b>Scores come once a week of sleep, steps, heart rate or workouts is in.</div>
  <template v-else>
    <!-- the scores' numbers, as Steps', Sleep's and Heart's tiles -->
    <div class="grid g4" :class="tiles.length < 4 ? `n${tiles.length}` : ''">
      <div v-for="(x, i) in tiles" :key="x.key" class="card stat" :class="{ hero: i === 0 }"><div class="lbl"><span class="bi"><Icon :name="x.icon" :size="15" /></span>{{ x.label }}</div>
        <div class="val">{{ x.value }}<small>{{ x.unit }}</small></div><div class="sub">{{ x.sub }}</div></div>
    </div>

    <!-- each score's parts as Stats → Heart's What stands out rows, then why and what it is based on -->
    <div v-for="s in scores" :key="s.key" class="card wkc spt">
      <div class="ch"><span class="bi"><Icon :name="s.meta.icon" :size="15" /></span><span class="t grow">{{ s.meta.name }}</span><span class="tiny">{{ s.meta.span }}</span></div>
      <div class="tiny sc-why">{{ scoreWhy(s, num) }}</div>
      <div class="list sc-rows">
        <div v-for="x in s.parts.map((p) => scoreRow(p, num))" :key="x.key" class="li">
          <Icon :name="x.icon" :size="18" class="muted" />
          <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
          <b class="r rv" :class="x.tone">{{ x.r }}</b>
        </div>
      </div>
      <div class="tiny sc-line">{{ s.meta.source }}</div>
    </div>

    <div v-if="ready" class="card wkc spt">
      <div class="ch"><span class="bi"><Icon name="gauge" :size="15" /></span><span class="t grow">Readiness</span><span class="tiny">Vs your usual</span></div>
      <div v-if="ready.why" class="tiny sc-why">{{ ready.why }}</div>
      <div v-if="readyRows.length" class="list sc-rows">
        <div v-for="x in readyRows" :key="x.key" class="li">
          <Icon :name="x.icon" :size="18" class="muted" />
          <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
          <b class="r rv" :class="x.tone">{{ x.r }}</b>
        </div>
      </div>
      <div class="tiny sc-line">{{ SCORE_SOURCES.recovery }}</div>
    </div>
  </template>
</template>

<style scoped>
.sc-line { margin-top: var(--tdy); }
/* why under the title and above the rows, as on Home's score blocks */
.sc-why { margin-bottom: var(--cpy); }
/* the rows as Stats → Heart's highlights: the first without space above, the last without its line */
.sc-rows .li:first-child { padding-top: 0; }
.sc-rows .li:last-child { border-bottom: 0; padding-bottom: 0; }
.sc-rows .grow { min-width: 0; }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
