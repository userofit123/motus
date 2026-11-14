import { describe, expect, it } from "vitest";
import { GOAL_METRICS, goalAutoTitle } from "./goals";
import type { Goal } from "./types";

type G = Pick<Goal, "scope" | "scopeId" | "metric" | "comparator" | "target" | "period" | "days">;
const goal = (metric: string, p: Partial<G> = {}): G => {
  const m = GOAL_METRICS.find((x) => x.metric === metric)!;
  return { scope: m.scope, scopeId: null, metric, comparator: m.comparator ?? ">=", target: 1, period: m.periodic ? "week" : "once", days: null, ...p };
};
const lb = { weight: "lb", distance: "mi", length: "in" } as const;

describe("goalAutoTitle", () => {
  it("reads naturally for every measure", () => {
    const t: Record<string, string> = {
      workouts: goalAutoTitle(goal("workouts", { target: 3 })),
      active_minutes: goalAutoTitle(goal("active_minutes", { target: 150 })),
      streak_weeks: goalAutoTitle(goal("streak_weeks", { target: 8 })),
      volume: goalAutoTitle(goal("volume", { target: 20000 })),
      routine_count: goalAutoTitle(goal("routine_count", { target: 2 }), { name: "Push day" }),
      routine_duration: goalAutoTitle(goal("routine_duration", { target: 45 }), { name: "Push day" }),
      routine_volume: goalAutoTitle(goal("routine_volume", { target: 5000 }), { name: "Push day" }),
      max_weight: goalAutoTitle(goal("max_weight", { target: 100 }), { name: "Bench press" }),
      e1rm: goalAutoTitle(goal("e1rm", { target: 100 }), { name: "Bench press" }),
      max_reps: goalAutoTitle(goal("max_reps", { target: 15 }), { name: "Pull-up" }),
      max_duration: goalAutoTitle(goal("max_duration", { target: 90 }), { name: "Plank" }),
      exercise_count: goalAutoTitle(goal("exercise_count", { target: 1 }), { name: "Squat" }),
      muscle_sets: goalAutoTitle(goal("muscle_sets", { target: 12 }), { name: "Chest" }),
      muscle_sessions: goalAutoTitle(goal("muscle_sessions", { target: 2 }), { name: "Legs" }),
      sessions: goalAutoTitle(goal("sessions", { target: 3 })),
      activity_distance: goalAutoTitle(goal("activity_distance", { target: 30, period: "month", scopeId: "walk" }), { name: "Walk" }),
      activity_count: goalAutoTitle(goal("activity_count", { target: 3, scopeId: "run" }), { name: "Run" }),
      activity_minutes: goalAutoTitle(goal("activity_minutes", { target: 30, period: "day", scopeId: "walk" }), { name: "Walk" }),
      steps_avg: goalAutoTitle(goal("steps_avg", { target: 10000, period: "day" })),
      sleep_h: goalAutoTitle(goal("sleep_h", { target: 7 })),
      body_weight: goalAutoTitle(goal("body_weight", { target: 75, comparator: "<=" })),
      body_metric: goalAutoTitle(goal("body_metric", { target: 38, scopeId: "arm_l" })),
    };
    expect(Object.keys(t).sort()).toEqual(GOAL_METRICS.map((m) => m.metric).sort());
    expect(t).toEqual({
      workouts: "3 workouts a week",
      active_minutes: "150 active minutes a week",
      streak_weeks: "8 weeks in a row reaching your weekly goal",
      volume: "Lift 20,000 kg a week",
      routine_count: "Push day twice a week",
      routine_duration: "Finish Push day within 45 min",
      routine_volume: "Lift 5,000 kg in one Push day",
      max_weight: "Bench press 100 kg",
      e1rm: "Bench press estimated 1RM 100 kg",
      max_reps: "Pull-up 15 reps in a set",
      max_duration: "Plank hold 1 min 30 s",
      exercise_count: "Squat once a week",
      muscle_sets: "12 chest sets a week",
      muscle_sessions: "Train legs twice a week",
      sessions: "3 sessions a week",
      activity_distance: "Walk 30 km a month",
      activity_count: "Run 3 times a week",
      activity_minutes: "Walk 30 min a day",
      steps_avg: "10,000 steps a day",
      sleep_h: "Average 7h of sleep a night",
      body_weight: "Body weight down to 75 kg",
      body_metric: "Upper arm (left) up to 38 cm",
    });
  });
  it("says every period", () => {
    const walk = (p: Partial<G>) => goalAutoTitle(goal("activity_minutes", { target: 30, scopeId: "walk", ...p }), { name: "Walk", firstDay: 1 });
    expect(walk({ period: "day" })).toBe("Walk 30 min a day");
    expect(walk({ period: "day", days: "workdays" })).toBe("Walk 30 min on workdays");
    expect(walk({ period: "day", days: [5, 0, 1] })).toBe("Walk 30 min on Mon, Fri, Sun");
    expect(walk({ period: "day", days: [0, 1, 2, 3, 4, 5, 6] })).toBe("Walk 30 min a day");
    expect(walk({ period: "week" })).toBe("Walk 30 min a week");
    expect(walk({ period: "month" })).toBe("Walk 30 min a month");
    expect(walk({ period: "once" })).toBe("Walk 30 min in total");
    expect(goalAutoTitle(goal("sleep_h", { target: 8, period: "day" }))).toBe("Sleep 8h a night");
    expect(goalAutoTitle(goal("sleep_h", { target: 7.5, period: "month" }))).toBe("Average 7h 30m of sleep a night");
    expect(goalAutoTitle(goal("steps_avg", { target: 8000, period: "week" }))).toBe("Average 8,000 steps a day");
  });
  it("names everything, gym workouts and any activity plainly", () => {
    expect(goalAutoTitle(goal("sessions", { target: 1, scopeId: "workout" }))).toBe("1 workout a week");
    expect(goalAutoTitle(goal("sessions", { target: 4, scopeId: "walk" }), { name: "Walk" })).toBe("Walk 4 times a week");
    expect(goalAutoTitle(goal("activity_minutes", { target: 60 }))).toBe("60 min of activity a week");
    expect(goalAutoTitle(goal("activity_distance", { target: 20 }))).toBe("20 km a week");
  });
  it("shows your units", () => {
    expect(goalAutoTitle(goal("e1rm", { target: 100 }), { name: "Squat", units: lb })).toBe("Squat estimated 1RM 220.5 lb");
    expect(goalAutoTitle(goal("activity_distance", { target: 16.09344, scopeId: "run", period: "month" }), { name: "Run", units: lb })).toBe("Run 10 mi a month");
    expect(goalAutoTitle(goal("body_metric", { target: 81.28, scopeId: "waist", comparator: "<=" }), { units: lb })).toBe("Waist down to 32 in");
    expect(goalAutoTitle(goal("body_metric", { target: 15, scopeId: "body_fat", comparator: "<=" }))).toBe("Body fat down to 15%");
  });
});
