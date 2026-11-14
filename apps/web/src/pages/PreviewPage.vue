<script setup lang="ts">
// Before pressing Start (requirement 17): how many exercises, sets and reps, how long it should take with the rests,
// what each exercise is and what you did last time (tap for its full history), reminders and pinned notes,
// skipping or reordering for today only, and this workout's settings.
import { goBack } from "../core/leave";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { duration, estimate, usesWeight, usesReps, muscleSets, musclesWorked } from "@motus/shared";
import { usePreview, useSettings, loaded } from "../api/queries";
import { api, ApiError, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, ago } from "../core/format";
import { reminderText } from "../core/reminderText";
import { exerciseSheet, noteSheet } from "../core/ui";
import { choose } from "../core/ask";
import { toastError } from "../core/toast";
import { askNotificationsOnce } from "../workout/native";
import Icon from "../components/Icon.vue";
import MuscleFig from "../components/MuscleFig.vue";
import NoteItem from "../components/NoteItem.vue";
import ReminderItem from "../components/ReminderItem.vue";
import BodyMap from "../components/BodyMap.vue";
import Sheet from "../components/Sheet.vue";
import WorkoutSettings from "../components/WorkoutSettings.vue";
import Menu from "../components/Menu.vue";
import { replacingWorkout } from "../workout/useWorkout";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const overrides = ref<Record<string, unknown>>({});
// with this workout's own settings, so the numbers shown are the ones it starts with
const pv = usePreview(id, overrides);
const s = useSettings();
const fmt = useFmt();
const p = computed<any>(() => pv.data.value);
const skip = ref<string[]>([]), order = ref<string[]>([]);
const showSettings = ref(false), busy = ref(false);
watch(p, (v) => { if (v && !order.value.length) order.value = v.exercises.map((e: any) => e.routineExerciseId); }, { immediate: true });
// which exercise a reminder or note is about; routine-wide ones need no label
const exName = (x: any) => (x.targetType === "exercise" ? p.value?.exercises.find((e: any) => e.exerciseId === x.targetId) : x.targetType === "routine_exercise" ? p.value?.exercises.find((e: any) => e.routineExerciseId === x.targetId) : null)?.exercise?.name ?? null;
const exs = computed<any[]>(() => (p.value?.exercises ?? []).slice().sort((a: any, b: any) => order.value.indexOf(a.routineExerciseId) - order.value.indexOf(b.routineExerciseId)));
const active = computed(() => exs.value.filter((e) => !skip.value.includes(e.routineExerciseId)));
const counts = computed(() => {
  const sets = active.value.flatMap((e) => e.sets);
  return { exercises: active.value.length, sets: sets.filter((x: any) => x.kind !== "warmup").length, warm: sets.filter((x: any) => x.kind === "warmup").length, reps: sets.reduce((a: number, x: any) => a + (x.kind !== "warmup" ? x.reps ?? 0 : 0), 0) };
});
// your real times say more than the plan's numbers, but only for the whole routine: skip something and it's the plan again
const usual = computed<{ s: number; of: number; newest: boolean } | null>(() => (skip.value.length ? null : p.value?.usual ?? null));
const est = computed(() => estimate(active.value.map((e) => ({ sets: e.sets.map((x: any) => ({ kind: x.kind, reps: x.reps, durationS: x.durationS, restS: x.restS })) }))));
const muscles = computed(() => muscleSets(active.value.map((e) => ({ primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [], sets: e.sets.length }))));
// main and helped by whether any exercise has the muscle as a main one, not by amounts (a busy helper isn't a main muscle)
const worked = computed(() => musclesWorked(active.value.map((e) => ({ primary: e.exercise?.primaryMuscles ?? [], secondary: e.exercise?.secondaryMuscles ?? [] }))));
const toggleSkip = (rid: string) => { const i = skip.value.indexOf(rid); if (i >= 0) skip.value.splice(i, 1); else skip.value.push(rid); };
const move = (rid: string, d: number) => { const a = order.value, i = a.indexOf(rid), j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j]!, a[i]!]; };
const setText = (e: any, x: any) => [x.weightKg != null && usesWeight(e.exercise?.tracking) ? fmt.value.w(x.weightKg) : "", x.reps != null && usesReps(e.exercise?.tracking) ? x.reps : "", x.durationS ? fmt.value.clock(x.durationS) : ""].filter((v) => v !== "").join(" × ");
// "4 × 50 kg × 8", or when the sets differ "4 sets · 42.5-50 kg · 8 reps"
const span = (xs: number[], f: (v: number) => string | number) => { const lo = Math.min(...xs), hi = Math.max(...xs); return lo === hi ? `${f(lo)}` : `${f(lo)}-${f(hi)}`; };
const plan = (e: any) => {
  const w = e.sets.filter((x: any) => x.kind !== "warmup");
  const txt = w.map((x: any) => setText(e, x));
  if (!w.length) return "No sets";
  if (txt.every((t: string) => t === txt[0])) return `${w.length} × ${txt[0] || "-"}${usesWeight(e.exercise?.tracking) && w[0]?.weightKg != null ? " " + fmt.value.wu : ""}`;
  const kg = w.map((x: any) => x.weightKg).filter((v: any) => v != null), reps = w.map((x: any) => x.reps).filter((v: any) => v != null);
  return [`${w.length} sets`, kg.length && usesWeight(e.exercise?.tracking) ? `${span(kg, fmt.value.w)} ${fmt.value.wu}` : "", reps.length ? `${span(reps, (v) => v)} reps` : ""].filter(Boolean).join(" · ");
};
async function start(force = false) {
  busy.value = true;
  try {
    const replaced = force ? replacingWorkout() : null;
    await api.post("/workouts/start", { routineId: id.value, skip: skip.value, order: order.value, settings: overrides.value, scheduleId: route.query.schedule ?? null, scheduledDate: route.query.date ?? null, programId: route.query.program ?? null, deloadPct: route.query.deload ? Number(route.query.deload) : null, force });
    replaced?.();
    void askNotificationsOnce();
    invalidate(["workouts", "home", "calendar"]);
    router.replace("/workout");
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const v = await choose("A workout is already in progress", [{ label: "Go back to it", value: "resume" }, { label: "Discard it and start this one", value: "new" }]);
      if (v === "resume") router.push("/workout"); else if (v === "new") await start(true);
    } else toastError(e);
  } finally { busy.value = false; }
}
const changed = computed(() => Object.keys(overrides.value).length);
// show the page once its data is in, all at once
await loaded(pv);
</script>

