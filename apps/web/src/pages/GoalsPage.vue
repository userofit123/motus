<script setup lang="ts">
// Goals (requirements 7 and 8): general, per routine, per exercise, per muscle group, for activities and for the body.
// Active, achieved and archived; each with its progress, pace and trend.
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GROUPS, muscleName, toKg, toM, fromM, BODY_MEASURES, GOAL_DIRECTIONS, bodyMeasure, bodyGoalDirection, orderGoals, GOAL_METRICS, type Goal, type GoalMetric, workdaysOf } from "@motus/shared";
import { useGoals, useGoalMetrics, useRoutines, useExercises, useActivityTypes, useChange, useBody, useSettings, saveSettings, loaded } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { confirm } from "../core/ask";
import { toastError, toast } from "../core/toast";
import Icon from "../components/Icon.vue";
import Sheet from "../components/Sheet.vue";
import ReorderSheet from "../components/ReorderSheet.vue";
import AppSelect from "../components/AppSelect.vue";
import { WEEKDAYS, daysShort, periodLabel } from "../core/goals";
import ChoiceTiles from "../components/ChoiceTiles.vue";
import DatePicker from "../components/DatePicker.vue";
import GoalCard from "../components/GoalCard.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import GoalSheet from "../components/GoalSheet.vue";
import Menu from "../components/Menu.vue";
import { newActivityType } from "../core/activityTypes";
import FilterPanel from "../components/FilterPanel.vue";
import FilterRow from "../components/FilterRow.vue";

const route = useRoute(), router = useRouter();
const goals = useGoals(true);
const metrics = useGoalMetrics();
const routines = useRoutines();
const exercises = useExercises();
const types = useActivityTypes();
const fmt = useFmt();
const filter = ref<"active" | "achieved" | "archived">("active");
const scopeFilter = ref("");
// in your order (Reorder goals), applied here too so a move shows before the server answers
const ordered = computed(() => orderGoals(goals.data.value ?? [], settings.value.goalsOrder));
const list = computed(() => ordered.value.filter((g) => g.status === filter.value && (!scopeFilter.value || g.scope === scopeFilter.value)));
const counts = computed(() => ({ active: 0, achieved: 0, archived: 0, ...Object.fromEntries(["active", "achieved", "archived"].map((s) => [s, (goals.data.value ?? []).filter((g) => g.status === s).length])) }));
// activity first: "sessions a week" (the weekly target) is the goal most people start with
const SCOPES: [string, string, string][] = [["activity", "Training sessions", "walk"], ["general", "All training", "target"], ["routine", "Routine", "routines"], ["exercise", "Exercise", "dumbbell"], ["muscle", "Muscle group", "activity"], ["body", "Body", "scale"]];
// in the new-goal form each kind is a tile saying what it can measure, so the choice explains itself
const SCOPE_HINT: Record<string, string> = { general: "Total minutes or weight lifted", routine: "Times done, time, volume", exercise: "Heaviest, one-rep max, reps",
  muscle: "Working sets, sessions", activity: "How often, how far, steps", body: "Weight and measurements" };
