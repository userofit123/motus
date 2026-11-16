import { describe, expect, it } from "vitest";
import { stillStretch, currentStreak, typicalHour } from "./stepsInsights";

const H = 3600_000;
const day = (vals: number[]) => vals.map((value, i) => ({ a: i * H, value }));
const never = () => false;

describe("long stretch with little walking", () => {
  it("finds the longest run between the first and last active hour", () => {
    // night (0-6) left out; 9-12 is still for 3 hours, 14-15 for 2
    const h = day([0, 0, 0, 0, 0, 0, 0, 800, 600, 100, 50, 120, 900, 400, 30, 10, 700, 0, 0]);
    expect(stillStretch(h, never)).toEqual({ from: 9 * H, to: 12 * H, hours: 3, steps: 270 });
  });
  it("is none under 2 hours or without an active hour on both sides", () => {
    expect(stillStretch(day([800, 100, 800]), never)).toBeNull();
    expect(stillStretch(day([0, 0, 800, 0, 0, 0]), never)).toBeNull();
  });
  it("lets a workout break the run and leaves out hours not over yet", () => {
    const h = day([800, 10, 10, 10, 10, 800]);
    expect(stillStretch(h, (a) => a === 2 * H || a === 3 * H)).toBeNull();
    expect(stillStretch(h, never, 5 * H)).toBeNull();
    expect(stillStretch(h, never)?.hours).toBe(4);
  });
});

describe("current streak", () => {
  const days = ["d1", "d2", "d3", "d4", "d5"];
  it("counts back from today once today reached the goal", () => {
    expect(currentStreak(days, (d) => d !== "d2")).toEqual({ days: 3, since: "d3", todayDone: true, more: false });
  });
  it("keeps a run ending yesterday while today is still going", () => {
    expect(currentStreak(days, (d) => d !== "d5" && d !== "d1")).toEqual({ days: 3, since: "d2", todayDone: false, more: false });
  });
  it("says when the run may go further back than the days given", () => {
    expect(currentStreak(days, () => true)).toEqual({ days: 5, since: "d1", todayDone: true, more: true });
    expect(currentStreak(days, () => false)).toEqual({ days: 0, since: null, todayDone: false, more: false });
  });
});

describe("usual busiest hour", () => {
  it("averages each hour over the days with steps", () => {
    const h = [
      { day: "a", hour: 8, value: 900 }, { day: "a", hour: 18, value: 1200 },
      { day: "b", hour: 8, value: 1000 }, { day: "b", hour: 18, value: 600 },
      { day: "c", hour: 8, value: 800 }, { day: "c", hour: 18, value: 600 },
    ];
    expect(typicalHour(h)).toEqual({ hour: 8, avg: 900, days: 3 });
  });
  it("is none under 3 days", () => {
    expect(typicalHour([{ day: "a", hour: 8, value: 900 }, { day: "b", hour: 8, value: 900 }])).toBeNull();
  });
});
