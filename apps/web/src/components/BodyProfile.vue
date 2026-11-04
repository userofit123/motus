<script setup lang="ts">
// Body → About you: year of birth, sex and height, edited in place. All three are optional. Only sex is used (with your latest weight) for the strength standards;
// height and year of birth are kept for you. Height is stored in cm and shown in feet and inches when imperial.
import { computed } from "vue";
import { useSettings, saveSettings } from "../api/queries";
import AppSelect from "./AppSelect.vue";
import NumStep from "./NumStep.vue";

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
const setProfile = (patch: Record<string, unknown>) => saveSettings({ profile: patch });
const setHeightImperial = (f: number | null, i: number | null) => setProfile({ heightCm: f || i ? Math.round(((f ?? 0) * 12 + (i ?? 0)) * 2.54) : null });
</script>

<template>
  <p class="tiny hgap">All optional. Sex and your latest weight set the strength standards; height and age are kept for you.</p>
  <div class="card flush">
    <div class="li"><div class="grow"><div class="t">Year of birth</div><div v-if="age" class="s">{{ age }} years old</div></div>
      <AppSelect class="bpf-in" :model-value="p.birthYear ?? null" :options="YEARS" title="Year of birth" @update:model-value="(v) => setProfile({ birthYear: v })" /></div>
    <div class="li"><div class="grow t">Sex</div>
      <div class="seg bpf-in"><button v-for="o in SEX" :key="o.value" :class="{ on: p.sex === o.value }" @click="p.sex !== o.value && setProfile({ sex: o.value })">{{ o.label }}</button></div></div>
    <div class="li"><div class="grow"><div class="t">Height</div><button v-if="p.heightCm" class="lnk" @click="setProfile({ heightCm: null })">Not set</button></div>
      <NumStep v-if="!imperial" :value="p.heightCm" :min="100" :max="250" unit="cm" label="height" @set="(v) => setProfile({ heightCm: v || null })" />
      <div v-else class="bpf-ftin">
        <NumStep :value="ft" :min="3" :max="8" unit="ft" label="feet" @set="(v) => setHeightImperial(v, inch)" />
        <NumStep :value="inch" :min="0" :max="11" unit="in" label="inches" @set="(v) => setHeightImperial(ft ?? 5, v)" />
      </div></div>
  </div>
</template>

<style scoped>
.li > .bpf-in { width: min(240px, 58%); max-width: none; flex: none; }
.bpf-in.seg { display: flex; }
.bpf-in.seg button { flex: 1; padding-inline: 6px; }
.bpf-ftin { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
</style>
