// Every screen's data, filed under a topic (the first part of the key) so live updates know what to reload.
import { computed, type Ref, unref, watch, type MaybeRef } from "vue";
import { useQuery, useMutation, useInfiniteQuery, keepPreviousData, type QueryClient } from "@tanstack/vue-query";
import { withDefaults, type Settings, type Exercise, type RoutineSummary, type Goal, type Me, type Program, type GoalMetric, type Score, type HomeData, type ActivityType, type ActivityFigures, activityDistance, activityClimb, TOPICS } from "@motus/shared";
import { api, httpTransport } from "./client";
import { sync } from "./replica";
import { endedHere } from "./outbox";
import { invalidate, queryClient } from "./live";
import { toastError, savedToast, savedError } from "../core/toast";

/** What ["settings", "me"] holds: who is signed in and their settings. */
export type SettingsMe = { user: Me; settings: Settings };
export const useMe = () => useQuery({ queryKey: ["settings", "me"], queryFn: () => api.get<SettingsMe>("/me"), staleTime: 60_000 });
export function useSettings(): Ref<Settings> {
  const me = useMe();
  return computed(() => withDefaults(me.data.value?.settings ?? {}));
}
export const useExercises = () => useQuery({ queryKey: ["exercises", "all"], queryFn: () => api.get<Exercise[]>("/exercises"), staleTime: 5 * 60_000 });
export const useExercise = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["exercises", unref(id)]), queryFn: () => api.get(`/exercises/${unref(id)}`), enabled: computed(() => !!unref(id)) });
export const useExerciseHistory = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["workouts", "exhist", unref(id)]), queryFn: () => api.get(`/exercises/${unref(id)}/history`), enabled: computed(() => !!unref(id)) });
export const useRoutines = (archived = false) => useQuery({ queryKey: ["routines", "list", archived], queryFn: () => api.get<RoutineSummary[]>("/routines", { archived: archived ? 1 : undefined }) });
export const useRoutine = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["routines", unref(id)]), queryFn: () => api.get(`/routines/${unref(id)}`), enabled: computed(() => !!unref(id) && unref(id) !== "new") });
export const useFolders = () => useQuery({ queryKey: ["routines", "folders"], queryFn: () => api.get("/folders") });
export const usePrograms = () => useQuery({ queryKey: ["routines", "programs"], queryFn: () => api.get<Program[]>("/programs") });
// settings: the start screen's Workout settings for this workout only, so the numbers shown are the ones the start
// fills in; the last answer stays on screen while a changed one loads
export const usePreview = (id: MaybeRef<string>, settings?: MaybeRef<Record<string, unknown>>) => {
  const own = computed(() => { const o = unref(settings) ?? {}; return Object.keys(o).length ? JSON.stringify(o) : ""; });
  return useQuery({ queryKey: computed(() => ["routines", "preview", unref(id), own.value]), queryFn: () => api.get(`/routines/${unref(id)}/preview`, own.value ? { settings: own.value } : undefined),
    enabled: computed(() => !!unref(id)), placeholderData: (prev: unknown) => prev });
};
// a workout finished or cancelled here whose news is still waiting to be sent is over, whatever the server says meanwhile
// client: for watchers that outlive any one screen (they have no component to find the query client through)
export const useActive = (client?: QueryClient) => useQuery({ queryKey: ["workouts", "active"], queryFn: () => api.get<any>("/workouts/active").then((w) => (w && endedHere(w.id) ? null : w)), staleTime: 5_000 }, client);
export const useWorkoutQuery = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["workouts", unref(id)]), queryFn: () => api.get(`/workouts/${unref(id)}`), enabled: computed(() => !!unref(id)) });
/** keep: while new parameters load, keep showing the last answer (a screen stepped a day at a time doesn't flash empty) */
export type QueryOpts = { keep?: boolean };
const keepOpt = (o?: QueryOpts) => (o?.keep ? { placeholderData: keepPreviousData } : {});
export const useWorkouts = (params: MaybeRef<Record<string, unknown>> = {}, opts?: QueryOpts) => useQuery({ queryKey: computed(() => ["workouts", "list", unref(params)]), queryFn: () => api.get("/workouts", unref(params)), ...keepOpt(opts) });
export const useHome = () => useQuery({ queryKey: ["home"], queryFn: () => api.get<HomeData>("/home", { tz: new Date().getTimezoneOffset() }) });
export const useGoals = (all = false) => useQuery({ queryKey: ["goals", all], queryFn: () => api.get<Goal[]>("/goals", { all: all ? 1 : undefined, tz: new Date().getTimezoneOffset() }) });
export const useGoalDetail = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["goals", "detail", unref(id)]), queryFn: () => api.get<any>(`/goals/${unref(id)}/detail`, { tz: new Date().getTimezoneOffset() }), enabled: computed(() => !!unref(id)) });
export const useGoalMetrics = () => useQuery({ queryKey: ["static", "metrics"], queryFn: () => api.get<GoalMetric[]>("/goal-metrics"), staleTime: Infinity });
export const useStats = (range: MaybeRef<{ from?: string; to?: string; records?: 1 }>) => useQuery({ queryKey: computed(() => ["stats", unref(range)]), queryFn: () => api.get("/stats", { ...unref(range), tz: new Date().getTimezoneOffset() }) });
/** What /calendar sends: the done workouts (with their routine's colour) and activities from a day before to two days
 *  after the range (the app buckets them into its own days), and the planned days not done yet */
