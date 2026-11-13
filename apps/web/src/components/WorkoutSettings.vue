<script setup lang="ts">
// A workout's settings (PLAN.md §8.4.3), in the same groups, order and words as Settings → Workout defaults (one list
// for both: core/workoutPrefs.ts). Each shows the default, can be changed for this workout only, or saved as the new
// default.
import { computed } from "vue";
import type { WorkoutPrefs } from "@motus/shared";
import { useSettings, saveSettings } from "../api/queries";
import { toast } from "../core/toast";
import { prefGroups } from "../core/workoutPrefs";
import PrefRow from "./PrefRow.vue";

const model = defineModel<Record<string, unknown>>({ default: {} });
const s = useSettings();
const groups = computed(() => prefGroups(s.value));
// the settings as they apply to this workout: the defaults with this workout's own choices over them
const eff = computed<WorkoutPrefs>(() => ({ ...s.value.workout, ...model.value }) as WorkoutPrefs);
const val = (k: keyof WorkoutPrefs) => (k in model.value ? model.value[k] : s.value.workout[k]);
function set(k: keyof WorkoutPrefs, v: unknown) {
  const o = { ...model.value };
  if (v === s.value.workout[k]) delete o[k]; else o[k] = v;
  model.value = o;
}
function saveDefault() { saveSettings({ workout: model.value }, { quiet: true }); model.value = {}; toast("Saved as your default"); }
</script>

<template>
  <div>
    <template v-for="(g, gi) in groups" :key="g.id">
      <div class="sh" :class="{ first: gi === 0 }"><h2>{{ g.title }}</h2></div>
      <div class="card"><PrefRow v-for="r in g.rows" :key="r.key" :row="r" :value="val(r.key)" :prefs="eff" :local="r.key in model" @set="set(r.key, $event)" /></div>
    </template>
    <div v-if="Object.keys(model).length" class="row ws-foot"><button class="qb" @click="model = {}">Back to default</button><div class="grow" /><button class="btn o s" @click="saveDefault">Save as my default</button></div>
  </div>
</template>

<style scoped>
.ws-foot { margin-top: var(--spg); }
</style>
