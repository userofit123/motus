<script setup lang="ts">
// Home (requirement 9): how you're doing, what's next, what you did last, your goals. Optional cards are added by you.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { muscleName, num, fromM, orderGoals, type Goal } from "@motus/shared";
import { useHome, useSettings, saveSettings, useAchievements, useGoals, loaded } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { confirm } from "../core/ask";
import { toast } from "../core/toast";
import { onHome, streakOnHome, toggleHomeGoal, setHomeStreak, periodWord, periodNow, periodLabel } from "../core/goals";
import { queryClient } from "../api/live";
import { useFmt, ago, goalLabel } from "../core/format";
import { startOpen, bodySheet, dailySheet, activitySheet } from "../core/ui";
import { isPhone } from "../core/device";
import Icon from "../components/Icon.vue";
import MuscleFig from "../components/MuscleFig.vue";
import Sparkline from "../components/Sparkline.vue";
import Ring from "../components/Ring.vue";
import BodyMap from "../components/BodyMap.vue";
import DailyLog from "../components/DailyLog.vue";
import Sheet from "../components/Sheet.vue";
import GoalCard from "../components/GoalCard.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";
import GoalSheet from "../components/GoalSheet.vue";

const router = useRouter();
const home = useHome();
const s = useSettings();
const fmt = useFmt();
const h = computed<any>(() => home.data.value);
// nothing made or done yet
const fresh = computed(() => !!h.value && !h.value.routineCount && !h.value.totalWorkouts && !h.value.activityCount && !h.value.programs?.length);
const custom = ref(false);
const planOpen = ref<any>(null);
// goal blocks at the top: the goals you picked (Customise home, or a goal's own sheet), each with its streak beside it if wanted
// (put in the saved order here too, so a move in Customise home shows before the server answers)
const homeGoals = computed<(Goal & { showStreak: boolean })[]>(() => orderGoals(h.value?.homeGoals ?? [], s.value.home.goals.map((x) => x.id)));
const goalOpen = ref<string | null>(null);
const allGoals = useGoals();
const pickable = computed(() => (allGoals.data.value ?? []).filter((g) => g.status !== "archived"));
// in Customise home: the goals at the top first, in their order (the arrows move them), then the ones you could add
const homePicked = computed(() => orderGoals(pickable.value.filter((g) => onHome(s.value, g.id)), s.value.home.goals.map((x) => x.id)));
const goalRows = computed(() => [...homePicked.value, ...pickable.value.filter((g) => !onHome(s.value, g.id))]);
// like moveSection: past the neighbour you can see (a picked goal that is archived keeps its place)
function moveHomeGoal(id: string, dir: -1 | 1) {
  const l = homePicked.value, other = l[l.findIndex((g) => g.id === id) + dir];
  if (!other) return;
  const all = [...s.value.home.goals], a = all.findIndex((x) => x.id === id), b = all.findIndex((x) => x.id === other.id);
  [all[a], all[b]] = [all[b]!, all[a]!];
  saveSettings({ home: { goals: all } }, { quiet: true });
}
const goalVal = (g: Goal, v: number) => { const u = g.progress?.unit; return u === "kg" ? fmt.value.w(v) : u === "km" ? fmt.value.num(fromM(v * 1000, fmt.value.du), 1) : u === "cm" ? fmt.value.len(v) : fmt.value.num(v, u === "min" ? 0 : 1); };
const goalUnit = (g: Goal) => { const u = g.progress?.unit; return u === "kg" ? fmt.value.wu : u === "km" ? fmt.value.du : u === "cm" ? fmt.value.lu : u ?? ""; };
// a goal block takes the hero colour once it's reached (this period, or achieved for good), whichever block it is
const reached = (g: Goal) => g.status === "achieved" || !!g.progress?.done;
const goalIcon = (g: Goal) => ({ activity: g.scopeId === "workout" ? "dumbbell" : "walk", routine: "routines", exercise: "dumbbell", muscle: "activity", body: "scale" } as Record<string, string>)[g.scope] ?? "target";
async function goalStatus(g: Goal, status: string) { await api.put(`/goals/${g.id}`, { status }); invalidate(["goals", "home"]); goalOpen.value = null; toast(status === "archived" ? "Goal archived" : "Goal made active"); }
async function goalDelete(g: Goal) { if (await confirm(`Delete "${g.title}"?`, { ok: "Delete", danger: true })) { await api.del(`/goals/${g.id}`); invalidate(["goals", "home"]); goalOpen.value = null; toast("Goal deleted"); } }
// Home is one ordered list of sections, each shown or hidden (Customise home)
const NAMES: Record<string, string> = { goalBlocks: "Goals at the top", time: "Time this week", condition: "Muscles worked", program: "Your program", upnext: "Up next",
  suggest: "Suggested", previous: "Previous workout", goals: "Goals", volume: "Volume this week", walking: "Walking", bodyweight: "Body weight",
  daily: "Today: steps and daily log", reminders: "Reminders", feed: "Recent activity", muscles: "Sets per muscle this week", achievements: "Achievements" };
