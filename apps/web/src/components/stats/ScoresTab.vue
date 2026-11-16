<script setup lang="ts">
// Stats → Scores (the Health scores feature, M-247): each score of the last 7 days as a tile, then its parts as rows with
// the guideline it is based on, as Home's score blocks show them. Recovery is Readiness (from your own usual), shown
// beside them rather than worked out a second way. Only scores whose data is there; the tab is absent without any.
import { computed } from "vue";
import { RECOVERY_BASIS } from "@motus/shared";
import SourceRow from "../learn/SourceRow.vue";
import { useHealthScores, useReadiness } from "../../api/queries";
import { useFmt } from "../../core/format";
import { SCORE_META, SCORE_KEYS, scoreRow, scoreWhy } from "../../core/scores";
import { readinessRows } from "../../core/readiness";
import Icon from "../Icon.vue";

const fmt = useFmt();
const num = (v: number) => fmt.value.num(v, 0);
const sq = useHealthScores();
const rq = useReadiness();
const scores = computed(() => SCORE_KEYS.flatMap((k) => { const s = sq.data.value?.[k]; return s ? [{ ...s, meta: SCORE_META[k] }] : []; }));
const ready = computed(() => (rq.data.value?.score != null ? rq.data.value : null));
// the number big and its word in the sub line, as the other tabs' tiles keep a long word ("Take it easy") out of the value
const tiles = computed(() => [
  ...scores.value.map((s) => ({ key: s.key, icon: s.meta.icon, label: s.meta.name, value: s.score, sub: `${s.label} · ${s.meta.span}` })),
  ...(ready.value ? [{ key: "recovery", icon: "gauge", label: "Readiness", value: ready.value.score!, sub: `${ready.value.label ? ready.value.label + " · " : ""}Today` }] : []),
]);
// Readiness's parts in the rows Home's Readiness block shows (core/readiness.ts)
const readyRows = computed(() => (ready.value ? readinessRows(ready.value, num) : []));
// the scores follow the adult guidelines: under 18 the server sends none and says why (minor); Readiness, from your
// own usual, still shows
const minor = computed(() => !!sq.data.value?.minor);
</script>

<template>
  <div v-if="sq.isLoading.value" class="empty">Loading…</div>
  <div v-else-if="minor && !tiles.length" class="card empty"><Icon name="gauge" :size="34" /><b>No scores under 18</b>The scores follow the guidelines for adults, which differ for children and teens.</div>
  <div v-else-if="!tiles.length" class="card empty"><Icon name="gauge" :size="34" /><b>No scores yet</b>Scores come once a week of sleep, steps, heart rate or workouts is in.</div>
  <template v-else>
    <!-- the scores' numbers, as Steps', Sleep's and Heart's tiles -->
    <div class="grid g4" :class="tiles.length < 4 ? `n${tiles.length}` : ''">
      <div v-for="(x, i) in tiles" :key="x.key" class="card stat" :class="{ hero: i === 0 }"><div class="lbl"><span class="bi"><Icon :name="x.icon" :size="15" /></span>{{ x.label }}</div>
        <div class="val">{{ x.value }}</div><div class="sub">{{ x.sub }}</div></div>
    </div>

    <!-- each score's parts as Stats → Heart's What stands out rows, then the row that opens what it is based on -->
    <div v-for="s in scores" :key="s.key" class="card wkc spt">
      <div class="ch"><span class="bi"><Icon :name="s.meta.icon" :size="15" /></span><span class="t grow">{{ s.meta.name }}</span><span class="tiny">{{ s.meta.span }}</span></div>
      <div class="tiny sc-why">{{ scoreWhy(s, num) }}</div>
      <div class="list sc-rows">
        <div v-for="x in s.parts.map((p) => scoreRow(p, num))" :key="x.key" class="li">
          <Icon :name="x.icon" :size="18" class="muted" />
          <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
          <b class="r rv" :class="x.tone">{{ x.r }}</b>
        </div>
        <SourceRow :topic="s.meta.lesson" :sources="s.meta.sources" />
      </div>
    </div>

    <!-- Readiness compares you with yourself, so it has no sources to open: its basis stays a plain line -->
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
      <div class="tiny sc-line">{{ RECOVERY_BASIS }}</div>
      <div v-if="minor" class="tiny sc-line">Sleep, activity and strength scores follow the adult guidelines, so they start at 18.</div>
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
