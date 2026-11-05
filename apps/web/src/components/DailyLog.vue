<script setup lang="ts">
// The daily log: steps (Steps feature) and sleep, water and mood (Sleep, water and mood feature), one value a day.
// Kept apart from body measurements on purpose: these are about the day, not the body. Filed under activity.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useSettings } from "../api/queries";
import { localYmd, useFmt } from "../core/format";
import { savedToast, savedError } from "../core/toast";
import { DAILY_KINDS } from "@motus/shared";
import Icon from "./Icon.vue";
import { useStepGoal } from "../core/goals";

// day: which day the boxes write to; history: the last week below, for the sheet
const props = defineProps<{ day?: string; history?: boolean }>();
const s = useSettings();
const stepGoal = useStepGoal();
const fmt = useFmt();
const from = localYmd(new Date(Date.now() - 8 * 86400000));
const q = useQuery({ queryKey: ["activities", "daily", from], queryFn: () => api.get("/daily", { from, tz: new Date().getTimezoneOffset() }) });
const day = computed(() => props.day ?? localYmd(new Date()));
const KINDS = computed(() => DAILY_KINDS.filter((k) => s.value.features[k.feature]));
const row = (k: string, d: string) => (q.data.value ?? []).find((x: any) => x.kind === k && String(x.date).slice(0, 10) === d);
const num = (v: unknown) => (v == null ? null : Number(v));
// value: what the day counts (for steps, walks included); the box shows only what was entered (logged), so a lower
// number typed in stays visible instead of jumping back to the walks' total, which shows as a hint under it
const val = (k: string, d = day.value) => num(row(k, d)?.value);
const entered = (k: string) => { const r = row(k, day.value); return num(k === "steps" && r ? r.logged : r?.value); };
const walked = computed(() => num(row("steps", day.value)?.walked) ?? 0);
const steps = computed(() => val("steps"));
async function set(k: string, v: string) {
  try { await api.put("/daily", { date: day.value, kind: k, value: v === "" ? null : Number(v) }); invalidate(["activities", "stats", "goals", "home"]); savedToast(); } catch (e) { savedError(e); }
}
// the week before the chosen day, newest first, only days with something logged
const week = computed(() => Array.from({ length: 7 }, (_, i) => localYmd(new Date(new Date(day.value + "T12:00").getTime() - (i + 1) * 86400000)))
  .map((d) => ({ d, v: KINDS.value.map((k) => val(k.id, d)) })).filter((x) => x.v.some((v) => v != null)));
const show = (k: string, v: number | null) => (v == null ? "-" : k === "steps" ? fmt.value.num(v, 0) : `${fmt.value.num(v, 1)}${k === "mood" ? "" : " " + DAILY_KINDS.find((x) => x.id === k)!.unit}`);
</script>

<template>
  <div>
    <div class="grid g4 dl-grid">
      <div v-for="k in KINDS" :key="k.id" class="fld dl-fld"><label><Icon :name="k.icon" :size="14" />{{ k.name }}{{ k.unit ? ` (${k.unit})` : "" }}</label>
        <input type="number" :step="k.step" min="0" inputmode="decimal" :value="entered(k.id) ?? ''" @change="set(k.id, ($event.target as HTMLInputElement).value)" />
        <span v-if="k.id === 'steps' && walked > 0" class="tiny dl-hint">From activities: {{ fmt.num(walked, 0) }}</span></div>
    </div>
    <div v-if="s.features.steps && stepGoal" class="dl-goal"><div class="dl-bar"><i :style="{ width: Math.min(100, ((steps ?? 0) / stepGoal.target) * 100) + '%' }" /></div>
      <span class="tiny">{{ fmt.num(steps ?? 0, 0) }} of {{ fmt.num(stepGoal.target, 0) }} steps</span></div>
    <template v-if="history && week.length">
      <div class="lbl dl-wk">Last 7 days</div>
      <div class="list"><div v-for="w in week" :key="w.d" class="li"><div class="grow t">{{ fmt.date(w.d + "T12:00", { weekday: "short", day: "numeric", month: "short" }) }}</div>
        <span v-for="(k, i) in KINDS" :key="k.id" class="num tiny dl-v" :title="k.name">{{ show(k.id, w.v[i]!) }}</span></div></div>
    </template>
  </div>
</template>

<style scoped>
.dl-grid { gap: 10px; }
.dl-fld { margin: 0; }
.dl-fld label { display: flex; align-items: center; gap: 4px; }
.dl-goal { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.dl-bar { flex: 1; height: 6px; border-radius: 3px; background: var(--s2); overflow: hidden; }
.dl-bar i { display: block; height: 100%; background: var(--acc); border-radius: inherit; }
.dl-hint { display: block; margin-top: 4px; }
.dl-wk { margin-top: var(--spg); }
.dl-v { min-width: 56px; text-align: end; }
</style>
