<script setup lang="ts">
// Home (requirement 9): one board of blocks in your order (Edit home, from the ⋮ menu). Today leads; blocks are half a row on
// a computer (a whole row on the phone) or the whole row; a half-size block left alone in its row takes the whole row. A block with nothing to say right now
// (no reminder waiting, no goal due soon, no program running) stays away until it has; feature blocks need their feature.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { muscleName, num, fromM, percentChange, orderGoals, HOME_BLOCKS, type Goal, type HomePlan, type HomeRecord, type HomeGroup, type HomeSuggestion, type HomeWeek } from "@motus/shared";
import { useHome, useSettings, saveSettings, useAchievements, useGoals, useHealthAvailable, useHealthDay, useReadiness, useSleep, useDaily, useActivityTypes, useRoutines, loaded, type HealthAvailable, type ReadinessPart } from "../api/queries";
import { api } from "../api/client";
import { invalidate, queryClient } from "../api/live";
import { confirm } from "../core/ask";
import { toast } from "../core/toast";
import { onHome, streakOnHome, toggleHomeGoal, setHomeStreak, periodWord, goalSub } from "../core/goals";
import { asleepMin, inBedMin, efficiency, hasStages, isFull, mins, SHORT_WHY } from "../core/sleep";
import { useFmt, unitOf, ago, goalLabel, localYmd, tomorrowYmd } from "../core/format";
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
import ScheduleEditor from "../components/ScheduleEditor.vue";
import GoalSheet from "../components/GoalSheet.vue";
import SessionStats from "../components/SessionStats.vue";
import TodayHero from "../components/home/TodayHero.vue";
import StageBar from "../components/stats/StageBar.vue";
import NightSheet from "../components/stats/NightSheet.vue";

const router = useRouter();
const home = useHome();
const s = useSettings();
const fmt = useFmt();
const h = computed(() => home.data.value);

const today = localYmd(new Date());
// nothing made or done yet: Today says how to begin and the summing-up blocks wait
const fresh = computed(() => !!h.value && !h.value.routineCount && !h.value.totalWorkouts && !h.value.activityCount && !(s.value.features.programs && h.value.programs?.length));

