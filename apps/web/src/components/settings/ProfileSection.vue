<script setup lang="ts">
// You: name, email, age, sex, height and weight. Age, sex, height and weight feed strength standards and calories.
import { computed } from "vue";
import { useMe, useSettings, saveSettings, useBody } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { toastError } from "../../core/toast";
import { useFmt, ago } from "../../core/format";
import { bodySheet } from "../../core/ui";

const me = useMe();
const s = useSettings();
const fmt = useFmt();
const weights = useBody("weight");
const latest = computed<any>(() => (weights.data.value ?? [])[0]);
const p = computed(() => s.value.profile);
const imperial = computed(() => s.value.units.system === "imperial");
const age = computed(() => (p.value.birthYear ? new Date().getFullYear() - p.value.birthYear : null));
// height is kept in cm; imperial shows feet and inches
const ft = computed(() => (p.value.heightCm ? Math.floor(p.value.heightCm / 30.48) : null));
const inch = computed(() => (p.value.heightCm ? Math.round((p.value.heightCm / 2.54) % 12) : null));
const setHeightImperial = (f: number | null, i: number | null) => saveSettings({ profile: { heightCm: f || i ? Math.round(((f ?? 0) * 12 + (i ?? 0)) * 2.54) : null } });
const val = (e: Event) => (e.target as HTMLInputElement).value;

async function saveMe(patch: { displayName?: string; email?: string }) {
  const u = me.data.value?.user;
  try { await api.put("/me", { displayName: patch.displayName ?? u?.displayName, email: patch.email ?? u?.email }); invalidate(["settings"]); } catch (e) { toastError(e); }
}
</script>

<template>
  <div class="card">
    <div class="frow">
      <div class="fld"><label>Name</label><input :value="me.data.value?.user.displayName ?? ''" placeholder="Your name" @change="saveMe({ displayName: val($event).trim() })" /></div>
      <div class="fld"><label>Email (optional)</label><input type="email" :value="me.data.value?.user.email ?? ''" @change="saveMe({ email: val($event).trim() })" /></div>
    </div>
  </div>
  <div class="sh first"><h2>Your body</h2></div>
  <div class="card">
    <p class="tiny" style="margin-bottom:10px">Optional. Used for strength standards and calories.</p>
    <div class="frow">
      <div class="fld"><label>Year of birth{{ age ? ` · ${age} years old` : "" }}</label><input type="number" inputmode="numeric" min="1900" :max="new Date().getFullYear()" :value="p.birthYear ?? ''" @change="saveSettings({ profile: { birthYear: Number(val($event)) || null } })" /></div>
      <div class="fld"><label>Sex</label><div class="seg block"><button v-for="[k, l] in [['', 'Not set'], ['male', 'Male'], ['female', 'Female']]" :key="k" :class="{ on: p.sex === k }" @click="saveSettings({ profile: { sex: k } })">{{ l }}</button></div></div>
    </div>
    <div class="frow">
      <div v-if="!imperial" class="fld"><label>Height (cm)</label><input type="number" inputmode="decimal" :value="p.heightCm ?? ''" @change="saveSettings({ profile: { heightCm: Number(val($event)) || null } })" /></div>
      <div v-else class="fld"><label>Height</label><div class="row" style="gap:8px">
        <input type="number" inputmode="numeric" :value="ft ?? ''" placeholder="ft" @change="setHeightImperial(Number(val($event)) || null, inch)" /><span class="tiny">ft</span>
        <input type="number" inputmode="numeric" :value="inch ?? ''" placeholder="in" @change="setHeightImperial(ft, Number(val($event)) || null)" /><span class="tiny">in</span></div></div>
      <div class="fld"><label>Body weight</label>
        <div class="row"><div class="grow"><b>{{ latest ? `${fmt.w(latest.value)} ${fmt.wu}` : "Not logged yet" }}</b><div v-if="latest" class="tiny">{{ ago(latest.measuredAt) }}</div></div><button class="btn s o" @click="bodySheet = true">Log</button></div></div>
    </div>
  </div>
</template>
