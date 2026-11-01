<script setup lang="ts">
// Body: weight (with a smoothed trend), measurements, and the daily log (steps, sleep, water, mood) when switched on.
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useBody, useSettings } from "../api/queries";
import { api } from "../api/client";
import { confirm } from "../core/ask";
import { invalidate } from "../api/live";
import { useFmt, localYmd } from "../core/format";
import { bodySheet } from "../core/ui";
import { fromCm } from "@motus/shared";
import Icon from "../components/Icon.vue";
import LineChart from "../components/LineChart.vue";
import DailyLog from "../components/DailyLog.vue";
import ProgressPhotos from "../components/ProgressPhotos.vue";

const route = useRoute();
const body = useBody();
const s = useSettings();
const fmt = useFmt();
onMounted(() => { if (route.query.add) bodySheet.value = true; });
const entries = computed(() => (body.data.value ?? []).filter((b: any) => b.kind !== "photo"));
const weights = computed(() => (body.data.value ?? []).filter((b: any) => b.kind === "weight").slice().reverse());
const trend = computed(() => { let e: number | null = null; return weights.value.map((b: any) => { const y = fmt.value.fromKg(b.value); e = e == null ? y : e + 0.15 * (y - e); return { x: new Date(b.measuredAt).getTime(), y: Math.round(e! * 10) / 10 }; }); });
const val = (b: any) => (b.kind === "weight" ? `${fmt.value.w(b.value)} ${fmt.value.wu}` : b.kind === "body_fat" ? `${b.value}%` : `${fmt.value.num(fromCm(b.value, s.value.units.length), 1)} ${s.value.units.length}`);
async function del(id: string) { if (!(await confirm("Delete this entry?", { ok: "Delete", danger: true }))) return; await api.del(`/body/${id}`); invalidate(["body", "stats", "goals", "home"]); }
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Body</h1><div class="sub">{{ weights.length ? `Latest ${fmt.w(weights.at(-1).value)} ${fmt.wu}` : "Nothing logged yet" }}</div></div><div class="acts"><button class="btn keep" @click="bodySheet = true"><Icon name="plus" :size="18" />Log</button></div></div>
    <div class="card"><div class="lbl" style="margin-bottom:8px">Body weight · smoothed trend</div><LineChart :points="trend" :height="220" :fmt="(v) => fmt.num(v, 1)" /></div>
    <DailyLog v-if="s.features.dailyLog || s.features.steps" style="margin-top:var(--spg)" />
    <ProgressPhotos v-if="s.features.photos" style="margin-top:var(--spg)" />
    <div class="sh"><h2>Entries</h2></div>
    <div class="card"><div v-if="!entries.length" class="tiny">No entries yet.</div>
      <div class="list"><div v-for="b in entries" :key="b.id" class="li"><div class="grow"><div class="t" style="text-transform:capitalize">{{ b.kind.replace("_", " ") }}</div><div class="s">{{ fmt.date(b.measuredAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div><b class="num">{{ val(b) }}</b><button class="ib sm plain" aria-label="Delete" @click="del(b.id)"><Icon name="trash" :size="16" /></button></div></div></div>
  </div>
</template>
