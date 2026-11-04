<script setup lang="ts">
// The quiet card at the top of Body → Weight: height, age and sex on one line ("178 cm · 34 · Male"); tapping it opens a
// small sheet to change them. All three are optional. Only sex is used (with your latest weight) for the strength standards;
// height and year of birth are kept for you. Height is stored in cm and shown in feet and inches when imperial.
import { computed, ref } from "vue";
import { useSettings, saveSettings } from "../api/queries";
import AppSelect from "./AppSelect.vue";
import NumStep from "./NumStep.vue";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";

const s = useSettings();
const p = computed(() => s.value.profile);
const imperial = computed(() => s.value.units.system === "imperial");
const open = ref(false);
const year = new Date().getFullYear();
const age = computed(() => (p.value.birthYear ? year - p.value.birthYear : null));
// newest first: most people scroll a short way; under-13s aren't offered, and the list runs back to 1900 so a stored year always shows
const YEARS = [{ value: null, label: "Not set" }, ...Array.from({ length: year - 13 - 1900 + 1 }, (_, i) => ({ value: year - 13 - i, label: String(year - 13 - i) }))];
const SEX = [{ value: "", label: "Not set" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }];
const totIn = computed(() => (p.value.heightCm ? Math.round(p.value.heightCm / 2.54) : null));
const ft = computed(() => (totIn.value ? Math.floor(totIn.value / 12) : null));
const inch = computed(() => (totIn.value ? totIn.value % 12 : null));
const height = computed(() => (!p.value.heightCm ? null : imperial.value ? `${ft.value} ft ${inch.value} in` : `${p.value.heightCm} cm`));
const parts = computed(() => [height.value, age.value ? String(age.value) : null, SEX.find((o) => o.value && o.value === p.value.sex)?.label ?? null].filter(Boolean) as string[]);
const setProfile = (patch: Record<string, unknown>) => saveSettings({ profile: patch });
const setHeightImperial = (f: number | null, i: number | null) => setProfile({ heightCm: f || i ? Math.round(((f ?? 0) * 12 + (i ?? 0)) * 2.54) : null });
</script>

<template>
  <div class="card flush">
    <div class="li click" role="button" tabindex="0" @click="open = true" @keydown.enter="open = true">
      <Icon name="user" :size="18" class="muted" />
      <div v-if="parts.length" class="grow bpf-row"><template v-for="(x, i) in parts" :key="i"><span v-if="i" class="sep">·</span><span>{{ x }}</span></template></div>
      <div v-else class="grow"><div class="t">Height, age and sex</div><div class="s">Optional</div></div>
      <Icon name="right" :size="16" class="muted" />
    </div>
  </div>

  <Sheet v-if="open" title="About your body" @close="open = false">
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
  </Sheet>
</template>

<style scoped>
.bpf-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.li > .bpf-in { width: min(240px, 58%); max-width: none; flex: none; }
.bpf-in.seg { display: flex; }
.bpf-in.seg button { flex: 1; padding-inline: 6px; }
.bpf-ftin { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
</style>
