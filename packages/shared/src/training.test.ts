import { describe, expect, it } from "vitest";
import { estimate, routineTime, setSeconds, usualDuration, CHANGEOVER_S, liftedKg, trackingFrom, trackingParts, trackingLabel, weightKindsFor, refitSet, newSetFor, progresses, TRACKINGS, COUNTED_BY, usesWeight, usesReps, usesDuration, usesDistance, restAfterSet, planSetRest, isStretch } from "./training";
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

describe("track by", () => {
  it("lift weight × reps only when counted in reps with a load", () => {
    expect(liftedKg(40, 8, "weight_reps")).toBe(320);
    expect(liftedKg(16, 30, "weight_reps_duration")).toBe(480);
    expect(liftedKg(40, 8, "weight_duration")).toBe(0);
    expect(liftedKg(40, 8, "assisted")).toBe(0);
  });
  it("makes every tracking from its two choices and back", () => {
    for (const t of TRACKINGS) { const p = trackingParts(t); expect(trackingFrom(p.counted, p.weight)).toBe(t); }
    const all = COUNTED_BY.flatMap((c) => weightKindsFor(c.value).map((w) => trackingFrom(c.value, w.value)));
    expect(new Set(all).size).toBe(TRACKINGS.length);
    expect(TRACKINGS).toHaveLength(12);
  });
  it("offers added weight and assistance only with reps, falling back when the counting changes", () => {
    expect(weightKindsFor("reps").map((w) => w.value)).toEqual(["none", "weight", "added", "assisted"]);
    expect(weightKindsFor("time").map((w) => w.value)).toEqual(["none", "weight"]);
    // a weighted push-up done for time keeps its weight (a weighted plank); assisted help isn't weight held
    expect(trackingFrom("time", "added")).toBe("weight_duration");
    expect(trackingFrom("time", "assisted")).toBe("duration");
    expect(trackingFrom("distance_time", "weight")).toBe("distance_weight_duration");
    expect(trackingFrom("reps_time", "weight")).toBe("weight_reps_duration");
    expect(trackingFrom("distance", "none")).toBe("distance");
  });
  it("answers which columns each combination has", () => {
    const cols = (t: any) => [usesWeight(t), usesReps(t), usesDuration(t), usesDistance(t)];
    expect(cols("distance")).toEqual([false, false, false, true]);
    expect(cols("distance_weight_duration")).toEqual([true, false, true, true]);
    expect(cols("reps_duration")).toEqual([false, true, true, false]);
    expect(cols("weight_reps_duration")).toEqual([true, true, true, false]);
    expect(cols("bodyweight_reps")).toEqual([true, true, false, false]);
    expect(cols("duration")).toEqual([false, false, true, false]);
  });
  it("says it in words", () => {
    expect(trackingLabel("weight_duration")).toBe("Time + weight");
    expect(trackingLabel("distance_weight_duration")).toBe("Distance + time + weight");
    expect(trackingLabel("reps_only")).toBe("Reps");
  });
  it("progresses only weight and reps without a clock", () => {
    expect(progresses("weight_reps")).toBe(true);
    expect(progresses("assisted")).toBe(true);
    expect(progresses("weight_reps_duration")).toBe(false);
    expect(progresses("weight_duration")).toBe(false);
  });
  it("starts a changed set like a new exercise's, weight kept while it stays a load", () => {
    expect(refitSet({ reps: 10, durationS: null, weightKg: 20 }, "weight_reps", "weight_duration")).toEqual({ reps: null, durationS: 30, distanceM: null, weightKg: 20 });
    expect(refitSet({ reps: null, durationS: 45, weightKg: 20 }, "weight_duration", "duration")).toEqual({ reps: null, durationS: 45, distanceM: null, weightKg: null });
    expect(refitSet({ reps: null, durationS: 45 }, "duration", "reps_only")).toEqual({ reps: 8, durationS: null, distanceM: null, weightKg: null });
    expect(refitSet({ reps: null, durationS: 45, weightKg: null }, "duration", "duration")).toBeNull();
    // help taken off isn't a load
    expect(refitSet({ reps: 8, weightKg: 20 }, "assisted", "weight_reps")?.weightKg).toBeNull();
    // a ruck plans its distance, not its time
    expect(refitSet({ reps: 8, weightKg: 10 }, "weight_reps", "distance_weight_duration")).toEqual({ reps: null, durationS: null, distanceM: 400, weightKg: 10 });
    expect(newSetFor("reps_duration")).toEqual({ reps: 8, durationS: 30, distanceM: null, weightKg: null });
    expect(newSetFor("distance")).toEqual({ reps: null, durationS: null, distanceM: 400, weightKg: null });
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
