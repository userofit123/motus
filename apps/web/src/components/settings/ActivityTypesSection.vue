<script setup lang="ts">
// Settings → Activities: the activity types you record, log and set goals for, one list used everywhere. Add your own,
// rename one, change what it tracks, or remove it (activities already logged as it keep their name).
import { useActivityTypes } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { prompt, confirm, choose } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { newActivityType, TRACKS, tracksOf } from "../../core/activityTypes";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";

const types = useActivityTypes();
async function put(slug: string, b: Record<string, unknown>, msg?: string) {
  try { await api.put(`/activity-types/${slug}`, b); invalidate(["activities"]); if (msg) toast(msg); } catch (e) { toastError(e); }
}
async function rename(t: any) { const n = (await prompt("Rename", { value: t.name }))?.trim(); if (n && n !== t.name) put(t.slug, { name: n }, "Renamed"); }
async function remove(t: any) {
  if (!(await confirm(`Remove ${t.name}?`, { text: "Activities you logged as it stay, under the same name.", ok: "Remove", danger: true }))) return;
  try { await api.del(`/activity-types/${t.slug}`); invalidate(["activities"]); toast(`${t.name} removed`); } catch (e) { toastError(e); }
}
const hintOf = (t: any) => TRACKS.find((x) => x.value === tracksOf(t))!.hint;
// asked like a new type's second question; a drop-down in the row left no room for its text at phone width
async function setTracks(t: any) {
  const v = await choose(`What does ${t.name} track?`, TRACKS.map(({ value, label }) => ({ value, label })), `Now: ${hintOf(t)}`);
  if (!v || v === tracksOf(t)) return;
  const x = TRACKS.find((y) => y.value === v)!;
  put(t.slug, { hasDistance: x.hasDistance, hasGps: x.hasGps, hasSteps: x.hasSteps }, "Saved");
}
</script>

<template>
  <!-- no heading: the page title (phone) or the open section in the side list (computer) already says "Activity types" -->
  <p class="muted" style="margin:0">Used when you record or log an activity and when you set a goal. Gym workouts are separate: they're the workouts you log in Motus.</p>
  <div v-if="types.data.value" class="card flush">
    <div v-for="t in types.data.value" :key="t.slug" class="li">
      <Icon :name="t.icon" :size="18" class="muted" /><div class="grow"><div class="t">{{ t.name }}</div><div class="s">{{ hintOf(t) }}</div></div>
      <Menu :label="`${t.name} options`" :items="[{ label: 'Rename', icon: 'edit', run: () => rename(t) }, { label: 'Change what it tracks', icon: 'activity', run: () => setTracks(t) }, { label: 'Remove', icon: 'trash', danger: true, sep: true, run: () => remove(t) }]" />
    </div>
    <div v-if="!types.data.value.length" class="li"><span class="grow tiny">No activity types. Add your own.</span></div>
  </div>
  <button class="btn" @click="newActivityType"><Icon name="plus" :size="16" />New activity type</button>
</template>
