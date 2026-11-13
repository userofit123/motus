<script setup lang="ts">
// Home (requirement 9): one board of blocks in your order (Edit home, from the ⋮ menu). Today leads; small blocks pair up
// in rows of four (two on the phone) and wider ones take half or the whole row. A block with nothing to say right now
// (no reminder waiting, no goal due soon, no program running) stays away until it has; feature blocks need their feature.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { muscleName, num, fromM, percentChange, orderGoals, HOME_BLOCKS, type Goal, type HomePlan, type HomeRecord, type HomeGroup, type HomeWeek } from "@motus/shared";
import { useHome, useSettings, saveSettings, useAchievements, useGoals, loaded } from "../api/queries";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import { confirm } from "../core/ask";
import { toast } from "../core/toast";
import { onHome, streakOnHome, toggleHomeGoal, setHomeStreak, periodWord, periodNow, periodLabel } from "../core/goals";
import { useFmt, ago, goalLabel, localYmd, tomorrowYmd } from "../core/format";
import { reminderText } from "../core/reminderText";
import { startPlan, unplanItems } from "../components/home/planActions";
import { startOpen, bodySheet, dailySheet, reminderView } from "../core/ui";
import { isPhone } from "../core/device";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import MuscleFig from "../components/MuscleFig.vue";
import Sparkline from "../components/Sparkline.vue";
import Ring from "../components/Ring.vue";
import BodyMap from "../components/BodyMap.vue";
import DailyLog from "../components/DailyLog.vue";
import Sheet from "../components/Sheet.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";
import GoalSheet from "../components/GoalSheet.vue";
import SessionStats from "../components/SessionStats.vue";
import TodayHero from "../components/home/TodayHero.vue";

const router = useRouter();
const home = useHome();
const s = useSettings();
const fmt = useFmt();
const h = computed(() => home.data.value);
const today = localYmd(new Date());
// nothing made or done yet: Today says how to begin and the summing-up blocks wait
const fresh = computed(() => !!h.value && !h.value.routineCount && !h.value.totalWorkouts && !h.value.activityCount && !(s.value.features.programs && h.value.programs?.length));

// ---- the blocks: name and what it shows (Edit home), icon, and size: s a quarter of the row (half on the phone), m half (all of it on the phone), l the whole row
type Size = "s" | "m" | "l";
const META: Record<string, { name: string; desc: string; icon: string; size: Size }> = {
  today: { name: "Today", desc: "What to do today and this week's training days", icon: "play", size: "l" },
  week: { name: "This week", desc: "Workouts, time and volume against last week", icon: "stats", size: "m" },
  pinned: { name: "Pinned goals", desc: "The goals you made and pinned, each as its own block", icon: "pin", size: "m" },
  dueSoon: { name: "Goals due soon", desc: "Shows when a goal ends within two weeks", icon: "target", size: "m" },
  program: { name: "Your program", desc: "Shows while you follow a program", icon: "routines", size: "m" },
  muscles: { name: "Muscles this week", desc: "Sets per muscle in the last 7 days, and what's resting", icon: "activity", size: "m" },
  upnext: { name: "Up next", desc: "What's planned for the coming days", icon: "calendar", size: "m" },
  previous: { name: "Last workout", desc: "Your most recent workout", icon: "dumbbell", size: "m" },
  goals: { name: "Goals", desc: "Your first three active goals", icon: "goals", size: "m" },
  suggest: { name: "Suggested", desc: "Routines and muscles that are due, and gaps in your routines", icon: "sparkle", size: "m" },
  reminders: { name: "Reminders", desc: "Shows when a reminder is waiting", icon: "bell", size: "m" },
  bodyweight: { name: "Body weight", desc: "Your latest weight and its trend", icon: "scale", size: "s" },
  records: { name: "Records", desc: "Personal records from the last 30 days", icon: "trophy", size: "m" },
  feed: { name: "Recent activity", desc: "Your latest workouts and activities", icon: "history", size: "m" },
  daily: { name: "Today's log", desc: "Sleep, water and mood for today", icon: "moon", size: "m" },
  achievements: { name: "Achievements", desc: "The latest reached and the next one", icon: "star", size: "m" },
};
// a block whose feature is off is absent everywhere, Edit home included
const FEATURE: Record<string, string> = { program: "programs", daily: "dailyLog", achievements: "achievements" };
const available = (id: string) => !!META[id] && (!FEATURE[id] || !!s.value.features[FEATURE[id]!]);
const listed = computed(() => s.value.home.blocks.filter((x) => available(x.id)));
const isOn = (id: string) => listed.value.some((x) => x.id === id && x.on);
// Today is always shown, so Edit home gives it no switch
const FIXED = new Set(["today"]);

