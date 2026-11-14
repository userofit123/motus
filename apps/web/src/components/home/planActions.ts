// What a plan does, the same on Home, in the calendar and on the routine's page. Start starts the routine or records the
// activity (back to the recording already running). Every plan's ⋮ takes it off the calendar (unplanItems): a repeating
// plan skips one day or goes for every day, a one-off plan is removed. Today's plans also log it as done instead: a
// workout on the log page with the routine filled in, an activity in its sheet. Days still to come only skip or remove.
import type { Router } from "vue-router";
import { TOPICS as LIVE, type HomePlan, type Schedule } from "@motus/shared";
import type { MenuItem } from "../Menu.vue";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { confirm } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { logSheet, activitySheet } from "../../core/ui";
import { recordPath } from "../../workout/recording";

export const startPlan = (router: Router, p: HomePlan) =>
  router.push(p.routineId ? `/routines/${p.routineId}/start${p.scheduleId ? `?schedule=${p.scheduleId}&date=${p.date}` : ""}` : recordPath(p.activityType));

type Unplan = Pick<HomePlan, "scheduleId" | "date" | "name" | "repeats">;
const TOPICS = [...LIVE.schedule];
const exception = (p: Unplan, clear: boolean) => api.post(`/schedules/${p.scheduleId}/exception`, { date: p.date, clear }).then(() => invalidate(TOPICS));

/** Removing a plan, the same everywhere (calendar, Home, the routine's page): a repeating one asks first, as all its days
 * go; a one-off one goes at once with Undo, which plans it again as it was (a new schedule with the same fields). */
export async function removeSchedule(p: Pick<Unplan, "scheduleId" | "name" | "repeats">) {
  if (p.repeats && !(await confirm(`Remove ${p.name} from the calendar?`, { text: "All its planned days go. Workouts you did stay in your history.", ok: "Remove", danger: true }))) return;
  // the one-off plan as it is now, to plan it again on Undo
  const was = p.repeats ? undefined : (await api.get<Schedule[]>("/schedules")).find((x) => x.id === p.scheduleId);
  await api.del(`/schedules/${p.scheduleId}`);
  invalidate(TOPICS);
  toast("Removed from the calendar", was ? { action: { label: "Undo", run: () => api.post("/schedules", {
    routineId: was.routineId, activityType: was.activityType, rule: was.rule, days: was.days, intervalDays: was.intervalDays,
    startDate: was.startDate, endDate: was.endDate, timeOfDay: was.timeOfDay, remindMin: was.remindMin,
  }).then(() => invalidate(TOPICS)).catch(toastError) } } : undefined);
}

/** The ⋮ item that removes a plan: "Remove all days" for a repeating one (beside Skip this day), "Remove" for a one-off. */
export const removeItem = (p: Pick<Unplan, "scheduleId" | "name" | "repeats">, sep = true): MenuItem =>
  ({ label: p.repeats ? "Remove all days" : "Remove", icon: "trash", danger: true, sep, run: () => removeSchedule(p).catch(toastError) });

/** Taking a plan off the calendar: a repeating one skips just this day (the schedule's exception, undoable) or goes for
 * every day; a one-off plan is removed, as skipping its only day would leave an empty schedule behind. */
export const unplanItems = (p: Unplan, sep = false): MenuItem[] => p.repeats
  ? [
      { label: "Skip this day", icon: "skip", sep, run: () => exception(p, false).then(() => toast("Day skipped", { action: { label: "Undo", run: () => exception(p, true).catch(toastError) } })).catch(toastError) },
      removeItem(p),
    ]
  : [removeItem(p, sep)];

export const planMenu = (router: Router, p: HomePlan): MenuItem[] => [{
  label: "Log it", icon: "plus",
  run: () => (p.routineId ? (logSheet.value = { routineId: p.routineId }) : (activitySheet.value = { type: p.activityType ?? undefined })),
}, ...unplanItems(p, true)];
