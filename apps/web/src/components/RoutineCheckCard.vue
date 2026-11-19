<script setup lang="ts">
// The Routine check (the Routine check feature, M-273) of a routine or a program's week: the score in a ring as Stats'
// day blocks show a goal, then each check as a row with what it found and what to change (as Stats → Scores' rows),
// then the row that opens the research behind it. The header has no icon, as its sibling cards on the Routine and
// Program pages. `muscles`: sets a week per muscle, for the figure where the page has none of its own (a program): on
// the left of the score, as the Routines list's routine cards (CLAUDE.md figure rule). `source`: what the week is
// built from, under the score (a routine's times a week, a program's week). Each row is met or not met, as the count
// under the score counts them: met in green with a tick, anything less in red with a cross, even when it earns part of
// its points (the score shows those). The value stacks so the tips keep their width at phone width: "1 of 3" over
// "big lifts", or two counts one over the other ("15 push" over "4 pull").
import { computed } from "vue";
import { CHECK_SOURCES, type CheckKey, type RoutineCheck } from "@motus/shared";
import Icon from "./Icon.vue";
import Ring from "./Ring.vue";
import BodyMap from "./BodyMap.vue";
import SourceRow from "./learn/SourceRow.vue";

// muscles: the figure's main and helper muscles (the routine card's look) and each one's sets a week for its tips
const props = defineProps<{ check: RoutineCheck; title: string; muscles?: { sets: Record<string, number>; primary: string[]; secondary: string[] }; source?: string }>();
const ICON: Record<CheckKey, string> = { volume: "activity", frequency: "calendar", pushPull: "swap", legs: "split", order: "arrowUp", reps: "refresh" };
// "1 of 3 big lifts" → ["1 of 3"] and "big lifts"; "15 push · 4 pull" → ["15 push", "4 pull"] and no noun line
const valueOf = (v: string) => { const m = /^(\S+ of \S+) (.+)$/.exec(v); return m ? { counts: [m[1]!], noun: m[2]! } : { counts: v.split(" · "), noun: "" }; };
const met = computed(() => props.check.checks.filter((c) => c.status === "good").length);
</script>

<template>
  <div class="card wkc">
    <div class="ch"><span class="t grow">{{ title }}</span></div>
    <div class="rtop">
      <BodyMap v-if="muscles" class="rbody" :values="muscles.sets" :highlight="muscles.primary" :secondary="muscles.secondary" />
      <div class="gs-top grow">
        <Ring :pct="check.score / 100" :size="64" :stroke="7" :done="check.score >= 100" />
        <div class="grow"><div class="gs-val">{{ check.score }}<small>{{ check.label }}</small></div>
          <div v-if="source" class="tiny">{{ source }}</div>
          <div class="tiny">{{ met }} of {{ check.checks.length }} checks met</div></div>
      </div>
    </div>
    <div class="list crows" style="margin-top: var(--cpy)">
      <div v-for="c in check.checks" :key="c.key" class="li">
        <Icon :name="ICON[c.key]" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ c.title }}</div><div class="s">{{ c.detail }}</div></div>
        <div class="r" :class="c.status === 'good' ? 'pos' : 'neg'" :aria-label="`${c.value}, ${c.status === 'good' ? 'met' : 'not met'}`">
          <b v-for="(v, i) in valueOf(c.value).counts" :key="v" class="rv"><Icon v-if="!i" :name="c.status === 'good' ? 'check' : 'close'" :size="14" />{{ v }}</b>
          <div v-if="valueOf(c.value).noun" class="s cst">{{ valueOf(c.value).noun }}</div></div>
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
/* each count on its own line, the first after the met / not met mark */
.li .r .rv { display: flex; align-items: center; justify-content: flex-end; gap: 3px; }
/* the count's noun under it, in the value's colour (the row's .s would grey it) */
.li .r .s.cst { color: inherit; }
</style>
