<script setup lang="ts">
// Finishing: the workout's summary first (time, how it went against the plan and against last time, what was done),
// then what it means for next time, kept as two separate things: next time's numbers (where they start from, then every
// weight change in one list: progression rules' own, and a step up where the top of the rep range was reached, each of
// those can be switched off) and how this session differed from the routine (listed, each saved only when switched
// on). Then how it felt, notes, body weight.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { readyForMore, structureChanges, workoutScore, workoutSoFar, type MoreWeight, type NextRule, type Routine, type StructureChange, type WorkoutExercise } from "@motus/shared";
import { useWorkout, endWorkout, finishDraft } from "./useWorkout";
import { api } from "../api/client";
import { settle } from "../api/outbox";
import { invalidate } from "../api/live";
import { useRoutine } from "../api/queries";
import { toast, toastError } from "../core/toast";
import { elapsed, finishRest } from "./runtime";
import { keepAwake } from "./native";
import { maybeAutoBackup } from "../core/backup";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import WorkoutSoFar from "./WorkoutSoFar.vue";
import RoutineChanges from "./RoutineChanges.vue";

const emit = defineEmits<{ close: []; cancel: []; open: [index: number] }>();
const router = useRouter();
const W = useWorkout();
const w = computed(() => W.state.w!);
const fmt = W.fmt;
// the typed-in answers live outside the sheet, so tapping an exercise line (which closes it) loses nothing
const d = finishDraft(w.value), busy = ref(false);
const secs = computed(() => elapsed(w.value));
const records = computed(() => workoutSoFar(w.value).records);
const sc = computed(() => workoutScore(w.value));
const n = (k: number, one: string, many = one + "s") => `${k} ${k === 1 ? one : many}`;
// the two verdicts in plain words, each with what it is based on. The plan one only with a routine (no plan, nothing
// to measure against), and without the sets and rep targets the tiles below already show.
const vsPlan = computed(() => {
  const p = sc.value.plan;
  if (!p) return null;
  return {
    t: { all: "Did the whole plan", most: "Did most of the plan", part: "Did part of the plan" }[p.verdict],
    s: [p.weightTargets ? `${p.weightTargetsHit} of ${n(p.weightTargets, "target weight")} lifted` : "", p.skipped ? `${n(p.skipped, "exercise")} skipped` : ""].filter(Boolean).join(" · "),
  };
});
const vsLast = computed(() => {
  const l = sc.value.last;
  if (!l) return { t: "First time", s: "Nothing to compare with yet: next time this shows how you did against today", trend: null };
  const pct = l.volumePct;
  return {
    t: { better: "Better than last time", same: "About the same as last time", worse: "Below last time" }[l.verdict],
    s: [pct ? `${pct > 0 ? "+" : ""}${pct}% volume` : "", l.improved ? `${n(l.improved, "exercise")} improved` : "", l.dropped ? `${n(l.dropped, "exercise")} went down` : "",
      !l.improved && !l.dropped ? `${n(l.compared, "exercise")} matched` : ""].filter(Boolean).join(" · "),
    trend: l.verdict === "better" ? "up" : l.verdict === "worse" ? "down" : null,
  };
});
// next time's numbers follow the saved settings (Settings → Workout), not a change made for this workout only on the
// routine's start screen: next time starts from the saved ones
const routine = useRoutine(computed(() => w.value.routineId ?? ""));
const routineEx = computed(() => new Map(((routine.data.value as Routine | undefined)?.exercises ?? []).filter((r) => r.id).map((r) => [r.id!, r])));
// what each progression rule will do at the next start, worked out by the engine as the start does (it needs the
// routine's earlier sessions), on the routine as the switched-on "Routine changes" leave it: a swap saved puts the rule
// on the exercise swapped in, set counts saved change its targets. Asked again when those switches change; offline it
// stays empty: the rules still apply, they just aren't listed
const rules = ref<NextRule[]>([]);
const ruleKeys = computed(() => d.routineChanges.filter((k) => /^(swapped|more|fewer):/.test(k)).sort().join(","));
let asked = 0;
if (W.settings.value.features.progression && w.value.routineId) {
  watch(ruleKeys, (keys) => {
    const n = ++asked;
    void settle().then(() => api.get(`/workouts/${w.value.id}/next-rules`, keys ? { changes: keys } : undefined))
      .then((r) => { if (n === asked) rules.value = r as NextRule[]; }).catch(() => {});
  }, { immediate: true });
}
const ruled = computed(() => new Set(rules.value.map((r) => r.workoutExerciseId)));
const names = (xs: string[]) => (xs.length > 3 ? `${xs.length} exercises` : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
// where next time's numbers start from, in one short line: "Start from what you did last time" and "Last time's
// numbers come from", and each routine exercise's own "Always start with these numbers" (an exercise whose rule sets
// its weight is left out here: its row below says what it starts with)
const startsFrom = computed(() => {
  const wo = W.settings.value.workout;
  // a routine fills in from its own last time first; another workout's only where it has none for the exercise
  if (!w.value.routineId) {
    if (!wo.prefillFromLast) return { t: "Routines start from their own numbers", s: "Today's numbers show beside each set next time" };
    return wo.prefillScope === "routine"
      ? { t: "Not used to fill in a routine", s: "Routines fill in from their own last time (Settings → Workout)" }
      : { t: "Today's weights and reps fill in next time", s: "In a routine only where it hasn't done the exercise itself yet" };
  }
  if (!wo.prefillFromLast) return { t: "Starts from the routine's numbers", s: "Today's numbers show beside each set" };
  const done = w.value.exercises.filter((e) => e.status !== "skipped" && e.sets.some((x) => x.done) && !ruled.value.has(e.id))
    .map((e) => routineEx.value.get(e.routineExerciseId ?? "")).filter((r): r is NonNullable<typeof r> => !!r);
  const fixed = done.filter((r) => r.prefill === "target").map((r) => r.exercise?.name ?? "");
  if (fixed.length && fixed.length === done.length) return { t: "Starts from the routine's numbers", s: "Each of these exercises always starts with the routine's numbers" };
  // today becomes this routine's own last time, which comes first whatever "Last time's numbers come from" says
  return {
    t: fixed.length ? `Starts from today's weights and reps, except ${names(fixed)} (always start${fixed.length === 1 ? "s" : ""} from the routine's numbers)` : "Starts from today's weights and reps",
    s: "What you did fills in next time you do this routine",
  };
});
// the weight step: the exercise's own (its settings), else the routine exercise's progression step, else Settings'.
// Where a progression rule moves that routine exercise's weight next time, no suggestion: the rule decides. An
// exercise swapped in has the rule only when its swap is switched on (else next time starts with the routine's one)
const stepFor = (e: WorkoutExercise): number | null => {
  const slot = e.routineExerciseId ? routineEx.value.get(e.routineExerciseId) : undefined;
  const re = slot && (slot.exerciseId === e.exerciseId || d.routineChanges.includes(`swapped:${slot.id}`)) ? slot : undefined;
  if (re?.progression && W.settings.value.features.progression) return null;
  return e.exercise?.incrementKg || re?.progression?.incrementKg || W.incKg.value;
};
const more = computed(() => readyForMore(w.value, stepFor));
const taken = computed(() => more.value.filter((m) => !d.skipMore.includes(m.workoutExerciseId)));
// every weight change next time in one list, in the workout's order: a rule's (no switch) or a suggestion (a switch)
type NextRow = { id: string; rule: NextRule; m?: undefined } | { id: string; m: MoreWeight; rule?: undefined };
const nextRows = computed<NextRow[]>(() => w.value.exercises.flatMap((e): NextRow[] => {
  const rule = rules.value.find((r) => r.workoutExerciseId === e.id);
  if (rule) return [{ id: e.id, rule }];
  const m = more.value.find((x) => x.workoutExerciseId === e.id);
  return m ? [{ id: e.id, m }] : [];
}));
function toggleMore(id: string) {
  const i = d.skipMore.indexOf(id);
  if (i >= 0) d.skipMore.splice(i, 1); else d.skipMore.push(id);
}
// why the rule moves the weight ("missed reps 3 times in a row"); an older server only says which way
const ruleWhy = (r: NextRule) => (r.reason ? r.reason[0]!.toLowerCase() + r.reason.slice(1) : r.action === "add" ? "add weight" : "lower weight");
const range = (m: { reps: number; topReps: number }) => m.reps === m.topReps ? `${m.topReps}` : `${m.reps}-${m.topReps}`;
const next = (kg: number, reps: number | null) => `${fmt.value.w(kg)} ${fmt.value.wu}${reps ? ` × ${reps}` : ""}`;
// how this session differed from the routine, each change saved only when switched on
const changes = computed<StructureChange[]>(() => w.value.routineId && routine.data.value ? structureChanges(routine.data.value, w.value) : []);
const unticked = computed(() => w.value.exercises.reduce((a, e) => a + (e.status === "skipped" ? 0 : e.sets.filter((s) => !s.done).length), 0));
async function finish() {
  if (busy.value) return;
  busy.value = true;
  const id = w.value.id, prs = records.value;
  try {
    finishRest(true);
    // sets ticked while offline must reach the server first, or finishing would remove them as unticked
    if (!(await settle())) { toast("Can't reach the server yet: your sets are kept here. Finish again when you're back online.", { kind: "err" }); return; }
    await api.post(`/workouts/${id}/finish`, {
      rating: d.rating, notes: d.notes, bodyweightKg: d.bw ? fmt.value.toKg(d.bw) : null,
      routineChanges: d.routineChanges.filter((k) => changes.value.some((c) => c.key === k)),
      moreWeight: taken.value.map((m) => ({ exerciseId: m.exerciseId, weightKg: m.toKg, reps: m.reps })),
    });
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
        <div v-if="vsPlan" class="li"><Icon name="target" :size="18" class="fin-i" /><div class="grow"><div class="t">{{ vsPlan.t }}</div><div v-if="vsPlan.s" class="s">{{ vsPlan.s }}</div></div></div>
        <div class="li"><Icon :name="vsLast.trend ?? 'history'" :size="18" class="fin-i" :class="{ pos: vsLast.trend === 'up', neg: vsLast.trend === 'down' }" /><div class="grow"><div class="t">{{ vsLast.t }}</div><div class="s">{{ vsLast.s }}</div></div></div>
      </div>
    </div>
    <div class="spb"><WorkoutSoFar :w="w" final :vs-last="sc.vsLast" @open="emit('open', $event)" /></div>
    <div v-if="unticked" class="banner note"><Icon name="info" />{{ unticked }} set{{ unticked > 1 ? "s were" : " was" }} not ticked. They will be left out.</div>

    <div class="sh"><h2>Next time</h2></div>
    <div class="card">
      <div class="li"><Icon name="refresh" :size="18" class="fin-i" /><div class="grow"><div class="t">{{ startsFrom.t }}</div><div class="s">{{ startsFrom.s }}</div></div></div>
      <template v-for="x in nextRows" :key="x.id">
        <div v-if="x.rule" class="li"><Icon :name="x.rule.action === 'add' ? 'arrowUp' : 'arrowDown'" :size="18" class="fin-i" :class="x.rule.action === 'add' ? 'pos' : 'neg'" />
          <div class="grow" style="min-width:0"><div class="t ellipsis">{{ x.rule.name }}</div>
            <div class="s">Rule: {{ ruleWhy(x.rule) }} · next time <b class="fin-next">{{ next(x.rule.weightKg, x.rule.reps) }}</b></div></div></div>
        <label v-else-if="x.m" class="tgl"><Icon name="arrowUp" :size="18" class="fin-i pos" />
          <div class="grow" style="min-width:0"><div class="t ellipsis">{{ x.m.name }}</div>
            <div class="s">{{ x.m.topReps }} reps in every set at {{ fmt.w(x.m.fromKg) }} {{ fmt.wu }} · next time <b class="fin-next">{{ next(x.m.toKg, x.m.reps) }}</b></div></div>
          <span class="tg"><input type="checkbox" :checked="!d.skipMore.includes(x.m.workoutExerciseId)" @change="toggleMore(x.m.workoutExerciseId)" /></span></label>
      </template>
    </div>
    <p v-if="more.length" class="tiny fin-note">You reached the top of the rep range ({{ more.length === 1 ? range(more[0]!) : "each one's" }}) in every set: up one weight step, reps back to the bottom. Switch off any you'd rather repeat.</p>
    <p v-if="rules.length" class="tiny fin-note">Rules are each exercise's progression rule. Change one in the routine's editor.</p>

    <template v-if="changes.length">
      <div class="sh"><h2>Routine changes</h2></div>
      <RoutineChanges v-model="d.routineChanges" :changes="changes" />
    </template>

    <div class="sh"><h2>How it went</h2></div>
    <div class="fld"><label>How did it feel?</label><div class="seg block"><button v-for="k in 5" :key="k" :class="{ on: d.rating === k }" @click="d.rating = d.rating === k ? null : k">{{ ["Awful", "Meh", "OK", "Good", "Great"][k - 1] }}</button></div></div>
    <div class="fld"><label>Notes</label><textarea v-model="d.notes" rows="3" placeholder="Anything to remember about this workout" /></div>
    <div class="fld"><label>Body weight today ({{ fmt.wu }}, optional)</label><input v-model.number="d.bw" type="number" inputmode="decimal" step="0.1" /></div>
    <button class="qb danger fin-cancel" @click="emit('cancel')"><Icon name="trash" :size="16" />Cancel the workout instead (nothing is saved)</button>
    <template #foot><button class="btn o" @click="emit('close')">Keep going</button><button class="btn" :disabled="busy" @click="finish">Finish</button></template>
  </Sheet>
</template>

<style scoped>
.fin-note { margin-top: var(--hg); }
.fin-next { color: var(--tx); font-weight: 600; white-space: nowrap; }
.fin-time { font-size: 34px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.fin-hero .list { margin-top: var(--lpy); }
.fin-hero .li:last-child { border-bottom: 0; }
.fin-cancel { margin-top: calc(var(--spg) * 1.75); }
.fin-i { flex: none; color: var(--tx2); }
.fin-i.pos { color: var(--pos); }
.fin-i.neg { color: var(--neg); }
</style>
