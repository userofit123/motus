<script setup lang="ts">
// Goals (requirements 7 and 8): general, per routine, per exercise, per muscle group, for activities and for the body.
// Active, achieved and archived; each with its progress, pace and trend.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GROUPS, toKg, fromKg, toM, fromM, type Goal } from "@motus/shared";
import { useGoals, useGoalMetrics, useRoutines, useExercises, useActivityTypes, useChange } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { confirm } from "../core/ask";
import { toastError, toast } from "../core/toast";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Sheet from "../components/Sheet.vue";
import GoalCard from "../components/GoalCard.vue";
import LineChart from "../components/LineChart.vue";
import ExercisePicker from "../components/ExercisePicker.vue";

const route = useRoute(), router = useRouter();
const goals = useGoals(true);
const metrics = useGoalMetrics();
const routines = useRoutines();
const exercises = useExercises();
const types = useActivityTypes();
const fmt = useFmt();
const filter = ref<"active" | "achieved" | "archived">("active");
const scopeFilter = ref("");
const list = computed(() => (goals.data.value ?? []).filter((g) => g.status === filter.value && (!scopeFilter.value || g.scope === scopeFilter.value)));
const counts = computed(() => ({ active: 0, achieved: 0, archived: 0, ...Object.fromEntries(["active", "achieved", "archived"].map((s) => [s, (goals.data.value ?? []).filter((g) => g.status === s).length])) }));
const SCOPES: [string, string, string][] = [["general", "General", "target"], ["routine", "Routine", "routines"], ["exercise", "Exercise", "dumbbell"], ["muscle", "Muscle group", "activity"], ["activity", "Activity", "walk"], ["body", "Body", "scale"]];
const open = ref<Goal | null>(null);

