<script setup lang="ts">
// The Start button's sheet (requirement 10): resume, today's plan, a routine, a new routine, an empty workout,
// an activity, or a workout from the past.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useRoutines, useActive, useHome } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toastError } from "../core/toast";
import { activitySheet } from "../core/ui";
import { ago } from "../core/format";
import { duration } from "@motus/shared";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";

const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const routines = useRoutines();
const active = useActive();
const home = useHome();
const q = ref("");
const go = (to: string) => { emit("close"); router.push(to); };
const today = computed(() => (home.data.value?.upNext ?? []).filter((p: any) => p.date === new Date().toLocaleDateString("sv-SE") && p.routineId));
const list = computed(() => (routines.data.value ?? []).filter((r) => !r.archived && r.name.toLowerCase().includes(q.value.toLowerCase()))
  .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastDoneAt ?? "").localeCompare(a.lastDoneAt ?? "")));
async function empty() {
  try { await api.post("/workouts/start", { name: "Workout" }); invalidate(["workouts", "home"]); go("/workout"); } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet title="Start" @close="emit('close')">
    <div class="opt-list">
      <button v-if="active.data.value" class="optb" style="border-color:var(--acc)" @click="go('/workout')"><span class="oi"><Icon name="play" /></span><div class="grow"><div class="t">Resume {{ active.data.value.name }}</div><div class="s">In progress</div></div></button>
      <button v-for="p in today" :key="p.scheduleId" class="optb" @click="go(`/routines/${p.routineId}/start?schedule=${p.scheduleId}&date=${p.date}`)"><span class="oi"><Icon name="calendar" /></span><div class="grow"><div class="t">{{ p.name }}</div><div class="s">Planned for today{{ p.timeOfDay ? " at " + p.timeOfDay : "" }}</div></div></button>
    </div>
    <h2>Routines</h2>
    <div v-if="(routines.data.value?.length ?? 0) > 6" class="search" style="margin-bottom:8px"><Icon name="search" :size="18" /><input v-model="q" placeholder="Find a routine" /></div>
    <div class="list">
      <div v-for="r in list.slice(0, 8)" :key="r.id" class="li click" @click="go(`/routines/${r.id}/start`)">
        <span class="dot" :style="r.color ? { background: r.color } : undefined" />
        <div class="grow"><div class="t">{{ r.name }}</div><div class="s">{{ r.exerciseCount }} exercises · ~{{ duration(r.estimateS, true) }} · {{ r.lastDoneAt ? ago(r.lastDoneAt) : "not done yet" }}</div></div>
        <Icon name="right" />
      </div>
      <div v-if="!routines.data.value?.length" class="tiny" style="padding:8px 0">No routines yet.</div>
    </div>
    <div class="opt-list" style="margin-top:14px">
      <button class="optb" @click="go('/routines/new/edit')"><span class="oi"><Icon name="plus" /></span><div class="grow"><div class="t">Create a new routine</div><div class="s">From scratch, from a template or from another routine</div></div></button>
      <button class="optb" @click="empty"><span class="oi"><Icon name="dumbbell" /></span><div class="grow"><div class="t">Empty workout</div><div class="s">Add exercises as you go</div></div></button>
      <button class="optb" @click="emit('close'); activitySheet = {}"><span class="oi"><Icon name="walk" /></span><div class="grow"><div class="t">Walk or other activity</div><div class="s">Record with GPS or type it in</div></div></button>
      <button class="optb" @click="go('/log')"><span class="oi"><Icon name="history" /></span><div class="grow"><div class="t">Log a past workout</div><div class="s">Something you did without the app</div></div></button>
    </div>
  </Sheet>
</template>
