<script setup lang="ts">
// Finishing: the workout's summary first (time, how it went against the plan and against last time, what was done),
// then what it means for next time, kept as two separate things: next time's numbers (filled in from today, plus a
// weight step up where the top of the rep range was reached, each one can be switched off) and the routine's layout
// (exercises or sets changed today: listed, and only saved when switched on). Then how it felt, notes, body weight.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { readyForMore, structureChanges, workoutScore, workoutSoFar, type Routine, type StructureChange, type WorkoutExercise } from "@motus/shared";
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
// next time's numbers: Settings → Workout → "Start from what you did last time" (the saved choice, not a change made
// for this workout only on the routine's start screen, as next time starts from the saved one)
const routine = useRoutine(computed(() => w.value.routineId ?? ""));
const fromToday = computed(() => W.settings.value.workout.prefillFromLast);
// the weight step: the exercise's own (its settings), else the routine exercise's progression step, else Settings'.
// Where the Progression feature already moves that routine exercise's weight next time, no suggestion here: it would
// add a second step on top of progression's
const routineEx = computed(() => new Map(((routine.data.value as Routine | undefined)?.exercises ?? []).filter((r) => r.id).map((r) => [r.id!, r])));
const stepFor = (e: WorkoutExercise): number | null => {
  const re = e.routineExerciseId ? routineEx.value.get(e.routineExerciseId) : undefined;
  if (re?.progression && W.settings.value.features.progression) return null;
  return e.exercise?.incrementKg || re?.progression?.incrementKg || W.incKg.value;
};
const more = computed(() => readyForMore(w.value, stepFor));
const taken = computed(() => more.value.filter((m) => !d.skipMore.includes(m.workoutExerciseId)));
function toggleMore(id: string) {
  const i = d.skipMore.indexOf(id);
  if (i >= 0) d.skipMore.splice(i, 1); else d.skipMore.push(id);
}
const range = (m: { reps: number; topReps: number }) => m.reps === m.topReps ? `${m.topReps}` : `${m.reps}-${m.topReps}`;
const next = (m: { toKg: number; reps: number }) => `${fmt.value.w(m.toKg)} ${fmt.value.wu} × ${m.reps}`;
// the routine's layout: what saving would change, against the routine as it is now
const changes = computed<StructureChange[]>(() => w.value.routineId && routine.data.value ? structureChanges(routine.data.value, w.value) : []);
const CHANGE_ICON: Record<StructureChange["kind"], string> = { added: "plus", removed: "minus", swapped: "swap", sets: "layers", order: "drag" };
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
      saveLayout: changes.value.length > 0 && d.saveLayout,
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
      <div class="li"><Icon name="refresh" :size="18" class="fin-i" /><div class="grow"><div class="t">{{ fromToday ? "Starts from today's weights and reps" : "Starts from the routine's numbers" }}</div>
        <div class="s">{{ fromToday ? "What you did fills in next time" : "Today's numbers show beside each set" }}</div></div></div>
      <label v-for="m in more" :key="m.workoutExerciseId" class="tgl"><Icon name="arrowUp" :size="18" class="fin-i pos" />
        <div class="grow" style="min-width:0"><div class="t ellipsis">{{ m.name }}</div>
          <div class="s">{{ m.topReps }} reps in every set at {{ fmt.w(m.fromKg) }} {{ fmt.wu }} · next time <b class="fin-next">{{ next(m) }}</b></div></div>
        <span class="tg"><input type="checkbox" :checked="!d.skipMore.includes(m.workoutExerciseId)" @change="toggleMore(m.workoutExerciseId)" /></span></label>
    </div>
    <p v-if="more.length" class="tiny fin-note">You reached the top of the rep range ({{ more.length === 1 ? range(more[0]!) : "each one's" }}) in every set: up one weight step, reps back to the bottom. Switch off any you'd rather repeat.</p>

    <template v-if="changes.length">
      <div class="sh"><h2>Routine changes</h2></div>
      <p class="tiny hgap">Today's layout differs from the routine. These stay in this workout unless you save them.</p>
      <div class="card">
        <div v-for="c in changes" :key="c.text" class="li"><Icon :name="CHANGE_ICON[c.kind]" :size="18" class="fin-i" /><div class="grow" style="min-width:0"><div class="t">{{ c.text }}</div></div></div>
        <label class="tgl"><div class="grow"><div class="t">Save these changes to the routine</div><div class="s">{{ d.saveLayout ? "The routine changes as listed. Its weights and reps stay as set." : "Off: the routine stays as it is" }}</div></div>
          <span class="tg"><input v-model="d.saveLayout" type="checkbox" /></span></label>
      </div>
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
