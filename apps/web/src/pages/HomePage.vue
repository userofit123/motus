<script setup lang="ts">
// Home (requirement 9): one board of blocks in your order (Edit home, from the ⋮ menu). Today leads by default; blocks are half a row on
// a computer (a whole row on the phone) or the whole row; a half-size block left alone in its row takes the whole row. A block with nothing to say right now
// (no reminder waiting, no goal due soon, no program running) stays away until it has; feature blocks need their feature.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { num, percentChange, weekStartDate, orderGoals, dismissalPatch, HOME_BLOCKS, GLANCE_RINGS, ageOf, stepsTarget, sleepRange, type Goal, type HomeData, type HomeSuggestion, type HomePlan, type HomeRecord, type HomeGroup, type HomeWeek, type ScoreKey, type GlanceRing } from "@motus/shared";
import { useCalendar, useHome, useSettings, saveSettings, useAchievements, useGoals, useHealthAvailable, useHealthDay, useReadiness, useHealthScores, useSleep, useDaily, useTypeName, loaded, type HealthAvailable, type ReadinessPart, type ReadinessBuilding } from "../api/queries";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import { confirm } from "../core/ask";
import { toast } from "../core/toast";
import { onHome, streakOnHome, toggleHomeGoal, setHomeStreak, periodWord, goalSub, periodDots, recurring, goalValue, goalUnit, goalTarget, goalIcon, goalSide, goalTrend, hasTrend } from "../core/goals";
import { asleepMin, hasStages, isFull, mins, nightRingLine, SHORT_WHY } from "../core/sleep";
import NightRing from "../components/stats/NightRing.vue";
import ScoreHead from "../components/stats/ScoreHead.vue";
import { SCORE_META, scoreRow, scoreWhy } from "../core/scores";
import SourceRow from "../components/learn/SourceRow.vue";
import { READY_PART, readinessRows, nightWhen } from "../core/readiness";
import { useFmt, unitOf, ago, goalLabel, localYmd, tomorrowYmd, hrPart } from "../core/format";
import { reminderText } from "../core/reminderText";
import { startPlan, unplanItems } from "../components/home/planActions";
import { startOpen, dailySheet, reminderView } from "../core/ui";
import { isPhone } from "../core/device";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import MuscleFig from "../components/MuscleFig.vue";
import Sparkline from "../components/Sparkline.vue";
import Ring from "../components/Ring.vue";
import BodyMap from "../components/BodyMap.vue";
import DailyLog from "../components/DailyLog.vue";
import Sheet from "../components/Sheet.vue";
import ReorderSheet from "../components/ReorderSheet.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";
import GoalSheet from "../components/GoalSheet.vue";
import SessionStats from "../components/SessionStats.vue";
import DotLine from "../components/DotLine.vue";
import TodayHero from "../components/home/TodayHero.vue";
import CalendarDay, { calendarDays } from "../components/CalendarDay.vue";
import SuggestionRow from "../components/home/SuggestionRow.vue";
import StageBar from "../components/stats/StageBar.vue";
import { adviceWord, useDevice } from "../native/health";

const router = useRouter();
const home = useHome();
const s = useSettings();
const dev = useDevice();
const fmt = useFmt();
const h = computed(() => home.data.value);

const today = localYmd(new Date());
// nothing made or done yet: Today says how to begin and the summing-up blocks wait
const fresh = computed(() => !!h.value && !h.value.routineCount && !h.value.totalWorkouts && !h.value.activityCount && !(s.value.features.programs && h.value.programs?.length));

// ---- the blocks: name and what it shows (Edit home), icon, and size: m half the row (all of it on the phone), l the whole row
type Size = "m" | "l";
const META: Record<string, { name: string; desc: string; icon: string; size: Size }> = {
  today: { name: "Today", desc: "What to do today and this week's training days", icon: "play", size: "l" },
  week: { name: "This week", desc: "Workouts, time and volume against the same days last week", icon: "stats", size: "m" },
  pinned: { name: "Pinned goals", desc: "The goals you made and pinned, each as its own block", icon: "pin", size: "m" },
  dueSoon: { name: "Goals due soon", desc: "Shows when a goal ends within two weeks", icon: "target", size: "m" },
  program: { name: "Your program", desc: "Shows while you follow a program", icon: "routines", size: "m" },
  muscles: { name: "Muscles, last 7 days", desc: "Sets per muscle in the last 7 days, and what's resting", icon: "activity", size: "m" },
  upnext: { name: "Up next", desc: "What's planned for the coming days", icon: "calendar", size: "m" },
  previous: { name: "Last workout", desc: "Your most recent workout", icon: "dumbbell", size: "m" },
  goals: { name: "Goals", desc: "Your first three active goals", icon: "goals", size: "m" },
  suggest: { name: "Suggested", desc: "Routines and muscles that are due, and gaps in your routines", icon: "sparkle", size: "m" },
  reminders: { name: "Reminders", desc: "Shows when a reminder is waiting", icon: "bell", size: "m" },
  records: { name: "Records", desc: "Personal records from the last 30 days", icon: "trophy", size: "m" },
  feed: { name: "Recent activity", desc: "Your latest workouts and activities", icon: "history", size: "m" },
  daily: { name: "Daily log", desc: "Steps, sleep, water and mood you type in for today", icon: "note", size: "m" },
  achievements: { name: "Achievements", desc: "The latest reached and the next one", icon: "star", size: "m" },
  readiness: { name: "Readiness", desc: "How ready you are to train, from last night's sleep and your heart", icon: "gauge", size: "m" },
  // named by the person's device (a getter, so Edit home follows it)
  sleep: { name: "Last night", get desc() { return `Time asleep and its stages, from your ${adviceWord(dev.value)}`; }, icon: "moon", size: "m" },
  heart: { name: "Heart", get desc() { return `Resting heart rate, HRV and today's range, from your ${adviceWord(dev.value)}`; }, icon: "heart", size: "m" },
  activityToday: { name: "Activity today", desc: "Steps, distance and active calories today, and your last 7 days", icon: "steps", size: "m" },
  // Health scores: each only when its data is there (the server leaves a score out without it)
  scoreSleep: { name: "Sleep score", desc: "Your last 7 nights against the sleep guidelines", icon: "moon", size: "m" },
  scoreActivity: { name: "Activity score", desc: "Your last 7 days of active minutes and steps against the guidelines", icon: "moveRing", size: "m" },
  scoreStrength: { name: "Strength score", desc: "Your last 7 days of strength training against the guidelines", icon: "dumbbell", size: "m" },
  // off until picked in Edit home (M-260, M-261)
  quickStats: { name: "Today at a glance", desc: "Rings for today's steps, resting heart rate and active calories, last night's sleep and your readiness", icon: "eye", size: "m" },
  calendarDay: { name: "Your day", get desc() { return `Today as the Calendar shows it: your ${adviceWord(dev.value)}'s numbers, the day by hour, and your workouts and activities`; }, icon: "calendar", size: "l" },
};
// a block whose feature is off is absent everywhere, Edit home included
const FEATURE: Record<string, string> = { program: "programs", daily: "dailyLog", achievements: "achievements", scoreSleep: "scores", scoreActivity: "scores", scoreStrength: "scores" };
// the band's blocks are absent everywhere, Edit home included, until that kind of data has come in (as Stats' Sleep and
// Heart tabs): the Health Connect switch is the Android app's, while the data can reach any device through the server
const HEALTH: Record<string, (a: HealthAvailable) => boolean> = { readiness: (a) => a.sleep || a.heart, sleep: (a) => a.sleep, heart: (a) => a.heart, activityToday: (a) => a.distance || a.calories,
  quickStats: (a) => a.sleep || a.heart || a.distance || a.calories || !!a.steps };
const avail = useHealthAvailable();
const available = (id: string) => !!META[id] && (!FEATURE[id] || !!s.value.features[FEATURE[id]!]) && (!HEALTH[id] || (!!avail.data.value && HEALTH[id]!(avail.data.value)));
const listed = computed(() => s.value.home.blocks.filter((x) => available(x.id)));
const isOn = (id: string) => listed.value.some((x) => x.id === id && x.on);