// under the tiles, once one is picked: what that kind of goal counts
const SCOPE_HELP: Record<string, string> = {
  activity: "How often you train, or how far and how long you go. Count gym workouts, walks, runs, rides… all together or one kind, e.g. 3 sessions a week, or 30 km of walking a month.",
  general: "Everything you do added up, whatever it was: the minutes of all your workouts and activities, or the total weight you lift (weight × reps over all sets), e.g. 150 active minutes a week.",
  routine: "One of your routines: how often you do it, finishing it within a time, or the volume in one session.",
  exercise: "One exercise: a heavier lift, a higher one-rep max, more reps, or doing it more often.",
  muscle: "One muscle group: how many working sets it gets, or how many sessions train it.",
  body: "A body weight or a measurement to reach.",
};
const SCOPE_TILES = SCOPES.map(([value, label, icon]) => ({ value, label, icon, hint: SCOPE_HINT[value] }));
const GROUP_OPTS = GROUPS.map((g) => ({ value: g.id, label: g.name, hint: g.muscles.length > 1 ? g.muscles.map(muscleName).join(", ") : undefined }));
// sessions can count gym workouts too ("workout"), and with nothing picked, everything; the other measures are activities only
const NEW_TYPE = "__new";
const activityOpts = computed(() => [
  ...(f.value.metric === "sessions" ? [{ value: null, label: "Everything", hint: "Gym workouts and every activity" }, { value: "workout", label: "Gym workouts", hint: "Workouts logged in Motus" }] : [{ value: null, label: "Any activity" }]),
  ...(types.data.value ?? []).filter((t: any) => f.value.metric !== "activity_distance" || t.hasDistance).map((t: any) => ({ value: t.slug, label: t.name })),
  { value: NEW_TYPE, label: "New activity type…" },
]);
// filters: status always; the "About" row only lists kinds you have goals of, and only once there are two or more
const STATUS = computed(() => (["active", "achieved", "archived"] as const).map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1), count: counts.value[k] })));
const scopeOpts = computed(() => SCOPES.map(([k, l, ic]) => ({ value: k, label: l, icon: ic, count: (goals.data.value ?? []).filter((g) => g.status === filter.value && g.scope === k).length })).filter((o) => o.count || o.value === scopeFilter.value));
function clearFilters() { filter.value = "active"; scopeFilter.value = ""; }
const open = ref<string | null>(null);

// ----- reorder: the active goals, dragged or moved with arrows; achieved and archived ones keep their own lists -----
const reordering = ref(false);
const activeGoals = computed(() => ordered.value.filter((g) => g.status === "active"));
function moveGoal(from: number, to: number) {
  const ids = activeGoals.value.map((g) => g.id);
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length || from === to) return;
  // put the goal at its new place among the active goals' own slots within the full saved order, so achieved and
  // archived goals keep their place in between and one made active again comes back where it was
  const full = ordered.value.map((g) => g.id), slots = ids.map((id) => full.indexOf(id));
  const grp = [...ids];
  grp.splice(to, 0, grp.splice(from, 1)[0]!);
  slots.slice().sort((x, y) => x - y).forEach((k, n) => { full[k] = grp[n]!; });
  saveSettings({ goalsOrder: full }, { quiet: true });
}

// ----- the goal form: a new goal, or an edit of one (editId) with the same fields filled in -----
const creating = ref(route.query.new === "1");
const editId = ref<string | null>(null);
// a measure no longer offered for new goals stays pickable on the goal that has it
const editMetric = ref<string | null>(null);
// while an edit fills the form in, the watchers below that reset fields on a change of kind or measure keep still
let filling = false;
// the + menu's "New goal" while this page is already open
watch(() => route.query.new, (v) => { if (v === "1") { closeForm(); creating.value = true; } });
const blank = () => ({ scope: "activity", metric: "sessions", scopeId: null, target: null, period: "week", when: "week", days: [] as number[], deadline: "", title: "", body: "weight", side: "l", dir: null as null | ">=" | "<=" });
const f = ref<any>(blank());
watch(() => f.value.scopeId, async (v) => { if (f.value.scope === "activity" && v === NEW_TYPE) f.value.scopeId = await newActivityType(); });
const pickEx = ref(false);
const scopeMetrics = computed(() => (metrics.data.value ?? []).filter((m: any) => m.scope === f.value.scope && (!m.hidden || m.metric === editMetric.value)));
const metric = computed<any>(() => (metrics.data.value ?? []).find((m: any) => m.metric === f.value.metric));
watch(() => f.value.scope, () => { if (filling) return; f.value.metric = scopeMetrics.value[0]?.metric; f.value.scopeId = null; f.value.when = scopeMetrics.value[0]?.periodic ? "week" : "once"; });
watch(() => f.value.metric, () => { if (filling) return; f.value.when = metric.value?.periodic ? (f.value.when === "once" ? "week" : f.value.when) : "once"; });
// how often: by the day (every day, workdays, chosen days), the week, the month, or once in total
const WHEN = [{ value: "day", label: "Every day" }, { value: "workdays", label: "Workdays" }, { value: "days", label: "Chosen days" },
  { value: "week", label: "Every week" }, { value: "month", label: "Every month" }, { value: "once", label: "Once, in total" }];
