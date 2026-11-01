<script setup lang="ts">
// One goal: what, how far along, the pace, and a small trend.
import type { Goal } from "@motus/shared";
import Sparkline from "./Sparkline.vue";
import Ring from "./Ring.vue";
import { useFmt } from "../core/format";

defineProps<{ goal: Goal; compact?: boolean }>();
const fmt = useFmt();
</script>

<template>
  <div class="card click stat" style="min-height:0">
    <div class="row" style="align-items:flex-start">
      <div class="grow">
        <div style="font-weight:600;line-height:1.3">{{ goal.title }}</div>
        <div class="tiny" style="margin-top:2px">{{ goal.period === "week" ? "Every week" : goal.period === "month" ? "Every month" : goal.deadline ? `By ${fmt.date(goal.deadline, { day: "numeric", month: "short", year: "numeric" })}` : "One-off" }}</div>
      </div>
      <Ring :pct="goal.progress?.pct ?? 0" :size="compact ? 38 : 46" :color="goal.progress?.done ? 'var(--pos)' : undefined" />
    </div>
    <div style="margin-top:10px;font-weight:600;font-variant-numeric:tabular-nums">{{ goal.progress?.label }}</div>
    <div class="sub" :class="{ pos: goal.progress?.done }">{{ goal.status === "achieved" ? "Achieved" : goal.progress?.done ? "Done for this period" : goal.progress?.pace }}</div>
    <Sparkline v-if="!compact && (goal.progress?.history?.length ?? 0) > 1" :values="goal.progress!.history.map((h) => h.value)" />
  </div>
</template>
