<script setup lang="ts">
// Stats → Scores (the Health scores feature, M-247): each score of the last 7 days as a block with its number, word and
// ring, then its parts as rows with the guideline it is based on, as Home's score blocks show them. Each block carries its
// own number (M-269), so there are no tiles above repeating them: reading a block never means scrolling back up. Recovery is Readiness (from your own usual), shown
// beside them rather than worked out a second way. Only scores whose data is there; the tab is absent without any. With
// the Health scores feature off the tab holds Readiness alone (it is no feature), and the scores aren't asked for.
import { computed } from "vue";
import { RECOVERY_BASIS } from "@motus/shared";
import SourceRow from "../learn/SourceRow.vue";
import { useHealthScores, useReadiness, useSettings } from "../../api/queries";
import { useFmt } from "../../core/format";
import { SCORE_META, SCORE_KEYS, scoreRow, scoreWhy } from "../../core/scores";
import { readinessRows } from "../../core/readiness";
import Icon from "../Icon.vue";
import ScoreHead from "./ScoreHead.vue";

const fmt = useFmt();
const num = (v: number) => fmt.value.num(v, 0);
const settings = useSettings();
// a disabled query still hands back what it had cached, so the scores are read only while the feature is on
const on = computed(() => !!settings.value.features.scores);
const sq = useHealthScores(on);
const rq = useReadiness();
const scores = computed(() => SCORE_KEYS.flatMap((k) => { const s = on.value && sq.data.value?.[k]; return s ? [{ ...s, meta: SCORE_META[k] }] : []; }));
const ready = computed(() => (rq.data.value?.score != null ? rq.data.value : null));
const any = computed(() => scores.value.length > 0 || !!ready.value);
// Readiness's parts in the rows Home's Readiness block shows (core/readiness.ts)
const readyRows = computed(() => (ready.value ? readinessRows(ready.value, num) : []));
// the scores follow the adult guidelines: under 18 the server sends none and says why (minor); Readiness, from your
// own usual, still shows
const minor = computed(() => on.value && !!sq.data.value?.minor);
</script>

<template>
  <div v-if="sq.isLoading.value || rq.isLoading.value" class="empty">Loading…</div>
  <div v-else-if="minor && !any" class="card empty"><Icon name="gauge" :size="34" /><b>No scores under 18</b>The scores follow the guidelines for adults, which differ for children and teens.</div>
  <div v-else-if="!any" class="card empty"><Icon name="gauge" :size="34" /><b>No scores yet</b>Scores come once a week of sleep, steps, heart rate or workouts is in.</div>
  <template v-else>
    <!-- each score as Home's score block: its number with its word and ring, the line that says why, then its parts as
         Stats → Heart's What stands out rows, and the row that opens what it is based on -->
    <div v-for="(s, i) in scores" :key="s.key" class="card wkc" :class="{ spt: i > 0 }">
      <div class="ch"><span class="bi"><Icon :name="s.meta.icon" :size="15" /></span><span class="t grow">{{ s.meta.name }}</span><span class="tiny">{{ s.meta.span }}</span></div>
      <ScoreHead :score="s.score" :label="s.label" :warn="s.label === 'Low'" />
      <div class="tiny sc-why">{{ scoreWhy(s, num) }}</div>
      <div class="list crows">
        <div v-for="x in s.parts.map((p) => scoreRow(p, num))" :key="x.key" class="li">
          <Icon :name="x.icon" :size="18" class="muted" />
          <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
          <b class="r rv" :class="x.tone">{{ x.r }}</b>
        </div>
        <SourceRow :topic="s.meta.lesson" :sources="s.meta.sources" />
      </div>
    </div>

    <!-- Readiness compares you with yourself, so it has no sources to open: its basis stays a plain line -->
    <div v-if="ready" class="card wkc" :class="{ spt: scores.length }">
      <div class="ch"><span class="bi"><Icon name="gauge" :size="15" /></span><span class="t grow">Readiness</span><span class="tiny">Vs your 28-day usual</span></div>
      <ScoreHead :score="ready.score!" :label="ready.label" :warn="ready.label === 'Take it easy'" />
      <div v-if="ready.why" class="tiny sc-why">{{ ready.why }}</div>
      <div v-if="readyRows.length" class="list crows" :class="{ 'sc-gap': !ready.why }">
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
/* why under the score and above the rows, as on Home's score blocks */
.sc-why { margin-top: var(--tdy); margin-bottom: var(--cpy); }
/* without a why line the rows keep the same space under the score */
.sc-gap { margin-top: var(--cpy); }
</style>