// ---- data the blocks read (all from /home, except goals and achievements, which have their own queries)
const tw = computed(() => h.value?.thisWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
const lw = computed(() => h.value?.lastWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
const weeks = computed<HomeWeek[]>(() => h.value?.weeks ?? []);
const weekMax = computed(() => Math.max(1, ...weeks.value.map((w) => w.workouts)));
const walked = computed(() => weeks.value.some((w) => w.walkM > 0));

// a stat tile in This week and Previous: label, value with its unit set small, and for This week the change from last week
// as a percent, the same way Stats shows it (nothing when last week had none to compare with)
// ("12.3k kg" splits at its space so the number carries the weight and the unit is set small beside it)
interface WStat { key: string; icon: string; label: string; value: string; unit: string; delta?: string; last?: string }
const unitOf = (s: string) => { const i = s.lastIndexOf(" "); return i < 0 ? { value: s, unit: "" } : { value: s.slice(0, i), unit: s.slice(i + 1) }; };
const weekStats = computed<WStat[]>(() => {
  const row = (key: string, icon: string, label: string, now: number, last: number, show: (n: number) => string, split = false): WStat => {
    const v = show(now);
    return { key, icon, label, ...(split ? unitOf(v) : { value: v, unit: "" }), delta: percentChange(now, last), last: show(last) };
  };
  const out = [
    row("workouts", "dumbbell", "Workouts", tw.value.workouts, lw.value.workouts, (n) => String(n)),
    row("time", "clock", "Time", tw.value.timeS, lw.value.timeS, (n) => fmt.value.dur(n, true)),
    row("volume", "layers", "Volume", tw.value.volumeKg, lw.value.volumeKg, (n) => fmt.value.vol(n), true),
  ];
  if (walked.value) out.push(row("walk", "walk", "Walked", tw.value.walkM, lw.value.walkM, (n) => fmt.value.dist(n, 1), true));
  return out;
});
// no stat has a change (first week): the header note and the change column are left out
const anyDelta = computed(() => weekStats.value.some((x) => x.delta));
const lastStats = computed<WStat[]>(() => {
  const l = h.value?.last;
  if (!l) return [];
  return [
    { key: "time", icon: "clock", label: "Duration", value: fmt.value.dur(l.durationS, true), unit: "" },
    { key: "ex", icon: "routines", label: "Exercises", value: String(l.exerciseCount), unit: "" },
    { key: "sets", icon: "check", label: "Sets", value: String(l.setCount), unit: "" },
    { key: "volume", icon: "layers", label: "Volume", ...unitOf(fmt.value.vol(l.volumeKg)) },
  ];
});

// goals: pinned ones (settings.home.goals, in that order), the first active ones, and active ones ending soon
const allGoals = useGoals();
const pinnedGoals = computed<(Goal & { showStreak: boolean })[]>(() => orderGoals(h.value?.homeGoals ?? [], s.value.home.goals.map((x) => x.id)));
const daysLeft = (g: Goal) => Math.round((Date.parse(g.deadline!.slice(0, 10)) - Date.parse(today)) / 86400000);
const dueSoon = computed(() => (allGoals.data.value ?? []).filter((g) => g.status === "active" && g.deadline && !g.progress?.done && daysLeft(g) >= 0 && daysLeft(g) <= 14)
  .sort((a, b) => daysLeft(a) - daysLeft(b)).slice(0, 3));
const dueText = (g: Goal) => { const d = daysLeft(g); return d === 0 ? "Ends today" : d === 1 ? "Ends tomorrow" : `Ends in ${d} days`; };
const reached = (g: Goal) => g.status === "achieved" || !!g.progress?.done;
const goalVal = (g: Goal, v: number) => { const u = g.progress?.unit; return u === "kg" ? fmt.value.w(v) : u === "km" ? fmt.value.num(fromM(v * 1000, fmt.value.du), 1) : u === "cm" ? fmt.value.len(v) : fmt.value.num(v, u === "min" ? 0 : 1); };
const goalUnit = (g: Goal) => { const u = g.progress?.unit; return u === "kg" ? fmt.value.wu : u === "km" ? fmt.value.du : u === "cm" ? fmt.value.lu : u === "sessions" || u === "times" ? "" : u ?? ""; };
const goalIcon = (g: Goal) => ({ activity: g.scopeId === "workout" ? "dumbbell" : "walk", routine: "routines", exercise: "dumbbell", muscle: "activity", body: "scale" } as Record<string, string>)[g.scope] ?? "target";
// progress.pct is a share (0 to 1); the rows show it as a percent and the bar is that wide
const pct = (g: Goal) => Math.max(0, Math.min(100, (g.progress?.pct ?? 0) * 100));
// a pinned goal without its streak fills the same half with when: the day it was achieved, the days left to its deadline,
// or the day it started; under it the goal's trend (its last periods, or its entries for a one-off goal)
const noon = (d: string) => d.slice(0, 10) + "T12:00:00"; // a calendar day read on this device's calendar, not as UTC midnight
const shortDate = (d: string) => fmt.value.date(noon(d), { day: "numeric", month: "short" });
// both halves of the tile are built the same way, row by row: header, big value, a tiny line, then the bottom element.
// The big value stays short (a number and one word) so it fits the narrower half at 360px without being cut
type GoalSide = { icon: string; label: string; big: string; small?: string; sub: string };
const goalSide = (g: Goal & { showStreak?: boolean }): GoalSide => {
  if (g.showStreak) {
    const n = g.progress?.streak ?? 0;
    return { icon: "flame", label: "Streak", big: String(n), small: periodWord(g, n), sub: "In a row" };
  }
  // the left half already says "Achieved", so this one names the day
  if (g.status === "achieved" && g.achievedAt) return { icon: "check", label: "Done on", big: fmt.value.date(g.achievedAt, { day: "numeric", month: "short" }), sub: when(g.achievedAt) };
  if (g.deadline && !reached(g)) {
    // calendar days left with today counted, as the goal's own pace says
    const d = daysLeft(g) + 1;
    return d > 0 ? { icon: "calendar", label: "Days left", big: String(d), sub: `Ends ${shortDate(g.deadline)}` }
      : { icon: "calendar", label: "Deadline", big: shortDate(g.deadline), sub: "Deadline passed" };
  }
  return { icon: "calendar", label: "Started", big: shortDate(g.startDate), sub: when(noon(g.startDate)) };
};
const trend = (g: Goal) => (g.progress?.history ?? []).map((x) => x.value);
// recurring goals end on their last periods as dots (filled when reached), one-off goals on their trend line; with no
// periods yet the dots are all empty, and a trend with nothing to draw is a flat line, so the half is never bare
const recurring = (g: Goal) => g.period !== "once";
const dots = (g: Goal) => (g.progress?.history?.length ? g.progress.history.map((x) => x.value >= g.target) : Array<boolean>(8).fill(false));
const hasTrend = (g: Goal) => trend(g).length > 1 && trend(g).some((v) => v);

// "Today", "Yesterday", "3 days ago": the day something was last done, by this device's calendar (as everywhere else)
const when = (iso: string | null | undefined) => { const a = ago(iso); return a.charAt(0).toUpperCase() + a.slice(1); };
const calDays = (iso: string) => { const d = new Date(iso), n = new Date(); return Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000); };

// muscles: every group with the day it was last worked; one worked today or in the 6 days before (by this device's
// calendar) counts as this week. The server's figure (main7, helpers7) uses the same days, so dot and figure agree.
// Kept in the groups' own order (not by date) so each group stays in its place from one day to the next
const groups = computed(() => (h.value?.groupDays ?? []).map((g: HomeGroup) => ({ ...g, on: !!g.lastAt && calDays(g.lastAt) < 7, when: g.lastAt ? when(g.lastAt) : "Not yet" })));
const worked = computed(() => groups.value.filter((g) => g.on).length);

// up next: the first few plans of the coming days. Today's are all listed in Today (also while a workout is in progress)
const upNext = computed<HomePlan[]>(() => (h.value?.upNext ?? []).filter((p) => p.date !== today).slice(0, 5));
const dayName = (d: string) => { const tm = tomorrowYmd(); return d === today ? "Today" : d === tm ? "Tomorrow" : fmt.value.date(d, { weekday: "long" }); };
const planOpen = ref<any>(null);

// body weight: the latest and the change over the last 30 days
const bw = computed<any[]>(() => h.value?.bodyweight ?? []);
const bwTrend = computed(() => [...bw.value].reverse().map((x) => x.value));
const bwChange = computed(() => {
  const since = Date.now() - 30 * 86400000, base = bw.value.filter((x) => Date.parse(x.at) >= since).at(-1), last = bw.value[0];
  if (!last || !base || base === last) return null;
  const d = last.value - base.value;
  return `${d > 0 ? "+" : d < 0 ? "-" : ""}${fmt.value.w(Math.abs(d))} ${fmt.value.wu} in 30 days`;
});

// records
const KIND: Record<string, string> = { weight: "Heaviest", e1rm: "Best 1RM", volume: "Most volume", reps: "Most reps", duration: "Longest", distance: "Farthest" };
const recordText = (r: HomeRecord) => r.distanceM ? fmt.value.dist(r.distanceM, 1) : r.durationS && !r.reps ? fmt.value.dur(r.durationS, true)
  : fmt.value.set(r, r.tracking ?? "weight_reps");

// achievements: the latest reached and the closest still to come
const ach = useAchievements(computed(() => isOn("achievements")));
const achSteps = computed(() => (ach.data.value ?? []).flatMap((a: any) => a.steps.map((x: any) => ({ ...x, unit: a.unit, value: a.value }))));
const achRecent = computed(() => achSteps.value.filter((x) => x.reachedAt).sort((a, b) => b.reachedAt.localeCompare(a.reachedAt)).slice(0, 3));
const achNext = computed(() => (ach.data.value ?? []).map((a: any) => a.steps.find((x: any) => !x.reachedAt) && { ...a.steps.find((x: any) => !x.reachedAt), unit: a.unit, value: a.value })
  .filter(Boolean).sort((a: any, b: any) => b.value / b.target - a.value / a.target)[0]);
const achAmount = (unit: string, v: number) => unit === "kg" ? fmt.value.vol(v) : unit === "m" ? fmt.value.dist(v, v < 10000 ? 1 : 0) : unit === "s" ? `${num(v / 3600, 0)}h` : unit === "weeks" ? `${num(v, 0)} wk` : num(v, 0);

// a dismissed suggestion stays away until your next workout; the list redraws without waiting for the server
const hideSuggestion = (key: string) => {
  queryClient.setQueriesData({ queryKey: ["home"] }, (d: any) => d && { ...d, suggest: d.suggest.filter((x: any) => x.key !== key) });
  saveSettings({ home: { hidden: { [key]: new Date().toISOString() } } }, { quiet: true });
};

// whether a switched-on block has something to show now
const shows = (id: string): boolean => {
  const x = h.value!; // only asked once Home has loaded
  switch (id) {
    case "week": case "upnext": return !fresh.value;
    case "pinned": return pinnedGoals.value.length > 0;
    case "dueSoon": return dueSoon.value.length > 0;
    case "program": return !!x.programs?.length;
    case "previous": return !!x.last;
    case "suggest": return !fresh.value && !!x.suggest?.length;
    case "reminders": return !!x.reminders?.length;
    case "records": return !!x.records?.length;
    case "feed": return !!x.feed?.length;
    default: return true;
  }
};
const blocks = computed(() => (h.value ? listed.value.filter((x) => (x.on || FIXED.has(x.id)) && shows(x.id)).map((x) => x.id) : []));

// every block opens where its numbers come from: a click, or Enter on a block reached with Tab
const go = (to: string | (() => void)) => (typeof to === "string" ? router.push(to) : to());
const link = (to: string | (() => void)) => ({ role: "button", tabindex: 0, onClick: () => go(to),
  onKeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); go(to); } } });

