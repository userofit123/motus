<script setup lang="ts">
// One workout setting from core/workoutPrefs.ts, as a switch, a choice or a number, the same on Settings and in the
// popup. `local` marks a value set for this workout only. `prefs`: all the settings as they apply on that screen, for
// hearing a sound at the volume chosen there.
import type { WorkoutPrefs } from "@motus/shared";
import type { PrefRow } from "../core/workoutPrefs";
import { previewCue } from "../workout/runtime";
import AppSelect from "./AppSelect.vue";
import NumStep from "./NumStep.vue";
import Icon from "./Icon.vue";

const props = defineProps<{ row: PrefRow; value: unknown; prefs: WorkoutPrefs; local?: boolean }>();
const emit = defineEmits<{ set: [v: unknown] }>();
const play = (cueSound: unknown) => previewCue({ cueSound: cueSound as WorkoutPrefs["cueSound"], cueVolume: props.prefs.cueVolume });
// a new volume is played at once, so you hear what you chose
function setNum(v: number) { emit("set", v); if (props.row.key === "cueVolume" && props.prefs.sound) previewCue({ cueSound: props.prefs.cueSound, cueVolume: v }); }
const label = (v: unknown) => props.row.options?.find((o) => o.value === v)?.label ?? "";
</script>

<template>
  <div v-if="row.options || row.num" class="li"><div class="grow"><div class="t">{{ row.label }}<span v-if="local" class="mchip pr-chip">this workout</span></div><div v-if="row.hint" class="s">{{ row.hint }}</div></div>
    <NumStep v-if="row.num" :value="value as number" :min="row.num.min" :max="row.num.max" :step="row.num.step" :unit="row.num.unit" :label="row.label.toLowerCase()" @set="setNum" />
    <template v-else>
      <AppSelect :model-value="value" :options="row.options!" :title="row.label" style="width:auto" @update:model-value="(v) => emit('set', v)">
        <template v-if="row.preview" #end="{ option }">
          <button type="button" class="ib sm plain" :disabled="!prefs.sound" :aria-label="`Play ${option.label}`" :title="`Play ${option.label}`" @click.stop="play(option.value)"><Icon name="play" /></button>
        </template>
      </AppSelect>
      <button v-if="row.preview" type="button" class="ib sm plain" :disabled="!prefs.sound" :aria-label="`Play ${label(value)}`" :title="`Play ${label(value)}`" @click="play(value)"><Icon name="play" /></button>
    </template>
  </div>
  <label v-else class="tgl"><div class="grow"><div class="t">{{ row.label }}<span v-if="local" class="mchip pr-chip">this workout</span></div><div v-if="row.hint" class="s">{{ row.hint }}</div></div>
    <span class="tg"><input type="checkbox" :checked="!!value" @change="emit('set', ($event.target as HTMLInputElement).checked)" /></span></label>
</template>

<style scoped>
.pr-chip { margin-inline-start: 6px; }
</style>
