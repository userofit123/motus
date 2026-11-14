<script setup lang="ts">
// One goal in full, opened from Goals or from its block on Home: how far along, the run of weeks (or months) reached and
// the best one, the last twelve of them, what went into this one, and whether it shows on Home.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { fromM, type Goal } from "@motus/shared";
import { useGoalDetail, useSettings, useActivityTypes } from "../api/queries";
import { useFmt, goalLabel } from "../core/format";
import { onHome, streakOnHome, toggleHomeGoal, setHomeStreak, periodWord, periodNow, goalSub } from "../core/goals";
import Sheet from "./Sheet.vue";
import Menu from "./Menu.vue";
import Icon from "./Icon.vue";
import Ring from "./Ring.vue";
import BarChart from "./BarChart.vue";
import LineChart from "./LineChart.vue";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; edit: [Goal]; status: [Goal, string]; delete: [Goal] }>();
const router = useRouter();
const fmt = useFmt();
const s = useSettings();
const types = useActivityTypes();
const q = useGoalDetail(computed(() => props.id));
const d = computed(() => q.data.value);
const g = computed<Goal | undefined>(() => d.value?.goal);
// reached this time round, or achieved for good: the ring is full and holds a check (as on the goal's card)
const reached = computed(() => g.value?.status === "achieved" || !!g.value?.progress?.done);
const periodic = computed(() => !!g.value && g.value.period !== "once");
// values come in kg, km and cm; shown in your units
const show = (v: number) => { const u = g.value?.progress?.unit; return u === "kg" ? fmt.value.w(v) : u === "km" ? fmt.value.num(fromM(v * 1000, fmt.value.du), 1) : u === "cm" ? fmt.value.len(v) : fmt.value.num(v, 1); };
const wlabel = (day: string) => fmt.value.date(day, g.value?.period === "month" ? { month: "short" } : { day: "numeric", month: "short" });
const icon = (x: any) => (x.kind === "workout" ? "dumbbell" : x.kind === "body" ? "scale" : x.kind === "day" ? "steps" : (types.data.value ?? []).find((t: any) => t.slug === x.type)?.icon ?? "activity");
const right = (x: any) => {
  if (x.kind === "body") return show(x.value) + " " + (g.value?.progress?.unit === "kg" ? fmt.value.wu : g.value?.progress?.unit === "cm" ? fmt.value.lu : "%");
  if (x.kind === "day") return fmt.value.num(x.value, 0);
  if (x.value != null) return show(x.value) + (g.value?.progress?.unit === "kg" ? ` ${fmt.value.wu}` : "");
  return [x.durationS ? fmt.value.dur(x.durationS, true) : "", x.distanceM ? `${fmt.value.num(fmt.value.distNum(x.distanceM), 1)} ${fmt.value.du}` : ""].filter(Boolean).join(" · ");
};
const open = (x: any) => { if (x.kind === "workout" && x.id) router.push(`/workouts/${x.id}`); else if (x.kind === "activity") router.push(`/activities/${x.id}`); else if (x.kind === "body") router.push("/body"); else return; emit("close"); };
const menu = computed(() => !g.value ? [] : [
  { label: "Edit", icon: "edit", run: () => emit("edit", g.value!) },
  { label: g.value.status === "archived" ? "Make active again" : "Archive", icon: "archive", run: () => emit("status", g.value!, g.value!.status === "archived" ? "active" : "archived") },
  { label: "Delete", icon: "trash", danger: true, sep: true, run: () => emit("delete", g.value!) },
]);
</script>