// ---- a goal opened from Home
const goalOpen = ref<string | null>(null);
async function goalStatus(g: Goal, status: string) { await api.put(`/goals/${g.id}`, { status }); invalidate(["goals", "home"]); goalOpen.value = null; toast(status === "archived" ? "Goal archived" : "Goal made active"); }
async function goalDelete(g: Goal) { if (await confirm(`Delete "${g.title}"?`, { ok: "Delete", danger: true })) { await api.del(`/goals/${g.id}`); invalidate(["goals", "home"]); goalOpen.value = null; toast("Goal deleted"); } }

// ---- Edit home: the same board, each block as a tile with its arrows and its switch
const editing = ref(false);
const setOn = (id: string, on: boolean) => saveSettings({ home: { blocks: s.value.home.blocks.map((x) => (x.id === id ? { ...x, on } : x)) } }, { quiet: true });
// past the neighbour you can see (blocks of a switched-off feature keep their place)
function move(id: string, dir: -1 | 1) {
  const l = listed.value, other = l[l.findIndex((x) => x.id === id) + dir];
  if (!other) return;
  const all = [...s.value.home.blocks], a = all.findIndex((x) => x.id === id), b = all.findIndex((x) => x.id === other.id);
  [all[a], all[b]] = [all[b]!, all[a]!];
  saveSettings({ home: { blocks: all } }, { quiet: true });
}
async function reset() {
  if (await confirm("Put Home back the way it started?", { text: "Blocks go back to their first order and switches. Pinned goals stay.", ok: "Reset" })) saveSettings({ home: { blocks: HOME_BLOCKS } });
}

// pinned goals: which ones, their order, and whether each brings its streak
const pinOpen = ref(false);
const pickable = computed(() => (allGoals.data.value ?? []).filter((g) => g.status !== "archived"));
const picked = computed(() => orderGoals(pickable.value.filter((g) => onHome(s.value, g.id)), s.value.home.goals.map((x) => x.id)));
const goalRows = computed(() => [...picked.value, ...pickable.value.filter((g) => !onHome(s.value, g.id))]);
function movePin(id: string, dir: -1 | 1) {
  const l = picked.value, other = l[l.findIndex((g) => g.id === id) + dir];
  if (!other) return;
  const all = [...s.value.home.goals], a = all.findIndex((x) => x.id === id), b = all.findIndex((x) => x.id === other.id);
  [all[a], all[b]] = [all[b]!, all[a]!];
  saveSettings({ home: { goals: all } }, { quiet: true });
}

