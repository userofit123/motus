<script setup lang="ts">
// The + sheet (requirement 10), in three plain sections so it reads at a glance:
//  Start: what's planned today, choosing any routine (the sheet turns into the routines in their folders), an empty
//  workout, recording an activity.
//  Log: things already done: a past workout, an activity typed in, body weight, measurements and the daily log (features).
//  Create: a new routine, a new goal, a new program (feature).
// Anything already running (the workout, a recording) comes first, to go back to it.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useRoutines, useActive, useHome, useSettings } from "../api/queries";
import type { RoutineSummary } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toastError } from "../core/toast";
import { confirm } from "../core/ask";
import { activitySheet, bodySheet, dailySheet } from "../core/ui";
import { ago } from "../core/format";
import { recording, recTypeName } from "../workout/recording";
import { iv, ivRunning } from "../workout/intervals";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";
import ProgramEditor from "../components/ProgramEditor.vue";
import RoutineChooser from "../components/RoutineChooser.vue";

const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const routines = useRoutines();
const active = useActive();
const home = useHome();
const s = useSettings();
const newProgram = ref(false);
const go = (to: string) => { emit("close"); router.push(to); };
const today = computed(() => (home.data.value?.upNext ?? []).filter((p: any) => p.date === new Date().toLocaleDateString("sv-SE") && p.routineId));
// "Choose a routine" turns this sheet into the routines in their folders; back returns to the rest
const choosing = ref(false);
const hasRoutines = computed(() => (routines.data.value ?? []).some((r) => !r.archived));
const startRoutine = (r: RoutineSummary) => go(`/routines/${r.id}/start`);
// an empty workout is planned first (exercises, sets, rests; saved as a routine if wanted). A workout already running
// comes first: the list may not have known about it yet (another device, still loading), so ask the server before planning
async function empty() {
  try {
    const cur = active.data.value ?? await api.get("/workouts/active");
    if (cur) {
      invalidate(["workouts"]);
      if (await confirm(`${cur.name} is still in progress`, { text: `Started ${ago(cur.startedAt)}. Finish or discard it before starting another.`, ok: "Go back to it" })) go("/workout");
      return;
    }
    go("/workout/plan");
  } catch (e) { toastError(e); }
}
</script>

