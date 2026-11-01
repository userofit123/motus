<script setup lang="ts">
// Before pressing Start (requirement 17): how many exercises, sets and reps, how long it should take with the rests,
// what each exercise is and what you did last time (tap for its full history), reminders and pinned notes,
// skipping or reordering for today only, and this workout's settings.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { duration, estimate, usesWeight, usesReps } from "@motus/shared";
import { usePreview, useSettings } from "../api/queries";
import { api, ApiError, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, ago } from "../core/format";
import { exerciseSheet, noteSheet } from "../core/ui";
import { choose } from "../core/ask";
import { toastError } from "../core/toast";
import { askNotificationPermission } from "../workout/native";
import Icon from "../components/Icon.vue";
import BodyMap from "../components/BodyMap.vue";
import Sheet from "../components/Sheet.vue";
import WorkoutSettings from "../components/WorkoutSettings.vue";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const pv = usePreview(id);
const s = useSettings();
const fmt = useFmt();
const p = computed<any>(() => pv.data.value);
const skip = ref<string[]>([]), order = ref<string[]>([]);
const overrides = ref<Record<string, unknown>>({});
const showSettings = ref(false), busy = ref(false);
watch(p, (v) => { if (v && !order.value.length) order.value = v.exercises.map((e: any) => e.routineExerciseId); }, { immediate: true });
const exs = computed<any[]>(() => (p.value?.exercises ?? []).slice().sort((a: any, b: any) => order.value.indexOf(a.routineExerciseId) - order.value.indexOf(b.routineExerciseId)));
const active = computed(() => exs.value.filter((e) => !skip.value.includes(e.routineExerciseId)));
const counts = computed(() => {
  const sets = active.value.flatMap((e) => e.sets);
  return { exercises: active.value.length, sets: sets.filter((x: any) => x.kind !== "warmup").length, warm: sets.filter((x: any) => x.kind === "warmup").length, reps: sets.reduce((a: number, x: any) => a + (x.kind !== "warmup" ? x.reps ?? 0 : 0), 0) };
});
const est = computed(() => estimate(active.value.map((e) => ({ sets: e.sets.map((x: any) => ({ kind: x.kind, reps: x.reps, durationS: x.durationS, restS: x.restS })) }))));
const muscles = computed(() => { const o: Record<string, number> = {}; for (const e of active.value) for (const m of e.exercise?.primaryMuscles ?? []) o[m] = (o[m] ?? 0) + e.sets.length; return o; });
const toggleSkip = (rid: string) => { const i = skip.value.indexOf(rid); if (i >= 0) skip.value.splice(i, 1); else skip.value.push(rid); };
const move = (rid: string, d: number) => { const a = order.value, i = a.indexOf(rid), j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j]!, a[i]!]; };
const setText = (e: any, x: any) => [x.weightKg != null && usesWeight(e.exercise?.tracking) ? fmt.value.w(x.weightKg) : "", x.reps != null && usesReps(e.exercise?.tracking) ? x.reps : "", x.durationS ? fmt.value.clock(x.durationS) : ""].filter((v) => v !== "").join(" × ");
const plan = (e: any) => {
  const w = e.sets.filter((x: any) => x.kind !== "warmup");
  const txt = w.map((x: any) => setText(e, x));
  const same = txt.every((t: string) => t === txt[0]);
  return same ? `${w.length} × ${txt[0] || "—"}${usesWeight(e.exercise?.tracking) && w[0]?.weightKg != null ? " " + fmt.value.wu : ""}` : txt.join(", ");
};
async function start(force = false) {
  busy.value = true;
  try {
    await api.post("/workouts/start", { routineId: id.value, skip: skip.value, order: order.value, settings: overrides.value, scheduleId: route.query.schedule ?? null, scheduledDate: route.query.date ?? null, force });
    askNotificationPermission();
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
</script>

<template>
  <div v-if="p" class="page">
    <button class="back" @click="router.back()"><Icon name="left" :size="16" />Back</button>
    <div class="ph">
      <div><h1>{{ p.routine.name }}</h1><div class="sub">{{ p.lastDoneAt ? `Last done ${ago(p.lastDoneAt)} · ${p.timesDone}×` : "First time" }}</div></div>
      <div class="acts"><button class="btn lg keep" :disabled="busy || !active.length" @click="start()"><Icon name="play" :size="18" />Start</button></div>
    </div>

    <div class="grid g4">
      <div class="card hero stat"><div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>About</div><div class="val">{{ duration(est.totalS, true) }}</div><div class="sub">{{ duration(est.workS, true) }} lifting · {{ duration(est.restS, true) }} rest{{ p.medianDurationS ? ` · usually ${duration(p.medianDurationS, true)}` : "" }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="dumbbell" :size="15" /></span>Exercises</div><div class="val">{{ counts.exercises }}</div><div class="sub">{{ skip.length ? `${skip.length} skipped today` : "in this order" }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="layers" :size="15" /></span>Sets</div><div class="val">{{ counts.sets }}</div><div class="sub">{{ counts.warm ? `+ ${counts.warm} warm-up` : "working sets" }}</div></div>
      <div class="card stat"><div class="lbl"><span class="bi"><Icon name="refresh" :size="15" /></span>Reps</div><div class="val">{{ counts.reps }}</div><div class="sub">in total</div></div>
    </div>

    <div v-for="m in p.reminders" :key="m.id" class="banner" style="margin-top:var(--spg)"><Icon name="bell" /><b>{{ m.body }}</b></div>
    <div v-for="n in p.notes" :key="n.id" class="banner note" :style="!p.reminders.length ? { marginTop: 'var(--spg)' } : undefined"><Icon name="note" /><div>{{ n.body }}</div></div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start;margin-top:var(--spg)">
      <div class="card">
        <div v-for="(e, i) in exs" :key="e.routineExerciseId" class="li" :style="skip.includes(e.routineExerciseId) ? { opacity: .45 } : undefined">
          <span class="tiny" style="width:18px">{{ i + 1 }}</span>
          <div class="thumb click" @click="exerciseSheet = e.exerciseId"><img v-if="e.exercise?.images?.[0]" :src="mediaUrl(e.exercise.images[0])" alt="" loading="lazy" /><Icon v-else name="dumbbell" /></div>
          <div class="grow click" @click="exerciseSheet = e.exerciseId">
            <div class="t">{{ e.exercise?.name }}<span v-if="e.reminders.length" class="mchip" style="margin-inline-start:6px;color:var(--acc)"><Icon name="bell" :size="11" style="display:inline;vertical-align:-1px" /> {{ e.reminders[0].body }}</span></div>
            <div class="s" :class="{ acc: e.sets.some((x: any) => x.adjusted) }">Today: {{ plan(e) }}{{ e.sets[0]?.restS ? ` · rest ${fmt.clock(e.sets[0].restS)}` : "" }}</div>
            <div v-if="e.last" class="s">Last time ({{ ago(e.last.startedAt) }}): {{ e.last.sets.filter((x: any) => x.kind !== "warmup").map((x: any) => setText(e, x)).join(", ") }}</div>
            <div v-else class="s">First time</div>
            <div v-if="e.suggestion" class="s acc">{{ e.suggestion }}</div>
          </div>
          <div class="col" style="gap:0">
            <button class="ib sm plain" :aria-label="skip.includes(e.routineExerciseId) ? 'Include' : 'Skip today'" :title="skip.includes(e.routineExerciseId) ? 'Include' : 'Skip today'" @click="toggleSkip(e.routineExerciseId)"><Icon :name="skip.includes(e.routineExerciseId) ? 'plus' : 'skip'" :size="16" /></button>
          </div>
          <div class="col" style="gap:0"><button class="ib sm plain" :disabled="i === 0" aria-label="Move up" @click="move(e.routineExerciseId, -1)"><Icon name="up" :size="16" /></button><button class="ib sm plain" :disabled="i === exs.length - 1" aria-label="Move down" @click="move(e.routineExerciseId, 1)"><Icon name="down" :size="16" /></button></div>
        </div>
      </div>
      <div class="col" style="gap:var(--spg)">
        <div class="card"><BodyMap :values="muscles" :height="170" /></div>
        <div class="card click row" role="button" @click="showSettings = true"><Icon name="settings" class="muted" /><div class="grow"><div style="font-weight:600">Workout settings</div><div class="tiny">{{ changed ? `${changed} changed for this workout` : "Default" }}</div></div><Icon name="right" class="muted" /></div>
        <div class="card click row" role="button" @click="noteSheet = { targets: [{ type: 'routine', id, label: p.routine.name }] }"><Icon name="note" class="muted" /><div class="grow" style="font-weight:600">Add a note</div></div>
      </div>
    </div>
    <Sheet v-if="showSettings" title="Workout settings" @close="showSettings = false"><WorkoutSettings v-model="overrides" :routine-id="id" /></Sheet>
  </div>
  <div v-else class="page"><div class="empty">Loading…</div></div>
</template>

<style scoped>
@media (max-width: 860px) { .grid[style*="300px"] { grid-template-columns: 1fr !important; } }
</style>
