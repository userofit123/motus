// What a plan on Home does, the same in Today and Up next: Start starts the routine or records the activity (back to
// the recording already running). Today's plans also get a ⋮ menu that logs one as done instead: a workout on the log
// page with the routine filled in, an activity in its sheet (Up next has none: those days haven't come yet).
import type { Router } from "vue-router";
import type { HomePlan } from "@motus/shared";
import type { MenuItem } from "../Menu.vue";
import { activitySheet } from "../../core/ui";
import { recordPath } from "../../workout/recording";

export const startPlan = (router: Router, p: HomePlan) =>
  router.push(p.routineId ? `/routines/${p.routineId}/start${p.scheduleId ? `?schedule=${p.scheduleId}&date=${p.date}` : ""}` : recordPath(p.activityType));

export const planMenu = (router: Router, p: HomePlan): MenuItem[] => [{
  label: "Log it", icon: "plus",
  run: () => (p.routineId ? router.push(`/log?routine=${p.routineId}`) : (activitySheet.value = { type: p.activityType ?? undefined })),
}];
