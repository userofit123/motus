<script setup lang="ts">
// One goal: what, how far along, the pace, and a small trend.
import type { Goal } from "@motus/shared";
import Sparkline from "./Sparkline.vue";
import Ring from "./Ring.vue";
import Icon from "./Icon.vue";
import { useFmt, goalLabel } from "../core/format";
import { periodWord, periodLabel } from "../core/goals";
import { useSettings } from "../api/queries";

defineProps<{ goal: Goal; compact?: boolean }>();
const fmt = useFmt();
const s = useSettings();
</script>

<template>
  <div class="card click stat" style="min-height:0">
    <div class="row" style="align-items:flex-start">
      <div class="grow">
        <div style="font-weight:600;line-height:1.3">{{ goal.title }}</div>
        <div class="tiny" style="margin-top:2px">{{ goal.period !== "once" ? periodLabel(goal, s) : goal.deadline ? `By ${fmt.date(goal.deadline, { day: "numeric", month: "short", year: "numeric" })}` : "One-off" }}</div>
      </div>
      <Ring :pct="goal.progress?.pct ?? 0" :size="compact ? 38 : 46" :color="goal.progress?.done ? 'var(--pos)' : undefined" />
    </div>
    <div style="margin-top:10px;font-weight:600;font-variant-numeric:tabular-nums">{{ goalLabel(goal, fmt) }}</div>
    <div class="sub" :class="{ pos: goal.progress?.done }">{{ goal.status === "achieved" ? "Achieved" : goal.progress?.done ? `Reached this ${periodWord(goal)}` : goal.progress?.pace }}</div>
    <div v-if="goal.progress?.streak" class="sub gc-run"><Icon name="flame" :size="13" />{{ goal.progress.streak }} {{ periodWord(goal, goal.progress.streak) }} in a row</div>
    <Sparkline v-if="!compact && (goal.progress?.history?.length ?? 0) > 1" :values="goal.progress!.history.map((h) => h.value)" />
  </div>
</template>

<style scoped>
.gc-run { display: flex; align-items: center; gap: 4px; color: var(--acc); }
</style>
