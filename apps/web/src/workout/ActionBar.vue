<script setup lang="ts">
// The controls of the running workout, in one sheet at the bottom: everything you press is here, always for the exercise
// being done now (state.active), whichever one is on screen above. A set to do: which set, the
// weight and reps with - and + for thumbs, the rest after it, then Pause, Skip and Done. Resting: a ring counting down,
// with -15 and +15 either side. When an exercise is finished: on to the next, or Finish. The workout's Pause is always
// the first button of the bottom row.
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { clock, usesWeight, usesReps, usesDuration, type WorkoutSet, type SetKind } from "@motus/shared";
import { useWorkout } from "./useWorkout";
import { setNo } from "../core/format";
import { KIND_LABEL, REST_LABEL } from "../core/plannedRest";
import { rest, restLeft, restActive, adjustRest, finishRest } from "./runtime";
import { choose } from "../core/ask";
import Icon from "../components/Icon.vue";
import NumStep from "../components/NumStep.vue";
import RestPicker from "../components/RestPicker.vue";

defineProps<{ paused: boolean }>();
const emit = defineEmits<{ finish: []; pause: [] }>();
const W = useWorkout();
// the saved rest is confirmed in place of the offer for a moment, so a tap is never silent: what was saved as it was at
// the tap, and which rest it is
const saved = ref("");
let savedT: ReturnType<typeof setTimeout> | undefined;
// What keeping the rest covers, worded as the routine page names its rests: between sets and after the last one are this
// exercise's; the rest after a warm-up, drop set or set to failure is kept for that kind of set: in a workout from a
// routine this exercise's, else Settings', for every exercise
const offerFor = (x: { after: boolean; kind: Exclude<SetKind, "normal"> | null; inRoutine: boolean } | null) =>
  x?.kind ? `${KIND_LABEL[x.kind]} in ${x.inRoutine ? "this" : "every"} exercise` : `${x?.after ? REST_LABEL.after : REST_LABEL.between} in this exercise`;
