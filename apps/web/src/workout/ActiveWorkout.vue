<script setup lang="ts">
// The running workout (PLAN.md §8.5). Phone: one exercise at a time (swipe between them), the rest timer as a bottom
// sheet. Computer: the list on the left, the current exercise in the middle, the timer and notes on the right.
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { clock, muscleName } from "@motus/shared";
import { useWorkout } from "./useWorkout";
import { elapsed, rest, finishRest } from "./runtime";
import { keepAwake } from "./native";
import { isPhone } from "../core/device";
import { confirm, prompt } from "../core/ask";
import { noteSheet, reminderSheet } from "../core/ui";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { waiting } from "../api/outbox";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Sheet from "../components/Sheet.vue";
import ExerciseCard from "./ExerciseCard.vue";
import RestPanel from "./RestPanel.vue";
import FinishSheet from "./FinishSheet.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import WorkoutSettings from "../components/WorkoutSettings.vue";

const router = useRouter();
const W = useWorkout();
// the exercise card slides in from the side you're moving to
const exDir = ref("nx");
watch(() => W.state.cur, (n, o) => { exDir.value = n >= o ? "nx" : "pv"; });
const w = computed(() => W.state.w);
const fmt = W.fmt;
const finishing = ref(false), adding = ref(false), settingsOpen = ref(false), listOpen = ref(false);
const overrides = computed({ get: () => (w.value?.settings ?? {}) as Record<string, unknown>, set: (v) => W.patchWorkout({ settings: v }) });
// keys on a computer: Space ticks the next set, arrows move between exercises
function key(ev: KeyboardEvent) {
  if ((ev.target as HTMLElement).closest("input,textarea,select") || document.querySelector(".scr")) return;
  const e = w.value?.exercises[W.state.cur];
  if (ev.key === " " && e) { const i = e.sets.findIndex((x) => !x.done); if (i >= 0) { ev.preventDefault(); W.tick(e, i); } }
  if (ev.key === "ArrowRight") go(W.state.cur + 1);
  if (ev.key === "ArrowLeft") go(W.state.cur - 1);
}
onMounted(() => { if (W.prefs.value.keepAwake) keepAwake(true); addEventListener("keydown", key); });
onBeforeUnmount(() => { keepAwake(false); removeEventListener("keydown", key); });
watch(() => W.active.isFetched.value && !W.active.data.value && !W.state.pending, (gone) => { if (gone) router.replace("/"); });

const done = computed(() => w.value?.exercises.flatMap((e) => e.sets).filter((s) => s.done).length ?? 0);
const total = computed(() => w.value?.exercises.filter((e) => e.status !== "skipped").flatMap((e) => e.sets).length ?? 0);
const volume = computed(() => w.value?.exercises.flatMap((e) => e.sets).filter((s) => s.done && s.kind !== "warmup").reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0) ?? 0);
const remainingS = computed(() => {
  // a rough "time left": undone sets × (their own time + their rest)
  let t = 0;
  for (const e of w.value?.exercises ?? []) if (e.status !== "skipped") for (const s of e.sets) if (!s.done) t += (s.durationS ?? (s.reps ?? 8) * 3 + 10) + (s.restPlannedS ?? W.prefs.value.restBetweenSetsS);
  return t;
});
const paused = computed(() => !!w.value?.pauseStartedAt);
const statusOf = (e: any) => (e.status === "skipped" ? "skip" : e.status === "done" || e.status === "partial" ? "done" : "");

// phone: swipe left and right between exercises
let x0 = 0, y0 = 0;
const ts = (e: TouchEvent) => { x0 = e.touches[0]!.clientX; y0 = e.touches[0]!.clientY; };
const te = (e: TouchEvent) => {
  const dx = e.changedTouches[0]!.clientX - x0, dy = e.changedTouches[0]!.clientY - y0;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && !(e.target as HTMLElement).closest("input")) go(W.state.cur + (dx < 0 ? 1 : -1));
};
const go = (i: number) => { if (w.value && i >= 0 && i < w.value.exercises.length) W.state.cur = i; };

