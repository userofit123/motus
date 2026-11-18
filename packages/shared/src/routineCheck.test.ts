import { describe, expect, it } from "vitest";
import { routineCheck, programCheck, weekMuscleSets, type CheckExercise } from "./routineCheck";

// an exercise with `n` working sets of `reps` (and a warm-up, which never counts)
const ex = (name: string, primary: string[], o: Partial<CheckExercise> = {}, n = 3, reps = 10): CheckExercise => ({
  name, primary, secondary: [], mechanic: "compound", force: null, category: "strength",
  sets: [{ kind: "warmup", reps: 10 }, ...Array.from({ length: n }, () => ({ kind: "normal" as const, reps }))], ...o,
});
const bench = (n = 3) => ex("Bench press", ["chest"], { secondary: ["triceps", "shoulders"], force: "push" }, n);
const row = (n = 3) => ex("Barbell row", ["middle back"], { secondary: ["lats", "biceps"], force: "pull" }, n);
const squat = (n = 3) => ex("Squat", ["quadriceps"], { secondary: ["glutes", "hamstrings"], force: "push" }, n);
const rdl = (n = 3) => ex("Romanian deadlift", ["hamstrings"], { secondary: ["glutes", "lower back"], force: "pull" }, n);
const curl = (n = 3) => ex("Dumbbell curl", ["biceps"], { mechanic: "isolation", force: "pull" }, n);
const key = (c: ReturnType<typeof routineCheck>, k: string) => c!.checks.find((x) => x.key === k);