// ---- the blocks: name and what it shows (Edit home), icon, and size: m half the row (all of it on the phone), l the whole row
type Size = "m" | "l";
const META: Record<string, { name: string; desc: string; icon: string; size: Size }> = {
  today: { name: "Today", desc: "What to do today and this week's training days", icon: "play", size: "l" },
  week: { name: "This week", desc: "Workouts, time and volume against last week", icon: "stats", size: "m" },
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
  readiness: { name: "Readiness", desc: "How ready you are to train, from last night's sleep and your heart", icon: "heartPulse", size: "m" },
  sleep: { name: "Last night", desc: "Time asleep and its stages, from your band", icon: "moon", size: "m" },
  heart: { name: "Heart", desc: "Resting heart rate, HRV and today's range, from your band", icon: "heart", size: "m" },
  activityToday: { name: "Today from your band", desc: "Steps, distance and active calories today, and your last 7 days, from your band", icon: "steps", size: "m" },
};
// a block whose feature is off is absent everywhere, Edit home included
const FEATURE: Record<string, string> = { program: "programs", daily: "dailyLog", achievements: "achievements" };
// the band's blocks are absent everywhere, Edit home included, until that kind of data has come in (as Stats' Sleep and
// Heart tabs): the Health Connect switch is the Android app's, while the data can reach any device through the server
const HEALTH: Record<string, (a: HealthAvailable) => boolean> = { readiness: (a) => a.sleep || a.heart, sleep: (a) => a.sleep, heart: (a) => a.heart, activityToday: (a) => a.distance || a.calories };
const avail = useHealthAvailable();
const available = (id: string) => !!META[id] && (!FEATURE[id] || !!s.value.features[FEATURE[id]!]) && (!HEALTH[id] || (!!avail.data.value && HEALTH[id]!(avail.data.value)));
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
interface WStat { note?: string; key: string; icon: string; label: string; value: string; unit: string; delta?: string; last?: string; tone?: string }
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
  if (walked.value) out.push({ ...row("walk", "walk", "Distance", tw.value.walkM, lw.value.walkM, (n) => fmt.value.dist(n, 1), true), note: "Walks and hikes" });
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
// a goal row's line after its progress: the automatic title of a goal with its own name, else how often it counts
// (nothing for a one-off goal, whose progress says it all); the same in Goals and Goals due soon
const listSub = (g: Goal) => (g.period !== "once" || (g.name && g.summary) ? goalSub(g, s.value) : "");
const reached = (g: Goal) => g.status === "achieved" || !!g.progress?.done;
// the unit after a goal's number, as the stat tiles write it ("142.5 kg", "12,500 steps", "1 session")
const COUNT_UNITS: Record<string, [string, string]> = { sessions: ["session", "sessions"], times: ["time", "times"], workouts: ["workout", "workouts"], weeks: ["week", "weeks"], reps: ["rep", "reps"], sets: ["set", "sets"], steps: ["step", "steps"] };
const goalVal = (g: Goal, v: number) => { const u = g.progress?.unit; return u === "kg" ? fmt.value.w(v) : u === "km" ? fmt.value.num(fromM(v * 1000, fmt.value.du), 1) : u === "cm" ? fmt.value.len(v) : fmt.value.num(v, u === "min" || !!COUNT_UNITS[u ?? ""] ? 0 : 1); };
const goalUnit = (g: Goal, v: number) => { const u = g.progress?.unit ?? ""; const c = COUNT_UNITS[u]; return c ? c[v === 1 ? 0 : 1] : u === "kg" ? fmt.value.wu : u === "km" ? fmt.value.du : u === "cm" ? fmt.value.lu : u; };
// the tile's tiny line names the target the same way for every goal: "of 150 kg" for goals that count up to it,
// "Target 80 kg" for body goals (which can head up or down) and goals that must stay under it
const goalTarget = (g: Goal) => `${g.scope === "body" || g.comparator === "<=" ? "Target" : "of"} ${goalVal(g, g.target)} ${goalUnit(g, g.target)}`.trim();
// "0 of 30 min today" for a daily goal (its own period says the rest); other periods keep their line after the progress
const goalLine = (g: Goal) => {
  const label = goalLabel(g, fmt.value).replace(" / ", " of ");
  return g.period === "day" && g.scope !== "body" ? `${label} today` : [label, listSub(g)].filter(Boolean).join(" · ");
};
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
  // the ring's tick shows it is done; this half names the day
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

// an activity type's own name ("Walk"), not its id
const types = useActivityTypes();
const typeName = (slug: string) => (types.data.value as { slug: string; name: string }[] | undefined)?.find((t) => t.slug === slug)?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1);
// suggestions: a routine's last day by the calendar as Routines counts it; a gap says which routines leave it out
const routinesQ = useRoutines();
const reasonOf = (x: HomeSuggestion) => {
  if (x.kind === "oldest") { const at = routinesQ.data.value?.find((r) => r.id === x.routineId)?.lastDoneAt; return at ? `Last done ${ago(at)}` : x.reason; }
  if (x.kind === "gap" || x.kind === "target") { const m = x.title.replace(/^Work your /, ""); return x.reason.startsWith("Your routines only") ? `Your routines only train your ${m} as a helper` : `None of your routines train your ${m}`; }
  return x.reason;
};

// records
const KIND: Record<string, string> = { weight: "Heaviest", e1rm: "Best estimated 1RM", volume: "Most volume", reps: "Most reps", duration: "Longest", distance: "Farthest" };
const recordText = (r: HomeRecord) => r.distanceM ? fmt.value.dist(r.distanceM, 1) : r.durationS && !r.reps ? fmt.value.dur(r.durationS, true)
  : fmt.value.set(r, r.tracking ?? "weight_reps");

