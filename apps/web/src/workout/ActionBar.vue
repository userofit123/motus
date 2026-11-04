<script setup lang="ts">
// The controls of the running workout, in one sheet at the bottom: everything you press is here, always for the exercise
// being done now (state.active), whichever one is on screen above. A set to do: which set, last time's numbers, the
// weight and reps with - and + for thumbs, the rest after it, then Pause, Skip and Done. Resting: a ring counting down,
// with -15 and +15 either side. When an exercise is finished: on to the next, or Finish. The workout's Pause is always
// the first button of the bottom row.
import { computed, ref } from "vue";
import { clock, usesWeight, usesReps, usesDuration, type WorkoutSet } from "@motus/shared";
import { useWorkout } from "./useWorkout";
import { rest, restLeft, restActive, adjustRest, finishRest } from "./runtime";
import { choose } from "../core/ask";
import Icon from "../components/Icon.vue";
import NumStep from "../components/NumStep.vue";
import RestPicker from "../components/RestPicker.vue";

defineProps<{ paused: boolean }>();
const emit = defineEmits<{ finish: []; pause: [] }>();
const W = useWorkout();
const fmt = W.fmt;
const w = computed(() => W.state.w);
const e = computed(() => w.value?.exercises[W.state.active] ?? null);
const tr = computed(() => e.value?.exercise?.tracking ?? "weight_reps");
const shown = computed(() => e.value?.sets.filter((x) => W.prefs.value.showWarmups || x.kind !== "warmup") ?? []);
/** the set to do now: the first one not done */
const s = computed<WorkoutSet | null>(() => (e.value?.status === "skipped" ? null : shown.value.find((x) => !x.done) ?? null));
const si = computed(() => (s.value ? e.value!.sets.indexOf(s.value) : -1));
// the sets that count: a drop belongs to the set before it
const work = computed(() => e.value?.sets.filter((x) => x.kind !== "warmup" && x.kind !== "drop") ?? []);
const parentOf = (x: WorkoutSet) => { const a = e.value!.sets; let i = a.indexOf(x); while (i > 0 && a[i]!.kind === "drop") i--; return a[i]!; };
const setLabel = computed(() => {
  const x = s.value; if (!x) return "";
  if (x.kind === "warmup") return "Warm-up set";
  if (x.kind === "drop") return `Drop set · set ${work.value.indexOf(parentOf(x)) + 1} of ${work.value.length}`;
  return `${x.kind === "failure" ? "Set to failure" : "Set"} ${work.value.indexOf(x) + 1} of ${work.value.length}`;
});
const short = (x: WorkoutSet) => (x.kind === "warmup" ? "W" : x.kind === "drop" ? "D" : x.kind === "failure" ? "F" : String(work.value.indexOf(x) + 1));
const prevText = (x: WorkoutSet) => {
  const p = x.prev; if (!p) return "-";
  const wt = usesWeight(tr.value) && p.weightKg != null ? fmt.value.w(p.weightKg) : "", r = usesReps(tr.value) && p.reps != null ? String(p.reps) : "";
  const d = usesDuration(tr.value) && p.durationS ? fmt.value.clock(p.durationS) : "";
  return [wt, r, d].filter(Boolean).join(" × ") || "-";
};
const hasPrev = computed(() => shown.value.some((x) => x.prev));

const resting = computed(() => restActive() || (rest.done && !!rest.endAt));
const left = computed(() => restLeft());
const pct = computed(() => (rest.totalS ? Math.min(1, left.value / rest.totalS) : 0));
// switching the exercise being done also shows it
const switchTo = (i: number) => { if (w.value && i >= 0 && i < w.value.exercises.length) { W.state.active = i; W.state.cur = i; } };
const go = (d: number) => switchTo(W.state.active + d);
const nextIdx = computed(() => {
  if (!w.value) return -1;
  const after = w.value.exercises.findIndex((x, j) => j > W.state.active && x.status === "pending");
  return after >= 0 ? after : w.value.exercises.findIndex((x) => x.status === "pending");
});