export interface CalendarWorkout { id: string; name: string | null; routineId: string | null; startedAt: string; status: string; avgHr: number | string | null; maxHr: number | string | null; color: string | null; durationS: number | string; sets: number; volumeKg: number }
export interface CalendarActivity { id: string; type: string; name: string | null; startedAt: string; durationS: number | string | null; distanceM: number | string | null; steps: number | string | null; source: string | null; avgHr: number | string | null; maxHr: number | string | null; hasRoute: boolean }
export interface CalendarPlanned { date: string; scheduleId: string; name: string; [k: string]: unknown }
export interface CalendarData { workouts: CalendarWorkout[]; activities: CalendarActivity[]; planned: CalendarPlanned[] }
export const useCalendar = (range: MaybeRef<{ from: string; to: string }>, enabled: MaybeRef<boolean> = true, opts?: QueryOpts) => useQuery({ queryKey: computed(() => ["calendar", unref(range)]),
  queryFn: () => api.get<CalendarData>("/calendar", { ...unref(range), tz: new Date().getTimezoneOffset() }), enabled, ...keepOpt(opts) });
export const useNotes = (type: MaybeRef<string>, id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["notes", unref(type), unref(id)]), queryFn: () => api.get("/notes", { targetType: unref(type), targetId: unref(id) }), enabled: computed(() => !!unref(id)) });
export const useReminders = (params: MaybeRef<Record<string, unknown>> = {}) => useQuery({ queryKey: computed(() => ["reminders", unref(params)]), queryFn: () => api.get("/reminders", unref(params)) });
export const useActivities = (params: MaybeRef<Record<string, unknown>> = {}, opts?: QueryOpts) => useQuery({ queryKey: computed(() => ["activities", unref(params)]), queryFn: () => api.get("/activities", unref(params)), ...keepOpt(opts) });
export const useActivity = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["activities", "one", unref(id)]), queryFn: () => api.get(`/activities/${unref(id)}`), enabled: computed(() => !!unref(id)) });
export const useActivityTypes = () => useQuery({ queryKey: ["activities", "types"], queryFn: () => api.get("/activity-types"), staleTime: 5 * 60_000 });
/** An activity type's own name ("Walk") from its id, for an activity without a name of its own, so every list says it alike. */
export function useTypeName() {
  const types = useActivityTypes();
  return (slug: string | null | undefined) => { const s = slug || "activity"; return (types.data.value as { slug: string; name: string }[] | undefined)?.find((t) => t.slug === s)?.name ?? s.charAt(0).toUpperCase() + s.slice(1); };
}
/** An activity's own distance (metres) and climb where its type tracks them, else null (activityDistance in
 *  @motus/shared): the one rule for every list, tile and sum that shows or adds up an activity's distance or pace. */
