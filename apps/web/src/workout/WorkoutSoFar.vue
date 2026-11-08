<script setup lang="ts">
// The workout so far: time, exercises and sets done against planned, volume, records and rep targets, and a line per
// exercise with its best set (the least help, for assisted ones). The last tab of the running workout; the numbers come from workoutSoFar (shared), so the
// Finish screen shows the same. There (`final`) the time leaves the tiles (Finish shows it larger) and each line says
// how the exercise compares with last time.
import { computed } from "vue";
import { workoutSoFar, type Trend, type Workout } from "@motus/shared";
import { useFmt } from "../core/format";
import { elapsed } from "./runtime";
import Icon from "../components/Icon.vue";

const props = defineProps<{ w: Workout; final?: boolean; vsLast?: Record<string, Trend> }>();
const emit = defineEmits<{ open: [index: number] }>();
const fmt = useFmt();
const TREND: Record<Trend, string> = { up: "better than last time", same: "same as last time", down: "below last time" };
const r = computed(() => workoutSoFar(props.w));
const secs = computed(() => elapsed(props.w));
const extras = computed(() => [
  r.value.records ? `${r.value.records} new record${r.value.records === 1 ? "" : "s"}` : "",
  r.value.targets ? `${r.value.targetsHit} of ${r.value.targets} rep targets reached` : "",
].filter(Boolean));
const line = (i: number) => {
  const p = r.value.perExercise[i]!, e = props.w.exercises[i]!;
  if (p.status === "skipped") return `Skipped${e.skipReason ? " · " + e.skipReason : ""}`;
  const vs = props.vsLast?.[p.id];
  return [`${p.setsDone} of ${p.setsPlanned} sets`, p.best ? `${e.exercise?.tracking === "assisted" ? "least help" : "best"} ${fmt.value.set(p.best, e.exercise?.tracking)}` : "",
    vs ? TREND[vs] : ""].filter(Boolean).join(" · ");
};
</script>

<template>
  <div class="aw-ex">
    <div class="exh"><div class="grow"><h3 class="wsf-h">{{ final ? "What you did" : "Summary so far" }}</h3><div v-if="extras.length" class="tiny wsf-x"><template v-for="(x, i) in extras" :key="x"><span v-if="i" class="sep">·</span><span>{{ x }}</span></template></div></div></div>
    <div class="grid keep wsf-t" :class="final ? 'g3' : 'g2'">
      <div v-if="!final"><div class="lbl">Time</div><div class="wsf-v">{{ fmt.clock(secs) }}</div></div>
      <div><div class="lbl">Volume</div><div class="wsf-v">{{ fmt.vol(r.volumeKg) }}</div></div>
      <div><div class="lbl">Exercises</div><div class="wsf-v">{{ r.exercisesDone }} <small>of {{ r.exercisesTotal }}</small></div></div>
      <div><div class="lbl">Sets</div><div class="wsf-v">{{ r.setsDone }} <small>of {{ r.setsPlanned }}</small></div></div>
    </div>
    <div class="list">
      <div v-for="(p, i) in r.perExercise" :key="p.id" class="li click" :class="{ skip: p.status === 'skipped' }" @click="emit('open', i)">
        <div class="grow" style="min-width:0"><div class="t ellipsis">{{ p.name }}</div><div class="s">{{ line(i) }}</div></div>
        <span v-if="p.records" class="pr">{{ p.records > 1 ? `${p.records} PRs` : "PR" }}</span>
        <Icon v-if="p.status === 'done' || p.status === 'partial'" name="check" :size="16" class="pos" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.wsf-h { cursor: default; }
.wsf-x { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 3px; }
.wsf-t { margin-bottom: var(--spg); }
.wsf-v { font-weight: 600; font-size: 18px; font-variant-numeric: tabular-nums; }
.wsf-v small { font-size: 13px; font-weight: 500; color: var(--tx2); }
.li.skip .t { text-decoration: line-through; opacity: .6; }
</style>