// ---- data the blocks read (all from /home, except goals and achievements, which have their own queries)
const tw = computed(() => h.value?.thisWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
const lw = computed(() => h.value?.lastWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
const weeks = computed<HomeWeek[]>(() => h.value?.weeks ?? []);
const weekMax = computed(() => Math.max(1, ...weeks.value.map((w) => w.workouts)));
const walked = computed(() => weeks.value.some((w) => w.walkM > 0));

// a stat tile in This week and Previous: label, value with its unit set small, and for This week the change from last week
// up to this point of it (the server's lastWeek), as a percent, the same way Stats shows it (nothing when last week had
// none by now to compare with, so a week just begun says nothing rather than "-100%")
// ("12.3k kg" splits at its space so the number carries the weight and the unit is set small beside it)
interface WStat { note?: string; key: string; icon: string; label: string; value: string; unit: string; delta?: string; last?: string; tone?: string }
const weekStats = computed<WStat[]>(() => {
  const row = (key: string, icon: string, label: string, now: number, last: number, show: (n: number) => string, split = false): WStat => {
    const v = show(now);
    return { key, icon, label, ...(split ? unitOf(v) : { value: v, unit: "" }), delta: percentChange(now, last), last: show(last) };
  };
  const out = [
    row("workouts", "dumbbell", "Workouts", tw.value.workouts, lw.value.workouts, (n) => String(n)),
    row("time", "clock", "Training time", tw.value.timeS, lw.value.timeS, (n) => fmt.value.dur(n, true)),
    row("volume", "layers", "Volume", tw.value.volumeKg, lw.value.volumeKg, (n) => fmt.value.vol(n), true),
  ];
  if (walked.value) out.push({ ...row("walk", "walk", "Distance", tw.value.walkM, lw.value.walkM, (n) => fmt.value.dist(n, 1), true), note: "Walks and hikes" });
  return out;
});
// no stat has a change (first week): the header note and the change column are left out
const anyDelta = computed(() => weekStats.value.some((x) => x.delta));
// the days the change covers, named in the header ("Vs Mon-Thu last week"): a bare "Vs last week" read as the whole of
// last week, so 1 workout against 2 by Thursday looked like a fall from last week's 6 (M-263)
const weekSpan = computed(() => {
  const now = new Date(), day = (d: Date) => fmt.value.date(d, { weekday: "short" });
  const a = day(weekStartDate(now, s.value.firstDay)), b = day(now);
  return a === b ? a : `${a}-${b}`;
});
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
// a goal row's line after its progress: the automatic title of a goal with its own name, else how often it counts
// (nothing for a one-off goal, whose progress says it all); the same in Goals and Goals due soon
const listSub = (g: Goal) => (g.period !== "once" || (g.name && g.summary) ? goalSub(g, s.value) : "");
const reached = (g: Goal) => g.status === "achieved" || !!g.progress?.done;
// "0 of 30 min today" for a daily goal (its own period says the rest); other periods keep their line after the progress
const goalLine = (g: Goal) => {
  const label = goalLabel(g, fmt.value).replace(" / ", " of ");
  return g.period === "day" && g.scope !== "body" ? `${label} today` : [label, listSub(g)].filter(Boolean).join(" · ");
};
// progress.pct is a share (0 to 1); the rows show it as a percent and the bar is that wide
const pct = (g: Goal) => Math.max(0, Math.min(100, (g.progress?.pct ?? 0) * 100));
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

// an activity type's own name ("Walk"), not its id
const typeName = useTypeName();
// records
const KIND: Record<string, string> = { weight: "Heaviest", e1rm: "Best estimated 1RM", volume: "Most volume", reps: "Most reps", duration: "Longest", distance: "Farthest" };
// a sentence: only the first name capitalised ("Best estimated 1RM, most volume, most reps"), as Stats lists them
const kindList = (ks: string[]) => ks.map((k, i) => { const w = KIND[k] ?? k; return i ? w[0]!.toLowerCase() + w.slice(1) : w; }).join(", ");
const recordText = (r: HomeRecord) => r.distanceM ? fmt.value.dist(r.distanceM, 1) : r.durationS && !r.reps ? fmt.value.dur(r.durationS, true)
  : fmt.value.set(r, r.tracking ?? "weight_reps");

// achievements: the latest reached and the closest still to come
const ach = useAchievements(computed(() => isOn("achievements")));
const achSteps = computed(() => (ach.data.value ?? []).flatMap((a: any) => a.steps.map((x: any) => ({ ...x, unit: a.unit, value: a.value }))));
const achRecent = computed(() => achSteps.value.filter((x) => x.reachedAt).sort((a, b) => b.reachedAt.localeCompare(a.reachedAt)).slice(0, 3));
const achNext = computed(() => (ach.data.value ?? []).map((a: any) => a.steps.find((x: any) => !x.reachedAt) && { ...a.steps.find((x: any) => !x.reachedAt), unit: a.unit, value: a.value })
  .filter(Boolean).sort((a: any, b: any) => b.value / b.target - a.value / a.target)[0]);
const achAmount = (unit: string, v: number) => fmt.value.ach(unit, v);

// ---- the band's blocks: today's numbers (/health/day), readiness, and the newest night of the last two days (the band
// often hands over last night only when it next connects, so before then yesterday's night is the newest)
const hDay = useHealthDay(today);
const day = computed(() => hDay.data.value ?? null);
const ready = useReadiness();
// shown with a score, and also while the usual is still being learnt (a new band's first week): then the big value is
// the days the score still waits for, rather than the block being absent until a score comes
const rd = computed(() => { const r = ready.data.value; return r && (r.score != null || r.parts.length + (r.building?.length ?? 0) > 0) ? r : null; });
const yesterday = localYmd(new Date(Date.now() - 86400000));
const nightsQ = useSleep({ from: yesterday, to: tomorrowYmd() });
const night = computed(() => nightsQ.data.value?.nights?.[0] ?? null);
const nightName = computed(() => (night.value?.date === today ? "Last night" : night.value ? fmt.value.date(night.value.date, { weekday: "long" }) : ""));
// a short record (a nap, or a band that slipped off) isn't the night: the block says so plainly, and readiness leaves it out
const nightShort = computed(() => !!night.value && !isFull(night.value));
const READY_TEXT: Record<string, string> = { Ready: "Rested and recovered. A good day to train hard.", Normal: "About your usual. Train as planned.", "Take it easy": "Still recovering. Train lightly today." };
// each part as a report's highlight (rows from core/readiness.ts, as Stats → Scores shows them)
const PART = READY_PART;
// every part in one list, in the order of the score's parts (sleep, resting heart rate, HRV, then the training load);
// the body's parts alone decide when a score comes (the load never waits on a usual of its own)
const BODY: ReadinessBuilding["key"][] = ["sleep", "restingHr", "hrv"];
// readiness leaves out a short record (under MIN_NIGHT_H) as no night; its row says why sleep isn't in the score
const shortPart = computed(() => nightShort.value && !rd.value?.parts.some((x) => x.key === "sleep") && !rd.value?.building?.some((x) => x.key === "sleep")
  ? [{ key: "sleep" as const, icon: PART.sleep.icon, t: PART.sleep.t, s: `${mins(asleepMin(night.value!))} ${nightWhen(night.value!.date, rd.value?.date ?? today, (d) => fmt.value.date(d, { weekday: "long" }))} · too short to count`, r: "Left out", tone: "muted" as const }] : []);
const allParts = computed(() => (rd.value ? readinessRows(rd.value, numOf, shortPart.value) : []));
const hasReadyParts = computed(() => !!rd.value?.parts.some((x) => x.value != null));
// without a score: the score needs two parts with a usual, so it waits on the second most advanced part (a part with a
// usual counts as all its days, one with no readings as none); the ring fills as its days come in
const readyWait = computed(() => {
  const r = rd.value;
  if (!r || r.score != null) return null;
  // an older server sends no building or need: guard them so Home still draws
  const building = r.building ?? [], need = r.need ?? 7;
  const days = BODY.map((k) => (r.parts.some((x) => x.key === k) ? need : building.find((x) => x.key === k)?.days ?? 0)).sort((a, b) => b - a);
  const missing = BODY.filter((k) => !r.parts.some((x) => x.key === k) && !building.some((x) => x.key === k));
  const left = need - days[1]!;
  const known = BODY.filter((k) => !missing.includes(k));
  return { days: days[1]!, need, left,
    text: r.parts.filter((x) => x.key !== "load").length + building.length < 2
      ? `Your score also needs ${missing.map((k) => (k === "hrv" ? PART[k].t : PART[k].t.toLowerCase())).join(" or ")} from your ${adviceWord(dev.value)}.`
      : `Learning your usual ${known.map((k) => PART[k].t.toLowerCase().replace("hrv", "HRV")).join(", ").replace(/, ([^,]*)$/, " and $1")}.` };
});
// ---- the health scores (a feature): each block is one score with its parts, as Stats → Scores shows them
const scoresQ = useHealthScores(computed(() => !!s.value.features.scores));
const SCORE_ID: Record<string, ScoreKey> = { scoreSleep: "sleep", scoreActivity: "activity", scoreStrength: "strength" };
const scoreOf = (id: string) => (SCORE_ID[id] ? scoresQ.data.value?.[SCORE_ID[id]!] ?? null : null);
const numOf = (v: number) => fmt.value.num(v, 0);
// heart: the resting heart rate and HRV of today (else the latest readiness read), each against your usual, and the day's range
const partOf = (k: ReadinessPart["key"]) => ready.data.value?.parts?.find((x) => x.key === k);
const heartStats = computed<WStat[]>(() => {
  const out: WStat[] = [];
  const vital = (key: "restingHr" | "hrv", icon: string, label: string, unit: string) => {
    const p = partOf(key), v = day.value?.[key] ?? p?.value ?? null;
    if (v == null) return;
    const d = p?.baseline != null ? Math.round(v - p.baseline) : null;
    // in the tone readiness gives it, so the same change reads the same in both blocks
    out.push({ key, icon, label, value: String(Math.round(v)), unit, delta: d == null ? "" : `${d < 0 ? "-" : "+"}${Math.abs(d)} ${unit}`,
      tone: p?.effect === "up" ? "pos" : p?.effect === "down" ? "neg" : undefined });
  };
  vital("restingHr", "heartPulse", "Resting heart rate", "bpm");
  vital("hrv", "wave", "HRV", "ms");
  // blood oxygen whole, its percent right after the number, as the Heart tab writes it; it has no usual to compare with
  if (day.value?.spo2 != null) out.push({ key: "spo2", icon: "water", label: "Blood oxygen", value: `${Math.round(day.value.spo2)}%`, unit: "", delta: "" });
  const hr = day.value?.hr;
  if (hr) out.push({ key: "today", icon: "heart", label: "Range today", value: `${Math.round(hr.min)}-${Math.round(hr.max)}`, unit: "bpm", delta: `average ${Math.round(hr.avg)}` });
  return out;
});
const heartDelta = computed(() => heartStats.value.some((x) => (x.key === "restingHr" || x.key === "hrv") && !!x.delta));
// a band reads every few seconds: the day's line is averaged down to at most 96 points, enough for a block's width
const hrLine = computed(() => {
  const xs = day.value?.hr?.series ?? [];
  const step = Math.max(1, Math.ceil(xs.length / 96)), out: number[] = [];
  for (let i = 0; i < xs.length; i += step) { const part = xs.slice(i, i + step); out.push(part.reduce((t, p) => t + p[1], 0) / part.length); }
  return out;
});
// today's steps, distance and active calories as the band counted them, each only when there; the steps against the
// steps goal when there is one. An average daily steps goal's target is a day's steps whatever its period (a weekly or
// monthly one averages its days), so any active one counts, a daily one first
const stepGoal = computed(() => {
  const gs = (allGoals.data.value ?? []).filter((g) => g.status === "active" && g.metric === "steps_avg");
  return gs.find((g) => g.period === "day") ?? gs[0] ?? null;
});
const actStats = computed<WStat[]>(() => {
  const d = day.value, g = stepGoal.value, out: WStat[] = [];
  if (!d) return out;
  if (d.steps != null) out.push({ key: "steps", icon: "steps", label: "Steps", value: fmt.value.num(d.steps, 0), unit: "",
    ...(g ? { delta: `of ${fmt.value.num(g.target, 0)}`, tone: d.steps >= g.target ? "pos" : undefined } : {}) });
  if (d.distanceM) out.push({ key: "dist", icon: "walk", label: "Distance", ...unitOf(fmt.value.dist(d.distanceM, 1)) });
  if (d.activeKcal) out.push({ key: "kcal", icon: "flame", label: "Active calories", value: fmt.value.num(d.activeKcal, 0), unit: "kcal" });
  return out;
});
// the last 7 days' steps as This week's bars, each under its weekday's letter, today in full colour; with a goal its
// target is a dashed line across them and the days that reached it are green
const weekAgo = localYmd(new Date(Date.now() - 6 * 86400000));
const dailyQ = useDaily(weekAgo);
// without today's heart line, the resting heart rate of the last 7 days in its place (days without one left out)
const restLine = computed(() => (dailyQ.data.value ?? []).filter((r) => r.kind === "resting_hr").map((r) => ({ d: String(r.date).slice(0, 10), v: Number(r.value) }))
  .sort((a, b) => a.d.localeCompare(b.d)).map((x) => x.v));
const stepDays = computed(() => Array.from({ length: 7 }, (_, i) => {
  const d = localYmd(new Date(Date.now() - (6 - i) * 86400000));
  const x = (dailyQ.data.value ?? []).find((r) => r.kind === "steps" && String(r.date).slice(0, 10) === d);
  const n = d === today && day.value?.steps != null ? day.value.steps : Number(x?.value ?? 0);
  return { d, n, letter: fmt.value.date(d, { weekday: "narrow" }), ok: !!stepGoal.value && n >= stepGoal.value.target };
}));
// the scale reaches the target too, so its line is always inside the bars' height
const stepMax = computed(() => Math.max(1, stepGoal.value?.target ?? 0, ...stepDays.value.map((x) => x.n)));

// Today at a glance (M-260): today's numbers as rings, each only when there and picked, each opening the Stats tab that shows it. A ring
// fills toward the number it is measured by (your steps goal, else the guideline's steps a day; the guideline's least
// hours asleep for your age; readiness out of 100). Resting heart rate and active calories have no number to reach, so
// theirs is a full ring in a faint accent: a reading, not progress (a bare track would read as nothing done). Names and
// units are the app's own ("Resting heart rate", "57 bpm")
const age = computed(() => ageOf(s.value.profile.birthYear));
const NO_TARGET = "color-mix(in srgb, var(--acc) 30%, transparent)";
// Readiness in full (its score, word and parts) is in Stats → Scores, which is there whenever readiness has a score; while
// its usual is still being learnt there is no score to read yet, so Heart (or Sleep, without heart data) on today, where
// the readings it is learning from come in. The Readiness block and its ring both open this
const readyTo = computed(() => (rd.value?.score != null ? "/stats?tab=scores" : `/stats?tab=${avail.data.value?.heart ? "heart" : "sleep"}&day=${today}`));
interface Glance { key: GlanceRing; icon: string; label: string; value: string; unit?: string; pct: number; done?: boolean; color?: string; aria: string; to: string }
const glance = computed<Glance[]>(() => {
  const d = day.value, out: Glance[] = [], on = (tab: string, at = today) => `/stats?tab=${tab}&day=${at}`;
  if (d?.steps != null) {
    const t = stepGoal.value?.target || stepsTarget(age.value);
    out.push({ key: "steps", icon: "steps", label: "Steps", value: fmt.value.num(d.steps, 0), pct: d.steps / t, done: d.steps >= t,
      aria: `Steps today ${fmt.value.num(d.steps, 0)} of ${fmt.value.num(t, 0)}`, to: on("steps") });
  }
  // without today's own, readiness's (yesterday's when the band hasn't synced today yet): it opens Heart on that day
  const rhr = d?.restingHr ?? partOf("restingHr")?.value ?? null, rhrDay = d?.restingHr == null && partOf("restingHr")?.ago ? yesterday : today;
  if (rhr != null) out.push({ key: "restingHr", icon: "heartPulse", label: "Resting heart rate", value: String(Math.round(rhr)), unit: "bpm", pct: 1, color: NO_TARGET, aria: `Resting heart rate ${Math.round(rhr)} bpm`, to: on("heart", rhrDay) });
  if (night.value?.date === today) {
    const m = asleepMin(night.value), least = sleepRange(age.value)[0] * 60;
    out.push({ key: "sleep", icon: "moon", label: "Last night", value: mins(m), pct: m / least, done: m >= least, aria: `Asleep last night ${mins(m)}`, to: on("sleep", night.value.date) });
  }
  const r = rd.value;
  if (r?.score != null) out.push({ key: "readiness", icon: "gauge", label: "Readiness", value: String(r.score), pct: r.score / 100, color: r.label === "Take it easy" ? "var(--warn)" : undefined,
    aria: `Readiness ${r.score}${r.label ? `, ${r.label}` : ""}`, to: readyTo.value });
  if (d?.activeKcal) out.push({ key: "activeKcal", icon: "flame", label: "Active calories", value: fmt.value.num(d.activeKcal, 0), unit: "kcal", pct: 1, color: NO_TARGET,
    // the Steps tab only exists with steps data, so the Activity today block's rule
    aria: `Active calories today ${fmt.value.num(d.activeKcal, 0)} kcal`, to: avail.data.value?.steps ? on("steps") : "/stats?tab=activities" });
  // only the rings picked in Edit home (all of them unless some were switched off)
  const shown = new Set(s.value.home.glance);
  return out.filter((x) => shown.has(x.key));
});
// Your day (M-261, first named Today's calendar): the Calendar's card for today, read only while the block is on
const todayCal = useCalendar({ from: today, to: today }, computed(() => isOn("calendarDay")));
const todayItems = computed(() => calendarDays(todayCal.data.value, today).get(today) ?? []);

// a dismissed suggestion keeps its routine and its muscles away for a week, so a near-duplicate doesn't take its place;
// the list redraws without waiting for the server
const hideSuggestion = (x: HomeSuggestion) => {
  const gone = (y: HomeSuggestion) => y.hide.some((k) => x.hide.includes(k));
  queryClient.setQueriesData<HomeData>({ queryKey: ["home"] }, (d) => d && { ...d, suggest: d.suggest.filter((y) => !gone(y)) });
  // the ones past their week (and older kinds of key) are cleared in the same save
  saveSettings({ home: { hidden: dismissalPatch(s.value.home.hidden ?? {}, x.hide, new Date()) } }, { quiet: true });
};
// the block shows the first few; "All" opens the rest in a sheet
const SUGGEST_SHOWN = 3;
const suggestAll = ref(false);
const planSuggestion = (routineId: string) => { suggestAll.value = false; planOpen.value = { rule: "once", routineId }; };

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
    case "readiness": return !!rd.value;
    case "sleep": return !!night.value;
    case "heart": return heartStats.value.length > 0;
    case "activityToday": return actStats.value.length > 0;
    case "scoreSleep": case "scoreActivity": case "scoreStrength": return !!scoreOf(id);
    case "quickStats": return glance.value.length > 0;
    // switched on, it always shows: an empty day says so in the Calendar's words, so the block never looks missing
    case "calendarDay": return true;
    default: return true;
  }
};
const blocks = computed(() => (h.value ? listed.value.filter((x) => x.on && shows(x.id)).map((x) => x.id) : []));