const wStep = computed(() => Math.round(fmt.value.fromKg(W.incKg.value) * 100) / 100);
const wNum = (kg: number | null) => (kg == null ? null : Math.round(fmt.value.fromKg(kg) * 100) / 100);
// Done with the reps left empty takes the target, as the field showed
async function done() {
  const x = s.value!;
  if (x.reps == null && x.targetReps != null && usesReps(tr.value)) await W.editSet(x, { reps: x.targetReps });
  W.tick(e.value!, si.value);
}
async function skip() {
  const v = await choose("Skip", [{ label: `Skip this set (${setLabel.value.toLowerCase()})`, value: "set" }, { label: `Skip ${e.value!.exercise.name}…`, value: "ex" }]);
  if (v === "set") W.removeSet(e.value!, s.value!); else if (v === "ex") W.skipExercise(e.value!);
}
// the rest that will follow this set; tap to change it for this set only
const restAfter = computed(() => (s.value ? W.restFor(e.value!, si.value).secs : 0));
const editingRest = ref(false);
// the ring while resting: the arc left is the rest left
const RING = 2 * Math.PI * 58;
</script>

<template>
  <div v-if="e" class="abar" :class="{ resting }">

    <!-- resting -->
    <template v-if="resting">
      <div class="ab-line">
        <span class="ab-k grow ellipsis">{{ rest.done ? "Rest over" : rest.label === "Next exercise" ? "Rest before the next exercise" : "Resting" }}</span>
      </div>
      <div class="ab-rest" role="timer">
        <button class="btn o" @click="adjustRest(-15)">-15</button>
        <div class="ring">
          <svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="58" class="rb" /><circle cx="66" cy="66" r="58" class="rf" :style="{ strokeDasharray: RING, strokeDashoffset: RING * (1 - pct) }" /></svg>
          <span class="ab-time" :class="{ over: rest.done }">{{ clock(left) }}</span>
        </div>
        <button class="btn o" @click="adjustRest(15)">+15</button>
      </div>
      <div class="ab-k ellipsis ab-next">Next: {{ rest.next }}</div>
      <button v-if="W.restChanged.value" class="qb ab-keep" @click="W.keepRest">Use {{ clock(rest.totalS) }} for this exercise from now on</button>
      <div class="ab-row">
        <button class="ib ab-pause" :class="{ on: paused }" :aria-label="paused ? 'Resume the workout' : 'Pause the workout'" :aria-pressed="paused" @click="emit('pause')"><Icon :name="paused ? 'play' : 'pause'" /></button>
        <button class="btn ab-go" @click="finishRest(true)">{{ rest.done ? "Next set" : "Skip rest" }}</button>
      </div>
    </template>

    <!-- a set to do -->
    <template v-else-if="s">
      <div class="ab-line">
        <span class="ab-k grow ellipsis"><b>{{ e.exercise?.name }}</b> · {{ setLabel }}</span>
        <button class="qb ab-rp" title="Rest after this set" @click="editingRest = true"><Icon name="timer" :size="14" />{{ restAfter ? `${clock(restAfter)} rest` : "No rest" }}</button>
      </div>
      <div v-if="hasPrev" class="ab-last">
        <span class="ab-k">Last time</span>
        <span v-for="x in shown" :key="x.id" class="lt" :class="{ n: x === s }"><small>{{ short(x) }}</small>{{ prevText(x) }}</span>
      </div>
      <div class="ab-in">
        <NumStep v-if="usesWeight(tr)" big :value="wNum(s.weightKg)" :step="wStep" :max="2000" :unit="fmt.wu" label="weight" @set="(v) => W.editSet(s!, { weightKg: fmt.toKg(v) })" />
        <NumStep v-if="usesReps(tr)" big :value="s.reps ?? s.targetReps ?? null" :min="0" :max="1000" unit="reps" label="reps" @set="(v) => W.editSet(s!, { reps: v })" />
        <NumStep v-else-if="usesDuration(tr)" big :value="s.durationS ?? 30" :step="5" :max="86400" unit="s" label="seconds" @set="(v) => W.editSet(s!, { durationS: v })" />
      </div>
      <div class="ab-row">
        <button class="ib ab-pause" :class="{ on: paused }" :aria-label="paused ? 'Resume the workout' : 'Pause the workout'" :aria-pressed="paused" @click="emit('pause')"><Icon :name="paused ? 'play' : 'pause'" /></button>
        <button class="btn o ab-sm" @click="skip"><Icon name="skip" :size="16" />Skip</button>
        <button class="btn ab-go" @click="done"><Icon name="check" :size="20" />Done</button>
      </div>
    </template>

    <!-- this exercise is finished (or skipped) -->
    <template v-else>
      <div class="ab-line"><div class="grow" style="min-width:0"><div class="ab-k">{{ e.status === "skipped" ? "Skipped" : "All sets done" }}</div><div class="ab-n2 ellipsis">{{ nextIdx >= 0 ? `Next: ${w!.exercises[nextIdx]!.exercise.name}` : "That was the last exercise" }}</div></div></div>
      <div class="ab-row">
        <button class="ib ab-pause" :class="{ on: paused }" :aria-label="paused ? 'Resume the workout' : 'Pause the workout'" :aria-pressed="paused" @click="emit('pause')"><Icon :name="paused ? 'play' : 'pause'" /></button>
        <button v-if="nextIdx >= 0" class="btn ab-go" @click="switchTo(nextIdx)">Next exercise<Icon name="right" :size="18" /></button>
        <button v-else class="btn ab-go" @click="emit('finish')"><Icon name="check" :size="18" />Finish workout</button>
      </div>
    </template>
    <RestPicker v-if="editingRest && s" title="Rest after this set" :value="s.restPlannedS ?? null" :default-label="`As planned (${clock(restAfter)})`"
      @close="editingRest = false" @pick="(v) => { W.editSet(s!, { restPlannedS: v }); editingRest = false; }" />
  </div>