<template>
  <div v-if="p" class="page">
    <button class="back" @click="goBack(router, '/routines')"><Icon name="left" :size="16" /><span>Back</span></button>
    <div class="ph">
      <div><h1>{{ p.routine.name }}</h1><div class="sub">{{ p.lastDoneAt ? `Last done ${ago(p.lastDoneAt)} · done ${p.timesDone}×` : "First time" }}</div></div>
      <div class="acts"><button class="btn lg keep" :disabled="busy || !active.length" @click="start()"><Icon name="play" :size="18" />Start</button></div>
    </div>

    <div class="grid g4">
      <div v-if="usual" class="card hero stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>{{ usual.of === 1 && usual.newest ? "Last time" : "Usually" }}</div><div class="val">{{ duration(usual.s, true) }}</div><div class="sub">{{ usual.of > 1 ? `from ${usual.of} recent workouts` : p.timesDone === 1 ? "your one workout so far" : usual.newest ? "your latest workout" : "from your recent workouts" }}</div></div>
      <div v-else class="card hero stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>About</div><div class="val">{{ duration(est.totalS, true) }}</div><div class="sub">{{ duration(est.restS, true) }} of it resting</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="dumbbell" :size="15" /></span>Exercises</div><div class="val">{{ counts.exercises }}</div><div class="sub">{{ skip.length ? `${skip.length} skipped today` : "in this order" }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Sets</div><div class="val">{{ counts.sets }}</div><div class="sub">{{ counts.warm ? `+ ${counts.warm} warm-up` : "working sets" }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="refresh" :size="15" /></span>Reps</div><div class="val">{{ counts.reps }}</div><div class="sub">in total</div></div>
    </div>

    <div v-if="route.query.deload" class="banner spt"><Icon name="info" /><b>Deload week: working weights are {{ route.query.deload }}% lighter today.</b></div>
    <div v-if="p.reminders?.length || p.notes?.length" class="nlist spt">
      <ReminderItem v-for="m in p.reminders" :key="m.id" :reminder="m" :where="exName(m)" />
      <NoteItem v-for="n in p.notes" :key="n.id" :note="n" :where="exName(n)" />
    </div>

    <div class="grid spt" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start">
      <TransitionGroup tag="div" name="mv" class="card">
        <div v-for="(e, i) in exs" :key="e.routineExerciseId" class="li pvx" :class="{ off: skip.includes(e.routineExerciseId) }">
          <MuscleFig sm :muscles="e.exercise?.primaryMuscles" :helpers="e.exercise?.secondaryMuscles" />
          <div class="thumb click" @click="exerciseSheet = e.exerciseId"><img v-if="e.exercise?.images?.[0]" :src="mediaUrl(e.exercise.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
          <div class="grow click" @click="exerciseSheet = e.exerciseId">
            <div class="t ellipsis">{{ i + 1 }}. {{ e.exercise?.name }}</div>
            <div v-if="skip.includes(e.routineExerciseId)" class="s">Skipped today</div>
            <template v-else>
              <div class="s ellipsis" :class="{ acc: e.sets.some((x: any) => x.adjusted) }">{{ plan(e) }}</div>
              <div class="s ellipsis">{{ e.sets[0]?.restS ? `Rest ${fmt.clock(e.sets[0].restS)} · ` : "" }}{{ e.last ? `last time ${e.last.sets.filter((x: any) => x.kind !== "warmup").map((x: any) => setText(e, x)).join(", ")}` : "first time" }}</div>
              <div v-if="e.reminders.length" class="s acc ellipsis"><Icon name="bell" :size="12" style="display:inline;vertical-align:-1px" /> {{ reminderText(e.reminders[0], fmt) }}</div>
            </template>
          </div>
          <Menu :items="[
            { label: skip.includes(e.routineExerciseId) ? 'Do it today' : 'Skip today', icon: skip.includes(e.routineExerciseId) ? 'plus' : 'skip', run: () => toggleSkip(e.routineExerciseId) },
            { label: 'Move up', icon: 'up', run: () => move(e.routineExerciseId, -1), hidden: i === 0 },
            { label: 'Move down', icon: 'down', run: () => move(e.routineExerciseId, 1), hidden: i === exs.length - 1 },
          ]" label="Today only" />
        </div>
      </TransitionGroup>
      <div class="stack">
        <div class="card"><BodyMap :values="muscles" :highlight="worked.primary" :secondary="worked.secondary" :height="190" legend /></div>
        <div class="card flush">
          <div class="li click" role="button" @click="showSettings = true"><Icon name="settings" :size="18" class="muted" /><div class="grow"><div class="t">Workout settings</div><div class="s">{{ changed ? `${changed} changed for this workout` : "As usual" }}</div></div><Icon name="right" :size="16" class="muted" /></div>
          <div class="li click" role="button" @click="noteSheet = { targets: [{ type: 'routine', id, label: p.routine.name }] }"><Icon name="note" :size="18" class="muted" /><div class="grow"><div class="t">Add a note</div></div><Icon name="right" :size="16" class="muted" /></div>
        </div>
      </div>
    </div>
    <Sheet v-if="showSettings" title="Workout settings" @close="showSettings = false"><WorkoutSettings v-model="overrides" /></Sheet>
  </div>
  <div v-else class="page"><div class="empty">Loading…</div></div>
</template>

<style scoped>
@media (max-width: 860px) { .grid[style*="300px"] { grid-template-columns: 1fr !important; } }
</style>