// ----- new goal -----
const creating = ref(route.query.new === "1");
const f = ref<any>({ scope: "general", metric: "workouts", scopeId: null, target: null, period: "week", deadline: "", title: "" });
const pickEx = ref(false);
const scopeMetrics = computed(() => (metrics.data.value ?? []).filter((m: any) => m.scope === f.value.scope));
const metric = computed<any>(() => (metrics.data.value ?? []).find((m: any) => m.metric === f.value.metric));
watch(() => f.value.scope, () => { f.value.metric = scopeMetrics.value[0]?.metric; f.value.scopeId = null; f.value.period = scopeMetrics.value[0]?.periodic ? "week" : "once"; });
watch(() => f.value.metric, () => { f.value.period = metric.value?.periodic ? (f.value.period === "once" ? "week" : f.value.period) : "once"; });
const unit = computed(() => metric.value?.unit === "kg" ? fmt.value.wu : metric.value?.unit === "km" ? fmt.value.du : metric.value?.unit);
const BODY: [string, string][] = [["weight", "Body weight"], ["body_fat", "Body fat %"], ["waist", "Waist"], ["chest", "Chest"], ["arm", "Arm"], ["thigh", "Thigh"]];
const scopeName = computed(() => {
  const v = f.value;
  if (v.scope === "routine") return routines.data.value?.find((r) => r.id === v.scopeId)?.name ?? "";
  if (v.scope === "exercise") return exercises.data.value?.find((e) => e.id === v.scopeId)?.name ?? "";
  if (v.scope === "muscle") return GROUPS.find((g) => g.id === v.scopeId)?.name ?? "";
  if (v.scope === "activity") return v.scopeId ? (types.data.value ?? []).find((t: any) => t.slug === v.scopeId)?.name ?? v.scopeId : "Any activity";
  if (v.scope === "body") return BODY.find((b) => b[0] === v.scopeId)?.[1] ?? "";
  return "";
});
const autoTitle = computed(() => {
  const m = metric.value; if (!m || f.value.target == null) return "";
  const per = f.value.period === "week" ? " a week" : f.value.period === "month" ? " a month" : "";
  const cmp = m.comparator === "<=" ? "to" : "";
  if (f.value.scope === "body") return `${scopeName.value || "Body weight"} ${cmp} ${f.value.target} ${unit.value}`;
  return `${scopeName.value ? scopeName.value + ": " : ""}${m.comparator === "<=" ? "under " : ""}${f.value.target} ${unit.value} ${m.name.toLowerCase()}${per}`.replace(/\s+/g, " ");
});
async function create() {
  const v = f.value, m = metric.value;
  if (!m || v.target == null) return toast("Set a target", { kind: "err" });
  let target = Number(v.target);
  if (m.unit === "kg") target = toKg(target, fmt.value.wu);
  if (m.unit === "km") target = toM(target, fmt.value.du) / 1000;
  if (v.scope === "body" && v.scopeId === "weight") { v.metric = "body_weight"; target = toKg(Number(v.target), fmt.value.wu); }
  try {
    await api.post("/goals", { metric: v.scope === "body" ? (v.scopeId === "weight" || !v.scopeId ? "body_weight" : "body_metric") : v.metric, scopeId: v.scope === "body" && v.scopeId === "weight" ? null : v.scopeId, target, period: v.period, deadline: v.deadline || null, title: v.title || autoTitle.value });
    invalidate(["goals", "home"]); creating.value = false; router.replace({ query: {} });
    f.value = { scope: "general", metric: "workouts", scopeId: null, target: null, period: "week", deadline: "", title: "" };
  } catch (e) { toastError(e); }
}
const setStatus = useChange((id: string, status: string) => api.put(`/goals/${id}`, { status }), ["goals", "home"]);
async function del(g: Goal) { if (await confirm(`Delete "${g.title}"?`, { ok: "Delete", danger: true })) { await api.del(`/goals/${g.id}`); invalidate(["goals", "home"]); open.value = null; } }
const display = (g: Goal, v: number) => { const m = (metrics.data.value ?? []).find((x: any) => x.metric === g.metric); return m?.unit === "kg" ? fmt.value.w(v) : m?.unit === "km" ? fmt.value.num(fromM(v * 1000, fmt.value.du), 1) : fmt.value.num(v, 1); };
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Goals</h1><div class="sub">{{ counts.active }} active · {{ counts.achieved }} achieved</div></div>
      <div class="acts"><button class="btn keep" @click="creating = true"><Icon name="plus" :size="18" />New goal</button></div></div>
    <div class="row wrap" style="margin-bottom:14px">
      <div class="seg"><button v-for="s in (['active', 'achieved', 'archived'] as const)" :key="s" :class="{ on: filter === s }" @click="filter = s">{{ s[0]!.toUpperCase() + s.slice(1) }}</button></div>
      <div class="chips"><button class="fchip" :class="{ on: !scopeFilter }" @click="scopeFilter = ''">All</button><button v-for="[k, l] in SCOPES" :key="k" class="fchip" :class="{ on: scopeFilter === k }" @click="scopeFilter = scopeFilter === k ? '' : k">{{ l }}</button></div>
    </div>
    <div v-if="goals.data.value && !list.length" class="card empty"><Icon name="goals" :size="34" /><b>{{ filter === "active" ? "No active goals" : `Nothing ${filter}` }}</b><template v-if="filter === 'active'">Three workouts a week, a heavier bench, 30 km of walking a month, a body weight…<br /><button class="btn tonal" @click="creating = true">Set a goal</button></template></div>
    <div class="grid g3"><GoalCard v-for="g in list" :key="g.id" :goal="g" @click="open = g" /></div>

    <Sheet v-if="open" :title="open.title" @close="open = null">
      <template #head><b>{{ open.title }}</b><Menu :items="[{ label: open.status === 'archived' ? 'Make active again' : 'Archive', icon: 'archive', run: () => { setStatus.run(open!.id, open!.status === 'archived' ? 'active' : 'archived'); open = null; } }, { label: 'Delete', icon: 'trash', danger: true, run: () => del(open!) }]" /></template>
      <div class="row" style="margin-bottom:12px"><div class="val" style="font-size:30px">{{ open.progress?.label }}</div></div>
      <div class="pbar" :class="{ ok: open.progress?.done }"><i :style="{ width: (open.progress?.pct ?? 0) * 100 + '%' }" /></div>
      <div class="tiny" style="margin-top:6px">{{ open.status === "achieved" ? `Achieved ${fmt.date(open.achievedAt)}` : open.progress?.pace }}{{ open.deadline ? ` · deadline ${fmt.date(open.deadline, { day: "numeric", month: "short", year: "numeric" })}` : "" }} · since {{ fmt.date(open.startDate, { day: "numeric", month: "short", year: "numeric" }) }}</div>
      <div v-if="(open.progress?.history.length ?? 0) > 1" class="card" style="margin-top:14px"><LineChart :points="open.progress!.history.map((h) => ({ x: new Date(h.date).getTime(), y: Number(display(open!, h.value)) || h.value }))" :height="170" /></div>
    </Sheet>

    <Sheet v-if="creating" title="New goal" @close="creating = false; router.replace({ query: {} })">
      <div class="fld"><label>About</label><div class="chips"><button v-for="[k, l, ic] in SCOPES" :key="k" class="fchip" :class="{ on: f.scope === k }" @click="f.scope = k"><Icon :name="ic" :size="14" />{{ l }}</button></div></div>
      <div v-if="f.scope === 'routine'" class="fld"><label>Routine</label><select v-model="f.scopeId"><option :value="null" disabled>Choose…</option><option v-for="r in routines.data.value ?? []" :key="r.id" :value="r.id">{{ r.name }}</option></select></div>
      <div v-if="f.scope === 'exercise'" class="fld"><label>Exercise</label><button class="btn o block" style="justify-content:flex-start" @click="pickEx = true">{{ scopeName || "Choose an exercise…" }}</button></div>
      <div v-if="f.scope === 'muscle'" class="fld"><label>Muscle group</label><div class="chips"><button v-for="g in GROUPS" :key="g.id" class="fchip" :class="{ on: f.scopeId === g.id }" @click="f.scopeId = g.id">{{ g.name }}</button></div></div>
      <div v-if="f.scope === 'activity'" class="fld"><label>Activity</label><div class="chips"><button class="fchip" :class="{ on: !f.scopeId }" @click="f.scopeId = null">Any</button><button v-for="t in types.data.value ?? []" :key="t.slug" class="fchip" :class="{ on: f.scopeId === t.slug }" @click="f.scopeId = t.slug">{{ t.name }}</button></div></div>
      <div v-if="f.scope === 'body'" class="fld"><label>Measure</label><div class="chips"><button v-for="[k, l] in BODY" :key="k" class="fchip" :class="{ on: (f.scopeId ?? 'weight') === k }" @click="f.scopeId = k">{{ l }}</button></div></div>
      <div v-if="f.scope !== 'body'" class="fld"><label>Measure by</label><div class="chips"><button v-for="m in scopeMetrics" :key="m.metric" class="fchip" :class="{ on: f.metric === m.metric }" @click="f.metric = m.metric">{{ m.name }}</button></div></div>
      <div class="frow">
        <div class="fld"><label>{{ metric?.comparator === "<=" || f.scope === "body" ? "Get to" : "Reach" }} ({{ f.scope === "body" ? ((f.scopeId ?? "weight") === "weight" ? fmt.wu : f.scopeId === "body_fat" ? "%" : "cm") : unit }})</label><input v-model.number="f.target" type="number" inputmode="decimal" step="any" /></div>
        <div v-if="metric?.periodic && f.scope !== 'body'" class="fld"><label>Every</label><select v-model="f.period"><option value="week">Week</option><option value="month">Month</option><option value="once">Once, in total</option></select></div>
      </div>
      <div class="frow"><div class="fld"><label>Deadline (optional)</label><input v-model="f.deadline" type="date" /></div></div>
      <div class="fld"><label>Name</label><input v-model="f.title" :placeholder="autoTitle || 'Name the goal'" /></div>
      <template #foot><button class="btn o" @click="creating = false">Cancel</button><button class="btn" @click="create">Save goal</button></template>
    </Sheet>
    <ExercisePicker v-if="pickEx" title="Goal for which exercise?" @close="pickEx = false" @pick="(ids) => { f.scopeId = ids[0]; pickEx = false; }" />
  </div>
</template>
