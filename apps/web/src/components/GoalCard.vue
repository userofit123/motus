<script setup lang="ts">
// One goal: what, how far along, the pace, and its streak or a small trend.
import { computed } from "vue";
import type { Goal } from "@motus/shared";
import Sparkline from "./Sparkline.vue";
import Ring from "./Ring.vue";
import Icon from "./Icon.vue";
import { useFmt } from "../core/format";
import { periodNow, periodDots, recurring, goalValue, goalUnit, goalTarget, goalIcon, goalSide, goalTrend, hasTrend } from "../core/goals";

const props = defineProps<{ goal: Goal }>();
// reached this time round, or achieved for good: the ring is full and holds a check
const reached = computed(() => props.goal.status === "achieved" || !!props.goal.progress?.done);
const fmt = useFmt();
// under the title: what a goal you named measures ("Walk 30 min a day"); a one-off goal's deadline is in the tile's second
// half ("Days left"), so it is not said again here
const sub = computed(() => (props.goal.name && props.goal.summary ? props.goal.summary : ""));
// the second half as on Home: the streak for a recurring goal (daily, weekly or monthly, Home's same test) still running,
// else when it was done, the days left to its deadline or when it started
const side = computed(() => goalSide({ ...props.goal, showStreak: recurring(props.goal) && props.goal.status === "active" && props.goal.progress?.streak != null }, fmt.value));
const now = computed(() => props.goal.progress?.current ?? 0);
// what the number covers: this day, week or month, everything so far for a one-off goal, the latest weigh-in for a body goal
const when = computed(() => (props.goal.scope === "body" ? "Latest" : periodNow(props.goal)));
// how this period is going, worded as the goal's sheet words it ("2 more this week", "Reached today"); a one-off goal's pace
// is its days left, which the second half already shows, and an achieved goal's half says "Done on"
const pace = computed(() => (props.goal.status === "achieved" || !recurring(props.goal) ? "" : props.goal.progress?.done ? `Reached ${periodNow(props.goal).toLowerCase()}` : props.goal.progress?.pace));
</script>

<template>
  <!-- Home's goal tile under a header: the progress (value big, unit small, ring) and beside it the streak or the goal's dates,
       both halves in the same type and ending on the same line: the periods' dots, the trend or a flat line -->
  <div class="card click gcard">
    <div class="ch">
      <span class="bi"><Icon :name="goalIcon(goal)" :size="15" /></span>
      <div class="grow" style="min-width:0"><div class="t">{{ goal.title }}</div><div v-if="sub" class="tiny ellipsis">{{ sub }}</div></div>
    </div>
    <div class="gtile">
      <div class="gmain">
        <div class="ch"><span class="bi"><Icon name="target" :size="15" /></span><span class="t">{{ when }}</span></div>
        <div class="row">
          <div class="big grow">{{ goalValue(goal, now, fmt) }}<small>{{ goalUnit(goal, now, fmt) }}</small></div>
          <Ring :pct="goal.progress?.pct ?? 0" :size="40" :done="reached" />
        </div>
        <div class="tiny">{{ goalTarget(goal, fmt) }}</div>
        <div v-if="pace" class="tiny gpace">{{ pace }}</div>
      </div>
      <div class="grun">
        <div class="ch"><span class="bi"><Icon :name="side.icon" :size="15" /></span><span class="t">{{ side.label }}</span></div>
        <div class="row"><div class="big grow">{{ side.big }}<small v-if="side.small">{{ side.small }}</small></div></div>
        <div class="tiny">{{ side.sub }}</div>
        <div class="gfoot" aria-hidden="true">
          <div v-if="recurring(goal)" class="gdots"><i v-for="(on, k) in periodDots(goal)" :key="k" :class="{ on }" /></div>
          <Sparkline v-else-if="hasTrend(goal)" :values="goalTrend(goal)" />
          <div v-else class="gflat" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the tile sits at the card's foot, so tiles line up across a row of cards whatever the header holds */
.gcard { display: flex; flex-direction: column; container-type: inline-size; }
.gcard .gtile { margin-top: auto; }
/* a card is about as narrow as Home's tile on a phone, so it takes the phone's split, and its values scale with the card:
   Home's phone size at 360px, up to the full size in a wide card */
.gcard .gtile { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); }
.gcard .gtile .big { font-size: clamp(20px, 7.3cqi, var(--fs-val)); }
/* the pace line ends the progress half on the line of the other half's dots or trend */
.gtile .gpace { align-self: end; line-height: 1; margin-bottom: -2px; }
</style>
