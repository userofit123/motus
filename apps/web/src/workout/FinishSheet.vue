<script setup lang="ts">
// Finishing: the workout's summary first (time, how it went against the plan and against last time, what was done),
// then what it means for next time, kept as two separate things: next time's numbers (the routine has today's, then
// Progression; every routine exercise done is listed, a "Suggest" change with its switch) and how this session differed
// from the routine (listed, each saved only when switched on). Then how it felt, notes, body weight.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { applyStructure, planNext, structureChanges, workoutScore, workoutSoFar, type NextChange, type Routine, type StructureChange } from "@motus/shared";
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
// next time: the routine has today's numbers, then Progression (planNext, the very function the engine saves with at
// the finish), on the routine as the switched-on "Routine changes" leave it: a swap saved puts today's exercise in the
// slot, set counts saved change its sets. Every routine exercise done today is listed with next time's numbers and the
// difference from today; "Suggest" changes have a switch, "Automatic" ones just say so
const routine = useRoutine(computed(() => w.value.routineId ?? ""));
type Item = Routine["exercises"][number];
const shaped = computed<Item[]>(() => {
  const r = routine.data.value as Routine | undefined;
  if (!r) return [];
  return ((applyStructure(r, w.value, d.routineChanges) ?? r.exercises) as Item[]).filter((x) => x.id);
});
const plan = computed(() => planNext(shaped.value, w.value, { ...W.settings.value.progression, stepKg: W.incKg.value }, d.declined));
const deciding = (k: string) => k !== "warmup" && k !== "drop";
const heaviest = (sets: { kind: string; weightKg: number | null }[]) => {
  const ws = sets.filter((x) => deciding(x.kind) && x.weightKg != null).map((x) => x.weightKg!);
  return ws.length ? Math.max(...ws) : null;
};
type NextRow = { id: string; name: string; next: string; diff: number | null; fixed: boolean; change?: NextChange; on: boolean };
const nextRows = computed<NextRow[]>(() => w.value.exercises.flatMap((e): NextRow[] => {
  if (e.status === "skipped" || !e.sets.some((x) => x.done) || !e.routineExerciseId) return [];
  const i = shaped.value.findIndex((x) => x.id === e.routineExerciseId && x.exerciseId === e.exerciseId);
  if (i < 0) return [];
  const item = plan.value.exercises[i]!;
  const sets = item.sets as Item["sets"];
  const first = sets.find((x) => deciding(x.kind)) ?? sets[0];
  const today = heaviest(e.sets.filter((x) => x.done)), next = heaviest(sets);
  const change = plan.value.changes.find((c) => c.routineExerciseId === item.id);
  return [{
    id: item.id!, name: e.exercise?.name ?? "", next: first ? numbers(first) : "-", fixed: !!item.fixed, change,
    diff: today != null && next != null ? Math.round((next - today) * 100) / 100 : null, on: !!change && (change.mode === "auto" || !d.declined.includes(item.id!)),
  }];
}));
// next time's numbers on its first working set: "62.5 kg × 8", "12 reps", "1:00"
function numbers(x: Item["sets"][number]) {
  const f = fmt.value;
  if (x.weightKg != null && x.reps != null) return `${f.wu_(x.weightKg)} × ${x.reps}`;
  if (x.reps != null) return `${x.reps} reps`;
  if (x.durationS != null) return f.clock(x.durationS);
  if (x.distanceM != null) return f.dist(x.distanceM);
  return x.weightKg != null ? f.wu_(x.weightKg) : "-";
}
function toggleNext(id: string) {
  const i = d.declined.indexOf(id);
  if (i >= 0) d.declined.splice(i, 1); else d.declined.push(id);
}
const diffText = (r: NextRow) => (r.fixed ? "Fixed numbers" : !r.diff ? "Same as today" : `${r.diff > 0 ? "+" : "-"}${fmt.value.wu_(Math.abs(r.diff))}`);
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
      declined: d.declined.filter((x) => plan.value.changes.some((c) => c.routineExerciseId === x && c.mode === "suggest")),
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

    <template v-if="w.routineId && nextRows.length">
      <div class="sh"><h2>Next time</h2></div>
      <div class="card">
        <div class="li fin-lead"><Icon name="refresh" :size="18" class="fin-i" /><div class="grow t">The routine now has today's numbers</div></div>
        <component :is="r.change?.mode === 'suggest' ? 'label' : 'div'" v-for="r in nextRows" :key="r.id" :class="r.change?.mode === 'suggest' ? 'tgl' : 'li'">
          <Icon :name="r.fixed ? 'lock' : r.diff && r.diff > 0 ? 'arrowUp' : r.diff && r.diff < 0 ? 'arrowDown' : 'check'" :size="18" class="fin-i" :class="{ pos: !r.fixed && (r.diff ?? 0) > 0, neg: !r.fixed && (r.diff ?? 0) < 0 }" />
          <div class="grow" style="min-width:0">
            <!-- the name gets its own line; next time's numbers and the reason sit under it in the small line -->
            <div class="t ellipsis">{{ r.name }}</div>
            <div class="s">Next time {{ r.next }}<template v-if="r.change"> · {{ r.change.reason }}</template><template v-if="r.change?.mode === 'auto'"> · Automatic</template></div>
          </div>
          <span class="mchip fin-diff" :class="{ pos: !r.fixed && (r.diff ?? 0) > 0, neg: !r.fixed && (r.diff ?? 0) < 0 }">{{ diffText(r) }}</span>
          <span v-if="r.change?.mode === 'suggest'" class="tg"><input type="checkbox" :checked="r.on" :aria-label="`${r.change.direction === 'up' ? 'Raise' : 'Lower'} the weight for ${r.name}`" @change="toggleNext(r.id)" /></span>
        </component>
      </div>
    </template>

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
.fin-diff { flex: none; }
.fin-diff.pos { color: var(--pos); }
.fin-diff.neg { color: var(--neg); }
.fin-lead .t { color: var(--tx2); }
.fin-time { font-size: 34px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.fin-hero .list { margin-top: var(--lpy); }
.fin-hero .li:last-child { border-bottom: 0; }
.fin-cancel { margin-top: calc(var(--spg) * 1.75); }
.fin-i { flex: none; color: var(--tx2); }
.fin-i.pos { color: var(--pos); }
.fin-i.neg { color: var(--neg); }
</style>