async function discard() {
  if (!(await confirm("Discard this workout?", { text: "Nothing from it will be saved.", ok: "Discard", danger: true }))) return;
  finishRest(false);
  await api.post(`/workouts/${w.value!.id}/discard`);
  invalidate(["workouts", "home", "calendar"]);
  router.replace("/");
}
async function rename() { const n = await prompt("Workout name", { value: w.value!.name }); if (n) W.patchWorkout({ name: n }); }
const move = (i: number, d: number) => { const ids = w.value!.exercises.map((e) => e.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; W.reorder(ids); };
const menu = computed(() => [
  { label: "Add exercise", icon: "plus", run: () => (adding.value = true) },
  { label: "Reorder exercises", icon: "routines", run: () => (listOpen.value = true), hidden: !isPhone.value },
  { label: "Workout note", icon: "note", run: () => (noteSheet.value = { targets: [{ type: "workout", id: w.value!.id, label: "This workout" }, ...(w.value!.routineId ? [{ type: "routine", id: w.value!.routineId, label: "The routine" }] : [])], workoutId: w.value!.id }) },
  { label: "Remind me next time (routine)", icon: "bell", run: () => (reminderSheet.value = { targetType: "routine", targetId: w.value!.routineId!, label: w.value!.name, workoutId: w.value!.id }), hidden: !w.value?.routineId },
  { label: paused.value ? "Resume" : "Pause the clock", icon: paused.value ? "play" : "pause", run: () => W.patchWorkout({ pause: !paused.value, pauseStartedAt: paused.value ? null : new Date().toISOString() }) },
  { label: "Workout settings", icon: "settings", run: () => (settingsOpen.value = true) },
  { label: "Rename", icon: "edit", run: rename },
  { label: "Discard workout", icon: "trash", danger: true, sep: true, run: discard },
]);
</script>

<template>
  <div v-if="w" class="page wide" :style="isPhone ? { paddingBottom: '200px' } : undefined">
    <div class="aw-top">
      <button class="ib sm plain" aria-label="Back" @click="router.push('/')"><Icon name="down" /></button>
      <div class="grow">
        <div style="font-weight:600;font-size:17px" class="ellipsis">{{ w.name }}</div>
        <div class="clock">{{ clock(elapsed(w)) }}{{ paused ? " · paused" : "" }} · {{ done }}/{{ total }} sets<template v-if="!isPhone"> · {{ fmt.vol(volume) }} · ~{{ Math.round(remainingS / 60) }} min left</template><template v-if="waiting.length"> · {{ waiting.length }} waiting to sync</template></div>
      </div>
      <button class="btn" :class="{ o: done === 0 }" @click="finishing = true">Finish</button>
      <Menu :items="menu" />
    </div>
    <div v-for="m in w.reminders" :key="m.id" class="banner"><Icon name="bell" /><b>{{ m.body }}</b></div>
    <div v-for="n in w.routineNotes?.filter((x) => x.pinned)" :key="n.id" class="banner note"><Icon name="note" />{{ n.body }}</div>

    <div v-if="!w.exercises.length" class="card empty"><Icon name="dumbbell" :size="34" /><b>Add your first exercise</b><button class="btn" @click="adding = true">Add exercises</button></div>

    <!-- phone -->
    <template v-else-if="isPhone">
      <div class="aw-dots"><i v-for="(e, i) in w.exercises" :key="e.id" :class="[statusOf(e), { cur: i === W.state.cur }]" @click="go(i)" /></div>
      <div class="card" @touchstart.passive="ts" @touchend.passive="te">
        <Transition :name="exDir" mode="out-in"><ExerciseCard v-if="w.exercises[W.state.cur]" :key="w.exercises[W.state.cur]!.id" :e="w.exercises[W.state.cur]!" :index="W.state.cur" /></Transition>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="qb" :disabled="W.state.cur === 0" @click="go(W.state.cur - 1)"><Icon name="left" :size="16" />Previous</button>
        <div class="grow center tiny">{{ W.state.cur + 1 }} of {{ w.exercises.length }}</div>
        <button class="qb" :disabled="W.state.cur >= w.exercises.length - 1" @click="go(W.state.cur + 1)">Next<Icon name="right" :size="16" /></button>
      </div>
      <button class="qb" style="margin:12px auto 0;display:flex" @click="adding = true"><Icon name="plus" :size="16" />Add exercise</button>
      <RestPanel variant="sheet" />
    </template>

    <!-- computer -->
    <div v-else class="aw-desk">
      <div class="card side aw-list" style="padding:10px">
        <TransitionGroup name="mv">
        <div v-for="(e, i) in w.exercises" :key="e.id" class="li" :class="{ cur: i === W.state.cur, skip: e.status === 'skipped' }" @click="go(i)">
          <span class="stt" :class="{ done: e.status === 'done', part: e.status === 'partial' || (e.status === 'pending' && e.sets.some((s) => s.done)) }"><Icon v-if="e.status === 'done'" name="check" :size="13" /></span>
          <div class="grow"><div class="t ellipsis">{{ e.exercise?.name }}</div><div class="s">{{ e.sets.filter((s) => s.done).length }}/{{ e.sets.length }} sets{{ e.superset ? ` · ${e.superset}` : "" }}</div></div>
          <span v-if="i === W.state.cur" class="col" style="gap:0" @click.stop><button class="ib sm plain" style="width:26px;height:22px" aria-label="Move up" @click="move(i, -1)"><Icon name="up" :size="14" /></button><button class="ib sm plain" style="width:26px;height:22px" aria-label="Move down" @click="move(i, 1)"><Icon name="down" :size="14" /></button></span>
        </div>
        </TransitionGroup>
        <button class="qb acc" style="margin-top:6px" @click="adding = true"><Icon name="plus" :size="16" />Add exercise</button>
      </div>
      <div class="card"><Transition name="sw" mode="out-in"><ExerciseCard v-if="w.exercises[W.state.cur]" :key="w.exercises[W.state.cur]!.id" :e="w.exercises[W.state.cur]!" :index="W.state.cur" /></Transition></div>
      <div class="side col" style="gap:var(--spg)">
        <RestPanel variant="ring" />
        <div v-if="!rest.endAt" class="card">
          <div class="lbl">Up next</div>
          <div style="font-weight:600;margin-top:4px">{{ w.exercises.find((e, i) => i > W.state.cur && e.status === "pending")?.exercise.name ?? "Last exercise" }}</div>
          <div class="tiny" style="margin-top:6px">Rest between sets {{ fmt.clock(w.exercises[W.state.cur]?.restS ?? W.prefs.value.restBetweenSetsS) }} · after {{ fmt.clock(w.exercises[W.state.cur]?.restAfterS ?? W.prefs.value.restAfterExerciseS) }}</div>
        </div>
        <div class="card">
          <div class="grid g2" style="gap:10px">
            <div><div class="lbl">Volume</div><div style="font-weight:600;font-size:18px">{{ fmt.vol(volume) }}</div></div>
            <div><div class="lbl">Time left</div><div style="font-weight:600;font-size:18px">~{{ Math.round(remainingS / 60) }} min</div></div>
          </div>
          <div class="chips" style="margin-top:10px"><span v-for="m in [...new Set(w.exercises.filter((e) => e.sets.some((s) => s.done)).flatMap((e) => e.exercise.primaryMuscles))]" :key="m" class="mchip">{{ muscleName(m) }}</span></div>
        </div>
        <p class="tiny center">Keys: Space ticks the next set · → / ← move between exercises</p>
      </div>
    </div>

    <FinishSheet v-if="finishing" @close="finishing = false" />
    <ExercisePicker v-if="adding" multi :exclude="w.exercises.map((e) => e.exerciseId)" @close="adding = false" @pick="(ids) => { adding = false; W.addExercises(ids); }" />
    <Sheet v-if="settingsOpen" title="Workout settings" @close="settingsOpen = false"><WorkoutSettings v-model="overrides" /></Sheet>
    <Sheet v-if="listOpen" title="Exercises" @close="listOpen = false">
      <TransitionGroup tag="div" name="mv" class="list aw-list"><div v-for="(e, i) in w.exercises" :key="e.id" class="li" :class="{ cur: i === W.state.cur, skip: e.status === 'skipped' }">
        <div class="grow" @click="go(i); listOpen = false"><div class="t">{{ e.exercise.name }}</div><div class="s">{{ e.sets.filter((s) => s.done).length }}/{{ e.sets.length }} sets</div></div>
        <button class="ib sm plain" :disabled="i === 0" @click="move(i, -1)"><Icon name="up" :size="16" /></button><button class="ib sm plain" :disabled="i === w.exercises.length - 1" @click="move(i, 1)"><Icon name="down" :size="16" /></button></div></TransitionGroup>
    </Sheet>
  </div>
  <div v-else class="page"><div class="empty"><b>No workout in progress</b><button class="btn" @click="router.push('/')">Home</button></div></div>
</template>
