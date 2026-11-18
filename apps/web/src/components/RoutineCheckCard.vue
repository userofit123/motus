<script setup lang="ts">
// The Routine check (the Routine check feature, M-273) of a routine or a program's week: the score in a ring as Stats'
// day blocks show a goal, then each check as a row with what it found and what to change (as Stats → Scores' rows),
// then the row that opens the research behind it. The header has no icon, as its sibling cards on the Routine and
// Program pages. `muscles`: sets a week per muscle, for the figure where the page has none of its own (a program): on
// the left of the score, as the Routines list's routine cards (CLAUDE.md figure rule). `source`: what the week is
// built from, under the score (a routine's times a week).
import { computed } from "vue";
import { CHECK_SOURCES, type CheckKey, type RoutineCheck } from "@motus/shared";
import Icon from "./Icon.vue";
import Ring from "./Ring.vue";
import BodyMap from "./BodyMap.vue";
import SourceRow from "./learn/SourceRow.vue";

// muscles: the figure's main and helper muscles (the routine card's look) and each one's sets a week for its tips
const props = defineProps<{ check: RoutineCheck; title: string; span: string; muscles?: { sets: Record<string, number>; primary: string[]; secondary: string[] }; source?: string }>();
const ICON: Record<CheckKey, string> = { volume: "activity", frequency: "calendar", pushPull: "swap", legs: "split", order: "arrowUp", reps: "refresh" };
// met in full reads positive, under half negative, as the score rows take their tone
const tone = (s: string) => (s === "good" ? "pos" : s === "low" ? "neg" : undefined);
const met = computed(() => props.check.checks.filter((c) => c.status === "good").length);
</script>

<template>
  <div class="card wkc">
    <div class="ch"><span class="t grow">{{ title }}</span><span class="tiny">{{ span }}</span></div>
    <div class="rtop">
      <BodyMap v-if="muscles" class="rbody" :values="muscles.sets" :highlight="muscles.primary" :secondary="muscles.secondary" />
      <div class="gs-top grow">
        <Ring :pct="check.score / 100" :size="64" :stroke="7" :done="check.score >= 100" />
        <div class="grow"><div class="gs-val">{{ check.score }}<small>{{ check.label }}</small></div>
          <div v-if="source" class="tiny">{{ source }}</div>
          <div class="tiny">{{ met }} of {{ check.checks.length }} checks met</div></div>
      </div>
    </div>
    <div class="list crows csec">
      <div v-for="c in check.checks" :key="c.key" class="li">
        <Icon :name="ICON[c.key]" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ c.title }}</div><div class="s">{{ c.detail }}</div></div>
        <b class="r rv" :class="tone(c.status)">{{ c.value }}</b>
      </div>
      <SourceRow topic="routineCheck" :sources="CHECK_SOURCES" />
    </div>
  </div>
</template>

<style scoped>
/* the figure on the left and the score on the right, the score centred on the figure's height */
.rtop { display: flex; align-items: stretch; gap: var(--cpx); }
/* beside the figure the ring keeps the in-block gap, so the score fits at phone width */
.rtop > .gs-top { min-width: 0; gap: var(--cpx); }
</style>
