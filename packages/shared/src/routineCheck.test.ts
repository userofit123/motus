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
    expect(routineCheck([])).toBeNull();
    expect(routineCheck([ex("Run", ["quadriceps"], { category: "cardio" })])).toBeNull();
    expect(programCheck([[]])).toBeNull();
  });

  it("counts a program's sets a week over its workouts, warm-ups left out, back by its busier muscle", () => {
    const d = [bench(4), row(4)];
    const c = programCheck([d, d, d])!;
    expect(c.sets.chest).toBe(12);
    // the row: middle back 1, lats 0.5 - counted once, not 1.5
    expect(c.sets.back).toBe(12);
    expect(c.sets.triceps).toBe(6);
    // the figure's count: every muscle, the row's lats as a helper
    expect(weekMuscleSets([[bench(4), row(4)]])).toMatchObject({ chest: 4, "middle back": 4, lats: 2 });
  });

  it("checks every muscle in a program's week, and says what to add", () => {
    const d = [squat(5), rdl(2)];
    const v = key(programCheck([d, d]), "volume")!;
    // quads 10 a week: the only one met, as a week should cover every muscle
    expect(v.value).toBe("1 of 10 muscles");
    // the biggest gap with its cause and what to add, then how many more are short
    expect(v.detail).toBe("No sets a week for chest: add 10, e.g. Bench press. 8 more muscles need more too.");
  });

  it("says chest and back in the singular, the other muscles in the plural", () => {
    const chest = (n: number) => ex("Bench press", ["chest"], { force: "push" }, n);
    expect(key(programCheck([[chest(3)], [curl(3)], [curl(3)]]), "frequency")!.detail).toBe("Chest is trained on 1 day a week: spread its sets over 2 days.");
  });

  it("asks for each muscle twice a week", () => {
    const one = key(programCheck([[bench(5)]]), "frequency")!;
    expect(one.share).toBe(0);
    expect(one.detail).toBe("The week has 1 workout, so each muscle is trained on 1 day: add a second workout.");
    expect(key(programCheck([[bench(5)], [bench(5)]]), "frequency")!.share).toBe(1);
  });

  it("counts a helper's day from 1 set, so bench on 2 days trains the triceps twice", () => {
    // bench 3 sets: triceps 1.5 a day as a helper
    const f = key(programCheck([[bench(3)], [bench(3)]]), "frequency")!;
    expect(f.share).toBe(1);
    expect(f.detail).not.toContain("1 day");
    // a single helper set (0.5) is not a day of training, but a main muscle's single set is
    const g = key(programCheck([[bench(1), ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)], [bench(1)]]), "frequency")!;
    expect(g.detail).toBe("Triceps are trained on 1 day a week: spread their sets over 2 days.");
    expect(key(programCheck([[ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)], [ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)]]), "frequency")!.share).toBe(1);
  });

  it("checks single-muscle lifts", () => {
    const iso = [curl(4), ex("Pushdown", ["triceps"], { mechanic: "isolation", force: "push" }, 4)];
    // no lift for several muscles, so a routine of them has only its reps checked
    expect(routineCheck(iso)!.checks.map((c) => c.key)).toEqual(["reps"]);
    const week = programCheck([iso, iso])!;
    expect(key(week, "frequency")!.share).toBe(1);
    expect(key(week, "pushPull")!.share).toBe(1);
  });

  it("balances pushing and pulling, quads and hamstrings over a program's week", () => {
    const d = [bench(6), row(2), ex("Leg press", ["quadriceps"], { force: "push" }, 6), rdl(1)];
    const c = programCheck([d, d])!;
    expect(key(c, "pushPull")!.status).toBe("low");
    expect(key(c, "pushPull")!.detail).toBe("Too few pulling sets next to pushing: add 5 a week, e.g. Barbell row.");
    expect(key(c, "pushPull")!.value).toBe("12 push · 4 pull");
    expect(key(c, "legs")!.detail).toBe("Too few hamstring sets next to quads: add 4 a week, e.g. Romanian deadlift.");
    const ok = [bench(4), row(4), squat(4), rdl(3)];
    expect(key(programCheck([ok, ok]), "pushPull")!.share).toBe(1);
    expect(key(programCheck([ok, ok]), "legs")!.share).toBe(1);
    // a week of pushing only has no pulling at all
    expect(key(programCheck([[bench(4)], [bench(4)]]), "pushPull")!.share).toBe(0);
  });

  it("wants big lifts before single-muscle ones that tire the same muscles", () => {
    const c = routineCheck([curl(), row()])!;
    expect(key(c, "order")!.share).toBe(0);
    expect(key(c, "order")!.detail).toBe("Do Barbell row before Dumbbell curl, which tires the same muscles.");
    expect(key(routineCheck([row(), curl()]), "order")!.share).toBe(1);
    // in one superset they alternate, so the order doesn't count
    expect(key(routineCheck([{ ...curl(), superset: "A" }, { ...row(), superset: "A" }]), "order")!.share).toBe(1);
  });

  it("checks reps against 5-30", () => {
    const c = routineCheck([ex("Deadlift", ["lower back"], {}, 3, 3), ex("Leg press", ["quadriceps"], {}, 3, 40), bench()])!;
    const r = key(c, "reps")!;
    expect(r.value).toBe("3 of 9 sets");
    // one tip, for the side with more sets outside the range (a tie goes to too many reps)
    expect(r.detail).toBe("Leg press targets 40 reps: add weight so 30 or fewer are hard.");
    expect(key(routineCheck([ex("Deadlift", ["lower back"], {}, 3, 3), bench()]), "reps")!.detail).toBe("Deadlift targets 3 reps, good for strength: 5-30 reps build more muscle.");
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

  it("checks a program's week for sets, frequency and balance, and a routine only on its own workout", () => {
    const day = [curl(), row(), bench()];
    // a program's week: only the checks about the week, as each routine checks its own workout
    expect(programCheck([day, day])!.checks.map((c) => c.key)).toEqual(["volume", "frequency", "pushPull"]);
    // a routine, in a program or not: only the checks about one workout
    const w = routineCheck(day)!;
    expect(w.checks.map((c) => c.key)).toEqual(["order", "reps"]);
    expect(key(w, "order")!.detail).toBe("Do Barbell row before Dumbbell curl, which tires the same muscles.");
    // nothing to check in one workout: no lifting, or no reps and no mix of big and single-muscle lifts
    expect(routineCheck([{ ...bench(), sets: [{ kind: "normal", reps: null }] }])).toBeNull();
  });
});
