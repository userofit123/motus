<script setup lang="ts">
// One goal: what, how far along, the pace, and a small trend.
import { computed } from "vue";
import type { Goal } from "@motus/shared";
import Sparkline from "./Sparkline.vue";
import Ring from "./Ring.vue";
import Icon from "./Icon.vue";
import { useFmt, goalLabel } from "../core/format";
import { periodWord, goalSub } from "../core/goals";
import { useSettings } from "../api/queries";

const props = defineProps<{ goal: Goal }>();
// reached this time round, or achieved for good: the ring is full and holds a check
const reached = computed(() => props.goal.status === "achieved" || !!props.goal.progress?.done);
const fmt = useFmt();
const s = useSettings();
// under the title: how often it counts (or what a named goal measures), and a one-off goal's deadline
const by = (d: string) => `By ${fmt.value.date(d, { day: "numeric", month: "short", year: "numeric" })}`;
const sub = computed(() => {
  const g = props.goal;
  if (g.period !== "once") return goalSub(g, s.value);
  if (g.name && g.summary) return g.deadline ? `${g.summary} · ${by(g.deadline)}` : g.summary;
  return g.deadline ? by(g.deadline) : "One-off";
});
</script>

<template>
  <div class="card click stat" style="min-height:0">
    <div class="row" style="align-items:flex-start">
      <div class="grow">
        <div style="font-weight:600;line-height:1.3">{{ goal.title }}</div>
        <div class="tiny" style="margin-top:2px">{{ sub }}</div>
      </div>
      <Ring :pct="goal.progress?.pct ?? 0" :size="46" :done="reached" />
    </div>
    <div style="margin-top:10px;font-weight:600;font-variant-numeric:tabular-nums">{{ goalLabel(goal, fmt) }}</div>
    <div class="sub">{{ goal.status === "achieved" ? "Achieved" : goal.progress?.done ? `Reached this ${periodWord(goal)}` : goal.progress?.pace }}</div>
    <div v-if="goal.progress?.streak" class="sub gc-run"><Icon name="flame" :size="13" />{{ goal.progress.streak }} {{ periodWord(goal, goal.progress.streak) }} in a row</div>
    <Sparkline v-if="(goal.progress?.history?.length ?? 0) > 1" :values="goal.progress!.history.map((h) => h.value)" />
  </div>
</template>

<style scoped>
.gc-run { display: flex; align-items: center; gap: 4px; color: var(--acc); }
</style>