describe("routine check", () => {
  it("needs lifting with working sets", () => {
    expect(routineCheck([], 2)).toBeNull();
    expect(routineCheck([ex("Run", ["quadriceps"], { category: "cardio" })], 2)).toBeNull();
    expect(programCheck([[]])).toBeNull();
  });

  it("counts sets a week from times a week, warm-ups left out, back by its busier muscle", () => {
    const c = routineCheck([bench(4), row(4)], 3)!;
    expect(c.sets.chest).toBe(12);
    // the row: middle back 1, lats 0.5 - counted once, not 1.5
    expect(c.sets.back).toBe(12);
    expect(c.sets.triceps).toBe(6);
    // the figure's count: every muscle, the row's lats as a helper
    expect(weekMuscleSets([[bench(4), row(4)]])).toMatchObject({ chest: 4, "middle back": 4, lats: 2 });
  });

  it("checks only the muscles a routine trains, and says what to add", () => {
    // quads 10 a week; hamstrings 4 + 5 as the squat's helper; glutes 7 as a helper of both
    const c = routineCheck([squat(5), rdl(2)], 2)!;
    const v = key(c, "volume")!;
    expect(v.value).toBe("1 of 3");
    // the biggest gap only, then how many more, in one short sentence
    expect(v.detail).toBe("Add 3 sets a week for glutes, e.g. Hip thrust, and more for 1 other muscle.");
    // chest isn't trained here (a leg day), so it isn't missed
    expect(v.detail).not.toContain("chest");
  });

  it("asks for each muscle twice a week", () => {
    expect(key(routineCheck([bench(5)], 1), "frequency")!.share).toBe(0);
    expect(key(routineCheck([bench(5)], 1), "frequency")!.detail).toContain("twice");
    expect(key(routineCheck([bench(5)], 2), "frequency")!.share).toBe(1);
  });

  it("counts a helper's day from 1 set, so bench on 2 days trains the triceps twice", () => {
    // bench 3 sets: triceps 1.5 a day as a helper
    const f = key(programCheck([[bench(3)], [bench(3)]]), "frequency")!;
    expect(f.share).toBe(1);
    expect(f.detail).not.toContain("1 day");
    // a single helper set (0.5) is not a day of training, but a main muscle's single set is
    const g = key(programCheck([[bench(1), ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)], [bench(1)]]), "frequency")!;
    expect(g.detail).toBe("Triceps is trained on 1 day a week: spread its sets over 2 days.");
    expect(key(programCheck([[ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)], [ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)]]), "frequency")!.share).toBe(1);
  });

  it("checks a routine of single-muscle lifts only", () => {
    const iso = [curl(4), ex("Pushdown", ["triceps"], { mechanic: "isolation", force: "push" }, 4)];
    const twice = routineCheck(iso, 2)!;
    expect(key(twice, "frequency")!.share).toBe(1);
    // no lift for several muscles, so the order isn't checked
    expect(key(twice, "order")).toBeUndefined();
    expect(key(twice, "pushPull")!.share).toBe(1);
    expect(key(twice, "volume")!.value).toBe("0 of 2");
    expect(key(twice, "volume")!.detail).toBe("Add 2 sets a week for biceps, e.g. Dumbbell curl, and more for 1 other muscle.");
    const once = routineCheck(iso, 1)!;
    expect(key(once, "frequency")!.detail).toBe("Done once a week: do it twice, or spread its sets over 2 days.");
  });

  it("balances pushing and pulling, quads and hamstrings", () => {
    const c = routineCheck([bench(6), row(2), ex("Leg press", ["quadriceps"], { force: "push" }, 6), rdl(1)], 2)!;
    expect(key(c, "pushPull")!.status).toBe("low");
    expect(key(c, "pushPull")!.detail).toBe("Too little pulling: add 5 pulling sets a week, e.g. Barbell row.");
    expect(key(c, "legs")!.detail).toBe("Too little for hamstrings: add 4 sets a week, e.g. Romanian deadlift.");
    const ok = routineCheck([bench(4), row(4), squat(4), rdl(3)], 2)!;
    expect(key(ok, "pushPull")!.share).toBe(1);
    expect(key(ok, "legs")!.share).toBe(1);
    // a push day alone has no pulling to balance against: that is its program's job
    expect(key(routineCheck([bench(4)], 2), "pushPull")).toBeUndefined();
  });

  it("wants big lifts before single-muscle ones that tire the same muscles", () => {
    const c = routineCheck([curl(), row()], 2)!;
    expect(key(c, "order")!.share).toBe(0);
    expect(key(c, "order")!.detail).toBe("Do Barbell row before Dumbbell curl, which tires the same muscles.");
    expect(key(routineCheck([row(), curl()], 2), "order")!.share).toBe(1);
    // in one superset they alternate, so the order doesn't count
    expect(key(routineCheck([{ ...curl(), superset: "A" }, { ...row(), superset: "A" }], 2), "order")!.share).toBe(1);
  });

  it("checks reps against 5-30", () => {
    const c = routineCheck([ex("Deadlift", ["lower back"], {}, 3, 3), ex("Leg press", ["quadriceps"], {}, 3, 40), bench()], 2)!;
    const r = key(c, "reps")!;
    expect(r.value).toBe("3 of 9");
    // one tip, for the side with more sets outside the range (a tie goes to too many reps)
    expect(r.detail).toBe("Leg press aims for 40 reps: add weight so 30 or fewer are hard.");
    expect(key(routineCheck([ex("Deadlift", ["lower back"], {}, 3, 3), bench()], 2), "reps")!.detail).toBe("Deadlift aims for 3 reps: good for strength, but 5-30 build more muscle.");
  });

  it("scores a sound program week high and a lopsided one low", () => {
    const a = [bench(4), row(4), squat(4), rdl(3), curl(3), ex("Pushdown", ["triceps"], { mechanic: "isolation", force: "push" }), ex("Overhead press", ["shoulders"], { force: "push", secondary: ["triceps"] }, 3),
      ex("Hip thrust", ["glutes"], {}, 3), ex("Calf raise", ["calves"], { mechanic: "isolation" }, 4), ex("Cable crunch", ["abdominals"], { mechanic: "isolation" }, 4)];
    const good = programCheck([a, a, a])!;
    expect(good.label).toBe("Good");
    expect(good.score).toBeGreaterThanOrEqual(80);
    const bad = programCheck([[bench(6)]])!;
    expect(bad.label).toBe("Low");
    // a week checks every major muscle: no back is missed
    expect(key(bad, "volume")!.detail).toContain("for back");
  });
});
