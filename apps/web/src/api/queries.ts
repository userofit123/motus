// Every screen's data, filed under a topic (the first part of the key) so live updates know what to reload.
import { computed, type Ref, unref, type MaybeRef } from "vue";
import { useQuery, useMutation } from "@tanstack/vue-query";
import { withDefaults, type Settings, type Exercise, type RoutineSummary, type Goal, type Me } from "@motus/shared";
import { api } from "./client";
import { invalidate, queryClient } from "./live";
import { toastError } from "../core/toast";

export const useMe = () => useQuery({ queryKey: ["settings", "me"], queryFn: () => api.get<{ user: Me; settings: Settings }>("/me"), staleTime: 60_000 });
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
export const usePreview = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["routines", "preview", unref(id)]), queryFn: () => api.get(`/routines/${unref(id)}/preview`), enabled: computed(() => !!unref(id)) });
export const useActive = () => useQuery({ queryKey: ["workouts", "active"], queryFn: () => api.get("/workouts/active"), staleTime: 5_000 });
export const useWorkout = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["workouts", unref(id)]), queryFn: () => api.get(`/workouts/${unref(id)}`), enabled: computed(() => !!unref(id)) });
export const useWorkouts = (params: MaybeRef<Record<string, unknown>> = {}) => useQuery({ queryKey: computed(() => ["workouts", "list", unref(params)]), queryFn: () => api.get("/workouts", unref(params)) });
export const useHome = () => useQuery({ queryKey: ["home"], queryFn: () => api.get("/home", { tz: new Date().getTimezoneOffset() }) });
export const useGoals = (all = false) => useQuery({ queryKey: ["goals", all], queryFn: () => api.get<Goal[]>("/goals", { all: all ? 1 : undefined }) });
export const useGoalMetrics = () => useQuery({ queryKey: ["static", "metrics"], queryFn: () => api.get("/goal-metrics"), staleTime: Infinity });
export const useStats = (range: MaybeRef<{ from?: string; to?: string }>) => useQuery({ queryKey: computed(() => ["stats", unref(range)]), queryFn: () => api.get("/stats", unref(range)) });
export const useCalendar = (range: MaybeRef<{ from: string; to: string }>) => useQuery({ queryKey: computed(() => ["calendar", unref(range)]), queryFn: () => api.get("/calendar", unref(range)) });
export const useNotes = (type: MaybeRef<string>, id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["notes", unref(type), unref(id)]), queryFn: () => api.get("/notes", { targetType: unref(type), targetId: unref(id) }), enabled: computed(() => !!unref(id)) });
export const useReminders = (params: MaybeRef<Record<string, unknown>> = {}) => useQuery({ queryKey: computed(() => ["reminders", unref(params)]), queryFn: () => api.get("/reminders", unref(params)) });
export const useActivities = (params: MaybeRef<Record<string, unknown>> = {}) => useQuery({ queryKey: computed(() => ["activities", unref(params)]), queryFn: () => api.get("/activities", unref(params)) });
export const useActivity = (id: MaybeRef<string>) => useQuery({ queryKey: computed(() => ["activities", "one", unref(id)]), queryFn: () => api.get(`/activities/${unref(id)}`), enabled: computed(() => !!unref(id)) });
export const useActivityTypes = () => useQuery({ queryKey: ["activities", "types"], queryFn: () => api.get("/activity-types"), staleTime: 5 * 60_000 });
export const useBody = (kind?: string) => useQuery({ queryKey: ["body", kind ?? "all"], queryFn: () => api.get("/body", { kind }) });
export const useSchedules = () => useQuery({ queryKey: ["schedules"], queryFn: () => api.get("/schedules") });
export const useTemplates = () => useQuery({ queryKey: ["static", "templates"], queryFn: () => api.get("/templates"), staleTime: Infinity });
export const useAchievements = () => useQuery({ queryKey: ["stats", "achievements"], queryFn: () => api.get("/achievements") });

/** A change: runs the call, refreshes what it touched on this device at once, and shows any error. */
export function useChange<A extends unknown[], R>(fn: (...a: A) => Promise<R>, topics: string[]) {
  const m = useMutation({ mutationFn: (a: A) => fn(...a), onSuccess: () => invalidate(topics), onError: toastError });
  return { run: (...a: A) => m.mutateAsync(a), busy: m.isPending };
}

/** Settings change, applied to the cache straight away so the screen does not wait for the server. */
// Saves go one after another: quick taps each build on the last one instead of racing and overwriting it.
let saving: Promise<unknown> = Promise.resolve();
export function saveSettings(patch: Partial<Settings> | Record<string, unknown>) {
  queryClient.setQueryData(["settings", "me"], (m: any) => m && { ...m, settings: mergePatch(m.settings, patch) });
  saving = saving.then(async () => {
    try { await api.put("/settings", patch); } catch (e) { toastError(e); }
    invalidate(["settings", "home", "stats", "goals"]);
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
