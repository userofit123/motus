<script setup lang="ts">
// Settings → Activities: the activity types you record, log and set goals for, one list used everywhere. Add your own,
// rename one, change what it tracks, or remove it (activities already logged as it keep their name).
import { useActivityTypes } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { prompt, confirm } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { newActivityType, TRACKS, tracksOf } from "../../core/activityTypes";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import AppSelect from "../AppSelect.vue";

const types = useActivityTypes();
async function put(slug: string, b: Record<string, unknown>, msg?: string) {
  try { await api.put(`/activity-types/${slug}`, b); invalidate(["activities"]); if (msg) toast(msg); } catch (e) { toastError(e); }
}
async function rename(t: any) { const n = (await prompt("Rename", { value: t.name }))?.trim(); if (n && n !== t.name) put(t.slug, { name: n }, "Renamed"); }
async function remove(t: any) {
  if (!(await confirm(`Remove ${t.name}?`, { text: "Activities you logged as it stay, under the same name.", ok: "Remove", danger: true }))) return;
  try { await api.del(`/activity-types/${t.slug}`); invalidate(["activities"]); toast(`${t.name} removed`); } catch (e) { toastError(e); }
}
const setTracks = (t: any, v: string) => { const x = TRACKS.find((y) => y.value === v)!; put(t.slug, { hasDistance: x.hasDistance, hasGps: x.hasGps }); };
</script>

<template>
  <div class="sh first"><h2>Activity types</h2><button class="lnk" @click="newActivityType"><Icon name="plus" :size="14" />New type</button></div>
  <p class="tiny hgap">Used when you record or log an activity and when you set a goal. Gym workouts are separate: they're the workouts you log in Motus.</p>
  <div class="card flush">
    <div v-for="t in types.data.value ?? []" :key="t.slug" class="li">
      <Icon :name="t.icon" :size="18" class="muted" /><div class="grow"><div class="t">{{ t.name }}</div></div>
      <AppSelect class="at-tr" :model-value="tracksOf(t)" :options="TRACKS.map(({ value, label }) => ({ value, label }))" :title="`What ${t.name} tracks`" @update:model-value="(v) => setTracks(t, String(v))" />
      <Menu :items="[{ label: 'Rename', icon: 'edit', run: () => rename(t) }, { label: 'Remove', icon: 'trash', danger: true, run: () => remove(t) }]" />
    </div>
  </div>
</template>

<style scoped>
.li > .at-tr { width: min(260px, 50%); max-width: none; flex: none; }
</style>
