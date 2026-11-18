<script setup lang="ts">
// One goal: what, how far along, the pace, and a small trend.
import { computed } from "vue";
import type { Goal } from "@motus/shared";
import Sparkline from "./Sparkline.vue";
import Ring from "./Ring.vue";
import Icon from "./Icon.vue";
import { useFmt, goalLabel } from "../core/format";
import { periodWord, goalSub, periodDots } from "../core/goals";
import { useSettings } from "../api/queries";

const props = defineProps<{ goal: Goal }>();
// reached this time round, or achieved for good: the ring is full and holds a check
const reached = computed(() => props.goal.status === "achieved" || !!props.goal.progress?.done);
const fmt = useFmt();
const s = useSettings();
// under the title: what a named goal measures and a one-off goal's deadline; nothing when the title says it all
const sub = computed(() => goalSub(props.goal, s.value));
// a weekly or monthly goal still running shows its streak as on Home: the count, then its last periods as dots (filled when
// reached), which take the trend line's place as they do there; a one-off goal has no streak and keeps its trend
const streak = computed(() => (props.goal.period !== "once" && props.goal.status === "active" && props.goal.progress?.streak != null ? props.goal.progress.streak : null));
</script>

<template>
  <div class="card click stat" style="min-height:0">
    <div class="row" style="align-items:flex-start">
      <div class="grow">
        <div style="font-weight:600;line-height:1.3">{{ goal.title }}</div>
        <div v-if="sub" class="tiny" style="margin-top:2px">{{ sub }}</div>
      </div>
      <Ring :pct="goal.progress?.pct ?? 0" :size="46" :done="reached" />
    </div>
    <div style="margin-top:10px;font-weight:600;font-variant-numeric:tabular-nums">{{ goalLabel(goal, fmt) }}</div>
    <div class="sub">{{ goal.status === "achieved" ? "Achieved" : goal.progress?.done ? `Reached this ${periodWord(goal)}` : goal.progress?.pace }}</div>
    <div v-if="streak != null" class="gc-run">
      <div class="lbl"><span class="bi"><Icon name="flame" :size="15" /></span>Streak</div>
      <div class="val">{{ streak }}<small>{{ periodWord(goal, streak) }}</small></div>
      <div class="sub">In a row</div>
      <div class="gdots" aria-hidden="true"><i v-for="(on, k) in periodDots(goal)" :key="k" :class="{ on }" /></div>
    </div>
    <Sparkline v-else-if="(goal.progress?.history?.length ?? 0) > 1" :values="goal.progress!.history.map((h) => h.value)" />
  </div>
</template>

<style scoped>
/* the streak sits under the goal as its own part, set off by a line as Home's streak half is */
.gc-run { margin-top: auto; padding-top: var(--cpy); border-top: 1px solid var(--ol); }
/* it sits at the card's foot, so streaks line up across a row of cards whatever is above them */
.sub:has(+ .gc-run) { margin-bottom: var(--cpy); }
.gc-run .gdots { margin-top: var(--hg); }
</style>
