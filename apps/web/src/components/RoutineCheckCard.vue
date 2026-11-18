<script setup lang="ts">
// The Routine check (the Routine check feature, M-273) of a routine or a program's week: the score in a ring as Stats'
// day blocks show a goal, then each check as a row with what it found and what to change (as Stats → Scores' rows),
// then the row that opens the research behind it. The header has no icon, as its sibling cards on the Routine and
// Program pages. `muscles`: sets a week per muscle, for the figure where the page has
// none of its own (a program). The default slot goes first in the rows (a routine's "Times a week").
import { computed } from "vue";
import { CHECK_SOURCES, type CheckKey, type RoutineCheck } from "@motus/shared";
import Icon from "./Icon.vue";
import Ring from "./Ring.vue";
import BodyMap from "./BodyMap.vue";
import SourceRow from "./learn/SourceRow.vue";

const props = defineProps<{ check: RoutineCheck; title: string; span: string; muscles?: Record<string, number> }>();
const ICON: Record<CheckKey, string> = { volume: "activity", frequency: "calendar", pushPull: "swap", legs: "split", order: "arrowUp", reps: "refresh" };
// met in full reads positive, under half negative, as the score rows take their tone
const tone = (s: string) => (s === "good" ? "pos" : s === "low" ? "neg" : undefined);
const met = computed(() => props.check.checks.filter((c) => c.status === "good").length);
</script>

<template>
  <div class="card wkc">
    <div class="ch"><span class="t grow">{{ title }}</span><span class="tiny">{{ span }}</span></div>
    <div class="gs-top">
      <Ring :pct="check.score / 100" :size="64" :stroke="7" :done="check.score >= 100" />
      <div class="grow"><div class="gs-val">{{ check.score }}<small>{{ check.label }}</small></div>
        <div class="tiny">{{ met }} of {{ check.checks.length }} checks met</div></div>
    </div>
    <div v-if="muscles" class="csec"><div class="lbl hgap">Sets a week per muscle</div><BodyMap :values="muscles" :height="190" legend /></div>
    <div class="list crows csec">
      <slot />
      <div v-for="c in check.checks" :key="c.key" class="li">
        <Icon :name="ICON[c.key]" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ c.title }}</div><div class="s">{{ c.detail }}</div></div>
        <b class="r rv" :class="tone(c.status)">{{ c.value }}</b>
      </div>
      <SourceRow topic="routineCheck" :sources="CHECK_SOURCES" />
    </div>
  </div>
</template>