// every block opens where its numbers come from: a click, or Enter on a block reached with Tab
const go = (to: string | (() => void)) => (typeof to === "string" ? router.push(to) : to());
const link = (to: string | (() => void)) => ({ role: "button", tabindex: 0, onClick: () => go(to),
  onKeydown: (e: KeyboardEvent) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); go(to); } } });

// ---- a goal opened from Home
const goalOpen = ref<string | null>(null);
async function goalStatus(g: Goal, status: string) { await api.put(`/goals/${g.id}`, { status }); invalidate(["goals", "home"]); goalOpen.value = null; toast(status === "archived" ? "Goal archived" : "Goal made active"); }
async function goalDelete(g: Goal) { if (await confirm(`Delete "${g.title}"?`, { ok: "Delete", danger: true })) { await api.del(`/goals/${g.id}`); invalidate(["goals", "home"]); goalOpen.value = null; toast("Goal deleted"); } }

// ---- Edit home: the same board, each block as a tile with its switch and its arrows; Reorder blocks lists them all to drag
const editing = ref(false);
const setOn = (id: string, on: boolean) => saveSettings({ home: { blocks: s.value.home.blocks.map((x) => (x.id === id ? { ...x, on } : x)) } }, { quiet: true });
// Both ways of reordering go through here (M-270): a tile's arrows in Edit home move it one place; Reorder blocks (⋮ menu)
// drags it any distance, as Goals and Routines are reordered. Only the blocks listed move: those of a switched-off feature keep
// their slots in the saved order
const reorderOpen = ref(false);
function moveBlock(from: number, to: number) {
  const ids = listed.value.map((x) => x.id);
  if (to < 0 || to >= ids.length || from === to) return;
  ids.splice(to, 0, ids.splice(from, 1)[0]!);
  let k = 0;
  const byId = new Map(s.value.home.blocks.map((x) => [x.id, x]));
  const all = s.value.home.blocks.map((x) => (available(x.id) ? byId.get(ids[k++]!)! : x));
  saveSettings({ home: { blocks: all } }, { quiet: true });
}
// a half-size tile that would be alone in its row (the last of an odd run before a wide tile or the end) takes the whole row.
// Counted on the tiles as drawn, in order: Pinned goals draws one tile per goal and Your program one per program; in Edit
// home every block is one tile. Worked out here rather than read from the page, so it follows every reorder at once
const solo = computed(() => {
  const tile = (key: string, id: string) => ({ key, wide: META[id]!.size === "l" });
  const tiles = editing.value ? listed.value.map((x) => tile(x.id, x.id))
    : blocks.value.flatMap((id) => id === "pinned" ? pinnedGoals.value.map((g) => tile(`pinned:${g.id}`, id))
      : id === "program" ? (h.value?.programs ?? []).map((p) => tile(`program:${p.id}`, id)) : [tile(id, id)]);
  const out = new Set<string>();
  let run = 0, last = "";
  for (const t of [...tiles, { key: "", wide: true }]) {
    if (!t.wide) { run++; last = t.key; continue; }
    if (run % 2) out.add(last);
    run = 0;
  }
  return out;
});
async function reset() {
  if (await confirm("Put Home back the way it started?", { text: "Blocks go back to their first order and switches, and Today at a glance shows all its rings again. Pinned goals stay.", ok: "Reset" })) saveSettings({ home: { blocks: HOME_BLOCKS, glance: [...GLANCE_RINGS] } });
}

