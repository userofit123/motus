<script setup lang="ts">
// The running workout (PLAN.md §8.5). Phone: one exercise at a time on the page itself (swipe between them, or pick one from the tabs),
// with the controls in a sheet at the bottom: the set to do now, or the rest. Computer: the list on the left, the current exercise
// and the action bar (rest included) in the middle, what comes next and the totals on the right.
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { clock, muscleName, workoutSoFar, restAfterSet, restDefaultsOf, isStretch, type Reminder } from "@motus/shared";
import { useWorkout, endWorkout } from "./useWorkout";
import { elapsed, finishRest } from "./runtime";
import { keepAwake } from "./native";
import { isPhone } from "../core/device";
import { confirm, prompt } from "../core/ask";
import { noteSheet, reminderSheet } from "../core/ui";
import { invalidate, reloadQueued } from "../api/live";
import { waiting, send } from "../api/outbox";
import { toastError } from "../core/toast";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Sheet from "../components/Sheet.vue";
import ReorderSheet from "../components/ReorderSheet.vue";
import NoteItem from "../components/NoteItem.vue";
import { useNoteMenu } from "../core/noteMenu";
import ReminderItem from "../components/ReminderItem.vue";
import ExerciseCard from "./ExerciseCard.vue";
import ActionBar from "./ActionBar.vue";
import Peek from "./PeekBanner.vue";
import FinishSheet from "./FinishSheet.vue";
import WorkoutSoFar from "./WorkoutSoFar.vue";
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
  const e = w.value?.exercises[W.state.active];
  if (ev.key === " " && e) { const i = e.sets.findIndex((x) => !x.done); if (i >= 0) { ev.preventDefault(); W.tick(e, i); } }
  if (ev.key === "ArrowRight") go(W.state.cur + 1);
  if (ev.key === "ArrowLeft") go(W.state.cur - 1);
}
onMounted(() => { if (W.prefs.value.keepAwake) keepAwake(true); addEventListener("keydown", key); });
onBeforeUnmount(() => { keepAwake(false); removeEventListener("keydown", key); });
// no workout any more (finished or discarded elsewhere): go home. Not while fetching: right after Start, the cached
// answer is still "none" until the new workout arrives
watch(() => W.active.isFetched.value && !W.active.isFetching.value && !reloadQueued.value && !W.active.data.value && !W.state.pending, (gone) => { if (gone) router.replace("/"); });