// how wide a section is: a stat block (a quarter of the row), half the row, or the whole row
const WIDTH: Record<string, "stat" | "full"> = { goalBlocks: "stat", time: "stat", condition: "stat", program: "full", goals: "full" };
// the daily-log card is offered only while Steps or Sleep, water and mood is switched on
const dailyOn = computed(() => !!(s.value.features.steps || s.value.features.dailyLog));
// a section whose feature is off is absent, whatever was chosen for it, and left out of Customise home
const available = (id: string) => id === "daily" ? dailyOn.value : id === "achievements" ? !!s.value.features.achievements : id === "program" ? !!s.value.features.programs : true;
const listed = computed(() => s.value.home.sections.filter((x) => available(x.id)));
const has = (id: string) => listed.value.some((x) => x.id === id && x.on);
// shown sections in order; consecutive ones of the same width share a grid, so any order still lays out in rows
const runs = computed(() => {
  const out: { w: "stat" | "half" | "full"; ids: string[] }[] = [];
  for (const x of listed.value) {
    if (!x.on || (x.id === "program" && !h.value?.programs?.length) || (x.id === "suggest" && !h.value?.suggest?.length)) continue;
    const w = WIDTH[x.id] ?? "half", last = out[out.length - 1];
    if (last && last.w === w && w !== "full") last.ids.push(x.id); else out.push({ w, ids: [x.id] });
  }
  return out;
});
const setSection = (id: string, on: boolean) => saveSettings({ home: { sections: s.value.home.sections.map((x) => (x.id === id ? { ...x, on } : x)) } });
// moves past the neighbour you can see in the list (sections of a switched-off feature keep their place)
function moveSection(id: string, dir: -1 | 1) {
  const l = listed.value, other = l[l.findIndex((x) => x.id === id) + dir];
  if (!other) return;
  const all = [...s.value.home.sections], a = all.findIndex((x) => x.id === id), b = all.findIndex((x) => x.id === other.id);
  [all[a], all[b]] = [all[b]!, all[a]!];
  saveSettings({ home: { sections: all } }, { quiet: true });
}
// a dismissed suggestion stays away until your next workout; the list redraws without waiting for the server
const hideSuggestion = (key: string) => {
  queryClient.setQueriesData({ queryKey: ["home"] }, (d: any) => d && { ...d, suggest: d.suggest.filter((x: any) => x.key !== key) });
  saveSettings({ home: { hidden: { [key]: new Date().toISOString() } } }, { quiet: true });
};

const today = new Date();
const greeting = computed(() => { const hr = today.getHours(); return hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; });
const weeks = computed<any[]>(() => h.value?.weeks ?? []);
const tw = computed(() => h.value?.thisWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
const lw = computed(() => h.value?.lastWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
// how many muscle groups were worked in the last 7 days
const groups = computed<any[]>(() => h.value?.groupDays ?? []);
const worked = computed(() => groups.value.filter((g) => g.days != null && g.days < 7).length);
const condition = computed(() => !h.value?.last ? "Nothing worked yet" : `${worked.value}/${groups.value.length} groups`);
// minutes until there is an hour's worth, then hours and minutes
const hm = (sec: number) => { const m = Math.round(sec / 60); return m < 60 ? [[m, "min"]] : m % 60 ? [[Math.floor(m / 60), "h"], [m % 60, "min"]] : [[m / 60, "h"]]; };
const lastBw = computed(() => h.value?.bodyweight?.[0]);
const bwTrend = computed(() => [...(h.value?.bodyweight ?? [])].reverse().map((x: any) => x.value));
const delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);
// every block opens where its numbers come from: a click, or Enter on a block reached with Tab
const go = (to: string | (() => void)) => (typeof to === "string" ? router.push(to) : to());
const link = (to: string | (() => void)) => ({ role: "button", tabindex: 0, onClick: () => go(to),
  onKeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); go(to); } } });