// Today at a glance's rings: which ones it shows, in its fixed order, from its Edit home tile as Pinned goals' are
const glanceOpen = ref(false);
// each line names the number its ring fills toward, the same one the ring uses
const GLANCE_ROWS = computed<Record<GlanceRing, { icon: string; t: string; s: string }>>(() => ({
  steps: { icon: "steps", t: "Steps", s: stepGoal.value?.target ? `Today, against your goal of ${fmt.value.num(stepGoal.value.target, 0)} steps` : `Today, against ${fmt.value.num(stepsTarget(age.value), 0)} steps, the aim for your age` },
  restingHr: { icon: "heartPulse", t: "Resting heart rate", s: "Your latest reading, in bpm" },
  sleep: { icon: "moon", t: "Last night", s: `Time asleep, against at least ${sleepRange(age.value)[0]} hours, the aim for your age` },
  readiness: { icon: "gauge", t: "Readiness", s: "Today's score out of 100" },
  activeKcal: { icon: "flame", t: "Active calories", s: "Today, in kcal" },
}));
const setGlance = (k: GlanceRing, on: boolean) =>
  saveSettings({ home: { glance: GLANCE_RINGS.filter((x) => (x === k ? on : s.value.home.glance.includes(x))) } }, { quiet: true });

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
await loaded(home, ach, avail, hDay, ready, nightsQ, dailyQ, todayCal);
</script>