// the exercise being done's rests as "Up next" says them: the rule the workout rests by (restAfterSet), so a stretch says its own
const upRest = computed(() => {
  const e = w.value?.exercises[W.state.active], d = restDefaultsOf(W.prefs.value);
  const o = { stretch: isStretch(e?.exercise), exRestS: e?.restS, prefRestS: e?.prefRestS, exRestAfterS: e?.restAfterS, prefRestAfterS: e?.prefRestAfterS };
  return { between: restAfterSet({ ...o, isLastSet: false }, d), after: restAfterSet({ ...o, isLastSet: true }, d) };
});
const soFar = computed(() => workoutSoFar(w.value ?? { exercises: [] }));
const done = computed(() => soFar.value.setsDone), total = computed(() => soFar.value.setsPlanned);
// the Summary tab comes after the last exercise: cur one past the end
const onSummary = computed(() => !!w.value && W.state.cur >= w.value.exercises.length);
const remainingS = computed(() => {
  // a rough "time left": undone sets × (their own time + their rest)
  let t = 0;
  // each rest as the bottom bar shows it (restFor), so a set just made a warm-up counts its new rest straight away
  for (const e of w.value?.exercises ?? []) if (e.status !== "skipped") e.sets.forEach((s, i) => { if (!s.done) t += (s.durationS ?? (s.reps ?? 8) * 3 + 10) + W.restFor(e, i).secs; });
  return t;
});
const paused = computed(() => !!w.value?.pauseStartedAt);
// how far along: one segment per exercise, as long as its sets, filled by the sets done
// under the exercise: every note written in this workout (pinned or not), and the routine's pinned ones when reminders
// are shown: the same rule as an exercise's notes (ExerciseCard), the setting hides what comes back, not what you wrote today
const workoutNotes = computed(() => (w.value?.routineNotes ?? []).filter((x: any) => x.workoutId === w.value?.id || x.targetType === "workout" || (W.prefs.value.showReminders && x.pinned)));
const noteMenu = useNoteMenu();
// a note on the whole routine lands under the exercise, on the phone behind the action bar: bring it into view
// the phone and computer layouts each have the list, only one is on screen
const notesEl = ref<HTMLElement | null>(null);
let seenNotes = new Set(workoutNotes.value.map((n: any) => n.id));
// keyed by the workout too: the notes there when it first loads are not new
watch(() => [w.value?.id, ...workoutNotes.value.map((n: any) => n.id)], async ([wid, ...ids], old) => {
  const fresh = wid === old?.[0] && workoutNotes.value.find((n: any) => !seenNotes.has(n.id) && n.workoutId === wid);
  seenNotes = new Set(ids);
  if (fresh) { await nextTick(); notesEl.value?.querySelector(`[data-note="${fresh.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
});
const segs = computed(() => (w.value?.exercises ?? []).filter((e) => e.status !== "skipped").map((e) => ({ id: e.id, n: Math.max(1, e.sets.length), done: e.sets.filter((s) => s.done).length })));
// the tabs of exercises on the phone keep the current one in view
const strip = ref<HTMLElement | null>(null);
// the action bar's height, so the page can always scroll its last note clear of it
const dock = ref<HTMLElement | null>(null);
let ro: ResizeObserver | null = null;
watch(dock, (el) => {
  ro?.disconnect();
  // no action bar (the computer layout): nothing to keep clear of
  if (!el) { document.querySelector<HTMLElement>(".aw")?.style.removeProperty("--dockh"); return; }
  ro = new ResizeObserver(() => document.querySelector<HTMLElement>(".aw")?.style.setProperty("--dockh", `${el.offsetHeight}px`));
  ro.observe(el);
});
onBeforeUnmount(() => ro?.disconnect());
watch(() => W.state.cur, async () => { await nextTick(); strip.value?.querySelector(".cur")?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); });
const statusOf = (e: any) => (e.status === "skipped" ? "skip" : e.status === "done" || e.status === "partial" ? "done" : "");

// phone: swipe left and right anywhere on the exercise (sets included) to move between exercises; not on the tabs
// (it scrolls sideways), the action bar's steppers, or the screen edges (the phone's own Back gesture)
let x0 = 0, y0 = 0, t0 = 0, ok = false;
const ts = (e: TouchEvent) => {
  const t = e.touches[0]!; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  ok = e.touches.length === 1 && !document.querySelector(".scr") && !(e.target as HTMLElement).closest(".aw-tabs, .nstep, .ab-last, .mnu") && x0 > 24 && x0 < innerWidth - 24;
};
const te = (e: TouchEvent) => {
  if (!ok) return;
  const dx = e.changedTouches[0]!.clientX - x0, dy = e.changedTouches[0]!.clientY - y0;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3 && Date.now() - t0 < 900) { (document.activeElement as HTMLElement)?.blur?.(); go(W.state.cur + (dx < 0 ? 1 : -1)); }
};
const go = (i: number) => { if (w.value && i >= 0 && i <= w.value.exercises.length) W.state.cur = i; };

async function discard() {
  if (!(await confirm("Cancel this workout?", { text: "It ends now and nothing from it is saved: no sets, no history.", ok: "Cancel workout", danger: true }))) return;
  const id = w.value!.id;
  // through the outbox, behind any set changes still waiting there, so none of them arrives after the cancel
  try { await send("post", `/workouts/${id}/discard`); }
  catch (e) { toastError(e); invalidate(["workouts"]); return; }
  finishRest(false);
  // leave first, then drop it everywhere: dropping it while this screen is still up would flash "No workout in progress"
  await router.replace("/");
  endWorkout(id);
}
async function rename() { const n = await prompt("Workout name", { value: w.value!.name }); if (n) W.patchWorkout({ name: n }); }
const moveTo = (from: number, to: number) => { const ids = w.value!.exercises.map((e) => e.id); if (to < 0 || to >= ids.length || from === to) return; ids.splice(to, 0, ids.splice(from, 1)[0]!); W.reorder(ids); };
const move = (i: number, d: number) => { const ids = w.value!.exercises.map((e) => e.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j]!, ids[i]!]; W.reorder(ids); };
const togglePause = () => W.togglePause();
// in groups: its exercises, notes and reminders, its settings, then Cancel on its own
const menu = computed(() => [
  { label: "Add exercise", icon: "plus", run: () => (adding.value = true) },
  { label: "Reorder exercises", icon: "routines", run: () => (listOpen.value = true), hidden: !isPhone.value },
  { label: "Workout note", sep: true, icon: "note", run: () => (noteSheet.value = { targets: [{ type: "workout", id: w.value!.id, label: "This workout" }, ...(w.value!.routineId ? [{ type: "routine", id: w.value!.routineId, label: "The whole routine" }] : [])], workoutId: w.value!.id }) },
  { label: "Remind me next time (routine)", icon: "bell", run: () => (reminderSheet.value = { targetType: "routine", targetId: w.value!.routineId!, label: w.value!.name, workoutId: w.value!.id }), hidden: !w.value?.routineId },
  { label: "Workout settings", sep: true, icon: "settings", run: () => (settingsOpen.value = true) },
  { label: "Rename", icon: "edit", run: rename },
  { label: "Cancel workout", hint: "End it without saving anything", icon: "trash", danger: true, sep: true, run: discard },
]);
</script>

<template>
  <div v-if="w" class="page wide aw" :class="{ phone: isPhone }" @touchstart.passive="isPhone && ts($event)" @touchend.passive="isPhone && te($event)">
    <div class="aw-top">
      <button class="ib sm plain" aria-label="Minimise" @click="router.push('/')"><Icon name="down" /></button>
      <div class="grow" style="min-width:0;cursor:pointer" role="button" tabindex="0" @click="go(w.exercises.length)" @keydown.enter="go(w.exercises.length)">
        <div class="aw-name ellipsis">{{ w.name }}</div>
        <div class="aw-clock"><b>{{ clock(elapsed(w)) }}</b><span v-if="paused" class="aw-paused">Paused</span><span>{{ done }} of {{ total }} sets</span><span v-if="waiting.length">{{ waiting.length }} waiting to sync</span></div>
      </div>
      <Menu :items="menu" align="start" />
      <button class="btn" :class="{ o: done === 0 }" @click="finishing = true">Finish</button>
    </div>
    <div v-if="!isPhone" class="aw-prog" aria-hidden="true"><span v-for="g in segs" :key="g.id" :style="{ flexGrow: g.n }"><i :style="{ width: (g.done / g.n) * 100 + '%' }" /></span></div>
    <div v-if="W.prefs.value.showReminders && w.reminders?.length" class="nlist aw-rem"><ReminderItem v-for="m in w.reminders" :key="m.id" :reminder="m" live :workout-id="w.id" @gone="w.reminders = w.reminders.filter((x: Reminder) => x.id !== m.id)" /></div>


    <div v-if="!w.exercises.length" class="card empty"><Icon name="dumbbell" :size="34" /><b>Add your first exercise</b><button class="btn" @click="adding = true">Add exercises</button></div>

    <!-- phone -->
    <template v-else-if="isPhone">
      <!-- the exercises as tabs: a tick when done, a dot on the one being done -->
      <div ref="strip" class="aw-tabs" role="tablist">
        <button v-for="(e, i) in w.exercises" :key="e.id" role="tab" :aria-selected="i === W.state.cur" :class="[statusOf(e), { cur: i === W.state.cur, act: i === W.state.active }]" :title="i === W.state.active ? 'Doing now' : undefined" @click="go(i)">
          <Icon v-if="statusOf(e) === 'done'" name="check" :size="13" class="ok" /><span class="ellipsis">{{ e.exercise?.name }}</span>
        </button>
        <button role="tab" :aria-selected="onSummary" :class="{ cur: onSummary }" @click="go(w.exercises.length)"><Icon name="stats" :size="13" /><span>Summary</span></button>
        <button class="add" aria-label="Add exercise" @click="adding = true"><Icon name="plus" :size="16" /></button>
      </div>
      <Peek />
      <!-- the exercise and its sets sit on the page itself, no card around them -->
      <div class="aw-flat">
        <Transition :name="exDir" mode="out-in"><WorkoutSoFar v-if="onSummary" key="summary" :w="w" @open="go" /><ExerciseCard v-else-if="w.exercises[W.state.cur]" :key="w.exercises[W.state.cur]!.id" :e="w.exercises[W.state.cur]!" :index="W.state.cur" /></Transition>
      </div>
      <!-- the routine's pinned notes: under the exercise, not pushing it down (its reminders stay at the top) -->
      <div v-if="workoutNotes.length" ref="notesEl" class="aw-notes">
        <NoteItem v-for="n in workoutNotes" :key="n.id" :data-note="n.id" :note="n" :menu="noteMenu(n, n.targetType === 'routine' ? w.name : 'This workout')" />
      </div>
      <div ref="dock" class="aw-dock"><ActionBar :paused="paused" @finish="finishing = true" @pause="togglePause" /></div>
    </template>

    <!-- computer -->
    <div v-else class="aw-desk">
      <div class="card side aw-list" style="padding:calc(var(--cpy) * 2 / 3)">
        <TransitionGroup name="mv">
        <div v-for="(e, i) in w.exercises" :key="e.id" class="li" :class="{ cur: i === W.state.cur, act: i === W.state.active, skip: e.status === 'skipped' }" @click="go(i)">
          <span class="stt" :class="{ done: e.status === 'done', part: e.status === 'partial' || (e.status === 'pending' && e.sets.some((s) => s.done)) }"><Icon v-if="e.status === 'done'" name="check" :size="13" /></span>
          <div class="grow"><div class="t ellipsis">{{ e.exercise?.name }}</div><div class="s">{{ e.sets.filter((s) => s.done).length }} of {{ e.sets.length }} sets{{ e.superset ? `, superset ${e.superset}` : "" }}</div></div>
          <span v-if="i === W.state.cur" class="col" style="gap:0" @click.stop><button class="ib sm plain" style="width:26px;height:22px" aria-label="Move up" @click="move(i, -1)"><Icon name="up" :size="14" /></button><button class="ib sm plain" style="width:26px;height:22px" aria-label="Move down" @click="move(i, 1)"><Icon name="down" :size="14" /></button></span>
        </div>
        </TransitionGroup>
        <div class="li" :class="{ cur: onSummary }" @click="go(w.exercises.length)">
          <span class="stt"><Icon name="stats" :size="13" /></span>
          <div class="grow"><div class="t">Summary</div><div class="s">{{ soFar.exercisesDone }} of {{ soFar.exercisesTotal }} exercises done</div></div>
        </div>
        <button class="qb acc" style="margin-top:6px" @click="adding = true"><Icon name="plus" :size="16" />Add exercise</button>
      </div>
      <div class="stack" style="position:sticky;top:calc(24px + var(--st))">
        <Peek />
        <!-- the summary brings its own cards (hero, tiles), so only the exercise sits in one, as on the phone -->
        <div :class="{ card: !onSummary }"><Transition name="sw" mode="out-in"><WorkoutSoFar v-if="onSummary" key="summary" :w="w" @open="go" /><ExerciseCard v-else-if="w.exercises[W.state.cur]" :key="w.exercises[W.state.cur]!.id" :e="w.exercises[W.state.cur]!" :index="W.state.cur" /></Transition></div>
        <ActionBar :paused="paused" @finish="finishing = true" @pause="togglePause" />
        <div v-if="workoutNotes.length" ref="notesEl" class="aw-notes">
          <NoteItem v-for="n in workoutNotes" :key="n.id" :data-note="n.id" :note="n" :menu="noteMenu(n, n.targetType === 'routine' ? w.name : 'This workout')" />
        </div>
      </div>
      <div class="side stack">
        <div class="card">
          <div class="lbl">Up next</div>
          <div style="font-weight:600;margin-top:4px">{{ w.exercises.find((e, i) => i > W.state.active && e.status === "pending")?.exercise.name ?? "Last exercise" }}</div>
          <div class="tiny" style="margin-top:6px">Rest between sets {{ fmt.clock(upRest.between) }}, after the exercise {{ fmt.clock(upRest.after) }}</div>
        </div>
        <div class="card">
          <div class="grid g2" style="gap:10px">
            <div><div class="lbl">Volume</div><div style="font-weight:600;font-size:18px">{{ fmt.vol(soFar.volumeKg) }}</div></div>
            <div><div class="lbl">Time left</div><div style="font-weight:600;font-size:18px">about {{ Math.round(remainingS / 60) }}m</div></div>
          </div>
          <div class="chips" style="margin-top:10px"><span v-for="m in [...new Set(w.exercises.filter((e) => e.sets.some((s) => s.done)).flatMap((e) => e.exercise.primaryMuscles))]" :key="m" class="mchip">{{ muscleName(m) }}</span></div>
        </div>
        <p class="tiny center">Space ticks the set you're on. ← and → move between exercises.</p>
      </div>
    </div>

    <FinishSheet v-if="finishing" @close="finishing = false" @cancel="finishing = false; discard()" @open="(i) => { finishing = false; go(i); }" />
    <ExercisePicker v-if="adding" multi :exclude="w.exercises.map((e) => e.exerciseId)" @close="adding = false" @pick="(ids) => { adding = false; W.addExercises(ids); }" />
    <Sheet v-if="settingsOpen" title="Workout settings" @close="settingsOpen = false"><WorkoutSettings v-model="overrides" /></Sheet>
    <ReorderSheet v-if="listOpen" title="Reorder exercises" hint="Drag to reorder, or use the arrows. Tap an exercise to open it." :items="w.exercises.map((e, i) => ({ id: e.id, title: e.exercise.name, sub: `${e.sets.filter((s) => s.done).length}/${e.sets.length} sets`, cur: i === W.state.cur, active: i === W.state.active, muted: e.status === 'skipped' }))" @move="moveTo" @select="(i) => { go(i); listOpen = false; }" @close="listOpen = false" />
  </div>
  <!-- only once we know: while the app opens, or a reload is queued, the workout may still be on its way -->
  <div v-else-if="W.active.isFetched.value && !W.active.isFetching.value && !reloadQueued" class="page"><div class="empty"><b>No workout in progress</b><button class="btn" @click="router.push('/')">Home</button></div></div>
</template>

<style scoped>
/* room under the page for the action bar, however tall it is right now (it grows and shrinks with what it shows) */
.aw.phone { padding-bottom: calc(var(--dockh, 330px) + var(--spg)); }
.aw-name { font-size: 13px; font-weight: 600; color: var(--tx2); cursor: pointer; }
.aw-clock { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; font-size: 12.5px; color: var(--tx2); }
.aw-clock b { font-size: 26px; font-weight: 600; letter-spacing: -.8px; color: var(--tx); font-variant-numeric: tabular-nums; line-height: 1.1; }
.aw-paused { color: var(--acc); font-weight: 600; }
/* -4px pulls the bar up under the header's --hg gap (optical); the gap below is a block gap */
.aw-prog { display: flex; gap: 3px; margin: -4px 0 var(--spg); }
.aw-prog span { flex-basis: 0; height: 5px; border-radius: 5px; background: var(--s2); overflow: hidden; }
.aw-prog i { display: block; height: 100%; background: var(--acc); border-radius: inherit; transition: width .3s var(--ease); }
/* the routine's reminders between the header and the exercises: a block gap below. On a phone the header's --hg gap
   grows to --spg above, and below the tabs' own top padding (--awtab, inside their bar) counts towards it, so the
   reminders sit as far from the header as from the tab labels */
.aw { --awtab: 10px; }
.aw-rem { margin-bottom: var(--spg); }
.aw.phone .aw-rem { margin-top: calc(var(--spg) - var(--hg)); }
.aw.phone .aw-rem:has(+ .aw-tabs) { margin-bottom: calc(var(--spg) - var(--awtab)); }
/* phone: the exercises as underlined tabs across the top, edge to edge */
.aw-tabs { display: flex; overflow-x: auto; scrollbar-width: none; margin: 0 -16px var(--spg); padding: 0 10px; border-bottom: 1px solid var(--ol); }
.aw-tabs::-webkit-scrollbar { display: none; }
.aw-tabs button { display: inline-flex; align-items: center; gap: 5px; flex: none; max-width: 170px; padding: var(--awtab) 10px 9px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; color: var(--tx2); font: inherit; font-size: 13.5px; cursor: pointer; }
.aw-tabs button.cur { color: var(--tx); font-weight: 600; border-bottom-color: var(--acc); }
.aw-tabs button.skip { opacity: .55; text-decoration: line-through; }
.aw-tabs .ok { color: var(--pos); flex: none; }
.aw-tabs .add { padding-inline: 12px; }
/* the exercise being done: a dot after its name, wherever you're looking */
.aw-tabs button.act::after, .aw-list .li.act .t::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--pos); flex: none; display: inline-block; margin-inline-start: 6px; vertical-align: middle; }
/* phone: the controls are a sheet fixed to the bottom edge, its own shadow lifting it off the page */
.aw-dock { position: fixed; z-index: 50; left: 0; right: 0; bottom: 0; padding-inline: var(--sl) var(--sr); }
.aw-dock :deep(.abar) { border-radius: var(--r-sheet) var(--r-sheet) 0 0; border-bottom: 0; padding-bottom: calc(14px + var(--sb, 0px)); box-shadow: 0 -10px 30px -18px rgb(0 0 0 / .45); }
</style>