function keep() {
  // worded before keeping, from the same state the offer showed
  const why = offerFor(W.restKeeps.value);
  const k = W.keepRest(); if (!k) return;
  saved.value = `${clock(k.secs)} rest ${why}`;
  clearTimeout(savedT); savedT = setTimeout(() => (saved.value = ""), 2500);
}
// a new rest starts without the last one's confirmation
watch(() => rest.setId, () => { saved.value = ""; clearTimeout(savedT); });
onBeforeUnmount(() => clearTimeout(savedT));
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
// counted as the badges are (setNo): a left and right round is one set, so "Set 2 of 3 · left" beside the badge "2L"
const sidesOn = computed(() => !!W.settings.value.features.unilateral);
const noOf = (x: WorkoutSet) => setNo(e.value!.sets, e.value!.sets.indexOf(x), sidesOn.value);
const total = computed(() => { const l = work.value.at(-1); return l ? noOf(l) : 0; });
const setLabel = computed(() => {
  const x = s.value; if (!x) return "";
  if (x.kind === "warmup") return "Warm-up set";
  if (x.kind === "drop") return `Drop set · set ${noOf(parentOf(x))} of ${total.value}`;
  // a set for one side says which (the feature on): "Set 2 of 3 · left"
  const side = sidesOn.value && x.side ? ` · ${x.side === "L" ? "left" : "right"}` : "";
  return `${x.kind === "failure" ? "Set to failure" : "Set"} ${noOf(x)} of ${total.value}${side}`;
});

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
// Done with the reps left empty takes the target, as the field showed. Not waiting for that save: editSet changes the
// set here at once, and the tick, sent after it, carries the reps too
function done() {
  const x = s.value!;
  if (x.reps == null && x.targetReps != null && usesReps(tr.value)) void W.editSet(x, { reps: x.targetReps });
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
        <span class="ab-k grow ellipsis ab-rtitle">{{ rest.done ? "Rest over" : rest.label === "Next exercise" ? "Rest before the next exercise" : "Resting" }}</span>
      </div>
      <div class="ab-ringg">
      <div class="ab-rest" role="timer">
        <button class="btn o" @click="adjustRest(-15)">-15</button>
        <div class="ring">
          <svg viewBox="0 0 132 132" aria-hidden="true"><circle cx="66" cy="66" r="58" class="rb" /><circle cx="66" cy="66" r="58" class="rf" :style="{ strokeDasharray: RING, strokeDashoffset: RING * (1 - pct) }" /></svg>
          <span class="ab-time" :class="{ over: rest.done }">{{ clock(left) }}</span>
        </div>
        <button class="btn o" @click="adjustRest(15)">+15</button>
      </div>
      <div class="ab-k ellipsis ab-next">{{ rest.next }}</div>
      </div>
      <div v-if="saved" class="ab-saved" role="status"><span class="ab-sv"><Icon name="check" :size="14" />Saved</span><span class="ab-why">{{ saved }}</span></div>
      <button v-else-if="W.restChanged.value" class="qb ab-keep" @click="keep">
        <span class="ab-why">This rest was planned at {{ clock(W.restPlannedNow.value ?? 0) }}, now {{ clock(rest.totalS) }}</span>
        <span class="ab-act">Use {{ clock(rest.totalS) }} {{ offerFor(W.restKeeps.value) }}</span>
      </button>
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
.abar { position: relative; display: flex; flex-direction: column; gap: clamp(12px, var(--spg), 16px); padding: 14px; background: var(--s1); border: 1px solid var(--ol); border-radius: var(--r-sheet); box-shadow: var(--shadow-pop); }
.ab-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ab-k { font-size: 12.5px; font-weight: 500; color: var(--tx2); }
.ab-k b { color: var(--tx); font-weight: 600; font-size: 14px; }
.ab-rp { flex: none; font-size: 12.5px; padding: 4px 8px; font-variant-numeric: tabular-nums; }
.ab-n2 { font-size: 14px; font-weight: 600; }
.ab-in { display: flex; gap: 8px; }
.ab-in :deep(.nstep) { flex: 1; justify-content: space-between; background: var(--bg); }
.ab-row { display: flex; align-items: center; gap: 8px; }
.ab-pause { width: 48px; height: 48px; flex: none; }
.ab-pause.on { background: var(--accc); color: var(--onc); border-color: transparent; }
.ab-sm { min-height: 48px; padding-inline: 14px; }
.ab-go { margin-inline-start: auto; flex: 1; max-width: 260px; min-height: 48px; font-size: 15px; }
/* resting: the ring between -15 and +15 */
.ab-rest { display: flex; align-items: center; justify-content: center; gap: var(--hg); }
.ab-ringg { display: flex; flex-direction: column; gap: var(--hg); }
.ring { position: relative; width: 132px; height: 132px; display: grid; place-items: center; flex: none; }
.ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
html.he .ring svg { transform: rotate(-90deg) scaleY(-1); }
.ring circle { fill: none; stroke-width: 8; }
.ring .rb { stroke: var(--s2); }
.ring .rf { stroke: var(--acc); stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
.ab-time { position: relative; font-size: 34px; font-weight: 600; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.ab-time.over { color: var(--acc); }
.ab-next { text-align: center; }
.ab-rtitle { text-align: center; }
/* the offer and its Saved confirmation share one two-line box (same padding, line height and min height) so nothing jumps */
.ab-keep, .ab-saved { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; line-height: 1.3; text-align: center; padding: var(--tdy) 10px; min-height: calc(2 * 1.3 * 12.5px + 2 * var(--tdy)); font-size: 12.5px; font-weight: 500; }
.ab-keep > span, .ab-saved > span { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ab-sv { display: inline-flex; align-items: center; gap: 6px; color: var(--pos); }
.ab-why { color: var(--tx2); }
.ab-act { color: var(--acc); }
</style>