<template>
  <div class="page">
    <div class="ph">
      <div v-if="editing"><h1>Edit home</h1><div class="sub">Move blocks and choose which show. Changes save as you go.</div></div>
      <div v-else><h1>{{ isPhone ? greeting : "Home" }}</h1><div class="sub">{{ fmt.dateLong(new Date().toISOString()) }}</div></div>
      <div class="acts">
        <template v-if="editing">
          <Menu :items="[{ label: 'Reorder blocks', icon: 'drag', run: () => (reorderOpen = true) }, { label: 'Reset to default', icon: 'refresh', run: reset }]" />
          <button class="btn keep" @click="editing = false"><Icon name="check" :size="18" />Done</button>
        </template>
        <Menu v-else :items="[{ label: 'Edit home', icon: 'edit', run: () => (editing = true) }, { label: 'Reorder blocks', icon: 'drag', run: () => (reorderOpen = true) }, { label: 'Pinned goals', icon: 'pin', run: () => (pinOpen = true) }]" />
      </div>
    </div>

    <!-- Edit home: every block there is, in order, at its own size so the layout reads as it will -->
    <TransitionGroup v-if="editing" name="mv" tag="div" class="hgrid">
      <div v-for="(x, i) in listed" :key="x.id" class="card etile" :class="[META[x.id]!.size === 'l' ? 'sz-l' : 'sz-m', { off: !x.on }]" :data-solo="solo.has(x.id) || undefined">
        <!-- the name and its switch on one row (label left, control right); the arrows have their own row at the foot, so a
             half-width tile has room for the switch in a narrow window -->
        <div class="ch">
          <span class="bi"><Icon :name="META[x.id]!.icon" :size="15" /></span>
          <label class="t grow" :for="`hb-${x.id}`">{{ META[x.id]!.name }}</label>
          <span class="tg"><input :id="`hb-${x.id}`" type="checkbox" :checked="x.on" @change="setOn(x.id, ($event.target as HTMLInputElement).checked)" /></span>
        </div>
        <div class="tiny">{{ META[x.id]!.desc }}</div>
        <div class="emv">
          <button v-if="x.id === 'pinned'" class="lnk inl" @click="pinOpen = true">{{ picked.length ? `${picked.length} pinned, change` : "Pin goals" }}</button>
          <button v-else-if="x.id === 'quickStats'" class="lnk inl" @click="glanceOpen = true">{{ s.home.glance.length ? (s.home.glance.length === GLANCE_RINGS.length ? `All ${GLANCE_RINGS.length} rings, change` : `${s.home.glance.length} of ${GLANCE_RINGS.length} rings, change`) : "Choose rings" }}</button>
          <span class="grow" />
          <button class="ib sm plain" :class="{ end: i === 0 }" :aria-disabled="i === 0" :aria-label="`Move ${META[x.id]!.name} earlier`" :title="`Move ${META[x.id]!.name} earlier`" @click="moveBlock(i, i - 1)"><Icon name="up" :size="18" /></button>
          <button class="ib sm plain" :class="{ end: i === listed.length - 1 }" :aria-disabled="i === listed.length - 1" :aria-label="`Move ${META[x.id]!.name} later`" :title="`Move ${META[x.id]!.name} later`" @click="moveBlock(i, i + 1)"><Icon name="down" :size="18" /></button>
        </div>
      </div>
    </TransitionGroup>

    <div v-else-if="h" class="hgrid">
      <template v-for="id in blocks" :key="id">
        <TodayHero v-if="id === 'today'" :h="h" :fresh="fresh" />

        <!-- this week against last week, and workouts per week over eight weeks -->
        <div v-else-if="id === 'week'" class="card hb wkc sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats')">
          <div class="ch"><span class="bi"><Icon name="stats" :size="15" /></span><span class="t grow">This week</span><span v-if="anyDelta" class="tiny">Vs {{ weekSpan }} last week</span></div>
          <div class="wstats" :class="{ n4: weekStats.length === 4, plain: !anyDelta }">
            <div v-for="x in weekStats" :key="x.key" class="ws" role="group" :aria-label="`${[x.label, x.value, x.unit, x.delta].filter(Boolean).join(' ')}, by this time last week: ${x.last}`" :title="`${x.note ? x.note + ' · ' : ''}By this time last week: ${x.last}`">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
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
          <div v-for="g in pinnedGoals" :key="g.id" class="card gtile sz-m click" :class="{ hero: reached(g) }" :data-solo="solo.has(`pinned:${g.id}`) || undefined" v-bind="link(() => (goalOpen = g.id))">
            <div class="gmain">
              <div class="ch"><span class="bi"><Icon :name="goalIcon(g)" :size="15" /></span><span class="t grow ellipsis">{{ g.title }}</span></div>
              <div class="row">
                <!-- like the stat tiles: the current number big with its unit small, the target on the tiny line -->
                <div class="big grow">{{ goalValue(g, g.progress?.current ?? 0, fmt) }}<small>{{ goalUnit(g, g.progress?.current ?? 0, fmt) }}</small></div>
                <!-- the ring and its check keep the accent gradient on a reached (accent) tile too, as on the goal cards -->
                <Ring :pct="g.progress?.pct ?? 0" :size="40" :done="reached(g)" />
              </div>
              <div class="tiny">{{ goalTarget(g, fmt) }}</div>
            </div>
            <div class="grun">
              <div class="ch"><span class="bi"><Icon :name="goalSide(g, fmt).icon" :size="15" /></span><span class="t">{{ goalSide(g, fmt).label }}</span></div>
              <div class="row"><div class="big grow">{{ goalSide(g, fmt).big }}<small v-if="goalSide(g, fmt).small">{{ goalSide(g, fmt).small }}</small></div></div>
              <div class="tiny">{{ goalSide(g, fmt).sub }}</div>
              <!-- the bottom element sits in one fixed box: the last eight periods as dots, oldest first, filled when reached;
                   or a one-off goal's trend -->
              <div class="gfoot" aria-hidden="true">
                <div v-if="recurring(g)" class="gdots"><i v-for="(on, k) in periodDots(g)" :key="k" :class="{ on }" /></div>
                <Sparkline v-else-if="hasTrend(g)" :values="goalTrend(g)" :color="reached(g) ? 'var(--onc)' : undefined" />
                <div v-else class="gflat" />
              </div>
            </div>
          </div>
        </div>

        <!-- goals ending within two weeks that aren't reached yet -->
        <div v-else-if="id === 'dueSoon'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi warn"><Icon name="target" :size="15" /></span><span class="t grow">Goals due soon</span></div>
          <div class="glist">
            <div v-for="g in dueSoon" :key="g.id" class="grow-row click" v-bind="link(() => (goalOpen = g.id))">
              <div class="row"><b class="grow ellipsis">{{ g.title }}</b><span class="tiny due">{{ dueText(g) }}</span></div>
              <div class="pbar"><i :style="{ width: pct(g) + '%' }" /></div>
              <div class="tiny ellipsis">{{ goalLine(g) }}</div>
            </div>
          </div>
        </div>

        <!-- the program you're following: where you are and the workout it says to do next -->
        <template v-else-if="id === 'program'">
          <div v-for="p in h.programs" :key="p.id" class="card hb sz-m click prog has-cover" :class="{ dl: p.next?.deload }" :data-solo="solo.has(`program:${p.id}`) || undefined">
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
        <div v-else-if="id === 'muscles'" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats?tab=muscles')">
          <div class="ch"><span class="bi"><Icon name="activity" :size="15" /></span><span class="t grow">Muscles, last 7 days</span></div>
          <div class="mfig">
            <BodyMap class="rbody" :values="{}" :highlight="h.main7" :secondary="h.helpers7" />
            <div class="grow mside">
              <template v-if="worked">
                <div class="big">{{ worked }}<small>of {{ groups.length }} muscle groups</small></div>
                <div class="tiny">trained in the last 7 days</div>
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
        <div v-else-if="id === 'upnext'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
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
        <div v-else-if="id === 'previous' && h.last" class="card hb wkc sz-m click has-cover" :data-solo="solo.has(id) || undefined">
          <button class="cover" :aria-label="`Open ${h.last.name}`" @click="go(`/workouts/${h.last.id}`)" />
          <div class="ch"><span class="bi"><Icon name="dumbbell" :size="15" /></span><span class="t">Last workout</span>
            <span class="lname"><span class="lnm ellipsis">{{ h.last.name }}</span><span class="sep">·</span><span class="lday">{{ when(h.last.startedAt) }}</span></span></div>
          <div class="wstats n4 plain">
            <div v-for="x in lastStats" :key="x.key" class="ws">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
            </div>
          </div>
        </div>

        <!-- the first active goals -->
        <div v-else-if="id === 'goals'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="goals" :size="15" /></span><span class="t grow">Goals</span><button class="lnk" @click="router.push('/goals')">All</button></div>
          <div v-if="!h.goals.length" class="tiny">Set one for a lift, a routine, a muscle group, walking or your body. <button class="lnk inl" @click="router.push('/goals?new=1')">Set a goal</button></div>
          <div v-else class="glist">
            <div v-for="g in h.goals" :key="g.id" class="grow-row click" v-bind="link(() => (goalOpen = g.id))">
              <div class="row"><b class="grow ellipsis">{{ g.title }}</b><span class="tiny" :class="{ pos: g.progress?.done }">{{ g.progress?.done ? "Reached" : `${Math.round(pct(g))}%` }}</span></div>
              <div class="pbar" :class="{ ok: g.progress?.done }"><i :style="{ width: pct(g) + '%' }" /></div>
              <div class="tiny ellipsis">{{ goalLine(g) }}</div>
            </div>
          </div>
        </div>

        <!-- suggestions (rules in shared suggest.ts): the first few, and "All" for the rest in a sheet -->
        <div v-else-if="id === 'suggest'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="sparkle" :size="15" /></span><span class="t grow">Suggested</span><button v-if="h.suggest.length > SUGGEST_SHOWN" class="lnk" @click="suggestAll = true">All</button></div>
          <TransitionGroup name="mv" tag="div" class="list">
            <SuggestionRow v-for="x in h.suggest.slice(0, SUGGEST_SHOWN)" :key="x.key" :x="x" @plan="planSuggestion" @hide="hideSuggestion" />
          </TransitionGroup>
        </div>

        <div v-else-if="id === 'reminders'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="bell" :size="15" /></span><span class="t grow">Reminders</span></div>
          <div class="list"><div v-for="r in h.reminders" :key="r.id" class="li click" v-bind="link(() => (reminderView = { r }))"><div class="grow"><div class="t">{{ reminderText(r, fmt) }}</div><DotLine class="s" :parts="[r.targetName, ...((s) => (s[0] ? [`Set ${s[0]}`, ...s.slice(1)] : []))(fmt.stampParts(r.createdAt))].filter((p): p is string => !!p)" /></div><Icon name="right" :size="16" class="muted" /></div></div>
        </div>

        <div v-else-if="id === 'records'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="trophy" :size="15" /></span><span class="t grow">Records</span><span class="tiny">Last 30 days</span></div>
          <div class="list">
            <div v-for="(r, i) in h.records" :key="`${r.workoutId}-${r.exerciseId}-${r.kinds.join()}-${i}`" class="li click" v-bind="link(`/exercises/${r.exerciseId}`)">
              <div class="grow"><div class="t">{{ r.name }}</div><div class="s">{{ kindList(r.kinds) }} · {{ fmt.date(r.at, { day: "numeric", month: "short" }) }}</div></div>
              <b class="rv">{{ recordText(r) }}</b>
            </div>
          </div>
        </div>

        <div v-else-if="id === 'feed'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="history" :size="15" /></span><span class="t grow">Recent activity</span><button class="lnk" @click="router.push('/history?view=list')">All</button></div>
          <div class="list"><div v-for="x in h.feed.slice(0, 5)" :key="x.id" class="li click" v-bind="link(x.kind === 'workout' ? `/workouts/${x.id}` : `/activities/${x.id}`)">
            <Icon :name="x.kind === 'workout' ? 'dumbbell' : x.type === 'walk' ? 'walk' : 'activity'" :size="18" class="muted" /><div class="grow"><div class="t">{{ x.kind === "workout" ? x.name : x.name || typeName(x.type) }}</div><DotLine class="s" :parts="[fmt.date(x.startedAt, { weekday: 'short', day: 'numeric', month: 'short' }), hrPart(x)].filter((p) => p != null)" /></div>
            <SessionStats :x="x" /></div></div>
        </div>

        <div v-else-if="id === 'daily'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="note" :size="15" /></span><span class="t grow">Daily log</span><button class="lnk" @click="dailySheet = true">Other days</button></div>
          <DailyLog />
        </div>

        <!-- readiness: the score as a pinned goal's value and ring, what it means, then what made it as a report's highlights;
             while the usual is being learnt, the days the score waits for in their place, and each part's days so far -->
        <div v-else-if="id === 'readiness' && rd" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link(readyTo)">
          <div class="ch"><span class="bi"><Icon name="gauge" :size="15" /></span><span class="t grow">Readiness</span><span v-if="hasReadyParts && !readyWait" class="tiny">Vs your 28-day usual</span></div>
          <div v-if="readyWait" class="row"><div class="big grow">{{ readyWait.left }}<small>{{ readyWait.left === 1 ? "day" : "days" }} until your score</small></div><Ring :pct="readyWait.days / readyWait.need" :size="40" /></div>
          <ScoreHead v-else :score="rd.score!" :label="rd.label" :warn="rd.label === 'Take it easy'" />
          <div v-if="readyWait" class="tiny">{{ readyWait.text }}</div>
          <div v-else-if="rd.label" class="tiny">{{ rd.why ?? READY_TEXT[rd.label] }}</div>
          <div v-if="allParts.length" class="list hhl">
            <div v-for="x in allParts" :key="x.key" class="li">
              <Icon :name="x.icon" :size="18" class="muted" />
              <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
              <b class="r rv" :class="x.tone">{{ x.r }}</b>
            </div>
          </div>
        </div>

        <!-- a health score: as Readiness, the score with its word and ring, the line that says why, then its parts as a
             report's highlights, and what it is based on; it opens Stats → Scores -->
        <div v-else-if="SCORE_ID[id] && scoreOf(id)" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats?tab=scores')">
          <div class="ch"><span class="bi"><Icon :name="SCORE_META[SCORE_ID[id]!].icon" :size="15" /></span><span class="t grow">{{ SCORE_META[SCORE_ID[id]!].name }}</span><span class="tiny">{{ SCORE_META[SCORE_ID[id]!].span }}</span></div>
          <ScoreHead :score="scoreOf(id)!.score" :label="scoreOf(id)!.label" :warn="scoreOf(id)!.label === 'Low'" />
          <div class="tiny">{{ scoreWhy(scoreOf(id)!, numOf) }}</div>
          <div class="list hhl">
            <div v-for="x in scoreOf(id)!.parts.map((p) => scoreRow(p, numOf))" :key="x.key" class="li">
              <Icon :name="x.icon" :size="18" class="muted" />
              <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
              <b class="r rv" :class="x.tone">{{ x.r }}</b>
            </div>
            <SourceRow :topic="SCORE_META[SCORE_ID[id]!].lesson" :sources="SCORE_META[SCORE_ID[id]!].sources" />
          </div>
        </div>

        <!-- the newest night: time asleep with the share of the time tracked asleep as its ring (NightRing, as Stats → Sleep's night), then its stages; it
             opens that night there. The ring is the size of the score blocks' and, like theirs, holds no number; the line under it
             gives its percent, so it doesn't read as a score (M-264), even for a nap, whose
             reason for being left out follows as on Stats → Sleep's night -->
        <div v-else-if="id === 'sleep' && night" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link(`/stats?tab=sleep&day=${night.date}`)">
          <div class="ch"><span class="bi"><Icon name="moon" :size="15" /></span><span class="t grow">{{ nightName }}</span><span class="tiny">{{ fmt.time(night.startAt) }}-{{ fmt.time(night.endAt) }}</span></div>
          <div class="row"><div class="big grow">{{ mins(asleepMin(night)) }}<small>{{ nightShort ? "short record" : "asleep" }}</small></div><NightRing :night="night" :size="40" /></div>
          <div class="tiny">{{ nightRingLine(night) }}</div>
          <div v-if="nightShort" class="tiny">{{ SHORT_WHY }}</div>
          <div v-if="hasStages(night) || night.awakeMin" class="hstages"><StageBar :night="night" /></div>
        </div>

        <!-- heart: resting heart rate and HRV against your usual, blood oxygen and today's range with its average as This
             week's tiles, each only when there, then today's line filling the rest of the block -->
        <div v-else-if="id === 'heart'" class="card hb wkc sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link(`/stats?tab=heart&day=${today}`)">
          <div class="ch"><span class="bi"><Icon name="heart" :size="15" /></span><span class="t grow">Heart</span><span v-if="heartDelta" class="tiny">Vs your 28-day usual</span></div>
          <div class="wstats hrows" :class="{ n4: heartStats.length === 4 }">
            <div v-for="x in heartStats" :key="x.key" class="ws" role="group" :aria-label="[x.label, x.value, x.unit, x.delta].filter(Boolean).join(' ')">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
              <div class="wd" :class="x.tone">{{ x.delta }}</div>
            </div>
          </div>
          <div v-if="hrLine.length > 1" class="hfoot" aria-hidden="true"><Sparkline :values="hrLine" /></div>
          <div v-else-if="restLine.length > 1" class="hfoot"><Sparkline :values="restLine" /><div class="tiny hcap">Resting heart rate, last 7 days</div></div>
        </div>

        <!-- what the band counted today, the steps against the steps goal when there is one, then the last 7 days' bars
             with their weekday letters and the goal's line -->
        <div v-else-if="id === 'activityToday'" class="card hb wkc sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link(avail.data.value?.steps ? `/stats?tab=steps&day=${today}` : '/stats?tab=activities')">
          <div class="ch"><span class="bi"><Icon name="steps" :size="15" /></span><span class="t grow">Activity today</span><span v-if="stepGoal" class="tiny">Goal {{ fmt.num(stepGoal.target, 0) }} a day</span></div>
          <div class="wstats hrows" :class="{ plain: !stepGoal }">
            <div v-for="x in actStats" :key="x.key" class="ws" role="group" :aria-label="[x.label, x.value, x.unit, x.delta].filter(Boolean).join(' ')">
              <div class="wlb"><Icon :name="x.icon" :size="14" />{{ x.label }}</div>
              <div class="wv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></div>
              <div v-if="stepGoal" class="wd" :class="x.tone">{{ x.delta }}</div>
            </div>
          </div>
          <template v-if="stepDays.some((x) => x.n)">
            <div class="wbars sbars" role="img" :aria-label="`Steps per day, last 7 days: ${stepDays.map((x) => x.n).join(', ')}${stepGoal ? `; goal ${stepGoal.target}` : ''}`">
              <i v-for="x in stepDays" :key="x.d" :class="{ cur: x.d === today, ok: x.ok }" :style="{ height: Math.max(4, (x.n / stepMax) * 100) + '%' }" />
              <b v-if="stepGoal" class="tgt" :style="{ '--f': stepGoal.target / stepMax }" />
            </div>
            <div class="wdays" aria-hidden="true"><span v-for="x in stepDays" :key="x.d" :class="{ cur: x.d === today }">{{ x.letter }}</span></div>
            <div class="tiny hcap">Steps, last 7 days</div>
          </template>
        </div>

        <!-- today at a glance: a ring per picked number, each opening the Stats tab that shows it in full; five to a row, or three and two -->
        <div v-else-if="id === 'quickStats'" class="card hb wkc sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="eye" :size="15" /></span><span class="t grow">Today at a glance</span></div>
          <div class="glance">
            <div v-for="x in glance" :key="x.key" class="gl click" :aria-label="x.aria" :title="x.aria" v-bind="link(x.to)">
              <span class="glr"><Ring :pct="x.pct" :size="52" :color="x.color" /><Icon :name="x.icon" :size="18" class="gli" :class="{ done: x.done }" /></span>
              <span class="glv">{{ x.value }} <small v-if="x.unit">{{ x.unit }}</small></span>
              <span class="gll">{{ x.label }}</span>
            </div>
          </div>
        </div>

        <!-- your day: the Calendar's own card for today, its header opening the Calendar on today -->
        <CalendarDay v-else-if="id === 'calendarDay'" class="hb sz-l" :day="today" :today="today" :items="todayItems">
          <template #head><div class="ch"><span class="bi"><Icon name="calendar" :size="15" /></span><span class="t grow">Your day</span><button class="lnk" @click="planOpen = { rule: 'once', startDate: today }"><Icon name="plus" :size="14" />Plan</button><button class="lnk" @click="router.push(`/history?date=${today}`)">Calendar</button></div></template>
        </CalendarDay>

        <div v-else-if="id === 'achievements'" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats?tab=achievements')">
          <div class="ch"><span class="bi"><Icon name="star" :size="15" /></span><span class="t grow">Achievements</span></div>
          <div v-if="!achRecent.length" class="tiny">Finish your first workout for your first one.</div>
          <div class="list"><div v-for="a in achRecent" :key="a.id" class="li"><Icon name="trophy" :size="18" class="ach-on" /><div class="grow"><div class="t">{{ a.name }}</div><div class="s">{{ fmt.date(a.reachedAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div></div></div>
          <div v-if="achNext" class="ach-next"><div class="row tiny"><span class="grow">Next: <b class="ach-nm">{{ achNext.name }}</b></span>{{ achAmount(achNext.unit, achNext.value) }} / {{ achAmount(achNext.unit, achNext.target) }}</div>
            <div class="pbar"><i :style="{ width: Math.min(100, (achNext.value / achNext.target) * 100) + '%' }" /></div></div>
        </div>
      </template>
      <!-- every block switched off, or none with anything to show now -->
      <div v-if="!blocks.length" class="card empty sz-l"><Icon name="home" :size="34" /><template v-if="listed.some((x) => x.on)"><b>Nothing to show today</b>Your blocks have nothing for today yet. Add more in Edit home.</template><template v-else><b>Nothing to show</b>Every block is switched off. Choose which ones Home shows.</template><br /><button class="btn tonal" @click="editing = true">Edit home</button></div>
    </div>
    <div v-else-if="home.isLoading.value" class="hgrid"><div class="card today-ph sz-l" /><div v-for="i in 2" :key="i" class="card sz-m today-ph" /></div>
    <div v-else class="card empty"><Icon name="info" :size="34" /><b>Couldn't load Home</b>{{ (home.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="home.refetch()">Try again</button></div>

    <Sheet v-if="suggestAll && h?.suggest.length" title="Suggested" @close="suggestAll = false">
      <TransitionGroup name="mv" tag="div" class="list">
        <SuggestionRow v-for="x in h.suggest" :key="x.key" :x="x" @plan="planSuggestion" @hide="hideSuggestion" @go="suggestAll = false" />
      </TransitionGroup>
    </Sheet>
    <ScheduleEditor v-if="planOpen" :schedule="planOpen" @close="planOpen = null" />
    <GoalSheet v-if="goalOpen" :id="goalOpen" @close="goalOpen = null" @edit="(g) => router.push(`/goals?edit=${g.id}`)" @status="goalStatus" @delete="goalDelete" />
    <ReorderSheet v-if="reorderOpen" title="Reorder blocks" hint="Drag to reorder the blocks on Home."
      :items="listed.map((x) => ({ id: x.id, title: META[x.id]!.name, sub: x.on ? undefined : 'Off', off: !x.on }))" @move="moveBlock" @close="reorderOpen = false" />
    <Sheet v-if="glanceOpen" title="Today at a glance" @close="glanceOpen = false">
      <p class="tiny hgap">Choose the rings this block shows. Each one appears once its reading is in.</p>
      <label v-for="k in GLANCE_RINGS" :key="k" class="tgl">
        <Icon :name="GLANCE_ROWS[k].icon" :size="18" class="gsi" />
        <div class="grow"><div class="t">{{ GLANCE_ROWS[k].t }}</div><div class="s">{{ GLANCE_ROWS[k].s }}</div></div>
        <span class="tg"><input type="checkbox" :checked="s.home.glance.includes(k)" @change="setGlance(k, ($event.target as HTMLInputElement).checked)" /></span>
      </label>
      <div v-if="!s.home.glance.length" class="tiny">With no ring picked, Home hides this block.</div>
    </Sheet>
    <Sheet v-if="pinOpen" title="Pinned goals" @close="pinOpen = false">
      <p class="tiny hgap">Each pinned goal gets its own block on Home, in this order. Weekly and monthly goals can bring their streak along.</p>
      <TransitionGroup name="mv" tag="div">
        <!-- the key sits on the template only: Vue refuses keys on its children (the build fails), and TransitionGroup
             keys each child from the template's key plus its place -->
        <template v-for="g in goalRows" :key="g.id">
          <div class="tgl">
            <label class="grow hsw" :for="`hg-${g.id}`"><div><div class="t">{{ g.title }}</div><div class="s">{{ goalSub(g, s) }}</div></div></label>
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
/* the board: four columns on a computer (blocks span two, wide ones all four), two on the phone. A half-size block left alone
   in its row (data-solo, worked out in solo) takes the whole row, so any order lays out without holes, in the order given */
.hgrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--spg); align-items: stretch; }
.sz-m { grid-column: span 2; }
.sz-l, .sz-m[data-solo] { grid-column: 1 / -1; }
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
.hero :deep(.big small), .hero .tiny { color: color-mix(in srgb, var(--onc) 75%, transparent); }

/* the stat tiles of this week and the last workout are the shared .wkc/.wstats ones (app.css) */
/* today at a glance: equal columns of a ring with its icon inside, the value under it and its name under that. Three to a
   row in a narrow block (the phone: three and two, the last row centred), five in a wider one (a computer's half row).
   Names are the stat tiles' size and may take two lines; each keeps room for two, so every column of a row is as tall
   and their rings, values and names line up */
.glance { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--hg) var(--tdy); }
.gl { flex: 0 0 calc((100% - 2 * var(--tdy)) / 3); }
@container (min-width: 440px) { .gl { flex-basis: calc((100% - 4 * var(--tdy)) / 5); } }
.gl { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; padding-block: var(--tdy); text-align: center; border-radius: var(--r-sm); }
.gl.click:hover { background: color-mix(in srgb, var(--tx) 3%, transparent); }
.glr { position: relative; display: grid; place-items: center; margin-bottom: 4px; }
/* the icon in the ring turns the accent once its number is reached (the ring's own check would sit on it) */
.gli { position: absolute; color: var(--tx2); }
.gli.done { color: var(--acc); }
.glv { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.2; }
.glv small { font-size: var(--fs-sm); font-weight: 500; color: var(--tx2); }
.gll { min-height: 2.4em; font-size: var(--fs-sm); color: var(--tx2); line-height: 1.2; }
/* Your day: a block's children are 4px apart (.hb's gap) on top of their own margins, so each section takes those
   4px back and sits --cpy below the one before, as on the Calendar page; the header does the same (.hb > .ch) */
.hb > :deep(.csec) { margin-top: calc(var(--cpy) - 4px); }
.wbars { display: flex; align-items: flex-end; gap: 6px; height: 34px; margin-top: auto; padding-top: var(--hg); box-sizing: content-box; }
.wbars i { flex: 1; border-radius: 4px 4px 2px 2px; background: color-mix(in srgb, var(--acc) 28%, transparent); }
.wbars i.cur { background: var(--acc); }
/* the steps bars: a day that reached the steps goal in green (today solid), the goal as a dashed line at its height
   (--f, the target's share of the bars' 34px), and each day's weekday letter under its bar, spaced as the bars */
.sbars { position: relative; }
.sbars i.ok { background: color-mix(in srgb, var(--pos) 28%, transparent); }
.sbars i.cur.ok { background: var(--pos); }
.sbars .tgt { position: absolute; inset-inline: 0; bottom: calc(var(--f) * 34px); border-top: 1px dashed color-mix(in srgb, var(--tx2) 60%, transparent); pointer-events: none; }
.wdays { display: flex; gap: 6px; margin-top: 4px; }
.wdays span { flex: 1; text-align: center; font-size: var(--fs-xs); line-height: 1; color: var(--tx2); }
.wdays .cur { color: var(--tx); font-weight: 600; }
/* the last workout's name and day at the right of its header, at the size of the other headers' notes ("Vs your 28-day usual"):
   the name as strong as Achievements' "Next" name and cut first, so the title and the day always show at 360px */
.lname { flex: 1; min-width: 0; display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; font-size: var(--fs-xs); }
.lnm { min-width: 0; color: var(--tx); font-weight: 600; }
.lday { color: var(--tx2); white-space: nowrap; flex: none; }

/* a pinned goal is the shared goal tile (.gtile, app.css); the muscle groups' dots look like its streak dots, off and on */
.mdot { background: color-mix(in srgb, currentColor 14%, transparent); }
.mg.on .mdot { background: var(--acc); }

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

/* readiness's parts as a report's highlights (Reports .hl): a block-padding below the value under a faint line, the
   last row without its line, the number in the row's tone */
.hhl { margin-top: var(--cpy); border-top: 1px solid var(--ol); }
.hhl .li:last-child { border-bottom: 0; padding-bottom: 0; }
/* a part's line wraps rather than cut off, as the same rows on Stats → Scores */
.hhl .grow { min-width: 0; }
/* last night's stages under a faint line, as on Stats → Sleep's last-night card */
.hstages { margin-top: var(--cpy); padding-top: var(--cpy); border-top: 1px solid var(--ol); }
/* heart's line and the steps goal's bar sit at the foot of the block, as This week's bars */
/* today's heart line takes the room a taller neighbour leaves in the block (up to about three tile rows), so a short
   block has its line and a stretched one has no empty space under the tiles */
.hfoot { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; min-height: 28px; padding-top: var(--hg); }
.hcap { margin-top: 4px; }
/* Heart's four tiles hold the widest value on Home ("52-131 bpm"): in a half-width block they go two by two, as
   This week's four do in a narrower one, so the range never runs past the block's edge (rows below 330px stay) */
@container (min-width: 331px) and (max-width: 640px) {
  .hrows.n4 { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: calc(1.5 * var(--cpy)); }
  .hrows.n4 .ws:nth-child(odd) { border-inline-start: 0; padding-inline-start: 0; }
  .hrows.n4 .wv { font-size: clamp(var(--fs-lg), calc((100cqi - 2 * var(--hg)) / 11.2), calc(var(--fs-lg) * 1.25)); }
}
/* as rows (phone), Heart's and Steps today's notes take the same column width, so the two blocks' numbers line up */
@container (max-width: 330px) { .hrows:not(.plain) { grid-template-columns: minmax(0, 1fr) auto 5em; } }
.hfoot .spark { position: static; display: block; width: 100%; flex: 1 1 0; height: auto; min-height: 28px; max-height: 96px; }

/* Edit home: each tile names its block and says what it shows; switched-off ones fade back */
.etile { display: flex; flex-direction: column; gap: 4px; min-height: 92px; border: 1px dashed var(--ol); }
.etile .ch { margin-bottom: 0; }
/* a long name wraps rather than pushing the switch out of a narrow tile */
.etile .t { cursor: pointer; min-width: 0; overflow-wrap: anywhere; line-height: 1.25; }
.etile.off { opacity: .55; }
/* the foot: Pinned goals' or Today at a glance's link on the left, the arrows on the right with their icons lined up under the switch's edge */
.emv { display: flex; align-items: center; gap: 4px; margin-top: auto; margin-inline-end: calc((18px - 36px) / 2); }
.tgl.sub-t { padding-inline-start: calc(var(--cpx) + var(--hg)); }
/* a ring's icon in its row of the Today at a glance sheet, as the Routine changes rows' icons (RoutineChanges .rc-i):
   its size kept beside a long name, in the quiet text colour */
.gsi { flex: none; color: var(--tx2); }
/* the note under the rings' rows keeps a row's spacing from the last row's line */
.tgl + .tiny { margin-top: var(--lpy); }
.hsw { cursor: pointer; align-self: stretch; display: flex; align-items: center; }
</style>
