import { describe, expect, it } from "vitest";
import { routineCheck, programCheck, weekMuscleSets, GOALS, goalOf, type CheckExercise } from "./routineCheck";

// an exercise with `n` working sets of `reps` (and a warm-up, which never counts)
const ex = (name: string, primary: string[], o: Partial<CheckExercise> = {}, n = 3, reps = 10, restS?: number): CheckExercise => ({
  name, primary, secondary: [], mechanic: "compound", force: null, category: "strength",
  sets: [{ kind: "warmup", reps: 10 }, ...Array.from({ length: n }, () => ({ kind: "normal" as const, reps, restS }))], ...o,
});
const bench = (n = 3, reps = 10, rest?: number) => ex("Bench press", ["chest"], { secondary: ["triceps", "shoulders"], force: "push" }, n, reps, rest);
const row = (n = 3) => ex("Barbell row", ["middle back"], { secondary: ["lats", "biceps"], force: "pull" }, n);
const squat = (n = 3) => ex("Squat", ["quadriceps"], { secondary: ["glutes", "hamstrings"], force: "push" }, n);
const rdl = (n = 3) => ex("Romanian deadlift", ["hamstrings"], { secondary: ["glutes", "lower back"], force: "pull" }, n);
const curl = (n = 3) => ex("Dumbbell curl", ["biceps"], { mechanic: "isolation", force: "pull" }, n);
const fly = (n = 3) => ex("Cable fly", ["chest"], { mechanic: "isolation", force: "push" }, n);
const key = (c: ReturnType<typeof routineCheck>, k: string) => c!.checks.find((x) => x.key === k);

