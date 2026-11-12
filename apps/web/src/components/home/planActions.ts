// What a plan on Home does, the same in Today and Up next: Start starts the routine or records the activity (back to
// the recording already running). Today's plans also get a ⋮ menu that logs one as done instead: a workout on the log
// page with the routine filled in, an activity in its sheet. Every plan's ⋮ (here and in the calendar) can take it off
// the calendar (unplanItems).
import type { Router } from "vue-router";
import type { HomePlan } from "@motus/shared";
import type { MenuItem } from "../Menu.vue";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { confirm } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { activitySheet } from "../../core/ui";
import { recordPath } from "../../workout/recording";

export const startPlan = (router: Router, p: HomePlan) =>
  router.push(p.routineId ? `/routines/${p.routineId}/start${p.scheduleId ? `?schedule=${p.scheduleId}&date=${p.date}` : ""}` : recordPath(p.activityType));

type Unplan = Pick<HomePlan, "scheduleId" | "date" | "name" | "repeats">;
const TOPICS = ["schedules", "calendar", "home"];
const exception = (p: Unplan, clear: boolean) => api.post(`/schedules/${p.scheduleId}/exception`, { date: p.date, clear }).then(() => invalidate(TOPICS));

async function removeSchedule(p: Unplan) {
  if (p.repeats && !(await confirm(`Remove ${p.name} from the calendar?`, { text: "Every day it repeats on goes. Workouts you did stay in your history.", ok: "Remove", danger: true }))) return;
  await api.del(`/schedules/${p.scheduleId}`);
  invalidate(TOPICS);
  toast(p.repeats ? "Schedule removed" : "Plan removed");
}

/** Taking a plan off the calendar: a repeating one skips just this day (the schedule's exception, undoable) or goes for
 * every day; a one-off plan is removed, as skipping its only day would leave an empty schedule behind. */
export const unplanItems = (p: Unplan, sep = false): MenuItem[] => p.repeats
  ? [
      { label: "Skip this day", icon: "close", sep, run: () => exception(p, false).then(() => toast("Day skipped", { action: { label: "Undo", run: () => exception(p, true).catch(toastError) } })).catch(toastError) },
      { label: "Remove all days", icon: "trash", danger: true, sep: true, run: () => removeSchedule(p).catch(toastError) },
    ]
  : [{ label: "Remove", icon: "trash", danger: true, sep, run: () => removeSchedule(p).catch(toastError) }];

export const planMenu = (router: Router, p: HomePlan): MenuItem[] => [{
  label: "Log it", icon: "plus",
  run: () => (p.routineId ? router.push(`/log?routine=${p.routineId}`) : (activitySheet.value = { type: p.activityType ?? undefined })),
}, ...unplanItems(p, true)];
