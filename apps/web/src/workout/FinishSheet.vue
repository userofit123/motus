<script setup lang="ts">
// Finishing: the workout's summary first (time, how it went against the plan and against last time, what was done),
// then what it means for next time, kept as two separate things: next time's numbers (the routine has today's, then
// Progression; a short summary here, the details and the Apply switches in the "Next time" sheet) and how this session
// differed from the routine (listed, each saved only when switched on). Then how it felt, notes, body weight.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { applyStructure, planNext, startRepsOf, structureChanges, todaysSets, usesReps, usesWeight, workoutScore, workoutSoFar, type Routine, type StructureChange, type Tracking, type Workout } from "@motus/shared";
import { useWorkout, endWorkout, finishDraft } from "./useWorkout";
import { api } from "../api/client";
import { settle } from "../api/outbox";
import { invalidate } from "../api/live";
import { useRoutine } from "../api/queries";
import { toast, toastError } from "../core/toast";
import { elapsed, finishRest } from "./runtime";
import { keepAwake } from "./native";
import { maybeAutoBackup } from "../core/backup";
import { setLabel } from "../core/format";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import WorkoutSoFar from "./WorkoutSoFar.vue";
import RoutineChanges from "./RoutineChanges.vue";
import NextTimeSheet, { type NextGroup, type NextSet } from "./NextTimeSheet.vue";

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
// slot, set counts saved change its sets. Here a short summary; the "Next time" sheet lists, set by set, each exercise
// whose numbers change against that routine before this workout. "Automatic" changes just apply; a "Suggest" one only
// when its Apply switch is on
const routine = useRoutine(computed(() => w.value.routineId ?? ""));
type Item = Routine["exercises"][number];
type RSet = Item["sets"][number];
// the routine as the switched-on changes leave it; exercises added today come in without an id (they carry the workout
// exercise they came from)
type Shaped = Item & { fromWorkoutExerciseId?: string };
const shaped = computed<Shaped[]>(() => {
  const r = routine.data.value as Routine | undefined;
  if (!r) return [];
  return (applyStructure(r, w.value, d.routineChanges) ?? r.exercises) as Shaped[];
});
const plan = computed(() => planNext(shaped.value, w.value, { ...W.settings.value.progression, stepKg: W.incKg.value }, d.accepted));
// the range itself (repsMax) is never shown here, so a change to it alone is not a row
const FIELDS = ["kind", "weightKg", "reps", "startReps", "durationS", "distanceM"] as const;
const sameSet = (a: RSet | undefined, b: RSet) => !!a && FIELDS.every((k) => (a[k] ?? null) === (b[k] ?? null));
// a set's numbers as next time starts them: "20 kg × 10", "12 reps", "1:00"; "-" when it has none. The reps you'll do
// (with a range, its starting reps), never the range: a change of reps inside it shows as one
const setText = (x: RSet, t: Tracking) => numbersText({ ...x, reps: startRepsOf(x) }, t);
// a set's numbers as text, "-" when it has none: next time's (setText) and what was done today
type Nums = { weightKg: number | null; reps: number | null; durationS?: number | null; distanceM?: number | null };
const numbersText = (x: Nums, t: Tracking) => numbersParts(x, t).join(" ");
// the same numbers in parts ("47.5 kg", "× 12"): the Next time table puts each on its own line, as a phone has no room
// for three "47.5 kg × 12" side by side
function numbersParts(x: Nums, t: Tracking) {
  const f = fmt.value;
  const kg = x.weightKg != null && usesWeight(t) ? f.wu_(x.weightKg) : "";
  const reps = x.reps == null || !usesReps(t) ? "" : String(x.reps);
  const r = reps ? (kg ? `× ${reps}` : `${reps} rep${reps === "1" ? "" : "s"}`) : "";
  const parts = [kg, r, x.durationS ? f.clock(x.durationS) : "", x.distanceM ? f.dist(x.distanceM) : ""].filter(Boolean);
  return parts.length ? parts : ["-"];
}
// an exercise's working sets in short, runs of the same numbers counted: "3 × 20 kg × 10", "2 × 20 kg × 10, 25 kg × 8"
function setsText(sets: RSet[], t: Tracking) {
  const runs: { k: number; text: string }[] = [];
  for (const x of sets.filter((x) => x.kind !== "warmup")) {
    const text = setText(x, t), last = runs.at(-1);
    if (last?.text === text) last.k++; else runs.push({ k: 1, text });
  }
  if (!runs.length || runs.every((x) => x.text === "-")) return n(runs.reduce((a, x) => a + x.k, 0), "set");
  return runs.map((x) => (x.k > 1 ? `${x.k} × ${x.text}` : x.text)).join(", ");
}
// sets left unticked with numbers typed in: finishing drops them. Compared with the numbers the set started with (a
// lighter week or a reminder may have moved them off the routine's), so only sets you edited count; prefilled ones and
// workouts started before sets kept their start fall back to the routine's target
type WSet = Workout["exercises"][number]["sets"][number];
const edited = (s: WSet) => {
  if (s.prefilled) return false;
  const kept = s.startWeightKg != null || s.startReps != null;
  const w0 = kept ? s.startWeightKg ?? null : s.targetWeightKg, r0 = kept ? s.startReps ?? null : s.targetReps;
  return (s.weightKg != null && s.weightKg !== w0) || (s.reps != null && s.reps !== r0);
};
const typedUnticked = (e: Workout["exercises"][number]) => e.status !== "skipped" && e.sets.some((s) => !s.done && edited(s));
const nextTime = computed(() => {
  const groups: NextGroup[] = [], unchanged: { id: string; name: string; fixed: boolean; sets: string }[] = [];
  const listed = new Set<number>();
  // "before" is the routine as it is now, not as the switched-on changes reshape it
  const orig = new Map(((routine.data.value as Routine | undefined)?.exercises ?? []).map((x) => [x.id, x] as const));
  shaped.value.forEach((item, i) => {
    const after = plan.value.exercises[i]!;
    const was = item.id ? orig.get(item.id) : undefined;
    const index = item.id ? w.value.exercises.findIndex((e) => e.routineExerciseId === item.id && e.exerciseId === item.exerciseId)
      : w.value.exercises.findIndex((e) => e.id === item.fromWorkoutExerciseId);
    const e = w.value.exercises[index];
    const name = e?.exercise?.name ?? item.exercise?.name ?? "";
    const t = (e?.exercise?.tracking ?? item.exercise?.tracking ?? "weight_reps") as Tracking;
    // a swap switched on puts another exercise in the slot: nothing of the old one carries over, so its sets are all new
    const swapped = !!was && was.exerciseId !== item.exerciseId;
    const note = !was ? "New in the routine" : swapped ? `Was: ${was.exercise?.name ?? ""}` : undefined;
    const before = (was && !swapped ? was.sets : []) as RSet[];
    // today's set in each place, the one its numbers came from (the routine before Progression pairs like the one after)
    const did = e ? todaysSets(item.sets as RSet[], e) : [];
    const aft = after.sets as RSet[], sides = !!W.settings.value.features.unilateral;
    const rows = aft.flatMap((x, j): NextSet[] => {
      const b = before[j];
      if (sameSet(b, x)) return [];
      // planned: where the routine started this set before; did: today's ticked set in its place; next: where next time
      // starts it. A row only when planned and next read differently
      if ((b ? setText(b, t) : "-") === setText(x, t)) return [];
      const planned = b ? numbersParts({ ...b, reps: startRepsOf(b) }, t) : ["-"], next = numbersParts({ ...x, reps: startRepsOf(x) }, t);
      const d0 = did[j], done = d0 ? numbersParts(d0, t) : ["-"];
      // the arrow says what changes in the routine: next time against the plan (today's only when nothing was planned)
      const base = b ? b.weightKg : d0?.weightKg;
      const delta = base != null && x.weightKg != null ? (x.weightKg - base) * (t === "assisted" ? -1 : 1) : 0;
      return [{ key: j, label: setLabel(aft, j, sides), kind: x.kind, side: sides ? x.side ?? null : null, planned, did: done, next, trend: delta > 0 ? "up" : delta < 0 ? "down" : null }];
    });
    // a run of numbered working sets in a row reading the same folds into one row, "1-6", like the routine's sets in
    // short ("3 × 20 kg"). Warm-ups, drops and to-failure sets have no number to make a range of ("W-W"), and left and
    // right sets keep a row each: "1L-1R" would hide which side the range is
    const sets: NextSet[] = [];
    const same = (a: string[], b: string[]) => a.join(" ") === b.join(" ");
    for (const r of rows) {
      const last = sets.at(-1);
      if (last && last.lastKey === r.key - 1 && r.kind === "normal" && last.kind === "normal" && !r.side && !last.side && same(last.planned, r.planned) && same(last.did, r.did) && same(last.next, r.next) && last.trend === r.trend) {
        last.lastKey = r.key; last.label = `${last.label.split("-")[0]}-${r.label}`;
      } else sets.push({ ...r, lastKey: r.key });
    }
    const change = item.id ? plan.value.changes.find((c) => c.routineExerciseId === item.id) : undefined;
    const unticked = !!e && typedUnticked(e);
    if (e) listed.add(index);
    const id = item.id ?? e?.id ?? `new-${i}`;
    if (sets.length || change || unticked || note) groups.push({ id, index, name, note, sets, change, unticked, assisted: t === "assisted" });
    else unchanged.push({ id, name, fixed: !!item.fixed, sets: setsText(after.sets as RSet[], t) });
  });
  // exercises outside the routine lose their unticked sets too
  w.value.exercises.forEach((e, index) => {
    if (!listed.has(index) && typedUnticked(e)) groups.push({ id: e.id, index, name: e.exercise?.name ?? "", sets: [], unticked: true, assisted: e.exercise?.tracking === "assisted" });
  });
  return { groups, unchanged };
});
// the Finish screen's summary of it: a line for each thing that applies, suggestions to review in the accent colour
const nextSummary = computed(() => {
  const { groups } = nextTime.value, ch = plan.value.changes;
  const lines: { icon: string; text: string; tone?: "pos" | "neg" | "acc" }[] = [];
  const auto = (dir: "up" | "down") => ch.filter((c) => c.mode === "auto" && c.direction === dir).length;
  const sug = ch.filter((c) => c.mode === "suggest"), on = sug.filter((c) => d.accepted.includes(c.routineExerciseId)).length;
  const fresh = groups.filter((g) => g.sets.length).length, unticked = groups.filter((g) => g.unticked).length;
  if (fresh) lines.push({ icon: "refresh", text: `${n(fresh, "exercise has", "exercises have")} new numbers` });
  if (auto("up")) lines.push({ icon: "arrowUp", text: `${n(auto("up"), "weight goes", "weights go")} up automatically`, tone: "pos" });
  if (auto("down")) lines.push({ icon: "arrowDown", text: `${n(auto("down"), "weight goes", "weights go")} down automatically`, tone: "neg" });
  // in the accent colour until every suggestion is switched on
  if (sug.length) lines.push({ icon: "sparkle", tone: on < sug.length ? "acc" : undefined,
    text: !on ? `${n(sug.length, "suggestion", "suggestions")} to review` : on === sug.length ? `${n(on, "suggestion", "suggestions")} applied` : `${on} of ${sug.length} suggestions applied` });
  if (unticked) lines.push({ icon: "info", text: `${n(unticked, "exercise has", "exercises have")} sets you didn't tick`, tone: "acc" });
  return lines;
});
const showNext = ref(false);
function goTo(index: number) { showNext.value = false; emit("open", index); }
// how this session differed from the routine, each change saved only when switched on
const changes = computed<StructureChange[]>(() => w.value.routineId && routine.data.value ? structureChanges(routine.data.value, w.value) : []);
const hasNext = computed(() => !!w.value.routineId && shaped.value.length > 0);
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
      accepted: d.accepted.filter((x) => plan.value.changes.some((c) => c.routineExerciseId === x && c.mode === "suggest")),
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
    <!-- with a routine, the Next time card points out unticked sets; without one this is the only place -->
    <div v-if="unticked && !hasNext" class="banner note"><Icon name="info" />{{ unticked }} set{{ unticked > 1 ? "s weren't" : " wasn't" }} ticked and won't be saved</div>

    <template v-if="hasNext">
      <div class="sh"><h2>Next time</h2></div>
      <div class="card spb">
        <div class="li click nt-sum" role="button" tabindex="0" @click="showNext = true" @keydown.enter="showNext = true">
          <span class="bi sg"><Icon name="routines" :size="17" /></span>
          <div class="grow" style="min-width:0">
            <div class="t">The routine's numbers</div>
            <div v-if="!nextSummary.length" class="s">The routine stays the same</div>
            <div v-for="x in nextSummary" :key="x.text" class="nt-line" :class="x.tone"><Icon :name="x.icon" :size="14" />{{ x.text }}</div>
          </div>
          <Icon name="right" :size="16" class="muted" />
        </div>
      </div>
      <NextTimeSheet v-if="showNext" v-model="d.accepted" :groups="nextTime.groups" :unchanged="nextTime.unchanged" @close="showNext = false" @open="goTo" />
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
.nt-sum { align-items: flex-start; }
.nt-sum > .muted { align-self: center; }
.nt-sum .t { margin-bottom: var(--tdy); }
.nt-line { display: flex; align-items: center; gap: var(--tdy); font-size: var(--fs-sm); color: var(--tx2); line-height: 1.6; }
.nt-line .ico { flex: none; }
.nt-line.pos .ico { color: var(--pos); }
.nt-line.neg .ico { color: var(--neg); }
.nt-line.acc { color: var(--acc); font-weight: 600; }
.fin-time { font-size: 34px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.fin-hero .list { margin-top: var(--lpy); }
.fin-hero .li:last-child { border-bottom: 0; }
.fin-cancel { margin-top: calc(var(--spg) * 1.75); }
.fin-i { flex: none; color: var(--tx2); }
.fin-i.pos { color: var(--pos); }
.fin-i.neg { color: var(--neg); }
</style>