// achievements: the latest reached and the closest still to come
const ach = useAchievements(computed(() => isOn("achievements")));
const achSteps = computed(() => (ach.data.value ?? []).flatMap((a: any) => a.steps.map((x: any) => ({ ...x, unit: a.unit, value: a.value }))));
const achRecent = computed(() => achSteps.value.filter((x) => x.reachedAt).sort((a, b) => b.reachedAt.localeCompare(a.reachedAt)).slice(0, 3));
const achNext = computed(() => (ach.data.value ?? []).map((a: any) => a.steps.find((x: any) => !x.reachedAt) && { ...a.steps.find((x: any) => !x.reachedAt), unit: a.unit, value: a.value })
  .filter(Boolean).sort((a: any, b: any) => b.value / b.target - a.value / a.target)[0]);
const achAmount = (unit: string, v: number) => unit === "kg" ? fmt.value.vol(v) : unit === "m" ? fmt.value.dist(v, v < 10000 ? 1 : 0) : unit === "s" ? `${num(v / 3600, 0)}h` : unit === "weeks" ? `${num(v, 0)} wk` : num(v, 0);

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
const nightOpen = ref<string | null>(null);
// a short record (a nap, or a band that slipped off) isn't the night: the block says so plainly, and readiness leaves it out
const nightShort = computed(() => !!night.value && !isFull(night.value));
const READY_TEXT: Record<string, string> = { Ready: "Rested and recovered. A good day to train hard.", Normal: "About your usual. Train as planned.", "Take it easy": "Still recovering. Keep today light." };
// each part as a report's highlight: what and its value against your usual, then how far off it is, in the tone of what
// it does to the score (raises it: positive, lowers it: negative)
const bpm = (v: number) => `${Math.round(v)} bpm`, ms = (v: number) => `${Math.round(v)} ms`;
const PART: Record<ReadinessPart["key"], { icon: string; t: string; f: (v: number) => string }> = {
  // sleep comes in hours, as the day's log keeps it
  sleep: { icon: "moon", t: "Sleep", f: (h) => mins(h * 60) }, restingHr: { icon: "heart", t: "Resting heart rate", f: bpm }, hrv: { icon: "heartPulse", t: "HRV", f: ms },
};
const signedBy = (d: number, f: (v: number) => string) => `${Math.round(d) < 0 ? "-" : "+"}${f(Math.abs(d))}`;
const readyParts = computed(() => (rd.value?.parts ?? []).filter((x) => x.value != null && PART[x.key]).map((x) => {
  const p = PART[x.key];
  return { key: x.key, icon: p.icon, t: p.t, s: x.baseline != null ? `${p.f(x.value!)} · usual ${p.f(x.baseline)}` : p.f(x.value!),
    r: x.effect === "flat" || x.baseline == null ? "As usual" : signedBy(x.value! - x.baseline, p.f), tone: x.effect === "up" ? "pos" : x.effect === "down" ? "neg" : undefined };
}));
// a part still learning its usual: today's value and when its usual comes, as a ready part's row has its usual, and on
// the right a muted word where a result goes (the days themselves are the block's big value)
const buildingParts = computed(() => (rd.value?.building ?? []).filter((x) => PART[x.key]).map((x) => {
  const p = PART[x.key];
  return { key: x.key, icon: p.icon, t: p.t, s: `${p.f(x.value)} · usual in ${(rd.value!.need ?? 7) - x.days} ${(rd.value!.need ?? 7) - x.days === 1 ? "day" : "days"}`, r: "Learning", tone: "muted" };
}));
// every part in one list, in the order of the score's parts (sleep, resting heart rate, HRV)
const ORDER: ReadinessPart["key"][] = ["sleep", "restingHr", "hrv"];
// readiness leaves out a short record (under MIN_NIGHT_H) as no night; its row says why sleep isn't in the score
const shortPart = computed(() => nightShort.value && !rd.value?.parts.some((x) => x.key === "sleep") && !rd.value?.building?.some((x) => x.key === "sleep")
  ? [{ key: "sleep" as const, icon: PART.sleep.icon, t: PART.sleep.t, s: `${mins(asleepMin(night.value!))} · too short to count`, r: "Left out", tone: "muted" }] : []);
