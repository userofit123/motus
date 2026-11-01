<script setup lang="ts">
// The daily log: steps, sleep, water and mood for today, with the last two weeks below.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useSettings } from "../api/queries";
import { localYmd } from "../core/format";

const s = useSettings();
const from = localYmd(new Date(Date.now() - 14 * 86400000));
const q = useQuery({ queryKey: ["body", "daily", from], queryFn: () => api.get("/daily", { from }) });
const today = localYmd(new Date());
const KINDS = computed(() => [...(s.value.features.steps ? [["steps", "Steps", 500]] : []), ...(s.value.features.dailyLog ? [["sleep_h", "Sleep (h)", 0.5], ["water_ml", "Water (ml)", 250], ["mood", "Mood (1–5)", 1]] : [])] as [string, string, number][]);
const val = (k: string, d = today) => (q.data.value ?? []).find((x: any) => x.kind === k && x.date === d)?.value ?? null;
async function set(k: string, v: string) { await api.put("/daily", { date: today, kind: k, value: v === "" ? null : Number(v) }); invalidate(["body", "stats", "goals", "home"]); }
</script>

<template>
  <div class="card">
    <div class="lbl" style="margin-bottom:8px">Today</div>
    <div class="grid g4" style="gap:10px">
      <div v-for="[k, l, step] in KINDS" :key="k" class="fld" style="margin:0"><label>{{ l }}</label><input type="number" :step="step" inputmode="decimal" :value="val(k) ?? ''" @change="set(k, ($event.target as HTMLInputElement).value)" /></div>
    </div>
  </div>
</template>