export function useActivityFigures() {
  const types = useActivityTypes();
  const typeOf = (slug: string | null | undefined) => (types.data.value as ActivityType[] | undefined)?.find((t) => t.slug === slug);
  return {
    dist: (a: ActivityFigures & { type?: string | null }) => activityDistance(a, typeOf(a.type)),
    climb: (a: ActivityFigures & { type?: string | null }) => activityClimb(a, typeOf(a.type)),
  };
}
export const useBody = (kind?: string) => useQuery({ queryKey: ["body", kind ?? "all"], queryFn: () => api.get("/body", { kind }) });
export const useSchedules = () => useQuery({ queryKey: ["schedules"], queryFn: () => api.get("/schedules") });
export const useTemplates = () => useQuery({ queryKey: ["static", "templates"], queryFn: () => api.get("/templates"), staleTime: Infinity });
// What a band handed over through Health Connect (or a script through the API): which kinds there are at all, so Stats
// shows its Sleep and Heart tabs only when there is something to put in them; filed under "health", which imports announce
export type HealthAvailable = { sleep: boolean; heart: boolean; distance: boolean; calories: boolean; vo2max?: boolean; hrDay?: boolean; bodyFat?: boolean; hydration?: boolean; nights?: boolean; restingHr?: boolean; hrv?: boolean; spo2?: boolean; imports?: boolean; steps?: boolean };
export const useHealthAvailable = () => useQuery({ queryKey: ["health", "available"], queryFn: () => api.get<HealthAvailable>("/health/available"), staleTime: 60_000 });
/** One night from a band: minutes in each stage (null when it only told asleep from awake) and what it read meanwhile */
export interface SleepNight {
  date: string; startAt: string; endAt: string; asleepMin: number; awakeMin: number | null;
  lightMin: number | null; deepMin: number | null; remMin: number | null;
  avgHr: number | null; minHr: number | null; avgSpo2: number | null; minSpo2: number | null; respRate: number | null;
  edited: boolean; sleepH: number;
  /** the night's own sleep score (shared nightScore), sent when asked for (scores: 1) with the Health scores feature on;
   *  none for a nap or part of a night, nor under 18 */
  score?: Score;
}
// nights asked for with their scores are filed under "nightscores", which a settings change (birth year, the feature)
// reloads as well as a health change, so the rest of the health screens don't reload with every setting
const sleepTopic = (scores: unknown) => (scores ? "nightscores" : "health");
export const useSleep = (range: MaybeRef<{ from?: string; to?: string; scores?: 1; tz?: number }>, enabled: MaybeRef<boolean> = true, opts?: QueryOpts) => useQuery({ queryKey: computed(() => [sleepTopic(unref(range).scores), "sleep", unref(range)]), queryFn: () => api.get<{ nights: SleepNight[] }>("/health/sleep", unref(range)), enabled, ...keepOpt(opts) });
// scores: with each night's own sleep score (the Health scores feature; in the key, so switching it on fetches them)
export const useSleepNight = (date: MaybeRef<string>, opts?: QueryOpts & { scores?: MaybeRef<boolean> }) => useQuery({ queryKey: computed(() => [sleepTopic(unref(opts?.scores)), "sleep", "night", unref(date)]),
  queryFn: () => api.get<SleepNight & { hr: [number, number][] | null }>(`/health/sleep/${unref(date)}`, unref(opts?.scores) ? { scores: 1, tz: new Date().getTimezoneOffset() } : undefined), enabled: computed(() => !!unref(date)), ...keepOpt(opts) });
/** One day from a band: its night (the one that ended that morning), the heart rate through the day (series: [unix
 *  seconds, bpm]), the day's vitals and totals; each null when the band handed nothing over for it */