const byDay = (w: string) => w === "day" || w === "workdays" || w === "days";
watch(() => f.value.when, (w) => { f.value.period = byDay(w) ? "day" : w; });
// the week's days in the order the week starts on, for picking
const DAY_OPTS = computed(() => Array.from({ length: 7 }, (_, i) => (i + settings.value.firstDay) % 7).map((d) => ({ value: d, label: WEEKDAYS[d]!.slice(0, 3) })));
const goalDays = (v: any) => (v.when === "workdays" ? "workdays" : v.when === "days" ? v.days : null);
const unit = computed(() => metric.value?.unit === "kg" ? fmt.value.wu : metric.value?.unit === "km" ? fmt.value.du : metric.value?.unit);
// body goals: one chip per measure, left/right pairs pick the side below (as when logging)
// (with Body measurements off, only body weight)
const settings = useSettings();
const BODY = computed(() => BODY_MEASURES.filter((m) => !m.old && m.side !== "right" && (settings.value.features.measurements || m.id === "weight")).map((m) => ({ key: m.pair ? m.id.slice(0, -2) : m.id, name: m.pair ?? m.name })));
const bodyPaired = computed(() => !!bodyMeasure(`${f.value.body}_l`)?.pair);
const bodyKind = computed(() => (bodyPaired.value ? `${f.value.body}_${f.value.side}` : f.value.body));
const bm = computed(() => bodyMeasure(bodyKind.value)!);
const bodyUnitShown = computed(() => (bm.value.unit === "kg" ? fmt.value.wu : bm.value.unit === "cm" ? fmt.value.lu : "%"));
const toBase = (v: number) => (bm.value.unit === "kg" ? toKg(v, fmt.value.wu) : bm.value.unit === "cm" ? fmt.value.toCm(v) : v);
// which way the goal heads is the person's choice (bigger or smaller depends on who you are); until they pick, it suggests
// from the latest entry towards the target, or the measure's usual way if nothing is logged
const body = useBody();
const bodyLatest = computed(() => (body.data.value as any[] | undefined)?.find((b) => b.kind === bodyKind.value) ?? null);
const bodyDir = computed(() => bodyGoalDirection(bodyKind.value, f.value.target ? toBase(Number(f.value.target)) : NaN, bodyLatest.value ? Number(bodyLatest.value.value) : null));
const dirShown = computed(() => f.value.dir ?? bodyDir.value);
// a new measure starts from its own suggestion again
watch(() => [f.value.body, f.value.side, f.value.scope], () => { if (!filling) f.value.dir = null; });
/** a target the latest entry has already passed in the chosen direction: saving would mark it achieved at once */
const passed = (dir: string, target: number, now: number | null) => now != null && target > 0 && (dir === ">=" ? now >= target : now <= target);
const bodyPassed = computed(() => f.value.target ? passed(dirShown.value, toBase(Number(f.value.target)), bodyLatest.value ? Number(bodyLatest.value.value) : null) : false);
const bodyNow = computed(() => { const b = bodyLatest.value; if (!b) return ""; const v = Number(b.value); return bm.value.unit === "kg" ? `${fmt.value.w(v)} ${fmt.value.wu}` : bm.value.unit === "cm" ? `${fmt.value.len(v)} ${fmt.value.lu}` : `${v}%`; });
const scopeName = computed(() => {
  const v = f.value;
  if (v.scope === "routine") return routines.data.value?.find((r) => r.id === v.scopeId)?.name ?? "";
  if (v.scope === "exercise") return exercises.data.value?.find((e) => e.id === v.scopeId)?.name ?? "";
  if (v.scope === "muscle") return GROUPS.find((g) => g.id === v.scopeId)?.name ?? "";
  if (v.scope === "activity") return v.scopeId === "workout" ? "Gym workouts" : v.scopeId ? (types.data.value ?? []).find((t: any) => t.slug === v.scopeId)?.name ?? v.scopeId : v.metric === "sessions" ? "" : "Any activity";
  if (v.scope === "body") return bm.value.name;
  return "";
});
const autoTitle = computed(() => {
  const m = metric.value; if (!m || f.value.target == null) return "";
  const w = f.value.when;
  const per = w === "week" ? " a week" : w === "month" ? " a month" : w === "day" ? " a day" : w === "workdays" ? " on workdays" : w === "days" && f.value.days.length ? ` on ${daysShort(f.value.days)}` : "";
  if (f.value.scope === "body") return `${scopeName.value} to ${f.value.target} ${bodyUnitShown.value}`;
  // "Gym workouts: 3 a week", "Walk: 2 a week", "Sessions: 4 a week"
  if (m.metric === "sessions") return `${scopeName.value || "Sessions"}: ${f.value.target}${per || " in total"}`;
  return `${scopeName.value ? scopeName.value + ": " : ""}${m.comparator === "<=" ? "under " : ""}${f.value.target} ${unit.value} ${m.name.toLowerCase()}${per}`.replace(/\s+/g, " ");
});
async function save() {
  const v = f.value, m = metric.value;
  if (!m || v.target == null || (v.target as any) === "" || Number(v.target) <= 0) return toast("Set a target", { kind: "err" });
  if (v.when === "days" && !v.days.length) return toast("Pick the days", { kind: "err" });
  if (["routine", "exercise", "muscle"].includes(v.scope) && !v.scopeId) return toast(`Pick the ${v.scope === "muscle" ? "muscle group" : v.scope}`, { kind: "err" });
  let target = Number(v.target);
  if (m.unit === "kg") target = toKg(target, fmt.value.wu);
  if (m.unit === "km") target = toM(target, fmt.value.du) / 1000;
  const isBody = v.scope === "body", weight = bodyKind.value === "weight";
  if (isBody) target = toBase(Number(v.target));
  const body: Record<string, unknown> = { metric: isBody ? (weight ? "body_weight" : "body_metric") : v.metric, scopeId: isBody ? (weight ? null : bodyKind.value) : v.scopeId,
    comparator: isBody ? dirShown.value : undefined, target, period: v.period, days: goalDays(v), deadline: v.deadline || null, title: v.title.trim() || autoTitle.value };
  // an untouched target stays as stored: the shown one is rounded, and converting it back would move it (100 kg → 100.017)
  if (editId.value && prefill && String(v.target) === prefill.text && (isBody ? bm.value.unit : m.unit) === prefill.unit) delete body.target;
  try {
    const gid = editId.value ?? (await api.post<{ id: string }>(`/goals?tz=${new Date().getTimezoneOffset()}`, body)).id;
    if (editId.value) await api.put(`/goals/${gid}`, body);
    const made = !editId.value;
    invalidate(["goals", "home"]); closeForm();
    // a one-off goal you have already reached moves straight to Achieved: say so instead of letting it vanish
    const g = await api.get<Goal>(`/goals/${gid}`);
    if (g.status === "achieved" && filter.value !== "achieved") { toast("Already reached: it's under Achieved"); filter.value = "achieved"; }
    else if (!made && g.status === "active" && filter.value === "achieved") { toast("Goal saved: it's under Active again"); filter.value = "active"; }
    else toast(made ? "Goal created" : "Goal saved");
  } catch (e) { toastError(e); }
}
function closeForm() {
  creating.value = false; editId.value = null; editMetric.value = null; prefill = null;
  f.value = blank(); router.replace({ query: {} });
}
// the target as an edit showed it, and the unit it was stored in, so save can tell whether it was changed
let prefill: { text: string; unit: string } | null = null;
// editing fills the new-goal form with the goal's values: the target in your units (it is kept in kg / km / cm)
async function startEdit(g: Goal) {
  const kind = g.metric === "body_weight" ? "weight" : g.scopeId ?? "weight", paired = g.scope === "body" && !!bodyMeasure(kind)?.pair;
  // by the unit save converts with (the metric's, or the body measure's), not the one progress reports
  // (the shared list when the server's isn't in yet: an unknown unit would show kg as they are and save them as lb)
  const metricUnit = (list: GoalMetric[] | undefined) => list?.find((m) => m.metric === g.metric)?.unit;
  const u = (g.scope === "body" ? bodyMeasure(kind)?.unit : metricUnit(metrics.data.value) ?? metricUnit(GOAL_METRICS)) ?? "";
  // shown numbers have thousands separators ("1,250"), which a number field can't take
  const n = (x: string) => Number(x.replace(/,/g, ""));
  const target = u === "kg" ? n(fmt.value.w(g.target)) : u === "km" ? n(fmt.value.num(fromM(g.target * 1000, fmt.value.du), 2)) : u === "cm" ? n(fmt.value.len(g.target, 2)) : g.target;
  prefill = { text: String(target), unit: u };
  const when = g.period !== "day" ? g.period : g.days === "workdays" ? "workdays" : Array.isArray(g.days) && g.days.length ? "days" : "day";
  open.value = null; creating.value = false;
  filling = true;
  editMetric.value = g.metric; editId.value = g.id;
  f.value = { scope: g.scope, metric: g.metric, scopeId: g.scope === "body" ? null : g.scopeId, target, period: g.period, when, days: Array.isArray(g.days) ? [...g.days] : [],
    deadline: g.deadline ?? "", title: g.title, body: paired ? kind.slice(0, -2) : kind, side: paired ? kind.slice(-1) : "l", dir: g.scope === "body" ? g.comparator : null };
  await nextTick();
  filling = false;
  // a name the app made follows the goal as it changes; one you typed stays
  if (g.title === autoTitle.value) f.value.title = "";
}
const setStatus = useChange(async (id: string, status: string) => { await api.put(`/goals/${id}`, { status }); toast(status === "archived" ? "Goal archived" : "Goal made active"); }, ["goals", "home"]);
async function del(g: Goal) { if (await confirm(`Delete "${g.title}"?`, { ok: "Delete", danger: true })) { await api.del(`/goals/${g.id}`); invalidate(["goals", "home"]); open.value = null; toast("Goal deleted"); } }
// Home's ⋮ "Edit" on a goal lands here with ?edit=id
// (once the metrics are in too, so the target is shown and saved in the right unit)
watch([() => route.query.edit, () => goals.data.value, () => metrics.data.value], ([e]) => { const g = e && metrics.data.value && goals.data.value?.find((x) => x.id === e); if (g) { startEdit(g); router.replace({ query: {} }); } }, { immediate: true });
// show the page once its data is in, all at once
await loaded(goals, metrics, routines, exercises, types, body);
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Goals</h1><div class="sub">{{ counts.active }} active · {{ counts.achieved }} achieved</div></div>
      <div class="acts"><Menu v-if="counts.active > 1" :items="[{ label: 'Reorder goals', icon: 'drag', run: () => (reordering = true) }]" /><button class="btn keep" @click="creating = true"><Icon name="plus" :size="18" />New goal</button></div></div>
    <FilterPanel v-if="goals.data.value?.length" :count="`${list.length} goal${list.length === 1 ? '' : 's'}`" :active="!!scopeFilter || filter !== 'active'" @clear="clearFilters">
      <FilterRow :model-value="filter" label="Status" :options="STATUS" @update:model-value="(v) => (filter = v as typeof filter)" />
      <FilterRow v-if="scopeOpts.length > 1 || scopeFilter" v-model="scopeFilter" label="About" all="All" :options="scopeOpts" />
    </FilterPanel>
    <div v-if="goals.data.value && !list.length" class="card empty"><Icon name="goals" :size="34" /><b>{{ filter === "active" ? "No active goals" : `Nothing ${filter}` }}</b><template v-if="filter === 'active'">Three sessions a week, a heavier bench, 30 km of walking a month, a body weight…<br /><button class="btn tonal" @click="creating = true">Set a goal</button></template></div>
    <div class="grid g3"><GoalCard v-for="g in list" :key="g.id" :goal="g" @click="open = g.id" /></div>

    <GoalSheet v-if="open" :id="open" @close="open = null" @edit="startEdit" @status="(g, st) => { setStatus.run(g.id, st); open = null; }" @delete="del" />
    <ReorderSheet v-if="reordering" title="Reorder goals" hint="Drag to reorder your active goals, here and in Home's Goals."
      :items="activeGoals.map((g) => ({ id: g.id, title: g.title, sub: periodLabel(g, settings) }))" @move="moveGoal" @close="reordering = false" />
    <Sheet v-if="creating || editId" :title="editId ? 'Edit goal' : 'New goal'" @close="closeForm">
      <div class="fld"><label>What is it about?</label><ChoiceTiles v-model="f.scope" :options="SCOPE_TILES" label="What is it about?" />
        <p v-if="SCOPE_HELP[f.scope]" class="tiny" style="margin-top:8px">{{ SCOPE_HELP[f.scope] }}</p></div>
      <div v-if="f.scope === 'routine'" class="fld"><label>Routine</label><AppSelect v-model="f.scopeId" :options="(routines.data.value ?? []).map((r) => ({ value: r.id, label: r.name }))" placeholder="Choose a routine" title="Routine" /></div>
      <div v-if="f.scope === 'exercise'" class="fld"><label>Exercise</label><button type="button" class="fpick" @click="pickEx = true"><span class="v" :class="{ unset: !scopeName }">{{ scopeName || "Choose an exercise" }}</span><Icon name="right" :size="16" /></button></div>
      <div v-if="f.scope === 'muscle'" class="fld"><label>Muscle group</label><AppSelect v-model="f.scopeId" :options="GROUP_OPTS" placeholder="Choose a muscle group" title="Muscle group" /></div>
      <div v-if="f.scope === 'activity'" class="fld"><label>What counts</label><AppSelect v-model="f.scopeId" :options="activityOpts" title="Activity" /></div>
      <div v-if="f.scope === 'body' && BODY.length > 1" class="fld"><label>Measure</label><AppSelect v-model="f.body" :options="BODY.map((c) => ({ value: c.key, label: c.name }))" title="Measure" />
        <div v-if="bodyPaired" class="seg block"><button :class="{ on: f.side === 'l' }" @click="f.side = 'l'">Left</button><button :class="{ on: f.side === 'r' }" @click="f.side = 'r'">Right</button></div></div>
      <div v-if="f.scope !== 'body'" class="fld"><label>Measure by</label><AppSelect v-model="f.metric" :options="scopeMetrics.map((m: any) => ({ value: m.metric, label: m.name }))" title="Measure by" /></div>
      <div v-if="f.scope === 'body'" class="fld"><label>Direction</label><div class="seg block"><button v-for="d in GOAL_DIRECTIONS" :key="d.value" :class="{ on: dirShown === d.value }" @click="f.dir = d.value">{{ d.label }}</button></div></div>
      <div class="frow">
        <div class="fld"><label>Target ({{ f.scope === "body" ? bodyUnitShown : unit }})</label><input v-model.number="f.target" type="number" inputmode="decimal" step="any" />
          <div v-if="f.scope === 'body'" class="tiny" style="margin-top:4px">{{ bodyNow ? `Now ${bodyNow}` : "Nothing logged yet" }}{{ bodyPassed ? " · already there" : "" }}</div></div>
        <div v-if="metric?.periodic && f.scope !== 'body'" class="fld"><label>How often</label><AppSelect v-model="f.when" :options="WHEN" title="How often" /></div>
      </div>
      <div v-if="f.when === 'days' && f.scope !== 'body'" class="fld"><label>On these days</label><ChoiceTiles v-model="f.days" :options="DAY_OPTS" multiple compact min="56px" label="On these days" /></div>
      <p v-else-if="f.when === 'workdays' && f.scope !== 'body'" class="tiny hgap">{{ daysShort(workdaysOf(settings)) }}, your work week. <button class="lnk inl" @click="router.push('/settings/units')">Change it</button></p>
      <div class="frow"><div class="fld"><label>Deadline (optional)</label><DatePicker v-model="f.deadline" clearable placeholder="No deadline" title="Deadline" /></div></div>
      <div class="fld"><label>Name</label><input v-model="f.title" :placeholder="autoTitle || 'Name the goal'" /></div>
      <template #foot><button class="btn o" @click="closeForm">Cancel</button><button class="btn" @click="save">Save goal</button></template>
    </Sheet>
    <ExercisePicker v-if="pickEx" title="Goal for which exercise?" @close="pickEx = false" @pick="(ids) => { f.scopeId = ids[0]; pickEx = false; }" />
  </div>
</template>


