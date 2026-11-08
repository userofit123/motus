<script setup lang="ts">
// Finishing: the workout's summary first (time, how it went against the plan and against last time, what was done),
// then how it felt, notes, body weight, the routine update (as Settings → Workout says: asked here, done anyway, or
// never) and one-tap reminders to add weight where every rep target was reached.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { workoutScore, workoutSoFar } from "@motus/shared";
import { useWorkout, endWorkout } from "./useWorkout";
import { api } from "../api/client";
import { settle } from "../api/outbox";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { elapsed, finishRest } from "./runtime";
import { keepAwake } from "./native";
import { maybeAutoBackup } from "../core/backup";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import WorkoutSoFar from "./WorkoutSoFar.vue";

const emit = defineEmits<{ close: []; cancel: []; open: [index: number] }>();
const router = useRouter();
const W = useWorkout();
const w = computed(() => W.state.w!);
const fmt = W.fmt;
const rating = ref<number | null>(null), notes = ref(w.value.notes ?? ""), bw = ref<number | null>(null), busy = ref(false);
// Settings → Workout → "After a workout, update its routine": Ask shows the switch (off until ticked, as updating
// also drops unticked sets); Always updates without asking (the changes are listed); Never hides it all.
const mode = computed(() => W.prefs.value.updateRoutine);
const askUpdate = ref(false);
const updateRoutine = computed(() => mode.value === "always" || (mode.value === "ask" && askUpdate.value));
const secs = computed(() => elapsed(w.value));
const records = computed(() => workoutSoFar(w.value).records);
const sc = computed(() => workoutScore(w.value));
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
// the two verdicts in plain words, each with what it is based on
const vsPlan = computed(() => {
  const p = sc.value.plan;
  return {
    t: { all: "Did the whole plan", most: "Did most of the plan", part: "Did part of the plan" }[p.verdict],
    s: [`${p.setsDone} of ${n(p.setsPlanned, "set")} done`, p.repTargets ? `${p.repTargetsHit} of ${n(p.repTargets, "rep target")} reached` : "",
      p.weightTargets ? `${p.weightTargetsHit} of ${n(p.weightTargets, "target weight")} lifted` : "", p.skipped ? `${n(p.skipped, "exercise")} skipped` : ""].filter(Boolean).join(" · "),
  };
});
const vsLast = computed(() => {
  const l = sc.value.last;
  if (!l) return { t: "First time", s: "Nothing to compare with yet: next time this shows how you did against today", trend: null };
  const pct = l.volumePct;
  return {
    t: { better: "Better than last time", same: "About the same as last time", worse: "Below last time" }[l.verdict],
    s: [pct != null ? `${pct > 0 ? "+" : ""}${pct}% volume` : "", l.improved ? `${n(l.improved, "exercise")} improved` : "", l.dropped ? `${n(l.dropped, "exercise")} went down` : "",
      !l.improved && !l.dropped ? `${n(l.compared, "exercise")} matched` : ""].filter(Boolean).join(" · "),
    trend: l.verdict === "better" ? "up" : l.verdict === "worse" ? "down" : null,
  };
});
// what "update the routine" would change, in words: exercises added today, unticked sets dropped, new numbers
// (skipped exercises stay in the routine as they were)
const routineChanges = computed(() => !w.value.routineId ? [] : w.value.exercises.filter((e) => e.status !== "skipped" && e.sets.some((s) => s.done)).flatMap((e) => {
  const name = e.exercise.name;
  if (!e.routineExerciseId) return [`Adds ${name}`];
  const left = e.sets.filter((s) => !s.done).length;
  const nums = e.sets.some((s) => s.done && (s.weightKg !== s.targetWeightKg || (s.targetReps != null && s.reps !== s.targetReps)));
  const parts = [nums ? "today's weights and reps" : "", left ? `without the ${left} unticked set${left > 1 ? "s" : ""}` : ""].filter(Boolean);
  return parts.length ? [`${name}: ${parts.join(", ")}`] : [];
}));
const changedFromPlan = computed(() => routineChanges.value.length > 0);
// exercises with weight where every working set was done and reached its target reps: offer "add weight next time".
// At least one set must have had a rep target, or "every target reached" would be true of no targets at all.
const hitAll = computed(() => w.value.exercises.filter((e) => {
  const work = e.sets.filter((s) => s.kind !== "warmup");
  return e.status !== "skipped" && e.exercise?.tracking !== "assisted" && work.some((s) => s.targetReps != null) && work.some((s) => s.weightKg)
    && work.every((s) => s.done && (s.targetReps == null || (s.reps ?? 0) >= s.targetReps));
}));
const reminded = ref<string[]>([]);
async function remind(e: any) {
  const inc = W.incKg.value;
  await api.post("/reminders", { targetType: "exercise", targetId: e.exerciseId, body: `Add ${fmt.value.w(inc)} ${fmt.value.wu}`, action: { weightKg: inc }, workoutId: w.value.id });
  reminded.value.push(e.id);
}
const unticked = computed(() => w.value.exercises.reduce((a, e) => a + (e.status === "skipped" ? 0 : e.sets.filter((s) => !s.done).length), 0));
async function finish() {
  if (busy.value) return;
  busy.value = true;
  const id = w.value.id, prs = records.value;
  try {
    finishRest(true);
    // sets ticked while offline must reach the server first, or finishing would remove them as unticked
    if (!(await settle())) { toast("Can't reach the server yet: your sets are kept here. Finish again when you're back online.", { kind: "err" }); return; }
    await api.post(`/workouts/${id}/finish`, { rating: rating.value, notes: notes.value, bodyweightKg: bw.value ? fmt.value.toKg(bw.value) : null, updateRoutine: updateRoutine.value });
    keepAwake(false);
    if (prs) toast(`${prs} new record${prs > 1 ? "s" : ""}!`, { kind: "pr" });
    // leave first, then drop it everywhere (this sheet lives on the workout screen, which needs it until then)
    await router.replace(`/workouts/${id}?done=1`);
    endWorkout(id);
    maybeAutoBackup(W.settings.value.backup, true, (run) => toast("Back up now?", { action: { label: "Download", run }, ms: 10000 }));
  } catch (e) { toastError(e); invalidate(["workouts"]); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet title="Finish workout" @close="emit('close')">
    <div class="card spb fin-hero">
      <div class="lbl">Workout time</div>
      <div class="fin-time">{{ fmt.dur(secs) }}</div>
      <div class="list">
        <div class="li"><Icon name="target" :size="18" class="fin-i" /><div class="grow"><div class="t">{{ vsPlan.t }}</div><div class="s">{{ vsPlan.s }}</div></div></div>
        <div class="li"><Icon :name="vsLast.trend ?? 'history'" :size="18" class="fin-i" :class="{ pos: vsLast.trend === 'up', neg: vsLast.trend === 'down' }" /><div class="grow"><div class="t">{{ vsLast.t }}</div><div class="s">{{ vsLast.s }}</div></div></div>
      </div>
    </div>
    <div class="card spb"><WorkoutSoFar :w="w" :duration-s="secs" final :vs-last="sc.vsLast" @open="emit('open', $event)" /></div>
    <div v-if="unticked" class="banner note"><Icon name="info" />{{ unticked }} set{{ unticked > 1 ? "s were" : " was" }} not ticked. They will be left out.</div>
    <template v-if="hitAll.length">
      <div class="sh"><h2>Ready for more weight</h2></div>
      <p class="tiny">You did every set and reached every rep target on these. Set a reminder to add weight next time?</p>
      <div class="list spb"><div v-for="e in hitAll" :key="e.id" class="li"><div class="grow" style="min-width:0"><div class="t ellipsis">{{ e.exercise.name }}</div></div>
        <button class="btn s" :class="reminded.includes(e.id) ? 'o' : 'tonal'" :disabled="reminded.includes(e.id)" @click="remind(e)"><Icon :name="reminded.includes(e.id) ? 'check' : 'bell'" :size="14" />{{ reminded.includes(e.id) ? "Reminder set" : `Add ${fmt.w(W.incKg.value)} ${fmt.wu}` }}</button></div></div>
    </template>
    <div class="fld"><label>How did it feel?</label><div class="seg block"><button v-for="k in 5" :key="k" :class="{ on: rating === k }" @click="rating = rating === k ? null : k">{{ ["Awful", "Meh", "OK", "Good", "Great"][k - 1] }}</button></div></div>
    <div class="fld"><label>Notes</label><textarea v-model="notes" rows="3" placeholder="Anything to remember about this workout" /></div>
    <div class="fld"><label>Body weight today ({{ fmt.wu }}, optional)</label><input v-model.number="bw" type="number" inputmode="decimal" step="0.1" /></div>
    <template v-if="changedFromPlan && mode !== 'never'">
      <label v-if="mode === 'ask'" class="tgl"><div class="grow"><div class="t">Also update the routine</div><div class="s">Next time starts from what you did today:</div>
        <ul class="rchg"><li v-for="c in routineChanges" :key="c">{{ c }}</li></ul><div class="s">Skipped exercises stay in the routine. Settings → Workout → "After a workout, update its routine" is set to Ask; choose Always to stop being asked.</div></div><span class="tg"><input v-model="askUpdate" type="checkbox" /></span></label>
      <div v-else class="banner note"><Icon name="refresh" /><div>The routine will be updated with today's sets (Settings → Workout says Always):<ul class="rchg"><li v-for="c in routineChanges" :key="c">{{ c }}</li></ul></div></div>
    </template>
    <button class="qb danger" style="margin-top:14px" @click="emit('cancel')"><Icon name="trash" :size="16" />Cancel the workout instead (nothing is saved)</button>
    <template #foot><button class="btn o" @click="emit('close')">Keep going</button><button class="btn" :disabled="busy" @click="finish">Finish</button></template>
  </Sheet>
</template>

<style scoped>
.rchg { margin: 4px 0 4px 18px; font-size: 12.5px; color: var(--tx); line-height: 1.5; }
.fin-time { font-size: 34px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.fin-hero .list { margin-top: var(--lpy); }
.fin-hero .li:last-child { border-bottom: 0; }
.fin-i { flex: none; color: var(--tx2); }
.fin-i.pos { color: var(--pos); }
.fin-i.neg { color: var(--neg); }
</style>