export interface HealthDay {
  /** sleepH: the day's sleep hours, also on a day without a night's detail */
  date: string; sleep: SleepNight | null; sleepH: number | null; hr: { min: number; max: number; avg: number; series: [number, number][] } | null;
  restingHr: number | null; hrv: number | null; spo2: number | null; vo2max: number | null;
  steps: number | null; distanceM: number | null; activeKcal: number | null; waterMl: number | null;
  /** false when any of the day's steps, distance and active calories from Health Connect came without a band (absent from an older server) */
  worn?: boolean;
}
export const useHealthDay = (date: MaybeRef<string | null>, enabled: MaybeRef<boolean> = true, opts?: QueryOpts) => useQuery({ queryKey: computed(() => ["health", "day", unref(date)]),
  queryFn: () => api.get<HealthDay>(`/health/day/${unref(date)}`), enabled: computed(() => !!unref(date) && unref(enabled)), ...keepOpt(opts) });
/** How ready for training today, from last night's sleep, resting heart rate and HRV against your usual (baseline), and
 * with Training load on the last 7 days' load against the 4-week average (load: value and baseline are weeks' loads) */
export interface ReadinessPart { key: "sleep" | "restingHr" | "hrv" | "load"; value: number | null; baseline: number | null; change: number | null; effect: "up" | "down" | "flat"; ago?: 1 }
// building: parts with today's value but fewer than `need` days for a usual yet (never the load, whose 4 weeks fill on their own)
export interface ReadinessBuilding { key: Exclude<ReadinessPart["key"], "load">; value: number; days: number; ago?: 1 }
// why: one line from the parts that moved the score most and what the label advises (an older server sends none)
export interface Readiness { score: number | null; label: "Ready" | "Normal" | "Take it easy" | null; why?: string | null; parts: ReadinessPart[]; building: ReadinessBuilding[]; need: number; date: string }
// under "stats": a workout, activity, band sync or settings change (the Training load feature, the max heart rate) all touch stats
export const useReadiness = (enabled: MaybeRef<boolean> = true) => useQuery({ queryKey: ["stats", "readiness"], queryFn: () => api.get<Readiness>("/health/readiness", { tz: new Date().getTimezoneOffset() }), enabled });
/** Health scores (the Health scores feature): sleep, activity and strength over the last 7 days, each null without its
 *  data; scores null while the feature is off. Under "stats" as readiness, so a workout, sync or settings change reloads them */
export type HealthScores = { from: string; to: string; age: number | null; /** under 18: no scores, the guidelines scored are the adult ones */ minor?: boolean; sleep: Score | null; activity: Score | null; strength: Score | null };
export const useHealthScores = (enabled: MaybeRef<boolean> = true) => useQuery({ queryKey: ["stats", "scores"], enabled,
  queryFn: () => api.get<{ scores: HealthScores | null }>("/health/scores", { tz: new Date().getTimezoneOffset() }).then((r) => r.scores) });
/** Training load (Stats → Heart): each session's load over [from, to] and the 28 days before, and the 7:28 comparison as of `to`; load null while the feature is off */
export interface LoadSession { kind: "workout" | "activity"; id: string; name: string | null; type: string | null; date: string; load: number; hr: boolean }
export interface TrainingLoad { sessions: LoadSession[]; trend: { week: number; usual: number; ratio: number | null; state: "lighter" | "steady" | "higher" | "much higher" | null; left?: number | null }; maxHr: boolean }
export const useTrainingLoad = (range: MaybeRef<{ from: string; to: string }>, enabled: MaybeRef<boolean> = true) => useQuery({
  queryKey: computed(() => ["stats", "load", unref(range).from, unref(range).to]), enabled,
  queryFn: () => api.get<{ load: TrainingLoad | null }>("/health/load", { ...unref(range), tz: new Date().getTimezoneOffset() }).then((r) => r.load) });