</template>

<style scoped>
/* a sheet: rounded at the top, on the page's second surface; on a computer it sits in the column as a card */
.abar { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 14px; background: var(--s1); border: 1px solid var(--ol); border-radius: var(--r-sheet); box-shadow: var(--shadow-pop); }
.ab-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ab-k { font-size: 12.5px; font-weight: 500; color: var(--tx2); }
.ab-k b { color: var(--tx); font-weight: 600; font-size: 14px; }
.ab-rp { flex: none; font-size: 12.5px; padding: 4px 8px; font-variant-numeric: tabular-nums; }
.ab-n2 { font-size: 14px; font-weight: 600; }
.ab-last { display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.ab-last::-webkit-scrollbar { display: none; }
.ab-last .ab-k { flex: none; margin-inline-end: 2px; }
.lt { flex: none; display: inline-flex; align-items: baseline; gap: 4px; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--tx2); padding: 3px 8px; border-radius: var(--pill); background: var(--s2); }
.lt small { font-size: 10.5px; font-weight: 700; opacity: .7; }
.lt.n { background: var(--accc); color: var(--onc); font-weight: 600; }
.ab-in { display: flex; gap: 8px; }
.ab-in :deep(.nstep) { flex: 1; justify-content: space-between; background: var(--bg); }
.ab-row { display: flex; align-items: center; gap: 8px; }
.ab-pause { width: 48px; height: 48px; flex: none; }
.ab-pause.on { background: var(--accc); color: var(--onc); border-color: transparent; }
.ab-sm { min-height: 48px; padding-inline: 14px; }
.ab-go { margin-inline-start: auto; flex: 1; max-width: 260px; min-height: 48px; font-size: 15px; }
/* resting: the ring between -15 and +15 */
.ab-rest { display: flex; align-items: center; justify-content: center; gap: 14px; }
.ring { position: relative; width: 132px; height: 132px; display: grid; place-items: center; flex: none; }
.ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
html.he .ring svg { transform: rotate(-90deg) scaleY(-1); }
.ring circle { fill: none; stroke-width: 8; }
.ring .rb { stroke: var(--s2); }
.ring .rf { stroke: var(--acc); stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
.ab-time { position: relative; font-size: 34px; font-weight: 600; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.ab-time.over { color: var(--acc); }
.ab-next { text-align: center; margin-top: -4px; }
.ab-keep { align-self: center; font-size: 12.5px; padding: 2px 8px; margin-top: -6px; }
</style>