<template>
  <ProgramEditor v-if="newProgram" :program="null" @close="emit('close')" @saved="(id) => router.push(`/programs/${id}`)" />
  <Sheet v-else-if="choosing" title="Choose a routine" @close="emit('close')">
    <template #head><button class="ib sm plain" aria-label="Back" @click="choosing = false"><Icon name="left" /></button><b>Choose a routine</b></template>
    <RoutineChooser @pick="startRoutine" />
  </Sheet>
  <Sheet v-else title="Start" @close="emit('close')">
    <div v-if="active.data.value || recording || ivRunning" class="opt-list hgap">
      <button v-if="active.data.value" class="optb now" @click="go('/workout')"><span class="oi"><Icon name="play" /></span><div class="grow"><div class="t">Back to {{ active.data.value.name }}</div><div class="s">Workout in progress</div></div></button>
      <button v-if="recording" class="optb now" @click="go('/activities/record')"><span class="oi"><Icon name="map" /></span><div class="grow"><div class="t">Back to your {{ recTypeName().toLowerCase() }}</div><div class="s">{{ recording.pauseAt ? "Recording paused" : "Recording" }}</div></div></button>
      <button v-if="ivRunning" class="optb now" @click="go('/timer')"><span class="oi"><Icon name="timer" /></span><div class="grow"><div class="t">Back to the interval timer</div><div class="s">{{ iv.pausedAt ? "Paused" : "Running" }}</div></div></button>
    </div>

    <div class="sh first"><h2>Start</h2></div>
    <div v-if="today.length" class="list hgap">
      <div v-for="p in today" :key="p.scheduleId" class="li click" @click="go(`/routines/${p.routineId}/start?schedule=${p.scheduleId}&date=${p.date}`)">
        <Icon name="calendar" class="acc" /><div class="grow"><div class="t">{{ p.name }}</div><div class="s">Planned for today{{ p.timeOfDay ? " at " + p.timeOfDay : "" }}</div></div><Icon name="right" />
      </div>
    </div>
    <div class="opt-list">
      <button v-if="hasRoutines" class="optb" @click="choosing = true"><span class="oi"><Icon name="routines" /></span><div class="grow"><div class="t">Choose a routine</div><div class="s">Your routines, in their folders</div></div><Icon name="right" /></button>
      <button v-if="!active.data.value" class="optb" @click="empty"><span class="oi"><Icon name="dumbbell" /></span><div class="grow"><div class="t">Empty workout</div><div class="s">{{ recording ? "Pick the exercises, then start. Your recording keeps going." : "Pick the exercises and sets, then start" }}</div></div></button>
      <button v-if="!recording" class="optb" @click="go('/activities/record')"><span class="oi"><Icon name="map" /></span><div class="grow"><div class="t">Record an activity</div><div class="s">{{ active.data.value ? "A walk, run, ride or anything you time. Your workout keeps going." : "A walk, run or ride with its route, or anything you time" }}</div></div></button>
      <button v-if="s.features.intervalTimer && !ivRunning" class="optb" @click="go('/timer')"><span class="oi"><Icon name="timer" /></span><div class="grow"><div class="t">Interval timer</div><div class="s">Work and rest in rounds: HIIT, Tabata, circuits</div></div></button>
    </div>

    <h2 class="spt">Log</h2>
    <div class="opt-list">
      <button class="optb" @click="go('/log')"><span class="oi"><Icon name="history" /></span><div class="grow"><div class="t">Past workout</div><div class="s">Something you did without the app</div></div></button>
      <button class="optb" @click="emit('close'); activitySheet = {}"><span class="oi"><Icon name="walk" /></span><div class="grow"><div class="t">Activity</div><div class="s">A walk, run, ride or class done earlier: type in the time</div></div></button>
      <button class="optb" @click="emit('close'); bodySheet = true"><span class="oi"><Icon name="scale" /></span><div class="grow"><div class="t">Body weight</div><div class="s">Kept on the Body page with its trend</div></div></button>
      <button v-if="s.features.measurements" class="optb" @click="emit('close'); bodySheet = 'tape'"><span class="oi"><Icon name="target" /></span><div class="grow"><div class="t">Measurements</div><div class="s">Waist, chest, arms… and body fat, all at once</div></div></button>
      <button v-if="s.features.steps || s.features.dailyLog" class="optb" @click="emit('close'); dailySheet = true"><span class="oi"><Icon :name="s.features.steps ? 'steps' : 'moon'" /></span><div class="grow"><div class="t">{{ s.features.dailyLog ? (s.features.steps ? "Steps, sleep, water, mood" : "Sleep, water, mood") : "Steps" }}</div><div class="s">Today's daily log</div></div></button>
    </div>

    <h2 class="spt">Create</h2>
    <div class="opt-list">
      <button class="optb" @click="go('/routines/new/edit')"><span class="oi"><Icon name="plus" /></span><div class="grow"><div class="t">New routine</div><div class="s">From scratch, from a template or from another routine</div></div></button>
      <button class="optb" @click="go('/goals?new=1')"><span class="oi"><Icon name="goals" /></span><div class="grow"><div class="t">New goal</div><div class="s">Sessions a week, a heavier lift, a distance, a body weight…</div></div></button>
      <button v-if="s.features.programs" class="optb" @click="newProgram = true"><span class="oi"><Icon name="layers" /></span><div class="grow"><div class="t">New program</div><div class="s">Weeks of routines in order, with lighter weeks</div></div></button>
    </div>
  </Sheet>
</template>

<style scoped>
.optb.now { border-color: var(--acc); }
.li .acc { color: var(--acc); flex: none; }
</style>
