<script setup lang="ts">
// A workout's settings (PLAN.md §8.4.3): each switch shows the default, can be changed for this workout only,
// or saved as the new default. Switches for features that are off are not shown.
import { computed } from "vue";
import type { WorkoutPrefs } from "@motus/shared";
import { useSettings, saveSettings } from "../api/queries";
import { toast } from "../core/toast";

const model = defineModel<Record<string, unknown>>({ default: {} });
defineProps<{ routineId?: string }>();
const s = useSettings();
const ROWS = computed(() => ([
  ["prefillFromLast", "Fill in last time's numbers", "Otherwise the routine's targets"],
  ["autoRest", "Start the rest timer when a set is ticked", ""],
  ["restEndNext", "Go to the next set when the rest ends", "Otherwise it waits on \"Rest over\" until you tap Next set"],
  ["countdown", "3-2-1 before timed sets", ""],
  ["sound", "Sound when the rest ends", ""],
  ["vibrate", "Vibrate when the rest ends", ""],
  ["warn10", "Warn 10 seconds before", ""],
  ...(s.value.features.voice ? [["voice", "Voice cues", "Says what's next"]] : []),
  ["keepAwake", "Keep the screen on", ""],
  ["lockScreen", "Timer on the lock screen", "Android app"],
  ...(s.value.features.setTypes ? [["showWarmups", "Show warm-up sets", ""]] : []),
  ["autoAdvance", "Go to the next exercise when one is done", ""],
  ["showPrevious", "Show last time's numbers", ""],
  ["showReminders", "Show reminders and pinned notes", ""],
  ["confirmSkip", "Ask before skipping an exercise", ""],
] as [keyof WorkoutPrefs, string, string][]));
const val = (k: keyof WorkoutPrefs) => (k in model.value ? model.value[k] : s.value.workout[k]) as boolean;
function set(k: keyof WorkoutPrefs, v: boolean) {
  const o = { ...model.value };
  if (v === s.value.workout[k]) delete o[k]; else o[k] = v;
  model.value = o;
}
function saveDefault() { saveSettings({ workout: model.value }, { quiet: true }); model.value = {}; toast("Saved as your default"); }
</script>

<template>
  <div>
    <label v-for="[k, l, d] in ROWS" :key="k" class="tgl">
      <div class="grow"><div class="t">{{ l }}<span v-if="k in model" class="mchip" style="margin-inline-start:6px">this workout</span></div><div v-if="d" class="s">{{ d }}</div></div>
      <span class="tg"><input type="checkbox" :checked="val(k)" @change="set(k, ($event.target as HTMLInputElement).checked)" /></span>
    </label>
    <div v-if="Object.keys(model).length" class="row" style="margin-top:12px"><button class="qb" @click="model = {}">Back to default</button><div class="grow" /><button class="btn o s" @click="saveDefault">Save as my default</button></div>
  </div>
</template>