<template>
  <Sheet :title="g?.title ?? 'Goal'" @close="emit('close')">
    <template #head><b class="grow ellipsis">{{ g?.title ?? "Goal" }}</b><Menu v-if="g" :items="menu" /></template>
    <template v-if="g">
      <div class="gs-top">
        <Ring :pct="g.progress?.pct ?? 0" :size="64" :stroke="7" :done="reached" />
        <div class="grow">
          <div class="gs-val">{{ goalLabel(g, fmt) }}</div>
          <div class="tiny">{{ g.status === "achieved" ? `Achieved ${fmt.date(g.achievedAt)}` : g.progress?.done ? `Reached ${periodNow(g).toLowerCase()}` : g.progress?.pace ?? periodNow(g) }}</div>
        </div>
      </div>
      <div class="tiny gs-when">{{ goalSub(g, s) }} · since {{ fmt.date(g.startDate, { day: "numeric", month: "short", year: "numeric" }) }}{{ g.deadline ? ` · deadline ${fmt.date(g.deadline, { day: "numeric", month: "short", year: "numeric" })}` : "" }}</div>

      <div v-if="periodic" class="grid g2 gs-runs">
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="flame" :size="15" /></span>Streak</div><div class="val">{{ d.streak }}<small>{{ periodWord(g, d.streak) }}</small></div><div class="sub">in a row</div></div>
        <div class="card stat"><div class="lbl"><span class="bi"><Icon name="trophy" :size="15" /></span>Best</div><div class="val">{{ d.best }}<small>{{ periodWord(g, d.best) }}</small></div><div class="sub">longest run</div></div>
      </div>
      <div v-if="periodic && d.periods.length" class="card"><div class="lbl hgap">Last {{ d.periods.length }} {{ periodWord(g, 2) }}</div>
        <BarChart :bars="d.periods.map((p: any) => ({ label: wlabel(p.from), value: p.value, dim: !p.met }))" :goal="g.target" :fmt="show" :height="150" /></div>
      <div v-else-if="(g.progress?.history.length ?? 0) > 1" class="card"><LineChart :points="g.progress!.history.map((h) => ({ x: new Date(h.date).getTime(), y: Number(show(h.value).replace(/,/g, '')) || h.value }))" :height="160" /></div>

      <div class="sh"><h2>{{ g.scope === "body" ? "Entries" : periodNow(g) }}</h2><span v-if="d.log.length" class="tiny">{{ d.log.length }}</span></div>
      <div v-if="d.log.length" class="card flush"><div v-for="(x, i) in d.log" :key="x.id ?? i" class="li" :class="{ click: x.kind !== 'day' }" @click="open(x)">
        <Icon :name="icon(x)" :size="18" class="muted" /><div class="grow"><div class="t">{{ x.name || "Workout" }}</div><div class="s">{{ fmt.date(x.at, { weekday: "short", day: "numeric", month: "short" }) }}</div></div><span class="tiny">{{ right(x) }}</span></div></div>
      <div v-else class="card empty">Nothing yet {{ periodNow(g).toLowerCase() }}.</div>
      <p v-if="g.notes" class="tiny spt">{{ g.notes }}</p>

      <div class="sh"><h2>On Home</h2></div>
      <div class="card flush">
        <label class="tgl li"><div class="grow"><div class="t">Pin to Home</div></div><span class="tg"><input type="checkbox" :checked="onHome(s, g.id)" @change="toggleHomeGoal(s, g)" /></span></label>
        <label v-if="periodic && onHome(s, g.id)" class="tgl li"><div class="grow"><div class="t">Show its streak</div><div class="s">Its block on Home also counts the {{ periodWord(g, 2) }} in a row</div></div><span class="tg"><input type="checkbox" :checked="streakOnHome(s, g.id)" @change="setHomeStreak(s, g.id, ($event.target as HTMLInputElement).checked)" /></span></label>
      </div>
    </template>
    <div v-else class="empty">{{ q.isError.value ? "This goal is gone." : "Loading…" }}</div>
  </Sheet>
</template>

<style scoped>
.gs-when { margin: var(--hg) 0 var(--spg); }
.gs-runs { margin-bottom: var(--spg); }
.gs-runs .stat { min-height: 0; }
</style>
