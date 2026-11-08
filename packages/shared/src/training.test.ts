import { describe, expect, it } from "vitest";
import { estimate, routineTime, setSeconds, usualDuration, CHANGEOVER_S } from "./training";

describe("estimate", () => {
  it("counts each set's work, the rests between sets and a changeover per exercise", () => {
    const sets = (n: number) => Array.from({ length: n }, () => ({ kind: "normal" as const, reps: 10, durationS: null, restS: 90 }));
    // 6 exercises × 4 sets of 10 with 90 s rests: about an hour, not 40 minutes
    const e = estimate(Array.from({ length: 6 }, () => ({ sets: sets(4) })));
    expect(e.workS).toBe(24 * 55);
    expect(e.restS).toBe(23 * 90); // no rest after the very last set
    expect(e.changeS).toBe(6 * CHANGEOVER_S);
    expect(e.totalS).toBe(e.workS + e.restS + e.changeS);
    expect(e.totalS / 60).toBeGreaterThan(55);
  });
  it("uses a timed set's own time, and leaves out exercises with no sets", () => {
    expect(setSeconds({ reps: null, durationS: 60 })).toBe(70);
    expect(setSeconds({ reps: 1, durationS: null })).toBe(20);
    expect(estimate([{ sets: [] }]).totalS).toBe(0);
  });
});

describe("usualDuration", () => {
  it("averages the last 3 workouts", () => {
    expect(usualDuration([3600, 3300, 3900, 1200 * 3])).toEqual({ s: 3600, of: 3 });
  });
  it("leaves out given-up, left-running and odd sessions", () => {
    // 2 min (given up), 6 h (left running), 20 min (way under the usual hour)
    expect(usualDuration([120, 6 * 3600, 1200, 3600, 3700, 3500])).toEqual({ s: 3600, of: 3 });
  });
  it("is null with nothing usable", () => {
    expect(usualDuration([])).toBeNull();
    expect(usualDuration([60, 200])).toBeNull();
  });
});

describe("routineTime", () => {
  it("says which kind of time it is", () => {
    expect(routineTime(3300, null)).toBe("about 55m");
    expect(routineTime(3300, { s: 3480, of: 3 })).toBe("usually 58m");
    expect(routineTime(3300, { s: 3480, of: 1 })).toBe("58m last time");
  });
});
