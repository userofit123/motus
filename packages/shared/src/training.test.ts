import { describe, expect, it } from "vitest";
import { estimate, routineTime, setSeconds, usualDuration, CHANGEOVER_S, liftedKg, trackingFor, retimeSet, restAfterSet, planSetRest, isStretch } from "./training";
import { restDefaultsOf, withDefaults } from "./settings";
import { TEMPLATES } from "./templates";

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
    expect(usualDuration([3600, 3300, 3900, 1200 * 3])).toEqual({ s: 3600, of: 3, newest: true });
  });
  it("leaves out given-up, left-running and odd sessions", () => {
    // 2 min (given up), 6 h (left running) are skipped; 20 min is way under the usual hour
    expect(usualDuration([120, 6 * 3600, 3600, 3700, 1200])).toEqual({ s: 3650, of: 2, newest: false });
  });
  it("says when the newest workout is not part of it", () => {
    expect(usualDuration([120, 3600])).toEqual({ s: 3600, of: 1, newest: false });
    expect(usualDuration([3600])).toEqual({ s: 3600, of: 1, newest: true });
  });
  it("never drops the newest usable workout, so a routine that got much longer shows it", () => {
    // newest is over twice the median of the last 3 usable ones, yet it still counts
    expect(usualDuration([7000, 3000, 3100])).toEqual({ s: Math.round(13100 / 3), of: 3, newest: true });
    // only the last 3 usable ones count, so an old short session can't hold "usually" down
    expect(usualDuration([5000, 5200, 5100, 1000])).toEqual({ s: 5100, of: 3, newest: true });
  });
  it("is null with nothing usable", () => {
    expect(usualDuration([])).toBeNull();
    expect(usualDuration([60, 200])).toBeNull();
  });
});

describe("routineTime", () => {
  it("says which kind of time it is", () => {
    expect(routineTime(3300, null)).toBe("about 55m");
    expect(routineTime(3300, { s: 3480, of: 3, newest: true })).toBe("usually 58m");
    expect(routineTime(3300, { s: 3480, of: 1, newest: true })).toBe("58m last time");
    // the newest workout was given up, so the one kept is an older one: not "last time"
    expect(routineTime(3300, usualDuration([120, 3480]))).toBe("usually 58m");
  });
});

describe("timed sets", () => {
  it("lift weight × reps only when counted in reps with a load", () => {
    expect(liftedKg(40, 8, "weight_reps")).toBe(320);
    expect(liftedKg(40, 8, "weight_duration")).toBe(0);
    expect(liftedKg(40, 8, "assisted")).toBe(0);
  });
  it("keep a bodyweight exercise's optional added weight when done for time", () => {
    expect(trackingFor("bodyweight_reps", true)).toBe("weight_duration");
    expect(trackingFor("assisted", true)).toBe("duration");
  });
  it("start a switched set like a new exercise's, weight kept", () => {
    expect(retimeSet({ reps: 10, durationS: null }, "weight_duration")).toEqual({ reps: null, durationS: 30 });
    expect(retimeSet({ reps: null, durationS: 45 }, "weight_reps")).toEqual({ reps: 8, durationS: null });
    expect(retimeSet({ reps: null, durationS: 45 }, "duration")).toBeNull();
  });
});

describe("stretch rests", () => {
  const d = { ...restDefaultsOf(withDefaults({}).workout), byKindS: { warmup: 60 } };
  const stretch = { category: "stretching" }, plank = { category: "strength" };
  const kinds = (...k: string[]) => k.map((kind) => ({ kind, side: null }));
  it("defaults to 10 s between sets and 15 s before the next exercise", () => {
    expect([d.stretchBetweenS, d.stretchAfterS]).toEqual([10, 15]);
  });
  it("is keyed on the category, so a plank held for time rests like lifting", () => {
    expect(isStretch(stretch)).toBe(true);
    expect(isStretch(plank)).toBe(false);
    expect(isStretch(undefined)).toBe(false);
    expect([0, 1].map((i) => planSetRest(kinds("normal", "normal"), i, { exercise: stretch }, d))).toEqual([10, 15]);
    expect([0, 1].map((i) => planSetRest(kinds("normal", "normal"), i, { exercise: plank }, d))).toEqual([d.betweenSetsS, d.afterExerciseS]);
  });
  it("rests a stretch's other kinds of set by the stretch default too, unless the routine sets one", () => {
    expect(restAfterSet({ kind: "warmup", stretch: true, isLastSet: false }, d)).toBe(10);
    expect(restAfterSet({ kind: "warmup", stretch: true, byKindS: { warmup: 20 }, isLastSet: false }, d)).toBe(20);
    expect(restAfterSet({ kind: "warmup", isLastSet: false }, d)).toBe(60);
  });
  it("lets anything more specific win: the set's own, the routine exercise's, the exercise default", () => {
    const o = { stretch: true, isLastSet: false };
    expect(restAfterSet({ ...o, setRestS: 40 }, d)).toBe(40);
    expect(restAfterSet({ ...o, exRestS: 30 }, d)).toBe(30);
    expect(restAfterSet({ ...o, prefRestS: 25 }, d)).toBe(25);
    expect(restAfterSet({ ...o, isLastSet: true, exRestAfterS: 45 }, d)).toBe(45);
    expect(restAfterSet({ ...o, isLastSet: true, prefRestAfterS: 35 }, d)).toBe(35);
  });
  it("keeps no rest inside a left and right round or before a drop", () => {
    expect(restAfterSet({ stretch: true, sideRound: true, isLastSet: false }, d)).toBe(0);
    expect(restAfterSet({ stretch: true, nextKind: "drop", isLastSet: false }, d)).toBe(0);
  });
  it("follows the person's own stretch defaults", () => {
    const mine = restDefaultsOf(withDefaults({ workout: { restStretchBetweenS: 5, restStretchAfterS: 20 } }).workout);
    expect([0, 1].map((i) => planSetRest(kinds("normal", "normal"), i, { exercise: stretch }, mine))).toEqual([5, 20]);
  });
  it("Daily stretch sets no rest of its own, so it follows the stretch defaults", () => {
    expect(TEMPLATES.find((t) => t.name === "Daily stretch")!.exercises.every((e) => e.restS == null)).toBe(true);
  });
});
