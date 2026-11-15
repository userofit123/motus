<script setup lang="ts">
// Body → About you: year of birth, sex and height, edited in place. All three are optional. Sex is used (with your latest weight) for the strength standards;
// height is kept for you. Height is stored in cm and shown in feet and inches when imperial. Max heart rate (the heart
// rate zones in Stats → Heart) only once a band has handed over heart data: from the year of birth unless set here.
import { computed } from "vue";
import { maxHeartRate } from "@motus/shared";
import { useSettings, saveSettings, useHealthAvailable } from "../api/queries";
import AppSelect from "./AppSelect.vue";
import NumStep from "./NumStep.vue";
import Icon from "./Icon.vue";

const s = useSettings();
const p = computed(() => s.value.profile);
const imperial = computed(() => s.value.units.system === "imperial");
const year = new Date().getFullYear();
const age = computed(() => (p.value.birthYear ? year - p.value.birthYear : null));
// newest first: most people scroll a short way; under-13s aren't offered, and the list runs back to 1900 so a stored year always shows
const YEARS = [{ value: null, label: "Not set" }, ...Array.from({ length: year - 13 - 1900 + 1 }, (_, i) => ({ value: year - 13 - i, label: String(year - 13 - i) }))];
const SEX = [{ value: "", label: "Not set" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }];
const totIn = computed(() => (p.value.heightCm ? Math.round(p.value.heightCm / 2.54) : null));
const ft = computed(() => (totIn.value ? Math.floor(totIn.value / 12) : null));
const inch = computed(() => (totIn.value ? totIn.value % 12 : null));
const DEFAULT_CM = 170; // a sensible start for the stepper; clearing it puts height back to not set
const avail = useHealthAvailable();
const heart = computed(() => !!avail.data.value?.heart);
// the estimate from age, shown beside the label while no max of your own is set; the stepper starts from it
const ageMax = computed(() => maxHeartRate({ birthYear: p.value.birthYear }));
const DEFAULT_MAX = 190;
const setProfile = (patch: Record<string, unknown>) => saveSettings({ profile: patch });
const setHeightImperial = (f: number | null, i: number | null) => setProfile({ heightCm: f || i ? Math.round(((f ?? 0) * 12 + (i ?? 0)) * 2.54) : null });
</script>

<template>
  <div class="card">
    <div class="fld"><label>Year of birth{{ age ? ` · ${age} years old` : "" }}</label>
      <AppSelect :model-value="p.birthYear ?? null" :options="YEARS" title="Year of birth" @update:model-value="(v) => setProfile({ birthYear: v })" /></div>
    <div class="fld"><label>Sex</label>
      <div class="seg block"><button v-for="o in SEX" :key="o.value" :class="{ on: p.sex === o.value }" @click="p.sex !== o.value && setProfile({ sex: o.value })">{{ o.label }}</button></div></div>
    <div class="fld"><label>Height</label>
      <div v-if="!p.heightCm" class="seg block"><button class="on" disabled>Not set</button><button @click="setProfile({ heightCm: DEFAULT_CM })">Set height</button></div>
      <div v-else class="hrow">
        <NumStep v-if="!imperial" :value="p.heightCm" :min="100" :max="250" unit="cm" label="height" @set="(v) => setProfile({ heightCm: v || null })" />
        <template v-else>
          <NumStep :value="ft" :min="3" :max="8" unit="ft" label="feet" @set="(v) => setHeightImperial(v, inch)" />
          <NumStep :value="inch" :min="0" :max="11" unit="in" label="inches" @set="(v) => setHeightImperial(ft ?? 5, v)" />
        </template>
        <button class="ib sm plain" aria-label="Clear height" @click="setProfile({ heightCm: null })"><Icon name="close" :size="16" /></button>
      </div></div>
    <div v-if="heart" class="fld"><label>Max heart rate{{ !p.maxHr && ageMax ? ` · ${ageMax.bpm} bpm` : "" }}</label>
      <div v-if="!p.maxHr" class="seg block"><button class="on" disabled>{{ ageMax ? "From your age" : "Not set" }}</button><button @click="setProfile({ maxHr: ageMax?.bpm ?? DEFAULT_MAX })">Set max heart rate</button></div>
      <div v-else class="hrow">
        <NumStep :value="p.maxHr" :min="100" :max="230" unit="bpm" label="max heart rate" @set="(v) => setProfile({ maxHr: v || null })" />
        <button class="ib sm plain" aria-label="Clear max heart rate" @click="setProfile({ maxHr: null })"><Icon name="close" :size="16" /></button>
      </div></div>
    <p class="tiny">All optional. Sex and your latest weight set the strength standards{{ heart ? "; your max heart rate (or your age) sets the heart rate zones" : "" }}; height{{ heart ? " is" : " and age are" }} kept for you.</p>
  </div>
</template>