const reminderPlace = (r: any) => r.targetType === "routine" ? `/routines/${r.targetId}` : `/exercises/${r.targetId}`;
const start = (p: any) => router.push(`/routines/${p.routineId}/start${p.scheduleId ? `?schedule=${p.scheduleId}&date=${p.date}` : ""}`);
// achievements card: the latest ones reached and the closest one still to come
const achOn = computed(() => has("achievements"));
const ach = useAchievements(achOn);
const achSteps = computed(() => (ach.data.value ?? []).flatMap((a: any) => a.steps.map((x: any) => ({ ...x, unit: a.unit, value: a.value }))));
const achRecent = computed(() => achSteps.value.filter((x) => x.reachedAt).sort((a, b) => b.reachedAt.localeCompare(a.reachedAt)).slice(0, 3));
const achNext = computed(() => (ach.data.value ?? []).map((a: any) => a.steps.find((x: any) => !x.reachedAt) && { ...a.steps.find((x: any) => !x.reachedAt), unit: a.unit, value: a.value })
  .filter(Boolean).sort((a: any, b: any) => b.value / b.target - a.value / a.target)[0]);
const achAmount = (unit: string, v: number) => unit === "kg" ? fmt.value.vol(v) : unit === "m" ? fmt.value.dist(v, v < 10000 ? 1 : 0) : unit === "s" ? `${num(v / 3600, 0)}h` : unit === "weeks" ? `${num(v, 0)} wk` : num(v, 0);
const dayName = (d: string) => { const t = new Date().toLocaleDateString("sv-SE"); const tm = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE"); return d === t ? "Today" : d === tm ? "Tomorrow" : fmt.value.date(d, { weekday: "long" }); };
// show the page once its data is in, all at once
await loaded(home, ach);
</script>

<template>
  <div class="page">
    <div class="ph">
      <div><h1>{{ isPhone ? greeting : "Home" }}</h1><div class="sub">{{ fmt.dateLong(today.toISOString()) }}</div></div>
    </div>
    <template v-if="h">
      <!-- a new account: nothing to sum up yet, so Home says how to begin -->
      <div v-if="fresh" class="card empty welcome">
        <Icon name="dumbbell" :size="34" /><b>Let's get you started</b>Make a routine: the exercises you do, with their sets, reps and rest. Or pick a ready-made one, or just start a workout and add exercises as you go.
        <div class="row" style="justify-content:center;margin-top:14px;flex-wrap:wrap"><button class="btn" @click="router.push('/routines/new/edit')">Create a routine</button><button class="btn tonal" @click="router.push('/routines?template=1')">Use a template</button></div>
        <button class="qb acc" style="margin-top:10px" @click="startOpen = true"><Icon name="play" :size="14" />Start a workout now</button>
      </div>
      <!-- the sections in your order (Customise home); a run of stat blocks or of half-width sections shares one grid -->
      <div class="hruns">
      <div v-for="run in runs" :key="run.ids.join()" class="hrun" :class="{ 'grid g4 st': run.w === 'stat', 'grid g2': run.w === 'half' }">
      <template v-for="id in run.ids" :key="id">
        <template v-if="id === 'goalBlocks'">
        <!-- a goal block; with its streak on it takes two columns and the streak sits inside it, so the two read as one -->
        <div v-for="g in homeGoals" :key="g.id" class="card stat click gblock" :class="{ hero: reached(g), wide: g.showStreak }" v-bind="link(() => (goalOpen = g.id))">
          <div class="gb-main">
            <div class="lbl"><span class="bi"><Icon :name="goalIcon(g)" :size="15" /></span><span class="ellipsis">{{ g.title }}</span></div>
            <div class="row" style="margin-top:8px">
              <div v-if="g.scope === 'body'" class="val" style="margin:0">{{ goalLabel(g, fmt) }}</div>
              <div v-else class="val" style="margin:0">{{ goalVal(g, g.progress?.current ?? 0) }}<small>of {{ goalVal(g, g.target) }}{{ g.progress?.unit === "sessions" || g.progress?.unit === "times" ? "" : ` ${goalUnit(g)}` }}</small></div>
              <span v-if="reached(g)" class="tick on wk-tick" title="Reached"><Icon name="check" :size="20" /></span>
              <span v-else class="wk-ring"><Ring :pct="g.progress?.pct ?? 0" :size="40" /></span>
            </div>
            <div class="sub">{{ g.status === "achieved" ? "Achieved" : g.progress?.done ? `Reached ${periodNow(g).toLowerCase()}` : g.progress?.pace ?? periodNow(g) }}</div>
          </div>
          <div v-if="g.showStreak" class="gb-run">
            <div class="lbl"><span class="bi"><Icon name="flame" :size="15" /></span>Streak</div>
            <div class="val">{{ g.progress?.streak ?? 0 }}<small>{{ periodWord(g, g.progress?.streak ?? 0) }} in a row</small></div>
            <!-- the last eight weeks (or months), oldest first: filled when reached -->
            <div class="gb-dots" aria-hidden="true"><i v-for="(x, k) in g.progress?.history ?? []" :key="k" :class="{ on: x.value >= g.target }" /></div>
          </div>
          <Sparkline v-else-if="(g.progress?.history.length ?? 0) > 1" :values="g.progress!.history.map((x) => x.value)" :color="reached(g) ? 'var(--onc)' : undefined" />
        </div>
        <!-- no goal picked for the top: what this week holds so far, and a way to set one -->
        <div v-if="!homeGoals.length" class="card stat click" v-bind="link('/goals?new=1')">
          <div class="lbl"><span class="bi"><Icon name="calendar" :size="15" /></span>This week</div>
          <div class="val">{{ tw.workouts }}<small>{{ tw.workouts === 1 ? "workout" : "workouts" }}</small></div>
          <div class="sub">Set a weekly goal to keep a streak</div>
          <Sparkline :values="weeks.map((w) => w.workouts)" />
        </div>
        </template>
        <div v-if="id === 'time'" class="card stat click" v-bind="link('/stats')">
          <div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Time this week</div>
          <div class="val"><template v-for="([v, u], i) in hm(tw.timeS)" :key="i">{{ i ? " " : "" }}{{ v }}<small>{{ u }}</small></template></div>
          <div class="sub">vs {{ fmt.dur(lw.timeS, true) }} last week</div>
          <Sparkline :values="weeks.map((w) => w.timeS)" />
        </div>
        <div v-if="id === 'condition'" class="card stat click" v-bind="link('/stats?tab=muscles')">
          <div class="lbl"><span class="bi"><Icon name="activity" :size="15" /></span>Muscles</div>
          <div class="cond">
            <div class="grow"><div class="ct">{{ condition }}</div><div v-if="h.last" class="sub">worked in the last 7 days</div></div>
            <BodyMap :values="h.muscles7" :height="isPhone ? 80 : 78" />
          </div>
        </div>

      <!-- the program you're following: where you are and the workout it says to do next -->
      <template v-if="id === 'program'">
      <section v-for="p in h.programs ?? []" :key="p.id">
        <div class="sh"><h2>Your program</h2><button class="lnk" @click="router.push(`/programs/${p.id}`)">Plan <Icon name="right" :size="14" /></button></div>
        <div class="card click prog" :class="{ dl: p.next?.deload }" v-bind="link(`/programs/${p.id}`)">
          <div class="row"><MuscleFig sm :routine="p.next.routineId" />
            <div class="grow" style="min-width:0"><b class="ellipsis pn">{{ p.name }}</b><div class="tiny">{{ p.calendarWeek === 0 ? `Starts ${fmt.date(p.startDate, { weekday: "long", day: "numeric", month: "short" })}` : `Week ${p.next.week} of ${p.weeks}` }} · {{ p.done }} of {{ p.total }} workouts</div></div></div>
          <div class="pbar"><i :style="{ width: (p.done / p.total) * 100 + '%' }" /></div>
          <div class="row pnx"><div class="grow" style="min-width:0"><div class="tiny">Next</div><div class="ellipsis"><b>{{ p.next.name }}</b><span v-if="p.next.deload" class="mchip">Deload −{{ p.deloadPct }}%</span></div></div>
            <button class="btn s keep" @click.stop="router.push(`/routines/${p.next.routineId}/start?program=${p.id}${p.next.deload ? `&deload=${p.deloadPct}` : ''}`)"><Icon name="play" :size="14" />Start</button></div>
          <div v-if="p.calendarWeek > p.next.week" class="tiny wn">{{ p.calendarWeek - p.next.week }} week{{ p.calendarWeek - p.next.week > 1 ? "s" : "" }} behind the calendar. Carry on from here; nothing is skipped.</div>
        </div>
      </section>
      </template>

        <!-- up next -->
        <section v-if="id === 'upnext'">
          <div class="sh"><h2>Up next</h2><div class="row" style="gap:14px"><button class="lnk" @click="planOpen = { rule: 'once' }"><Icon name="plus" :size="14" />Plan</button><button class="lnk" @click="router.push('/history')">Calendar <Icon name="right" :size="14" /></button></div></div>
          <div class="card">
            <div v-if="!h.upNext.length" class="empty sm"><b>Nothing planned</b>Plan a routine for certain days, and it shows here and in the calendar.<br /><button class="btn tonal" @click="planOpen = { rule: 'once' }">Plan a workout</button></div>
            <div v-else class="list">
              <div v-for="p in h.upNext" :key="p.scheduleId + p.date" class="li click" v-bind="link(() => (p.routineId ? start(p) : (activitySheet = { type: p.activityType })))">
                <MuscleFig sm :routine="p.routineId" />
                <span class="dot" :style="p.color ? { background: p.color } : undefined" />
                <div class="grow"><div class="t">{{ p.name }}</div><div class="s">{{ dayName(p.date) }}{{ p.timeOfDay ? " · " + p.timeOfDay : "" }}</div></div>
                <button v-if="p.routineId" class="btn s" :class="{ o: dayName(p.date) !== 'Today' }" @click.stop="start(p)">Start</button>
                <button v-else class="btn s o" @click.stop="activitySheet = { type: p.activityType }">Log</button>
              </div>
            </div>
          </div>
        </section>
        <!-- suggestions: worked out from your order of routines and the muscles you've worked -->
        <section v-if="id === 'suggest'">
          <div class="sh"><h2>Suggested</h2></div>
          <div class="card"><TransitionGroup name="mv" tag="div" class="list">
            <div v-for="x in h.suggest" :key="x.kind + (x.routineId ?? x.muscle)" class="li click" v-bind="link(x.routineId ? `/routines/${x.routineId}` : `/exercises?muscle=${encodeURIComponent(x.muscle)}`)">
              <!-- the routine's muscles, or the one muscle the tip is about -->
              <MuscleFig sm :routine="x.routineId" :muscles="x.routineId || !x.muscle ? undefined : [x.muscle]" />
              <div class="grow"><div class="t">{{ x.title }}</div><div class="s">{{ x.reason }}</div></div>
              <template v-if="x.routineId">
                <button class="ib sm" aria-label="Plan" title="Plan" @click.stop="planOpen = { rule: 'once', routineId: x.routineId }"><Icon name="calendar" :size="18" /></button>
                <button class="btn s o" @click.stop="router.push(`/routines/${x.routineId}/start`)">Start</button>
              </template>
              <button v-else class="btn s o" @click.stop="router.push(`/exercises?muscle=${encodeURIComponent(x.muscle)}`)">Exercises</button>
              <button class="ib sm plain" aria-label="Not now" title="Not now: hide until your next workout" @click.stop="hideSuggestion(x.key)"><Icon name="close" :size="16" /></button>
            </div>
          </TransitionGroup></div>
        </section>
        <!-- previous workout -->
        <section v-if="id === 'previous'">
          <div class="sh"><h2>Previous workout</h2><button class="lnk" @click="router.push('/history?view=list')">All <Icon name="right" :size="14" /></button></div>
          <div v-if="h.last" class="card click" v-bind="link(`/workouts/${h.last.id}`)">
            <div class="row"><span class="dot" :style="h.last.color ? { background: h.last.color } : undefined" /><b class="grow">{{ h.last.name }}</b><span class="tiny">{{ fmt.date(h.last.startedAt, { weekday: "short", day: "numeric", month: "short" }) }}</span></div>
            <div class="grid g3 keep" style="margin-top:12px;gap:8px">
              <div><div class="lbl">Duration</div><div style="font-weight:600;font-size:18px">{{ fmt.dur(h.last.durationS, true) }}</div></div>
              <div><div class="lbl">Sets</div><div style="font-weight:600;font-size:18px">{{ h.last.setCount }}</div></div>
              <div><div class="lbl">Volume</div><div style="font-weight:600;font-size:18px">{{ fmt.vol(h.last.volumeKg) }}</div></div>
            </div>
            <div class="tiny" style="margin-top:8px">{{ h.daysSinceLast === 0 ? "Today" : h.daysSinceLast === 1 ? "Yesterday" : `${h.daysSinceLast} days ago` }}</div>
          </div>
          <div v-else class="card empty" style="padding:calc(var(--cpy) * 1.3) var(--cpx)"><b>No workouts yet</b>Your last workout will show here.<br /><button class="btn tonal" @click="startOpen = true">Start one</button></div>
        </section>

      <section v-if="id === 'goals'">
        <div class="sh"><h2>Goals</h2><button class="lnk" @click="router.push('/goals')">All <Icon name="right" :size="14" /></button></div>
        <div v-if="h.goals.length" class="grid g3"><GoalCard v-for="g in h.goals" :key="g.id" :goal="g" compact v-bind="link(() => (goalOpen = g.id))" /></div>
        <div v-else class="card empty sm"><b>No goals yet</b>Set one for a lift, a routine, a muscle group, walking or your body.<br /><button class="btn tonal" @click="router.push('/goals?new=1')">Set a goal</button></div>
      </section>

      <!-- optional cards -->
        <section v-if="id === 'volume'"><div class="sh"><h2>Volume this week</h2><button class="lnk" @click="router.push('/stats')">Stats <Icon name="right" :size="14" /></button></div><div class="card stat click" v-bind="link('/stats')"><div class="val">{{ fmt.vol(tw.volumeKg) }}</div><div class="sub">{{ delta(tw.volumeKg, lw.volumeKg) >= 0 ? "+" : "" }}{{ delta(tw.volumeKg, lw.volumeKg) }}% vs last week</div><Sparkline :values="weeks.map((w) => w.volumeKg)" /></div></section>
        <section v-if="id === 'walking'"><div class="sh"><h2>Walking</h2><button class="lnk" @click="activitySheet = { type: 'walk' }">Add <Icon name="plus" :size="14" /></button></div><div class="card stat click" v-bind="link('/stats?tab=activities')"><div class="val">{{ fmt.dist(tw.walkM, 1) }}</div><div class="sub">this week · {{ fmt.dist(lw.walkM, 1) }} last week</div><Sparkline :values="weeks.map((w) => w.walkM)" /></div></section>
        <section v-if="id === 'bodyweight'"><div class="sh"><h2>Body weight</h2><button class="lnk" @click="bodySheet = true">Log <Icon name="plus" :size="14" /></button></div>
          <div class="card stat click" v-bind="link('/body')"><div class="val">{{ lastBw ? fmt.w(lastBw.value) : "-" }}<small>{{ fmt.wu }}</small></div><div class="sub">{{ lastBw ? ago(lastBw.at) : "Not logged yet" }}</div><Sparkline v-if="bwTrend.length > 1" :values="bwTrend" /></div></section>
        <section v-if="id === 'daily'"><div class="sh"><h2>Today</h2><button class="lnk" @click="dailySheet = true">Past days <Icon name="right" :size="14" /></button></div><div class="card"><DailyLog /></div></section>
        <section v-if="id === 'reminders'"><div class="sh"><h2>Reminders</h2></div>
          <div class="card"><div v-if="!h.reminders.length" class="tiny">No reminders waiting.</div><div class="list"><div v-for="r in h.reminders" :key="r.id" class="li click" v-bind="link(reminderPlace(r))"><Icon name="bell" :size="18" class="acc" /><div class="grow"><div class="t">{{ r.body }}</div><div class="s">{{ r.targetName }}</div></div></div></div></div></section>
        <section v-if="id === 'feed'"><div class="sh"><h2>Recent activity</h2><button class="lnk" @click="router.push('/history?view=list')">All <Icon name="right" :size="14" /></button></div>
          <div class="card"><div class="list"><div v-for="x in h.feed" :key="x.id" class="li click" v-bind="link(x.kind === 'workout' ? `/workouts/${x.id}` : `/activities/${x.id}`)">
            <Icon :name="x.kind === 'workout' ? 'dumbbell' : x.type === 'walk' ? 'walk' : 'activity'" :size="18" class="muted" /><div class="grow"><div class="t">{{ x.name || x.type }}</div><div class="s">{{ fmt.date(x.startedAt, { weekday: "short", day: "numeric", month: "short" }) }}</div></div>
            <span class="tiny">{{ x.kind === "workout" ? fmt.dur(x.durationS, true) : x.distanceM ? fmt.dist(x.distanceM, 1) : fmt.dur(x.durationS, true) }}</span></div></div></div></section>
        <section v-if="id === 'muscles'"><div class="sh"><h2>Sets per muscle · 7 days</h2><button class="lnk" @click="router.push('/stats?tab=muscles')">Stats <Icon name="right" :size="14" /></button></div>
          <div class="card click" v-bind="link('/stats?tab=muscles')"><div class="row" style="align-items:flex-start"><BodyMap :values="h.muscles7" :height="160" legend /><div class="grow col" style="gap:4px"><div v-for="[m, n] in Object.entries(h.muscles7).sort((a: any, b: any) => b[1] - a[1]).slice(0, 7)" :key="m" class="row tiny"><span class="grow" style="color:var(--tx)">{{ muscleName(m) }}</span>{{ Math.round(Number(n) * 10) / 10 }}</div></div></div></div></section>
        <section v-if="id === 'achievements'"><div class="sh"><h2>Achievements</h2><button class="lnk" @click="router.push('/stats?tab=achievements')">All <Icon name="right" :size="14" /></button></div>
          <div class="card click" v-bind="link('/stats?tab=achievements')">
            <div v-if="!ach.data.value" class="tiny">Loading…</div>
            <div v-else-if="!achRecent.length" class="tiny">Finish your first workout for your first one.</div>
            <div class="list"><div v-for="a in achRecent" :key="a.id" class="li"><Icon name="trophy" :size="18" class="ach-on" /><div class="grow"><div class="t">{{ a.name }}</div><div class="s">{{ fmt.date(a.reachedAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div></div></div>
            <div v-if="achNext" class="ach-next"><div class="row tiny"><span class="grow">Next: <b class="ach-nm">{{ achNext.name }}</b></span>{{ achAmount(achNext.unit, achNext.value) }} / {{ achAmount(achNext.unit, achNext.target) }}</div>
              <div class="pbar" style="margin-top:6px;height:5px"><i :style="{ width: Math.min(100, (achNext.value / achNext.target) * 100) + '%' }" /></div></div>
          </div></section>
      </template>
      </div>
      </div>

      <div class="center" style="margin-top:calc(var(--spg) * 1.75)"><button class="qb" @click="custom = true"><Icon name="layers" :size="16" />Customise home</button></div>
    </template>
    <div v-else-if="home.isLoading.value" class="grid g4"><div v-for="i in 4" :key="i" class="card stat" style="opacity:.4" /></div>
    <div v-else class="card empty"><Icon name="info" :size="34" /><b>Couldn't load Home</b>{{ (home.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="home.refetch()">Try again</button></div>

    <ScheduleEditor v-if="planOpen" :schedule="planOpen" @close="planOpen = null" />
    <GoalSheet v-if="goalOpen" :id="goalOpen" @close="goalOpen = null" @edit="(g) => router.push(`/goals?edit=${g.id}`)" @status="goalStatus" @delete="goalDelete" />
    <Sheet v-if="custom" title="Customise home" @close="custom = false">
      <p class="tiny hgap">What Home shows, top to bottom. Blocks of the same size next to each other share a row.</p>
      <TransitionGroup name="mv" tag="div">
        <div v-for="(x, i) in listed" :key="x.id" class="tgl">
          <label class="grow hsw" :for="`hs-${x.id}`"><div class="t">{{ NAMES[x.id] ?? x.id }}</div></label>
          <button class="ib sm plain" :class="{ end: i === 0 }" :aria-disabled="i === 0" :aria-label="`Move ${NAMES[x.id] ?? x.id} up`" :title="`Move ${NAMES[x.id] ?? x.id} up`" @click="moveSection(x.id, -1)"><Icon name="up" :size="18" /></button>
          <button class="ib sm plain" :class="{ end: i === listed.length - 1 }" :aria-disabled="i === listed.length - 1" :aria-label="`Move ${NAMES[x.id] ?? x.id} down`" :title="`Move ${NAMES[x.id] ?? x.id} down`" @click="moveSection(x.id, 1)"><Icon name="down" :size="18" /></button>
          <span class="tg"><input :id="`hs-${x.id}`" type="checkbox" :checked="x.on" @change="setSection(x.id, ($event.target as HTMLInputElement).checked)" /></span>
        </div>
      </TransitionGroup>
      <h2 class="spt">Goals at the top</h2>
      <p class="tiny hgap">Each one gets its own block, in the order listed. Weekly and monthly goals can bring their streak along.</p>
      <TransitionGroup name="mv" tag="div">
        <!-- the key sits on the template only: Vue refuses keys on its children (the build fails), and TransitionGroup
             keys each child from the template's key plus its place -->
        <template v-for="g in goalRows" :key="g.id">
          <div class="tgl">
            <label class="grow hsw" :for="`hg-${g.id}`"><div><div class="t">{{ g.title }}</div><div class="s">{{ periodLabel(g, s) }}</div></div></label>
            <template v-if="onHome(s, g.id)">
              <button class="ib sm plain" :class="{ end: homePicked[0]?.id === g.id }" :aria-disabled="homePicked[0]?.id === g.id" :aria-label="`Move ${g.title} up`" :title="`Move ${g.title} up`" @click="moveHomeGoal(g.id, -1)"><Icon name="up" :size="18" /></button>
              <button class="ib sm plain" :class="{ end: homePicked.at(-1)?.id === g.id }" :aria-disabled="homePicked.at(-1)?.id === g.id" :aria-label="`Move ${g.title} down`" :title="`Move ${g.title} down`" @click="moveHomeGoal(g.id, 1)"><Icon name="down" :size="18" /></button>
            </template>
            <span class="tg"><input :id="`hg-${g.id}`" type="checkbox" :checked="onHome(s, g.id)" @change="toggleHomeGoal(s, g)" /></span>
          </div>
          <label v-if="onHome(s, g.id) && g.period !== 'once'" class="tgl sub-t"><div class="grow"><div class="t">With its streak</div></div><span class="tg"><input type="checkbox" :aria-label="`${g.title}: with its streak`" :checked="streakOnHome(s, g.id)" @change="setHomeStreak(s, g.id, ($event.target as HTMLInputElement).checked)" /></span></label>
        </template>
      </TransitionGroup>
      <div v-if="!pickable.length" class="tiny">No goals yet. <button class="lnk" @click="custom = false; router.push('/goals?new=1')">Set one</button></div>
    </Sheet>
  </div>
</template>

<style scoped>
/* a goal block's ring shows progress; once it's reached it becomes the done set's tick (.tick.on in app.css: green,
   corners from the theme, pops in), green like a reached goal on the Goals page. Reached blocks are hero, so a thin
   ring in the hero's text colour keeps the tick apart from the card whatever the accent and mode. */
.wk-ring, .wk-tick { margin-inline-start: auto; flex: none; }
.wk-ring { display: grid; place-items: center; width: 40px; height: 40px; }
.wk-tick { margin-block: 0; cursor: inherit; }
.hero .wk-tick { box-shadow: 0 0 0 1.5px var(--onc); }
/* with its streak: main part and streak side by side, split by a faint line */
.gblock.wide { grid-column: span 2; flex-direction: row; gap: var(--cpx); }
.gb-main { flex: 1.3; min-width: 0; display: flex; flex-direction: column; }
.gb-run { flex: 1; min-width: 0; display: flex; flex-direction: column; padding-inline-start: var(--cpx); border-inline-start: 1px solid var(--ol); }
.hero .gb-run { border-color: color-mix(in srgb, var(--onc) 18%, transparent); }
.gb-run .val small { white-space: nowrap; }
.gb-dots { display: flex; gap: 4px; margin-top: auto; padding-top: var(--hg); }
.gb-dots i { flex: 1; max-width: 18px; height: 6px; border-radius: 3px; background: color-mix(in srgb, currentColor 14%, transparent); }
.gb-dots i.on { background: var(--acc); }
.hero .gb-dots i.on { background: var(--onc); }
.lbl .ellipsis { min-width: 0; }
/* a goal's streak switch sits under it, indented, so the pair reads as one */
.tgl.sub-t { padding-inline-start: calc(var(--cpx) + var(--hg)); }
.ach-on { color: var(--warn); }
/* the program card's lines (name, progress, next, behind note) are spaced by one gap */
.prog { display: flex; flex-direction: column; gap: var(--hg); }
.prog .pn { display: block; font-size: 16px; }
.prog .pbar { height: 6px; }
.prog .mchip { margin-inline-start: 8px; }
.prog.dl { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acc) 35%, transparent); }
.wn { color: var(--warn); }
.ach-next { margin-top: 12px; }
.welcome { margin-bottom: var(--spg); }
.welcome .qb { margin-inline: auto; }
/* a row of stat blocks after a section is parted from it like a section heading would be */
.hrun + .hrun.st { margin-top: calc(var(--spg) * 1.75); }
/* the first heading under the page title sits flush, like the old .sh.first (also the second block of a half-width first run) */
.hruns > .hrun:first-child > :first-child > .sh:first-child,
.hruns > .hrun.g2:first-child > :nth-child(2) > .sh:first-child { margin-top: 0; }
/* the name is the switch's label; the arrows sit beside it, not inside, so the switch is named by its section only */
.hsw { cursor: pointer; align-self: stretch; display: flex; align-items: center; }
.ach-nm { color: var(--tx); font-weight: 600; }
</style>