/** The daily log from a day on (newest first), steps with the recorded activities counted in; the key Home's Today's log uses */
export const useDaily = (from: string) => useQuery({ queryKey: ["activities", "daily", from], queryFn: () => api.get<{ date: string; kind: string; value: number | string }[]>("/daily", { from, tz: new Date().getTimezoneOffset() }) });
export const useAchievements = (enabled: MaybeRef<boolean> = true) => useQuery({ queryKey: ["stats", "achievements"], queryFn: () => api.get<any[]>("/achievements", { tz: new Date().getTimezoneOffset() }), enabled });

// The activity log, newest first, a page at a time. With an offline copy it comes from the server when it can be
// reached: the copy on this device only keeps the changes it hasn't sent yet. Any change can add to it, so it is
// fetched again whenever it is opened rather than filed under a topic.
export const useActivityLog = () => useInfiniteQuery({
  queryKey: ["log"], initialPageParam: "", staleTime: 0, refetchOnMount: "always",
  getNextPageParam: (p: { cursor: string | null }) => p.cursor ?? undefined,
  queryFn: async ({ pageParam }) => {
    const path = "/activity-log?" + new URLSearchParams({ limit: "40", ...(pageParam ? { before: pageParam } : {}) });
    if (sync.on) try { return await httpTransport.request("GET", path) as { entries: any[]; cursor: string | null }; } catch { /* offline: what this device has */ }
    return api.get<{ entries: any[]; cursor: string | null }>(path);
  },
});

/**
 * Holds a page back until its first data is in, so it fades in whole instead of piece by piece (folders after
 * their routines, cards one by one). `await loaded(a, b)` at the top of a page's setup; the shells wrap pages
 * in <Suspense>. A query that fails or isn't running (disabled, offline) doesn't hold it, and after a moment the
 * page shows anyway with its own loading states, so a slow server never leaves a blank screen.
 */
type Loadable = { status: Ref<string>; fetchStatus: Ref<string> };
export function loaded(...qs: Loadable[]): Promise<void> {
  const done = () => qs.every((q) => q.status.value !== "pending" || q.fetchStatus.value === "idle");
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(t); stop(); resolve(); };
    const t = setTimeout(finish, 1500);
    const stop = watch(done, (d) => { if (d) finish(); });
  });
}

/** A change: runs the call, refreshes what it touched on this device at once, and shows any error. */
export function useChange<A extends unknown[], R>(fn: (...a: A) => Promise<R>, topics: string[]) {
  const m = useMutation({ mutationFn: (a: A) => fn(...a), onSuccess: () => invalidate(topics), onError: toastError });
  return { run: (...a: A) => m.mutateAsync(a), busy: m.isPending };
}

/** Settings change, applied to the cache straight away so the screen does not wait for the server. */
// Saves go one after another: quick taps each build on the last one instead of racing and overwriting it.
let saving: Promise<unknown> = Promise.resolve();
// Refetch only once the last queued save is done: a refetch between two saves would bring back the older
// settings over the newer ones already shown, and a tap in that gap would build on the stale copy.
let pending = 0;
// quiet: for saves that aren't the person changing a setting (a dismissed suggestion) or that already say something
export function saveSettings(patch: Partial<Settings> | Record<string, unknown>, o: { quiet?: boolean } = {}) {
  // a settings fetch already under way would land after this change and undo it on screen
  void queryClient.cancelQueries({ queryKey: ["settings", "me"] });
  queryClient.setQueryData(["settings", "me"], (m: any) => m && { ...m, settings: mergePatch(m.settings, patch) });
  pending++;
  saving = saving.then(async () => {
    try { await api.put("/settings", patch); if (!o.quiet) savedToast(); } catch (e) { savedError(e); }
    if (--pending === 0) invalidate([...TOPICS.settings]);
  });
  return saving;
}
// the same merge the server does: objects merge, anything else (lists included) replaces
function mergePatch(a: any, b: any): any {
  if (Array.isArray(b) || b === null || typeof b !== "object") return b;
  const o = { ...(a && typeof a === "object" && !Array.isArray(a) ? a : {}) };
  for (const k of Object.keys(b)) o[k] = mergePatch(o[k], b[k]);
  return o;
}
