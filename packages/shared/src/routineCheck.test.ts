import { describe, expect, it } from "vitest";
import { routineCheck, programCheck, weekMuscleSets, GOALS, goalOf, type CheckExercise } from "./routineCheck";
import { muscleSetCount } from "./muscles";

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
    expect(v.detail).toBe("In week 1, calves get 0 sets, abs 0, shoulders 5, biceps 5, triceps 5, quads 5, glutes 5 and hamstrings 7.5. Each needs at least 10 a week: add sets until it gets there.");
    expect(v.items.filter((i) => !i.ok).map((i) => i.label)).toEqual(["Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Abs"]);
    // a short muscle the week already trains is pointed at its own lift
    expect(v.tips.find((t) => t.startsWith("Quads"))).toBe("Quads: 5 sets in week 1, 5 short of 10. Add 5 more sets to Squat.");
    const few = key(programCheck([[bench(10), row(10), squat(10), rdl(10), curl(10), ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 10), ex("Press", ["shoulders"], {}, 10), ex("Calf raise", ["calves"], {}, 4)]], "size", 2), "volume")!;
    expect(few.detail).toBe("In week 2, abs get 0 sets and calves 4. Each needs at least 10 a week: add sets until it gets there.");
    // a short muscle no exercise is mainly for gets a new one suggested
    expect(few.tips[0]).toBe("Abs: 0 sets in week 2, and no exercise in the week is mainly for them. Add one, such as Cable crunch, with 10 sets over the week.");
  });

  it("asks fewer weekly sets to keep muscle while losing fat, and for strength", () => {
    const d = [bench(3), row(3)];
    expect(key(programCheck([d, d], "size"), "volume")!.items.find((i) => i.label === "Chest")!.ok).toBe(false);
    expect(key(programCheck([d, d], "fatLoss"), "volume")!.items.find((i) => i.label === "Chest")!.ok).toBe(true);
    expect(key(programCheck([d, d], "strength"), "volume")!.title).toBe("At least 5 sets a week per muscle");
  });

  it("asks for each muscle twice a week, naming each muscle trained once", () => {
    const one = key(programCheck([[bench(5)]]), "frequency")!;
    expect(one.share).toBe(0);
    expect(one.detail).toBe("Week 1 has only 1 workout, so no muscle is trained on more than 1 day. Add a second workout to the week and split each muscle's sets between the two.");
    // the same 10 muscles as the sets-a-week row: bench on 2 days trains the chest twice; its helpers get no day (M-296)
    const twice = key(programCheck([[bench(5)], [bench(5)]]), "frequency")!;
    expect(twice.value).toBe("1 of 10 muscles");
    expect(twice.items.find((i) => i.label === "Chest")!.ok).toBe(true);
    expect(twice.items.find((i) => i.label === "Abs")!.note).toBe("No sets in the week");
    const chest = (n: number) => ex("Bench press", ["chest"], { force: "push" }, n);
    const f = key(programCheck([[chest(3)], [curl(3)], [curl(3)]], "size", 1, ["Push", "Arms", "Arms"]), "frequency")!;
    expect(f.detail).toMatch(/^In week 1, chest is trained in only one workout\. Move about half of its sets to another workout in the week\. Back, shoulders, /);
    // the tip names the routine of that workout
    expect(f.tips[0]).toBe("Chest: all 3 sets are in workout 1 (Push). Move about 1 of them to another workout in the week.");
    expect(f.items.find((i) => i.label === "Chest")!.note).toBe("Workout 1 (Push)");
  });

  it("counts a day only for the muscle an exercise is mainly for, never for its helpers (M-296)", () => {
    // two back days and two biceps days: the rows' biceps help gives the biceps no day, so they have 2 days, not 4
    const back = [row(3), ex("Lat pulldown", ["lats"], { secondary: ["biceps"], force: "pull" }, 3)];
    const p = key(programCheck([back, back, [curl(3)], [curl(3)]], "size", 1, ["Back #1", "Back #2", "Biceps #1", "Biceps #2"]), "frequency")!;
    expect(p.items.find((i) => i.label === "Biceps")).toMatchObject({ value: 2, note: "Workouts 3 (Biceps #1) and 4 (Biceps #2)" });
    // bench on 2 days: the triceps only help, so no day counts for them, and the tip asks for an exercise of their own
    const b = key(programCheck([[bench(3)], [bench(3)]]), "frequency")!;
    expect(b.items.find((i) => i.label === "Triceps")).toMatchObject({ ok: false, note: "Only helps in other exercises, and helping doesn't count as a day" });
    expect(b.tips.find((t) => t.startsWith("Triceps"))).toBe("Triceps: no workout has an exercise mainly for them; they only help in other exercises, and helping doesn't count as a day. Add an exercise for them, such as Triceps pushdown, to 2 workouts of the week.");
    const g = key(programCheck([[bench(1), ex("Pushdown", ["triceps"], { mechanic: "isolation" }, 1)], [bench(1)]]), "frequency")!;
    expect(g.detail).toMatch(/^In week 1, triceps are trained in only one workout\. Move about half of their sets to another workout in the week\. /);
    // the helper half set on day 2 doesn't count as a day, and the tip says so in its numbers
    expect(g.tips.find((t) => t.startsWith("Triceps"))).toBe("Triceps: 1.5 of their 2 sets are in workout 1. Move about 1 of them to another workout in the week.");
  });

  it("counts a left and a right set as 1 set for the muscle (M-295)", () => {
    const sided = (name: string, rounds: number): CheckExercise => ex(name, ["biceps"], { mechanic: "isolation", force: "pull",
      sets: [{ kind: "warmup", reps: 10, side: "L" }, ...Array.from({ length: rounds }, () => [{ kind: "normal" as const, reps: 10, side: "L" }, { kind: "normal" as const, reps: 10, side: "R" }]).flat()] });
    // each side counted on its own, the busier side counts; warm-ups never
    const sd = (x: string) => [...x].map((c) => (c === "W" ? { kind: "warmup", side: "L" } : { kind: "normal", side: c === "B" ? null : c }));
    expect([sd("LR"), sd("LRLR"), sd("L"), sd("LLR"), sd("WBLR"), sd("BB")].map(muscleSetCount)).toEqual([1, 2, 1, 2, 2, 2]);
    // 1 curl done with both arms for 3 sets, 3 one-arm curls done left and right 3 times each: 21 sets logged, 12 per arm
    const arms = [curl(3), sided("Concentration curl", 3), sided("One-arm cable curl", 3), sided("One-arm preacher curl", 3)];
    expect(weekMuscleSets([arms]).biceps).toBe(12);
    const s = key(routineCheck(arms), "session")!;
    expect(s.items.find((i) => i.label === "Biceps")!.value).toBe(12);
    // the push and pull row counts them the same way
    expect(key(programCheck([arms, arms]), "pushPull")!.value).toBe("0 push · 24 pull");
  });

  it("balances pushing and pulling, quads and hamstrings over a program's week, naming the numbers", () => {
    const d = [bench(6), row(2), ex("Leg press", ["quadriceps"], { force: "push" }, 6), rdl(1)];
    const c = programCheck([d, d])!;
    expect(key(c, "pushPull")!.status).toBe("low");
    expect(key(c, "pushPull")!.detail).toBe("In week 1, the upper body gets 12 pushing sets but only 4 pulling sets. Add about 5 pulling sets, such as Pull-up, to even it out.");
    expect(key(c, "pushPull")!.value).toBe("12 push · 4 pull");
    expect(key(c, "legs")!.detail).toBe("In week 1, the quads get 12 sets but the hamstrings only 2. Add about 4 hamstring sets, such as Romanian deadlift, so they get at least half as many as the quads.");
    // the person's own lifts first, and no new one they already do
    expect(key(c, "pushPull")!.tips[0]).toBe("Add about 5 pulling sets over the week: more sets of Barbell row, or a new exercise such as Pull-up.");
    expect(key(c, "legs")!.tips[0]).toBe("Add about 4 hamstring sets over the week: more sets of Romanian deadlift, or a new exercise such as Lying leg curl.");
    const ok = [bench(4), row(4), squat(4), rdl(3)];
    expect(key(programCheck([ok, ok]), "pushPull")!.share).toBe(1);
    expect(key(programCheck([ok, ok]), "legs")!.share).toBe(1);
    expect(key(programCheck([[bench(4)], [bench(4)]]), "pushPull")!.share).toBe(0);
  });

  it("wants big lifts before single-muscle ones that tire the same muscles, naming each", () => {
    const c = routineCheck([curl(), row()])!;
    expect(key(c, "order")!.share).toBe(0);
    expect(key(c, "order")!.detail).toBe("In this workout, Barbell row comes after Dumbbell curl, so the biceps are already tired when you start it and you lift less. Move it before Dumbbell curl.");
    expect(key(routineCheck([row(), curl()]), "order")!.share).toBe(1);
    // both late lifts named, not "and 1 more"
    expect(key(routineCheck([bench(), fly(), ex("Dips", ["chest"], { secondary: ["triceps"] }), ex("Incline press", ["chest"], { secondary: ["shoulders"] })]), "order")!.detail)
      .toBe("In this workout, Dips and Incline press come after Cable fly, so the chest is already tired when you start them and you lift less. Move them before Cable fly.");
    // in one superset they alternate, so the order doesn't count
    expect(key(routineCheck([{ ...curl(), superset: "A" }, { ...row(), superset: "A" }]), "order")!.share).toBe(1);
    // a "compound" with no helper muscle (a cable rotation) is not a big lift
    expect(key(routineCheck([curl(), ex("Cable rotation", ["biceps"])]), "order")).toBeUndefined();
    // a lift that is neither kind says it isn't checked
    expect(key(routineCheck([row(), curl(), ex("Cable rotation", ["biceps"])]), "order")!.items[2]!.text).toBe("Not checked");
  });

  it("checks reps against the goal's range", () => {
    const c = routineCheck([ex("Deadlift", ["lower back"], { secondary: ["hamstrings"] }, 3, 3), ex("Leg press", ["quadriceps"], {}, 3, 40), bench()])!;
    const r = key(c, "reps")!;
    expect(r.value).toBe("3 of 9 sets");
    expect(r.detail).toBe("In this workout, 3 sets of Deadlift aim for 3 reps and 3 sets of Leg press for 40. For muscle size, aim for 5-30 reps a set; tap this row to see which exercises need which change.");
    expect(key(routineCheck([bench(3, 3)]), "reps")!.detail).toBe("In this workout, 3 sets of Bench press aim for only 3 reps. Sets under 5 reps build strength more than muscle: use a weight you can lift at least 5 times.");
    // strength: 1-6 on big lifts, 5-30 on the others
    const s = key(routineCheck([bench(3, 10), curl()], "strength"), "reps")!;
    expect(s.detail).toBe("In this workout, 3 sets of Bench press aim for 10 reps. Big lifts build the most strength at 6 reps or fewer: add weight until 6 reps are hard.");
    expect(s.value).toBe("3 of 6 sets");
    // two targets (big lifts, single-muscle lifts), so the popup's headings say "targets"
    expect(s.targets).toBe(2);
    // the title names both targets, as its count holds the sets of both kinds of lift
    expect(s.title).toBe("1-6 reps on big lifts, 5-30 on single-muscle lifts");
    // general fitness gives its own reason for fewer reps, not muscle size's
    expect(key(routineCheck([bench(3, 5)], "health"), "reps")!.tips[0]).toBe("Bench press: 3 sets aim for 5 reps. Lower the weight so you can do at least 8: lighter sets of 8-15 reps are easier on the joints and easier to do with good form.");
    expect(key(routineCheck([bench(3, 20)], "endurance"), "reps")!.share).toBe(1);
    // strength with no big lift in the workout reads as the plain range
    const iso = key(routineCheck([curl()], "strength"), "reps")!;
    expect(iso.title).toBe("5-30 reps a set");
    expect(iso.detail).toBe("In this workout, every working set aims for 5-30 reps.");
    expect(iso.targets).toBe(1);
  });

  it("keeps each muscle to 11 sets in one workout, saying what to move", () => {
    const c = key(routineCheck([bench(8), fly(6)]), "session")!;
    expect(c.detail).toBe("Chest gets 14 sets in this workout. After about 11 sets the chest is too tired for more sets to build much: move the other 3 sets to another day of the week.");
    expect(c.tips[0]).toBe("Chest: 14 sets. Move about 3 of them to another workout, from Cable fly, the last chest exercise.");
    expect(key(routineCheck([bench(5), fly(5)]), "session")!.share).toBe(1);
  });

  it("checks the rest on big lifts against the goal, when rests are known", () => {
    expect(key(routineCheck([bench(3, 10)]), "rest")).toBeUndefined();
    expect(key(routineCheck([bench(3, 10, 90)]), "rest")!.share).toBe(1);
    const s = key(routineCheck([bench(3, 5, 90)], "strength"), "rest")!;
    expect(s.detail).toBe("In this workout, you rest 1:30 between sets of Bench press. For strength, rest at least 3:00, so the muscle has recovered and the next set can be just as heavy.");
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
      // the short reason names no study: who found what is the research's ("no study has tested" is not one)
      expect(c.reason).not.toMatch(/\b(19|20)\d\d\b|review|studies/);
      expect(c.research).not.toBe(c.reason);
      expect(c.items.length && c.tips.length && c.sources.length).toBeTruthy();
    }
  });
});
