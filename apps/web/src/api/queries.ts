// Every screen's data, filed under a topic (the first part of the key) so live updates know what to reload.
import { computed, type Ref, unref, watch, type MaybeRef } from "vue";
import { useQuery, useMutation, useInfiniteQuery, type QueryClient } from "@tanstack/vue-query";
import { withDefaults, type Settings, type Exercise, type RoutineSummary, type Goal, type Me, type Program, type GoalMetric, type HomeData } from "@motus/shared";
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
export const useWorkouts = (params: MaybeRef<Record<string, unknown>> = {}) => useQuery({ queryKey: computed(() => ["workouts", "list", unref(params)]), queryFn: () => api.get("/workouts", unref(params)) });
export const useHome = () => useQuery({ queryKey: ["home"], queryFn: () => api.get<HomeData>("/home", { tz: new Date().getTimezoneOffset() }) });
export const useGoals = (all = false) => useQuery({ queryKey: ["goals", all], queryFn: () => api.get<Goal[]>("/goals", { all: all ? 1 : undefined, tz: new Date().getTimezoneOffset() }) });
export const useGoalDetail = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["goals", "detail", unref(id)]), queryFn: () => api.get<any>(`/goals/${unref(id)}/detail`, { tz: new Date().getTimezoneOffset() }), enabled: computed(() => !!unref(id)) });
export const useGoalMetrics = () => useQuery({ queryKey: ["static", "metrics"], queryFn: () => api.get<GoalMetric[]>("/goal-metrics"), staleTime: Infinity });
export const useStats = (range: MaybeRef<{ from?: string; to?: string }>) => useQuery({ queryKey: computed(() => ["stats", unref(range)]), queryFn: () => api.get("/stats", { ...unref(range), tz: new Date().getTimezoneOffset() }) });
export const useCalendar = (range: MaybeRef<{ from: string; to: string }>) => useQuery({ queryKey: computed(() => ["calendar", unref(range)]), queryFn: () => api.get("/calendar", { ...unref(range), tz: new Date().getTimezoneOffset() }) });
export const useNotes = (type: MaybeRef<string>, id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["notes", unref(type), unref(id)]), queryFn: () => api.get("/notes", { targetType: unref(type), targetId: unref(id) }), enabled: computed(() => !!unref(id)) });
export const useReminders = (params: MaybeRef<Record<string, unknown>> = {}) => useQuery({ queryKey: computed(() => ["reminders", unref(params)]), queryFn: () => api.get("/reminders", unref(params)) });
export const useActivities = (params: MaybeRef<Record<string, unknown>> = {}) => useQuery({ queryKey: computed(() => ["activities", unref(params)]), queryFn: () => api.get("/activities", unref(params)) });
export const useActivity = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["activities", "one", unref(id)]), queryFn: () => api.get(`/activities/${unref(id)}`), enabled: computed(() => !!unref(id)) });
export const useActivityTypes = () => useQuery({ queryKey: ["activities", "types"], queryFn: () => api.get("/activity-types"), staleTime: 5 * 60_000 });
export const useBody = (kind?: string) => useQuery({ queryKey: ["body", kind ?? "all"], queryFn: () => api.get("/body", { kind }) });
export const useSchedules = () => useQuery({ queryKey: ["schedules"], queryFn: () => api.get("/schedules") });
export const useTemplates = () => useQuery({ queryKey: ["static", "templates"], queryFn: () => api.get("/templates"), staleTime: Infinity });
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
    if (--pending === 0) invalidate(["settings", "home", "stats", "goals"]);
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