const greeting = computed(() => { const hr = new Date().getHours(); return hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; });
// show the page once its data is in, all at once
await loaded(home, ach);
</script>

<template>
  <div class="page">
    <div class="ph">
      <div v-if="editing"><h1>Edit home</h1><div class="sub">Move blocks and choose which show. Changes save as you go.</div></div>
      <div v-else><h1>{{ isPhone ? greeting : "Home" }}</h1><div class="sub">{{ fmt.dateLong(new Date().toISOString()) }}</div></div>
      <div class="acts">
        <template v-if="editing">
          <Menu :items="[{ label: 'Reset to default', icon: 'refresh', run: reset }]" />
          <button class="btn keep" @click="editing = false"><Icon name="check" :size="18" />Done</button>
        </template>
        <Menu v-else :items="[{ label: 'Edit home', icon: 'edit', run: () => (editing = true) }, { label: 'Pinned goals', icon: 'pin', run: () => (pinOpen = true) }]" />
      </div>
    </div>

    <!-- Edit home: every block there is, in order, at its own size so the layout reads as it will -->
    <TransitionGroup v-if="editing" name="mv" tag="div" class="hgrid">
      <div v-for="(x, i) in listed" :key="x.id" class="card etile" :class="[META[x.id]!.size === 's' ? 'sz-s' : META[x.id]!.size === 'l' ? 'sz-l' : 'sz-m', { off: !x.on && !FIXED.has(x.id) }]">
        <!-- the name and its switch on one row (label left, control right); the arrows have their own row at the foot, so a
             quarter-width tile has room for the switch on the phone and in a narrow window -->
        <div class="ch">
          <span class="bi"><Icon :name="META[x.id]!.icon" :size="15" /></span>
          <span v-if="FIXED.has(x.id)" class="t grow">{{ META[x.id]!.name }}</span>
          <label v-else class="t grow" :for="`hb-${x.id}`">{{ META[x.id]!.name }}</label>
          <span v-if="!FIXED.has(x.id)" class="tg"><input :id="`hb-${x.id}`" type="checkbox" :checked="x.on" @change="setOn(x.id, ($event.target as HTMLInputElement).checked)" /></span>
        </div>
        <div class="tiny">{{ META[x.id]!.desc }}</div>
        <div class="emv">
          <button v-if="x.id === 'pinned'" class="lnk inl" @click="pinOpen = true">{{ picked.length ? `${picked.length} pinned, change` : "Pin goals" }}</button>
          <span class="grow" />
          <button class="ib sm plain" :class="{ end: i === 0 }" :aria-disabled="i === 0" :aria-label="`Move ${META[x.id]!.name} earlier`" :title="`Move ${META[x.id]!.name} earlier`" @click="move(x.id, -1)"><Icon name="up" :size="18" /></button>
          <button class="ib sm plain" :class="{ end: i === listed.length - 1 }" :aria-disabled="i === listed.length - 1" :aria-label="`Move ${META[x.id]!.name} later`" :title="`Move ${META[x.id]!.name} later`" @click="move(x.id, 1)"><Icon name="down" :size="18" /></button>
        </div>
      </div>
    </TransitionGroup>

    <div v-else-if="h" class="hgrid">
      <template v-for="id in blocks" :key="id">
        <TodayHero v-if="id === 'today'" :h="h" :fresh="fresh" />

        <!-- this week against last week, and workouts per week over eight weeks -->
        <div v-else-if="id === 'week'" class="card hb wkc sz-m click" v-bind="link('/stats')">
          <div class="ch"><span class="bi"><Icon name="stats" :size="15" /></span><span class="t grow">This week</span><span v-if="anyDelta" class="tiny">Vs last week</span></div>
          <div class="wstats" :class="{ n4: weekStats.length === 4, plain: !anyDelta }">
            <div v-for="x in weekStats" :key="x.key" class="ws" role="group" :aria-label="`${[x.label, x.value, x.unit, x.delta].filter(Boolean).join(' ')}, last week ${x.last}`" :title="`Last week ${x.last}`">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }}<small v-if="x.unit">{{ x.unit }}</small></div>
              <div v-if="anyDelta" class="wd">{{ x.delta }}</div>
            </div>
          </div>
          <div class="wbars" role="img" :aria-label="`Workouts per week, last 8 weeks: ${weeks.map((w) => w.workouts).join(', ')}`">
            <i v-for="(w, k) in weeks" :key="w.start" :class="{ cur: k === weeks.length - 1 }" :style="{ height: Math.max(4, (w.workouts / weekMax) * 100) + '%' }" />
          </div>
        </div>

        <!-- pinned goals: one block each, all the same width: the goal on the left, its streak on the right, or for a goal
             shown without its streak the day it started, ends or was done; both halves end on its periods' dots
             (recurring goals) or its trend (one-off goals) -->
        <div v-else-if="id === 'pinned'" class="pins">
          <div v-for="g in pinnedGoals" :key="g.id" class="card hb gtile sz-m click" :class="{ hero: reached(g) }" v-bind="link(() => (goalOpen = g.id))">
            <div class="gmain">
              <div class="ch"><span class="bi"><Icon :name="goalIcon(g)" :size="15" /></span><span class="t grow ellipsis">{{ g.title }}</span></div>
              <div class="row">
                <!-- a body goal heads to its target (up or down), the others count up to it -->
                <div class="big grow">{{ goalVal(g, g.progress?.current ?? 0) }}<small>{{ g.scope === "body" ? "to" : "of" }} {{ goalVal(g, g.target) }}{{ goalUnit(g) ? ` ${goalUnit(g)}` : "" }}</small></div>
                <!-- a reached goal's tile turns accent, so its ring and check take the on-accent colour -->
                <Ring :pct="g.progress?.pct ?? 0" :size="40" :done="reached(g)" :color="reached(g) ? 'var(--onc)' : undefined" />
              </div>
              <div class="tiny">{{ g.status === "achieved" ? "Achieved" : g.progress?.done ? `Reached ${periodNow(g).toLowerCase()}` : g.progress?.pace ?? periodNow(g) }}</div>
            </div>
            <div class="grun">
              <div class="ch"><span class="bi"><Icon :name="goalSide(g).icon" :size="15" /></span><span class="t">{{ goalSide(g).label }}</span></div>
              <div class="row"><div class="big grow">{{ goalSide(g).big }}<small v-if="goalSide(g).small">{{ goalSide(g).small }}</small></div></div>
              <div class="tiny">{{ goalSide(g).sub }}</div>
              <!-- the bottom element sits in one fixed box: the last eight periods as dots, oldest first, filled when reached;
                   or a one-off goal's trend -->
              <div class="gfoot" aria-hidden="true">
                <div v-if="recurring(g)" class="gdots"><i v-for="(on, k) in dots(g)" :key="k" :class="{ on }" /></div>
                <Sparkline v-else-if="hasTrend(g)" :values="trend(g)" :color="reached(g) ? 'var(--onc)' : undefined" />
                <div v-else class="gflat" />
              </div>
            </div>
          </div>
        </div>

        <!-- goals ending within two weeks that aren't reached yet -->
        <div v-else-if="id === 'dueSoon'" class="card hb sz-m">
          <div class="ch"><span class="bi warn"><Icon name="target" :size="15" /></span><span class="t grow">Goals due soon</span></div>
          <div class="glist">
            <div v-for="g in dueSoon" :key="g.id" class="grow-row click" v-bind="link(() => (goalOpen = g.id))">
              <div class="row"><b class="grow ellipsis">{{ g.title }}</b><span class="tiny due">{{ dueText(g) }}</span></div>
              <div class="pbar"><i :style="{ width: pct(g) + '%' }" /></div>
              <div class="tiny">{{ goalLabel(g, fmt) }}</div>
            </div>
          </div>
        </div>

        <!-- the program you're following: where you are and the workout it says to do next -->
        <template v-else-if="id === 'program'">
          <div v-for="p in h.programs" :key="p.id" class="card hb sz-m click prog has-cover" :class="{ dl: p.next?.deload }">
            <button class="cover" :aria-label="`Open ${p.name}`" @click="go(`/programs/${p.id}`)" />
            <div class="ch"><span class="bi"><Icon name="routines" :size="15" /></span><span class="t grow ellipsis">{{ p.name }}</span><span class="tiny">{{ p.done }} of {{ p.total }}</span></div>
            <div class="pbar"><i :style="{ width: (p.done / p.total) * 100 + '%' }" /></div>
            <div class="row"><MuscleFig sm :routine="p.next.routineId" />
              <div class="grow" style="min-width:0"><div class="tiny">{{ p.calendarWeek === 0 ? `Starts ${fmt.date(p.startDate, { weekday: "long", day: "numeric", month: "short" })}` : `Next, week ${p.next.week} of ${p.weeks}` }}</div>
                <div class="ellipsis"><b>{{ p.next.name }}</b><span v-if="p.next.deload" class="mchip">Deload -{{ p.deloadPct }}%</span></div></div>
              <button class="btn s o keep over" @click="router.push(`/routines/${p.next.routineId}/start?program=${p.id}${p.next.deload ? `&deload=${p.deloadPct}` : ''}`)">Start</button></div>
            <div v-if="p.calendarWeek > p.next.week" class="tiny wn">{{ p.calendarWeek - p.next.week }} week{{ p.calendarWeek - p.next.week > 1 ? "s" : "" }} behind the calendar. Carry on from here; nothing is skipped.</div>
          </div>
        </template>

        <!-- muscles: the header on top as on every block, then the figure on the left (as on every muscle card) and beside it
             how many groups were worked and every group with when it last was -->
        <div v-else-if="id === 'muscles'" class="card hb sz-m click" v-bind="link('/stats?tab=muscles')">
          <div class="ch"><span class="bi"><Icon name="activity" :size="15" /></span><span class="t grow">Muscles this week</span></div>
          <div class="mfig">
            <BodyMap class="rbody" :values="{}" :highlight="h.main7" :secondary="h.helpers7" />
            <div class="grow mside">
              <template v-if="worked">
                <div class="big">{{ worked }}<small>of {{ groups.length }} groups</small></div>
                <div class="tiny">worked in the last 7 days</div>
              </template>
              <div v-else class="tiny">No workouts in the last 7 days</div>
              <!-- every group, a dot filled when worked this week, and when it last was -->
              <div class="mgrp">
                <div v-for="g in groups" :key="g.id" class="mg" :class="{ on: g.on }"><i class="mdot" /><span class="mn ellipsis">{{ g.name }}</span><span class="mw">{{ g.when }}</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- up next: what's planned after today's -->
        <div v-else-if="id === 'upnext'" class="card hb sz-m">
          <div class="ch"><span class="bi"><Icon name="calendar" :size="15" /></span><span class="t grow">Up next</span>
            <button class="lnk" @click="planOpen = { rule: 'once' }"><Icon name="plus" :size="14" />Plan</button><button class="lnk" @click="router.push('/history')">Calendar</button></div>
          <div v-if="!upNext.length" class="tiny">Nothing else planned this week. Plan a routine for certain days and it shows here and in the calendar.</div>
          <div v-else class="list">
            <div v-for="p in upNext" :key="p.scheduleId + p.date" class="li click uprow">
              <button class="cover" :aria-label="`Open ${p.name}`" @click="startPlan(router, p)" />
              <MuscleFig sm :routine="p.routineId ?? undefined" />
              <div class="grow"><div class="t ellipsis">{{ p.name }}</div><div class="s ellipsis">{{ dayName(p.date) }}{{ p.timeOfDay ? " · " + p.timeOfDay : "" }}</div></div>
              <span class="pact over"><button class="btn s o" :aria-label="`Start ${p.name}`" @click="startPlan(router, p)"><Icon name="play" :size="14" />Start</button>
                <Menu :items="unplanItems(p)" :label="`Options for ${p.name}`" /></span>
            </div>
          </div>
        </div>

        <!-- last workout -->
        <div v-else-if="id === 'previous' && h.last" class="card hb wkc sz-m click has-cover">
          <button class="cover" :aria-label="`Open ${h.last.name}`" @click="go(`/workouts/${h.last.id}`)" />
          <div class="ch"><span class="bi"><Icon name="dumbbell" :size="15" /></span><span class="t">Last workout</span>
            <span class="lname"><span class="lnm ellipsis">{{ h.last.name }}</span><span class="sep">·</span><span class="lday">{{ when(h.last.startedAt) }}</span></span></div>
          <div class="wstats n4 plain">
            <div v-for="x in lastStats" :key="x.key" class="ws">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }}<small v-if="x.unit">{{ x.unit }}</small></div>
            </div>
          </div>
        </div>

        <!-- the first active goals -->
        <div v-else-if="id === 'goals'" class="card hb sz-m">
          <div class="ch"><span class="bi"><Icon name="goals" :size="15" /></span><span class="t grow">Goals</span><button class="lnk" @click="router.push('/goals')">All</button></div>
          <div v-if="!h.goals.length" class="tiny">Set one for a lift, a routine, a muscle group, walking or your body. <button class="lnk inl" @click="router.push('/goals?new=1')">Set a goal</button></div>
          <div v-else class="glist">
            <div v-for="g in h.goals" :key="g.id" class="grow-row click" v-bind="link(() => (goalOpen = g.id))">
              <div class="row"><b class="grow ellipsis">{{ g.title }}</b><span class="tiny" :class="{ pos: g.progress?.done }">{{ g.progress?.done ? "Reached" : `${Math.round(pct(g))}%` }}</span></div>
              <div class="pbar" :class="{ ok: g.progress?.done }"><i :style="{ width: pct(g) + '%' }" /></div>
              <div class="tiny">{{ goalLabel(g, fmt) }}<template v-if="g.period !== 'once'"> · {{ periodLabel(g, s) }}</template></div>
            </div>
          </div>
        </div>

        <!-- suggestions: worked out from your order of routines, the muscles you've worked and what your routines leave out.
             A routine opens its page; a muscle (or a gap in your routines) opens the exercises for it, and its + starts a
             new routine -->
        <div v-else-if="id === 'suggest'" class="card hb sz-m">
          <div class="ch"><span class="bi"><Icon name="sparkle" :size="15" /></span><span class="t grow">Suggested</span></div>
          <TransitionGroup name="mv" tag="div" class="list">
            <div v-for="x in h.suggest" :key="x.kind + (x.routineId ?? x.muscle)" class="li click">
              <button class="cover" :aria-label="x.routineId ? `Open ${x.title}` : `Exercises for ${muscleName(x.muscle ?? '').toLowerCase()}`" @click="go(x.routineId ? `/routines/${x.routineId}` : `/exercises?muscle=${encodeURIComponent(x.muscle ?? '')}`)" />
              <MuscleFig sm :routine="x.routineId ?? undefined" :muscles="x.routineId ? undefined : x.muscles ?? (x.muscle ? [x.muscle] : undefined)" />
              <div class="grow"><div class="t">{{ x.title }}</div><div class="s">{{ x.reason }}</div></div>
              <button v-if="x.routineId" class="ib sm over" aria-label="Plan" title="Plan" @click="planOpen = { rule: 'once', routineId: x.routineId }"><Icon name="calendar" :size="18" /></button>
              <button v-else-if="x.muscle" class="ib sm over" aria-label="New routine" title="New routine" @click="go('/routines/new/edit')"><Icon name="plus" :size="18" /></button>
              <button class="ib sm plain over" aria-label="Not now" title="Not now: hide until your next workout" @click="hideSuggestion(x.key)"><Icon name="close" :size="16" /></button>
            </div>
          </TransitionGroup>
        </div>

        <div v-else-if="id === 'reminders'" class="card hb sz-m">
          <div class="ch"><span class="bi"><Icon name="bell" :size="15" /></span><span class="t grow">Reminders</span></div>
          <div class="list"><div v-for="r in h.reminders" :key="r.id" class="li click" v-bind="link(() => (reminderView = { r }))"><div class="grow"><div class="t">{{ reminderText(r, fmt) }}</div><div class="s">{{ r.targetName }}</div></div><Icon name="right" :size="16" class="muted" /></div></div>
        </div>

        <!-- body weight: the latest, the change over 30 days and the trend -->
        <div v-else-if="id === 'bodyweight'" class="card hb stat sz-s click has-cover">
          <button class="cover" aria-label="Open body weight" @click="go('/body')" />
          <div class="ch"><span class="bi"><Icon name="scale" :size="15" /></span><span class="t grow">Weight</span>
            <button class="ib sm plain over" aria-label="Log weight" title="Log weight" @click="bodySheet = true"><Icon name="plus" :size="16" /></button></div>
          <div class="big">{{ bw[0] ? fmt.w(bw[0].value) : "-" }}<small>{{ fmt.wu }}</small></div>
          <div class="tiny">{{ bwChange ?? (bw[0] ? ago(bw[0].at) : "Not logged yet") }}</div>
          <Sparkline v-if="bwTrend.length > 1" :values="bwTrend" />
        </div>

        <div v-else-if="id === 'records'" class="card hb sz-m">
          <div class="ch"><span class="bi"><Icon name="trophy" :size="15" /></span><span class="t grow">Records</span><span class="tiny">Last 30 days</span></div>
          <div class="list">
            <div v-for="(r, i) in h.records" :key="`${r.workoutId}-${r.exerciseId}-${r.kinds.join()}-${i}`" class="li click" v-bind="link(`/exercises/${r.exerciseId}`)">
              <div class="grow"><div class="t">{{ r.name }}</div><div class="s">{{ r.kinds.map((k: string) => KIND[k] ?? k).join(", ") }} · {{ fmt.date(r.at, { day: "numeric", month: "short" }) }}</div></div>
              <b class="rv">{{ recordText(r) }}</b>
            </div>
          </div>
        </div>

        <div v-else-if="id === 'feed'" class="card hb sz-m">
          <div class="ch"><span class="bi"><Icon name="history" :size="15" /></span><span class="t grow">Recent activity</span><button class="lnk" @click="router.push('/history?view=list')">All</button></div>
          <div class="list"><div v-for="x in h.feed.slice(0, 5)" :key="x.id" class="li click" v-bind="link(x.kind === 'workout' ? `/workouts/${x.id}` : `/activities/${x.id}`)">
            <Icon :name="x.kind === 'workout' ? 'dumbbell' : x.type === 'walk' ? 'walk' : 'activity'" :size="18" class="muted" /><div class="grow"><div class="t">{{ x.kind === "workout" ? x.name : x.name || x.type }}</div><div class="s">{{ fmt.date(x.startedAt, { weekday: "short", day: "numeric", month: "short" }) }}</div></div>
            <SessionStats :x="x" /></div></div>
        </div>

        <div v-else-if="id === 'daily'" class="card hb sz-m">
          <div class="ch"><span class="bi"><Icon name="moon" :size="15" /></span><span class="t grow">Today's log</span><button class="lnk" @click="dailySheet = true">Other days</button></div>
          <DailyLog />
        </div>

        <div v-else-if="id === 'achievements'" class="card hb sz-m click" v-bind="link('/stats?tab=achievements')">
          <div class="ch"><span class="bi"><Icon name="star" :size="15" /></span><span class="t grow">Achievements</span></div>
          <div v-if="!achRecent.length" class="tiny">Finish your first workout for your first one.</div>
          <div class="list"><div v-for="a in achRecent" :key="a.id" class="li"><Icon name="trophy" :size="18" class="ach-on" /><div class="grow"><div class="t">{{ a.name }}</div><div class="s">{{ fmt.date(a.reachedAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div></div></div>
          <div v-if="achNext" class="ach-next"><div class="row tiny"><span class="grow">Next: <b class="ach-nm">{{ achNext.name }}</b></span>{{ achAmount(achNext.unit, achNext.value) }} / {{ achAmount(achNext.unit, achNext.target) }}</div>
            <div class="pbar"><i :style="{ width: Math.min(100, (achNext.value / achNext.target) * 100) + '%' }" /></div></div>
        </div>
      </template>
    </div>
    <div v-else-if="home.isLoading.value" class="hgrid"><div class="card today-ph sz-l" /><div v-for="i in 4" :key="i" class="card sz-s today-ph" /></div>
    <div v-else class="card empty"><Icon name="info" :size="34" /><b>Couldn't load Home</b>{{ (home.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="home.refetch()">Try again</button></div>

    <ScheduleEditor v-if="planOpen" :schedule="planOpen" @close="planOpen = null" />
    <GoalSheet v-if="goalOpen" :id="goalOpen" @close="goalOpen = null" @edit="(g) => router.push(`/goals?edit=${g.id}`)" @status="goalStatus" @delete="goalDelete" />
    <Sheet v-if="pinOpen" title="Pinned goals" @close="pinOpen = false">
      <p class="tiny hgap">Each pinned goal gets its own block on Home, in this order. Weekly and monthly goals can bring their streak along.</p>
      <TransitionGroup name="mv" tag="div">
        <!-- the key sits on the template only: Vue refuses keys on its children (the build fails), and TransitionGroup
             keys each child from the template's key plus its place -->
        <template v-for="g in goalRows" :key="g.id">
          <div class="tgl">
            <label class="grow hsw" :for="`hg-${g.id}`"><div><div class="t">{{ g.title }}</div><div class="s">{{ periodLabel(g, s) }}</div></div></label>
            <template v-if="onHome(s, g.id)">
              <button class="ib sm plain" :class="{ end: picked[0]?.id === g.id }" :aria-disabled="picked[0]?.id === g.id" :aria-label="`Move ${g.title} up`" :title="`Move ${g.title} up`" @click="movePin(g.id, -1)"><Icon name="up" :size="18" /></button>
              <button class="ib sm plain" :class="{ end: picked.at(-1)?.id === g.id }" :aria-disabled="picked.at(-1)?.id === g.id" :aria-label="`Move ${g.title} down`" :title="`Move ${g.title} down`" @click="movePin(g.id, 1)"><Icon name="down" :size="18" /></button>
            </template>
            <span class="tg"><input :id="`hg-${g.id}`" type="checkbox" :checked="onHome(s, g.id)" @change="toggleHomeGoal(s, g)" /></span>
          </div>
          <label v-if="onHome(s, g.id) && g.period !== 'once'" class="tgl sub-t"><div class="grow"><div class="t">With its streak</div></div><span class="tg"><input type="checkbox" :aria-label="`${g.title}: with its streak`" :checked="streakOnHome(s, g.id)" @change="setHomeStreak(s, g.id, ($event.target as HTMLInputElement).checked)" /></span></label>
        </template>
      </TransitionGroup>
      <div v-if="!pickable.length" class="tiny">No goals yet. <button class="lnk inl" @click="pinOpen = false; router.push('/goals?new=1')">Set one</button></div>
    </Sheet>
  </div>
</template>

<style scoped>
/* an Up next row: the name gives way to Start and ⋮ (cut with an ellipsis, like the plan rows in Today) instead of
   keeping the setting rows' 42%, so the row fits at phone width */
.uprow > .grow { min-width: 0; }
/* the board: four columns on a computer, two on the phone. Small blocks fill gaps left by wide ones (dense), so any order
   still lays out without holes */
.hgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--spg); grid-auto-flow: row dense; align-items: stretch; }
.sz-s { grid-column: span 1; }
.sz-m { grid-column: span 2; }
.sz-l { grid-column: 1 / -1; }
/* pinned goals are one block in the order but each goal is its own tile in the grid */
.pins { display: contents; }
@media (max-width: 760px) { .hgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .sz-m { grid-column: 1 / -1; } }
html.phone .hgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
html.phone .hgrid .sz-m { grid-column: 1 / -1; }

/* a block: its header row (icon, title, its one link), then its content spaced by the header gap */
.hb { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.hb > .ch { margin-bottom: calc(var(--hg) - 4px); }
.ch .lnk { font-size: var(--fs-sm); font-weight: 600; color: var(--acc); cursor: pointer; background: none; border: 0; display: inline-flex; align-items: center; gap: 2px; padding: 0; }
.ch .lnk + .lnk { margin-inline-start: var(--hg); }
.big { font-size: var(--fs-val); font-weight: 650; letter-spacing: -.8px; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.big small { font-size: var(--fs); font-weight: 500; margin-inline-start: 5px; color: var(--tx2); letter-spacing: 0; }
.hero .big small, .hero .tiny { color: color-mix(in srgb, var(--onc) 75%, transparent); }
/* small blocks and the goal tiles' halves are narrow on the phone, so their values shrink with the screen */
html.phone .sz-s .big, html.phone .gtile .big { font-size: clamp(22px, 7vw, var(--fs-val)); }

/* the stat tiles of this week and the last workout are the shared .wkc/.wstats ones (app.css) */
.wbars { display: flex; align-items: flex-end; gap: 6px; height: 34px; margin-top: auto; padding-top: var(--hg); box-sizing: content-box; }
.wbars i { flex: 1; border-radius: 4px 4px 2px 2px; background: color-mix(in srgb, var(--acc) 28%, transparent); }
.wbars i.cur { background: var(--acc); }
/* the last workout's name and day at the right of its header, at the size of the other headers' notes ("Vs last week"):
   the name as strong as Achievements' "Next" name and cut first, so the title and the day always show at 360px */
.lname { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; font-size: var(--fs-xs); }
.lnm { min-width: 0; color: var(--tx); font-weight: 600; }
.lday { color: var(--tx2); white-space: nowrap; flex: none; }

/* a pinned goal: its two halves side by side, split by a faint line. Both share the tile's four rows (subgrid), so header,
   value, tiny line and bottom box line up across the halves whatever each holds; the header is spaced from the value
   like every other block's (.hb > .ch), and the value row is the ring's height in both halves */
.gtile { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); grid-template-rows: auto minmax(40px, auto) auto 1fr; column-gap: var(--cpx); row-gap: 4px; }
.gmain, .grun { grid-row: 1 / -1; display: grid; grid-template-rows: subgrid; grid-template-columns: minmax(0, 1fr); row-gap: 4px; min-width: 0; align-items: center; }
.gmain > .ch, .grun > .ch { margin-bottom: calc(var(--hg) - 4px); }
.gtile .tiny { align-self: start; }
.gtile .row { align-self: stretch; }
.grun { padding-inline-start: var(--cpx); border-inline-start: 1px solid var(--ol); }
.hero .grun { border-color: color-mix(in srgb, var(--onc) 18%, transparent); }
/* the bottom box: one height for dots, trend and flat line, so stacked tiles are the same height */
.gfoot { align-self: end; height: 28px; padding-top: var(--hg); box-sizing: content-box; display: flex; align-items: flex-end; }
.gdots { flex: 1; display: flex; gap: 4px; }
.gdots i { flex: 1; max-width: 18px; height: 6px; border-radius: 3px; }
/* off and on look the same for the streak dots and the muscle groups' dots */
.gdots i, .mdot { background: color-mix(in srgb, currentColor 14%, transparent); }
.gdots i.on, .mg.on .mdot { background: var(--acc); }
.hero .gdots i.on { background: var(--onc); }
.gfoot .spark, .gflat { position: static; display: block; width: 100%; height: 28px; }
/* nothing to draw yet: the trend's flat baseline, in the empty dots' colour */
.gflat { background: linear-gradient(color-mix(in srgb, currentColor 14%, transparent), color-mix(in srgb, currentColor 14%, transparent)) bottom 4px left / 100% 2px no-repeat; }

/* goal rows: title and state, the bar, the numbers */
.glist { display: flex; flex-direction: column; gap: var(--hg); }
.grow-row { display: flex; flex-direction: column; gap: 6px; border-radius: var(--r-sm); }
.pbar { height: 6px; }
.pbar.ok i { background: var(--pos); }
.due { color: var(--warn); font-weight: 600; }
.pos { color: var(--pos); }

/* muscles: under the header the figure fills the rest of the block's height on the left, the groups beside it */
.mfig { flex: 1; display: flex; align-items: stretch; gap: var(--cpx); min-width: 0; }
.mside { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
/* a card that opens somewhere and also holds its own button: the card's link is a transparent button over the whole
   card, and the inner button sits above it, so the two are siblings rather than one inside the other */
.has-cover { position: relative; }
.cover { position: absolute; inset: 0; z-index: 0; margin: 0; padding: 0; border: 0; background: none; border-radius: inherit; cursor: pointer; }
.cover:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
/* a row with a cover button too (Up next): its own controls stay above the cover, so they act instead of the row */
:is(.has-cover, .li) .over { position: relative; z-index: 1; }
/* the groups: name on the left, when on the right; two columns once the side is wide enough, one on the phone.
   Worked this week shows as an accent dot and a full-strength day, not yet as a faint dot (the streak dots' off look)
   and a muted day. 160px fits the longest name with the longest day ("Shoulders", "3 weeks ago") without cutting it */
.mgrp { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); column-gap: var(--cpx); row-gap: var(--tdy); margin-top: auto; padding-top: var(--hg); }
.mg { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--fs-sm); }
.mdot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.mn { color: var(--tx); flex: 1; min-width: 0; }
.mw { color: var(--tx2); white-space: nowrap; font-variant-numeric: tabular-nums; }
.mg.on .mw { color: var(--tx); font-weight: 500; }

.prog { gap: var(--hg); }
.prog .mchip { margin-inline-start: 8px; }
.prog.dl { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acc) 35%, transparent); }
.wn { color: var(--warn); }
.rv { font-variant-numeric: tabular-nums; white-space: nowrap; }
.ach-on { color: var(--warn); }
.ach-nm { color: var(--tx); font-weight: 600; }
.ach-next { margin-top: var(--hg); display: flex; flex-direction: column; gap: 6px; }
.today-ph { opacity: .4; min-height: 118px; }

/* Edit home: each tile names its block and says what it shows; switched-off ones fade back */
.etile { display: flex; flex-direction: column; gap: 4px; min-height: 92px; border: 1px dashed var(--ol); }
.etile .ch { margin-bottom: 0; }
/* a long name wraps rather than pushing the switch out of a narrow tile */
.etile .t { cursor: pointer; min-width: 0; overflow-wrap: anywhere; line-height: 1.25; }
.etile.off { opacity: .55; }
/* the foot: the pinned goals' link on the left, the arrows on the right with their icons lined up under the switch's edge */
.emv { display: flex; align-items: center; gap: 4px; margin-top: auto; margin-inline-end: calc((18px - 36px) / 2); }
.tgl.sub-t { padding-inline-start: calc(var(--cpx) + var(--hg)); }
.hsw { cursor: pointer; align-self: stretch; display: flex; align-items: center; }
</style>