const allParts = computed(() => [...readyParts.value, ...buildingParts.value, ...shortPart.value].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)));
// without a score: the score needs two parts with a usual, so it waits on the second most advanced part (a part with a
// usual counts as all its days, one with no readings as none); the ring fills as its days come in
const readyWait = computed(() => {
  const r = rd.value;
  if (!r || r.score != null) return null;
  // an older server sends no building or need: guard them so Home still draws
  const building = r.building ?? [], need = r.need ?? 7;
  const days = ORDER.map((k) => (r.parts.some((x) => x.key === k) ? need : building.find((x) => x.key === k)?.days ?? 0)).sort((a, b) => b - a);
  const missing = ORDER.filter((k) => !r.parts.some((x) => x.key === k) && !building.some((x) => x.key === k));
  const left = need - days[1]!;
  const known = ORDER.filter((k) => !missing.includes(k));
  return { days: days[1]!, need, left,
    text: r.parts.length + building.length < 2
      ? `Your score also needs ${missing.map((k) => (k === "hrv" ? PART[k].t : PART[k].t.toLowerCase())).join(" or ")} from your band.`
      : `Learning your usual ${known.map((k) => PART[k].t.toLowerCase().replace("hrv", "HRV")).join(", ").replace(/, ([^,]*)$/, " and $1")}.` };
});
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
  vital("restingHr", "heart", "Resting heart rate", "bpm");
  vital("hrv", "heartPulse", "HRV", "ms");
  // blood oxygen whole, its percent right after the number, as the Heart tab writes it; it has no usual to compare with
  if (day.value?.spo2 != null) out.push({ key: "spo2", icon: "water", label: "Blood oxygen", value: `${Math.round(day.value.spo2)}%`, unit: "", delta: "" });
  const hr = day.value?.hr;
  if (hr) out.push({ key: "today", icon: "activity", label: "Range today", value: `${Math.round(hr.min)}-${Math.round(hr.max)}`, unit: "bpm", delta: `average ${Math.round(hr.avg)}` });
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
    case "readiness": return !!rd.value;
    case "sleep": return !!night.value;
    case "heart": return heartStats.value.length > 0;
    case "activityToday": return actStats.value.length > 0;
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
await loaded(home, ach, avail, hDay, ready, nightsQ, dailyQ);
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
      <div v-for="(x, i) in listed" :key="x.id" class="card etile" :class="[META[x.id]!.size === 'l' ? 'sz-l' : 'sz-m', { off: !x.on && !FIXED.has(x.id) }]" :data-solo="solo.has(x.id) || undefined">
        <!-- the name and its switch on one row (label left, control right); the arrows have their own row at the foot, so a
             half-width tile has room for the switch in a narrow window -->
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
        <div v-else-if="id === 'week'" class="card hb wkc sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats')">
          <div class="ch"><span class="bi"><Icon name="stats" :size="15" /></span><span class="t grow">This week</span><span v-if="anyDelta" class="tiny">Vs last week</span></div>
          <div class="wstats" :class="{ n4: weekStats.length === 4, plain: !anyDelta }">
            <div v-for="x in weekStats" :key="x.key" class="ws" role="group" :aria-label="`${[x.label, x.value, x.unit, x.delta].filter(Boolean).join(' ')}, last week ${x.last}`" :title="`${x.note ? x.note + ' · ' : ''}Last week ${x.last}`">
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
          <div v-for="g in pinnedGoals" :key="g.id" class="card hb gtile sz-m click" :class="{ hero: reached(g) }" :data-solo="solo.has(`pinned:${g.id}`) || undefined" v-bind="link(() => (goalOpen = g.id))">
            <div class="gmain">
              <div class="ch"><span class="bi"><Icon :name="goalIcon(g)" :size="15" /></span><span class="t grow ellipsis">{{ g.title }}</span></div>
              <div class="row">
                <!-- like the stat tiles: the current number big with its unit small, the target on the tiny line -->
                <div class="big grow">{{ goalVal(g, g.progress?.current ?? 0) }}<small>{{ goalUnit(g, g.progress?.current ?? 0) }}</small></div>
                <!-- the ring and its check keep the accent gradient on a reached (accent) tile too, as on the goal cards -->
                <Ring :pct="g.progress?.pct ?? 0" :size="40" :done="reached(g)" />
              </div>
              <div class="tiny">{{ goalTarget(g) }}</div>
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

        <!-- suggestions: worked out from your order of routines, the muscles you've worked and what your routines leave out.
             A routine opens its page; a muscle (or a gap in your routines) opens the exercises for it, and its + starts a
             new routine -->
        <div v-else-if="id === 'suggest'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="sparkle" :size="15" /></span><span class="t grow">Suggested</span></div>
          <TransitionGroup name="mv" tag="div" class="list">
            <div v-for="x in h.suggest" :key="x.kind + (x.routineId ?? x.muscle)" class="li click">
              <button class="cover" :aria-label="x.routineId ? `Open ${x.title}` : `Exercises for ${muscleName(x.muscle ?? '').toLowerCase()}`" @click="go(x.routineId ? `/routines/${x.routineId}` : `/exercises?muscle=${encodeURIComponent(x.muscle ?? '')}`)" />
              <MuscleFig sm :routine="x.routineId ?? undefined" :muscles="x.routineId ? undefined : x.muscles ?? (x.muscle ? [x.muscle] : undefined)" />
              <div class="grow"><div class="t">{{ x.title }}</div><div class="s">{{ reasonOf(x) }}</div></div>
              <button v-if="x.routineId" class="ib sm over" aria-label="Plan" title="Plan" @click="planOpen = { rule: 'once', routineId: x.routineId }"><Icon name="calendar" :size="18" /></button>
              <button v-else-if="x.muscle" class="ib sm over" aria-label="New routine" title="New routine" @click="go('/routines/new/edit')"><Icon name="plus" :size="18" /></button>
              <button class="ib sm plain over" aria-label="Not now" title="Not now: hide until your next workout" @click="hideSuggestion(x.key)"><Icon name="close" :size="16" /></button>
            </div>
          </TransitionGroup>
        </div>

        <div v-else-if="id === 'reminders'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="bell" :size="15" /></span><span class="t grow">Reminders</span></div>
          <div class="list"><div v-for="r in h.reminders" :key="r.id" class="li click" v-bind="link(() => (reminderView = { r }))"><div class="grow"><div class="t">{{ reminderText(r, fmt) }}</div><div class="s">{{ r.targetName }}</div></div><Icon name="right" :size="16" class="muted" /></div></div>
        </div>

        <div v-else-if="id === 'records'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="trophy" :size="15" /></span><span class="t grow">Records</span><span class="tiny">Last 30 days</span></div>
          <div class="list">
            <div v-for="(r, i) in h.records" :key="`${r.workoutId}-${r.exerciseId}-${r.kinds.join()}-${i}`" class="li click" v-bind="link(`/exercises/${r.exerciseId}`)">
              <div class="grow"><div class="t">{{ r.name }}</div><div class="s">{{ r.kinds.map((k: string) => KIND[k] ?? k).join(", ") }} · {{ fmt.date(r.at, { day: "numeric", month: "short" }) }}</div></div>
              <b class="rv">{{ recordText(r) }}</b>
            </div>
          </div>
        </div>

        <div v-else-if="id === 'feed'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="history" :size="15" /></span><span class="t grow">Recent activity</span><button class="lnk" @click="router.push('/history?view=list')">All</button></div>
          <div class="list"><div v-for="x in h.feed.slice(0, 5)" :key="x.id" class="li click" v-bind="link(x.kind === 'workout' ? `/workouts/${x.id}` : `/activities/${x.id}`)">
            <Icon :name="x.kind === 'workout' ? 'dumbbell' : x.type === 'walk' ? 'walk' : 'activity'" :size="18" class="muted" /><div class="grow"><div class="t">{{ x.kind === "workout" ? x.name : x.name || typeName(x.type) }}</div><div class="s">{{ fmt.date(x.startedAt, { weekday: "short", day: "numeric", month: "short" }) }}</div></div>
            <SessionStats :x="x" /></div></div>
        </div>

        <div v-else-if="id === 'daily'" class="card hb sz-m" :data-solo="solo.has(id) || undefined">
          <div class="ch"><span class="bi"><Icon name="note" :size="15" /></span><span class="t grow">Daily log</span><button class="lnk" @click="dailySheet = true">Other days</button></div>
          <DailyLog />
        </div>

        <!-- readiness: the score as a pinned goal's value and ring, what it means, then what made it as a report's highlights;
             while the usual is being learnt, the days the score waits for in their place, and each part's days so far -->
        <div v-else-if="id === 'readiness' && rd" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats?tab=heart')">
          <div class="ch"><span class="bi"><Icon name="heartPulse" :size="15" /></span><span class="t grow">Readiness</span><span v-if="readyParts.length && !readyWait" class="tiny">Vs your usual</span></div>
          <div v-if="readyWait" class="row"><div class="big grow">{{ readyWait.left }}<small>{{ readyWait.left === 1 ? "day" : "days" }} until your score</small></div><Ring :pct="readyWait.days / readyWait.need" :size="40" /></div>
          <div v-else class="row"><div class="big grow">{{ rd.score }}<small v-if="rd.label">{{ rd.label }}</small></div><Ring :pct="rd.score! / 100" :size="40" :color="rd.label === 'Take it easy' ? 'var(--warn)' : undefined" /></div>
          <div v-if="readyWait" class="tiny">{{ readyWait.text }}</div>
          <div v-else-if="rd.label" class="tiny">{{ READY_TEXT[rd.label] }}</div>
          <div v-if="allParts.length" class="list hhl">
            <div v-for="x in allParts" :key="x.key" class="li">
              <Icon :name="x.icon" :size="18" class="muted" />
              <div class="grow"><div class="t">{{ x.t }}</div><div class="s">{{ x.s }}</div></div>
              <b class="r rv" :class="x.tone">{{ x.r }}</b>
            </div>
          </div>
        </div>

        <!-- the newest night: time asleep with the share of the time in bed as its ring (as the night's sheet), then its stages -->
        <div v-else-if="id === 'sleep' && night" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link(() => (nightOpen = night!.date))">
          <div class="ch"><span class="bi"><Icon name="moon" :size="15" /></span><span class="t grow">{{ nightName }}</span><span class="tiny">{{ fmt.time(night.startAt) }}-{{ fmt.time(night.endAt) }}</span></div>
          <div class="row"><div class="big grow">{{ mins(asleepMin(night)) }}<small>{{ nightShort ? "short record" : "asleep" }}</small></div><Ring :pct="efficiency(night)" :size="40" /></div>
          <div v-if="nightShort" class="tiny">{{ SHORT_WHY }}</div>
          <div v-else class="tiny">{{ mins(inBedMin(night)) }} in bed · {{ Math.round(efficiency(night) * 100) }}% of it asleep</div>
          <div v-if="hasStages(night) || night.awakeMin" class="hstages"><StageBar :night="night" /></div>
        </div>

        <!-- heart: resting heart rate and HRV against your usual, blood oxygen and today's range with its average as This
             week's tiles, each only when there, then today's line filling the rest of the block -->
        <div v-else-if="id === 'heart'" class="card hb wkc sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats?tab=heart')">
          <div class="ch"><span class="bi"><Icon name="heart" :size="15" /></span><span class="t grow">Heart</span><span v-if="heartDelta" class="tiny">Vs your usual</span></div>
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
        <div v-else-if="id === 'activityToday'" class="card hb wkc sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats?tab=activities')">
          <div class="ch"><span class="bi"><Icon name="steps" :size="15" /></span><span class="t grow">Today from your band</span><span v-if="stepGoal" class="tiny">Goal {{ fmt.num(stepGoal.target, 0) }} a day</span></div>
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

        <div v-else-if="id === 'achievements'" class="card hb sz-m click" :data-solo="solo.has(id) || undefined" v-bind="link('/stats?tab=achievements')">
          <div class="ch"><span class="bi"><Icon name="star" :size="15" /></span><span class="t grow">Achievements</span></div>
          <div v-if="!achRecent.length" class="tiny">Finish your first workout for your first one.</div>
          <div class="list"><div v-for="a in achRecent" :key="a.id" class="li"><Icon name="trophy" :size="18" class="ach-on" /><div class="grow"><div class="t">{{ a.name }}</div><div class="s">{{ fmt.date(a.reachedAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div></div></div>
          <div v-if="achNext" class="ach-next"><div class="row tiny"><span class="grow">Next: <b class="ach-nm">{{ achNext.name }}</b></span>{{ achAmount(achNext.unit, achNext.value) }} / {{ achAmount(achNext.unit, achNext.target) }}</div>
            <div class="pbar"><i :style="{ width: Math.min(100, (achNext.value / achNext.target) * 100) + '%' }" /></div></div>
        </div>
      </template>
    </div>
    <div v-else-if="home.isLoading.value" class="hgrid"><div class="card today-ph sz-l" /><div v-for="i in 2" :key="i" class="card sz-m today-ph" /></div>
    <div v-else class="card empty"><Icon name="info" :size="34" /><b>Couldn't load Home</b>{{ (home.error.value as Error | null)?.message }}<br /><button class="btn tonal" @click="home.refetch()">Try again</button></div>

    <ScheduleEditor v-if="planOpen" :schedule="planOpen" @close="planOpen = null" />
    <NightSheet v-if="nightOpen" :date="nightOpen" @close="nightOpen = null" />
    <GoalSheet v-if="goalOpen" :id="goalOpen" @close="goalOpen = null" @edit="(g) => router.push(`/goals?edit=${g.id}`)" @status="goalStatus" @delete="goalDelete" />
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
.hero .big small, .hero .tiny { color: color-mix(in srgb, var(--onc) 75%, transparent); }
/* a goal's value carries its unit beside the ring ("12,500 steps"), so at 360px the goal half is a little wider and both
   halves' values a step smaller, the same in both halves so they still line up */
html.phone .gtile .big { font-size: clamp(20px, 6vw, var(--fs-val)); }
html.phone .gtile { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); }

/* the stat tiles of this week and the last workout are the shared .wkc/.wstats ones (app.css) */
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
.gdots i { flex: 1; height: 6px; border-radius: 3px; }
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

/* readiness's parts as a report's highlights (Reports .hl): a block-padding below the value under a faint line, the
   last row without its line, the number in the row's tone */
.hhl { margin-top: var(--cpy); border-top: 1px solid var(--ol); }
.hhl .li:last-child { border-bottom: 0; padding-bottom: 0; }
.hhl .grow { min-width: 0; }
.hhl .s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
@container (max-width: 330px) { .hrows:not(.plain) { grid-template-columns: minmax(0, 1fr) auto 5em; } .hrows .wd { white-space: normal; } }
.hfoot .spark { position: static; display: block; width: 100%; flex: 1 1 0; height: auto; min-height: 28px; max-height: 96px; }

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