describe("routine check", () => {
  it("needs lifting with working sets", () => {
    expect(routineCheck([])).toBeNull();
    expect(routineCheck([ex("Run", ["quadriceps"], { category: "cardio" })])).toBeNull();
    expect(programCheck([[]])).toBeNull();
  });

  it("offers the goals research tells apart, muscle size by default", () => {
    expect(Object.keys(GOALS)).toEqual(["size", "strength", "fatLoss", "endurance", "health"]);
    expect(goalOf(null).id).toBe("size");
    expect(goalOf("nonsense").id).toBe("size");
    // each scope's points add up to 100 for every goal
    for (const g of Object.values(GOALS)) {
      const w = g.weights;
      expect(w.volume + w.frequency + w.pushPull + w.legs).toBe(100);
      expect(w.reps + w.session + w.order + w.rest).toBe(100);
    }
  });

  it("counts a program's sets a week over its workouts, warm-ups left out, back by its busier muscle", () => {
    const d = [bench(4), row(4)];
    const c = programCheck([d, d, d])!;
    expect(c.sets.chest).toBe(12);
    // the row: middle back 1, lats 0.5 - counted once, not 1.5
    expect(c.sets.back).toBe(12);
    expect(c.sets.triceps).toBe(6);
    expect(weekMuscleSets([[bench(4), row(4)]])).toMatchObject({ chest: 4, "middle back": 4, lats: 2 });
  });

  it("names every short muscle in the week, never \"and 2 more\"", () => {
    const v = key(programCheck([[bench(5), row(5)], [bench(5), row(5), squat(5), rdl(5)]]), "volume")!;
    // chest 10 and back 10 met; shoulders, biceps, triceps and glutes 5 as helpers, quads 5, hamstrings 7.5, calves and abs 0
    expect(v.detail).toBe("Calves, abs, shoulders, biceps, triceps, quads, glutes and hamstrings get fewer than 10 sets in week 1. Add sets for them to reach 10.");
    expect(v.items.filter((i) => !i.ok).map((i) => i.label)).toEqual(["Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Abs"]);
    // a short muscle the week already trains is pointed at its own lift
    expect(v.tips.find((t) => t.startsWith("Quads"))).toBe("Quads: 5 of 10 sets. Add 5 sets a week, e.g. to Squat.");
    const few = key(programCheck([[bench(10), row(10), squat(10), rdl(10), curl(10), ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 10), ex("Press", ["shoulders"], {}, 10), ex("Calf raise", ["calves"], {}, 4)]], "size", 2), "volume")!;
    expect(few.detail).toBe("Abs and calves get fewer than 10 sets in week 2. Add sets for them to reach 10.");
  });

  it("asks fewer weekly sets to keep muscle while losing fat, and for strength", () => {
    const d = [bench(3), row(3)];
    expect(key(programCheck([d, d], "size"), "volume")!.items.find((i) => i.label === "Chest")!.ok).toBe(false);
    expect(key(programCheck([d, d], "fatLoss"), "volume")!.items.find((i) => i.label === "Chest")!.ok).toBe(true);
    expect(key(programCheck([d, d], "strength"), "volume")!.title).toBe("5+ sets a week per muscle");
  });

  it("asks for each muscle twice a week, naming each muscle trained once", () => {
    const one = key(programCheck([[bench(5)]]), "frequency")!;
    expect(one.share).toBe(0);
    expect(one.detail).toBe("Week 1 has 1 workout, so each muscle is trained on 1 day. Add a second workout.");
    expect(key(programCheck([[bench(5)], [bench(5)]]), "frequency")!.share).toBe(1);
    const chest = (n: number) => ex("Bench press", ["chest"], { force: "push" }, n);
    const f = key(programCheck([[chest(3)], [curl(3)], [curl(3)]]), "frequency")!;
    expect(f.detail).toBe("Chest is trained on only 1 day in week 1. Spread its sets over 2 days.");
    expect(f.items.find((i) => i.label === "Chest")!.note).toBe("Workout 1");
  });

  it("counts a helper's day from 1 set, so bench on 2 days trains the triceps twice", () => {
    expect(key(programCheck([[bench(3)], [bench(3)]]), "frequency")!.share).toBe(1);
    const g = key(programCheck([[bench(1), ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)], [bench(1)]]), "frequency")!;
    expect(g.detail).toBe("Triceps are trained on only 1 day in week 1. Spread each one's sets over 2 days.");
  });

  it("balances pushing and pulling, quads and hamstrings over a program's week, naming the numbers", () => {
    const d = [bench(6), row(2), ex("Leg press", ["quadriceps"], { force: "push" }, 6), rdl(1)];
    const c = programCheck([d, d])!;
    expect(key(c, "pushPull")!.status).toBe("low");
    expect(key(c, "pushPull")!.detail).toBe("12 pushing sets and only 4 pulling in week 1. Add about 5 pulling sets, e.g. Barbell row.");
    expect(key(c, "pushPull")!.value).toBe("12 push · 4 pull");
    expect(key(c, "legs")!.detail).toBe("12 quad sets and only 2 hamstring in week 1. Add about 4 hamstring sets, e.g. Romanian deadlift.");
    const ok = [bench(4), row(4), squat(4), rdl(3)];
    expect(key(programCheck([ok, ok]), "pushPull")!.share).toBe(1);
    expect(key(programCheck([ok, ok]), "legs")!.share).toBe(1);
    expect(key(programCheck([[bench(4)], [bench(4)]]), "pushPull")!.share).toBe(0);
  });

  it("wants big lifts before single-muscle ones that tire the same muscles, naming each", () => {
    const c = routineCheck([curl(), row()])!;
    expect(key(c, "order")!.share).toBe(0);
    expect(key(c, "order")!.detail).toBe("In this workout, Barbell row comes after Dumbbell curl, which tires the same muscles first. Move it earlier.");
    expect(key(routineCheck([row(), curl()]), "order")!.share).toBe(1);
    // both late lifts named, not "and 1 more"
    expect(key(routineCheck([bench(), fly(), ex("Dips", ["chest"], { secondary: ["triceps"] }), ex("Incline press", ["chest"], { secondary: ["shoulders"] })]), "order")!.detail)
      .toBe("In this workout, Dips and Incline press come after Cable fly, which tires the same muscles first. Move them earlier.");
    // in one superset they alternate, so the order doesn't count
    expect(key(routineCheck([{ ...curl(), superset: "A" }, { ...row(), superset: "A" }]), "order")!.share).toBe(1);
    // a "compound" with no helper muscle (a cable rotation) is not a big lift
    expect(key(routineCheck([curl(), ex("Cable rotation", ["biceps"])]), "order")).toBeUndefined();
  });

  it("checks reps against the goal's range", () => {
    const c = routineCheck([ex("Deadlift", ["lower back"], { secondary: ["hamstrings"] }, 3, 3), ex("Leg press", ["quadriceps"], {}, 3, 40), bench()])!;
    const r = key(c, "reps")!;
    expect(r.value).toBe("3 of 9 sets");
    expect(r.detail).toBe("In this workout, Deadlift (3 reps) and Leg press (40 reps) aim for reps outside 5-30. For muscle size, aim for 5-30 reps a set: open this check for each exercise.");
    expect(key(routineCheck([bench(3, 3)]), "reps")!.detail).toBe("In this workout, Bench press (3 reps) aims for fewer than 5 reps. For muscle size, use a weight you can lift 5 or more times.");
    // strength: 1-6 on big lifts, 5-30 on the others
    const s = key(routineCheck([bench(3, 10), curl()], "strength"), "reps")!;
    expect(s.detail).toBe("In this workout, Bench press (10 reps) aims for more than 6 reps. For strength, add weight so 6 or fewer reps are hard.");
    expect(s.value).toBe("3 of 6 sets");
    // two targets (big lifts, single-muscle lifts), so the popup's headings say "targets"
    expect(s.targets).toBe(2);
    expect(key(routineCheck([bench(3, 20)], "endurance"), "reps")!.share).toBe(1);
    // strength with no big lift in the workout reads as the plain range
    const iso = key(routineCheck([curl()], "strength"), "reps")!;
    expect(iso.title).toBe("5-30 reps a set");
    expect(iso.detail).toBe("Every working set in this workout aims for 5-30 reps.");
    expect(iso.targets).toBe(1);
  });

  it("keeps each muscle to 11 sets in one workout, saying what to move", () => {
    const c = key(routineCheck([bench(8), fly(6)]), "session")!;
    expect(c.detail).toBe("Chest gets 14 sets in this workout. In a 2024 analysis of 67 studies (Pelland and others), sets past about 11 for one muscle in one workout added little: move some to another day.");
    expect(c.tips[0]).toBe("Chest: 14 sets. Move about 3 to another day, e.g. Cable fly.");
    expect(key(routineCheck([bench(5), fly(5)]), "session")!.share).toBe(1);
  });

  it("checks the rest on big lifts against the goal, when rests are known", () => {
    expect(key(routineCheck([bench(3, 10)]), "rest")).toBeUndefined();
    expect(key(routineCheck([bench(3, 10, 90)]), "rest")!.share).toBe(1);
    const s = key(routineCheck([bench(3, 5, 90)], "strength"), "rest")!;
    expect(s.detail).toBe("Bench press rests 1:30 between sets in this workout. Rest at least 3:00 for strength.");
    expect(key(routineCheck([bench(3, 20, 180)], "endurance"), "rest")!.share).toBe(0);
  });

  it("scores a sound program week high and a lopsided one low", () => {
    const a = [bench(4), row(4), squat(4), rdl(3), curl(3), ex("Pushdown", ["triceps"], { mechanic: "isolation", force: "push" }), ex("Overhead press", ["shoulders"], { force: "push", secondary: ["triceps"] }, 3),
      ex("Hip thrust", ["glutes"], {}, 3), ex("Calf raise", ["calves"], { mechanic: "isolation" }, 4), ex("Cable crunch", ["abdominals"], { mechanic: "isolation" }, 4)];
    const good = programCheck([a, a, a])!;
    expect(good.label).toBe("Good");
    expect(good.goal).toBe("size");
    const bad = programCheck([[bench(6)]])!;
    expect(bad.label).toBe("Low");
    expect(key(bad, "volume")!.items.find((i) => i.label === "Back")!.ok).toBe(false);
  });

  it("checks a program's week for the week's checks, and a routine only on its own workout", () => {
    const day = [curl(), row(), bench()];
    expect(programCheck([day, day])!.checks.map((c) => c.key)).toEqual(["volume", "frequency", "pushPull"]);
    expect(routineCheck(day)!.checks.map((c) => c.key)).toEqual(["reps", "session", "order"]);
    // every check carries what its popup needs
    for (const c of Object.keys(GOALS).flatMap((g) => [...programCheck([day, day, [squat(), rdl()]], g)!.checks, ...routineCheck([curl(), row(), bench(3, 10, 120)], g)!.checks])) {
      expect(c.what && c.target && c.reason && c.research && c.itemsLabel).toBeTruthy();
      // the short reason names no study: who found what is the research's
      expect(c.reason).not.toMatch(/\b(19|20)\d\d\b|review|study|studies/);
      expect(c.research).not.toBe(c.reason);
      expect(c.items.length && c.tips.length && c.sources.length).toBeTruthy();
    }
  });
});
