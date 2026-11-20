<script setup lang="ts">
// The Routine check (the Routine check feature, M-273) of a routine or a program's week: the score in a ring as Stats'
// day blocks show a goal, then each check as a row with what it found and what to change (as Stats → Scores' rows),
// then the row that opens the research behind it. The header has no icon, as its sibling cards on the Routine and
// Program pages. `muscles`: sets a week per muscle, for the figure where the page has none of its own (a program): on
// the left of the score, as the Routines list's routine cards (CLAUDE.md figure rule). `source`: what the week is
// built from, under the score (a routine's times a week, a program's week). Each value takes Stats → Scores' tone
// (toneOf): green when met in full, plain when half or more, red under half; the line under the score (full width, as Scores'
// why line) counts the ones met in full and says the others earn part of their points, which is why 0 met can still score 53. The value stacks
// so the tips keep their width at phone width: "1 of 3" over "big lifts", or two counts one over the other, each
// with its small noun ("15 push" over "4 pull"). `weekIn`: a routine in a program, whose week (sets per muscle, twice a week, balance)
// is checked on the program's card instead (M-287), so its card says where, as a row that opens the program.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { CHECK_SOURCES, type CheckKey, type RoutineCheck } from "@motus/shared";
import Icon from "./Icon.vue";
import Ring from "./Ring.vue";
import BodyMap from "./BodyMap.vue";
import SourceRow from "./learn/SourceRow.vue";
import { toneOf } from "../core/scores";

// muscles: the figure's main and helper muscles (the routine card's look) and each one's sets a week for its tips
// check: null only for a routine in a program with lifting but nothing to check in one workout (no target reps), so the card keeps its row to the week
const props = defineProps<{ check: RoutineCheck | null; title: string; muscles?: { sets: Record<string, number>; primary: string[]; secondary: string[] }; source?: string;
  weekIn?: { id: string; name: string; more: number } }>();
const router = useRouter();
const openWeek = () => router.push(`/programs/${props.weekIn!.id}`);
const weekLine = computed(() => { const w = props.weekIn; if (!w) return "";
  return w.more ? `Checked on ${w.name} and ${w.more} more ${w.more === 1 ? "program" : "programs"}, each over its week` : `Checked on the program ${w.name}, all its workouts together`; });
const ICON: Record<CheckKey, string> = { volume: "activity", frequency: "calendar", pushPull: "swap", legs: "split", order: "arrowUp", reps: "refresh" };
// "1 of 3 big lifts" → "1 of 3" over "big lifts"; "15 push · 4 pull" → "15 push" over "4 pull", each count beside its noun
const valueOf = (v: string) => { const m = /^(\S+ of \S+) (.+)$/.exec(v); return m ? { of: m[1]!, noun: m[2]!, pairs: [] } : { of: "", noun: "", pairs: v.split(" · ").map((x) => { const [n, ...w] = x.split(" "); return { n: n!, w: w.join(" ") }; }) }; };
const STATE = { pos: "met in full", neg: "less than half met", none: "partly met" } as const;
const met = computed(() => (props.check?.checks ?? []).filter((c) => c.share >= 1).length);
// checks that earn some but not all of their points, so the line under the score can say why it isn't 0
const part = computed(() => (props.check?.checks ?? []).filter((c) => c.share > 0 && c.share < 1).length);
const metLine = computed(() => {
  const n = props.check?.checks.length ?? 0, rest = n - met.value, p = part.value;
  // one check left partly met reads as "the other", not "the rest"
  const tail = !p ? "" : p === rest ? (p === 1 ? ` · ${n === 1 ? "it" : "the other"} earns part of its points` : " · the rest earn part of their points")
    : ` · ${p} more ${p === 1 ? "earns part of its" : "earn part of their"} points`;
  return `${met.value} of ${n} ${n === 1 ? "check" : "checks"} met in full${tail}`;
});
</script>

<template>
  <div class="card wkc">
    <div class="ch"><span class="t grow">{{ title }}</span></div>
    <div v-if="check" class="rtop">
      <BodyMap v-if="muscles" class="rbody" :values="muscles.sets" :highlight="muscles.primary" :secondary="muscles.secondary" />
      <div class="gs-top grow">
        <Ring :pct="check.score / 100" :size="64" :stroke="7" :done="check.score >= 100" />
        <div class="grow"><div class="gs-val">{{ check.score }}<small>{{ check.label }}</small></div>
          <div v-if="source" class="tiny">{{ source }}</div></div>
      </div>
    </div>
    <div v-if="check" class="tiny rc-why">{{ metLine }}</div>
    <!-- no score: say why, in the count line's place, so the card isn't only its two rows -->
    <div v-else class="tiny rc-why">Nothing to score in this workout yet: no set has target reps, and it doesn't mix big and single-muscle lifts. Add target reps to score it.</div>
    <div class="list crows">
      <div v-for="c in check?.checks ?? []" :key="c.key" class="li">
        <Icon :name="ICON[c.key]" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ c.title }}</div><div class="s">{{ c.detail }}</div></div>
        <div class="r" :class="toneOf(c.share)" role="group" :aria-label="`${c.value}, ${STATE[toneOf(c.share) ?? 'none']}`">
          <template v-if="valueOf(c.value).of"><b class="rv">{{ valueOf(c.value).of }}</b><div class="s cst">{{ valueOf(c.value).noun }}</div></template>
          <div v-for="v in valueOf(c.value).pairs" v-else :key="v.w" class="rv"><b>{{ v.n }}</b> <span class="cst">{{ v.w }}</span></div></div>
      </div>
      <div v-if="weekIn" class="li click" role="link" tabindex="0" :aria-label="`Sets per muscle, twice a week and balance: ${weekLine}`" @click="openWeek"
           @keydown.enter.prevent="openWeek" @keydown.space.prevent="openWeek">
        <Icon name="layers" :size="18" class="muted" />
        <div class="grow"><div class="t">Sets per muscle, twice a week and balance</div><div class="s">{{ weekLine }}</div></div>
        <Icon name="right" :size="16" class="muted" />
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
/* what the count of met checks means, full width under the score and above the rows, as Stats → Scores' why line */
.rc-why { margin-top: var(--tdy); margin-bottom: var(--cpy); }
/* each value line on its own, right-aligned */
.li .r .rv { display: block; text-align: end; }
/* a count's noun small and grey, as Scores colours only the number, so the column stays narrow; no gap above, so
   both kinds of value space their lines alike */
.li .r .cst { color: var(--tx2); font-size: var(--fs-sm); font-weight: 500; margin-top: 0; }
</style>
