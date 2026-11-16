import { describe, expect, it } from "vitest";
import { pickSuggestions, suggestionSubjects, dismissalPatch, type SuggestInput } from "./suggest";
import { withDefaults } from "./settings";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();
const R = (id: string, name: string, days: number | null) => ({ id, name, color: null, daysAgo: days });
// a push / pull / legs person: every main muscle has a routine
const PPL = [R("push", "Push", 2), R("pull", "Pull", 1), R("legs", "Legs", 0)];
const MUSCLES: SuggestInput["routineMuscles"] = [
  ...["chest", "shoulders", "triceps"].map((m) => ({ routineId: "push", muscle: m, n: 2, main: true })),
  ...["lats", "middle back", "biceps"].map((m) => ({ routineId: "pull", muscle: m, n: 2, main: true })),
  { routineId: "pull", muscle: "forearms", n: 2, main: false },
  ...["quadriceps", "hamstrings", "glutes", "calves", "abdominals"].map((m) => ({ routineId: "legs", muscle: m, n: 2, main: true })),
];
const ALL = ["chest", "shoulders", "triceps", "lats", "middle back", "biceps", "quadriceps", "hamstrings", "glutes", "calves", "abdominals"];
const input = (p: Partial<SuggestInput> = {}): SuggestInput => ({
  now: NOW, routines: PPL, programs: [], recent: [], routineMuscles: MUSCLES,
  muscleDays: Object.fromEntries(ALL.map((m) => [m, 2])), sets28: Object.fromEntries(ALL.map((m) => [m, 12])),
  planned: { routineIds: [], muscles: [] }, hidden: {}, ...p,
});

describe("pickSuggestions", () => {
  it("suggests the routine that usually follows your last one, in plain words", () => {
    const s = pickSuggestions(input({ recent: ["push", "pull", "legs", "push", "pull", "legs", "push"], routines: [R("push", "Push", 0), R("pull", "Pull", 2), R("legs", "Legs", 1)] }));
    expect(s[0]).toMatchObject({ kind: "order", routineId: "pull", title: "Pull", reason: "Usually follows Push, your last workout" });
  });

  it("needs twice to call it a habit, unless only one routine ever followed", () => {
    const once = pickSuggestions(input({ recent: ["push", "pull", "push", "legs", "push"] }));
    expect(once.some((x) => x.kind === "order")).toBe(false);
  });

  it("names a muscle left out for a week and the routine that trains it", () => {
    const s = pickSuggestions(input({ muscleDays: { ...Object.fromEntries(ALL.map((m) => [m, 2])), triceps: 9 } }));
    expect(s.find((x) => x.kind === "missed")).toMatchObject({ routineId: "push", title: "Push", reason: "Your triceps were last trained 1 week ago" });
    const chest = pickSuggestions(input({ muscleDays: { ...Object.fromEntries(ALL.map((m) => [m, 2])), chest: 8 } }));
    expect(chest.find((x) => x.kind === "missed")?.reason).toBe("Your chest was last trained 1 week ago");
  });

  it("without a routine for it, a muscle tip says what to train", () => {
    const s = pickSuggestions(input({ routineMuscles: MUSCLES.filter((h) => h.muscle !== "triceps"), muscleDays: { ...Object.fromEntries(ALL.map((m) => [m, 2])), triceps: 12 } }));
    expect(s.find((x) => x.muscle === "triceps")).toMatchObject({ kind: "missed", routineId: null, title: "Train your triceps" });
  });

  it("shows one suggestion per routine: two muscles Pull trains come as one tip that names both", () => {
    const s = pickSuggestions(input({ muscleDays: { ...Object.fromEntries(ALL.map((m) => [m, 2])), lats: 12, "middle back": 11 } }));
    const pull = s.filter((x) => x.routineId === "pull");
    expect(pull).toHaveLength(1);
    expect(pull[0]).toMatchObject({ kind: "missed", title: "Pull", reason: "Your lats and middle back were last trained 1 week ago" });
    expect(pull[0]!.hide).toEqual(["r:pull", "m:lats", "m:middle back"]);
    // the same muscle never shows twice under another rule
    expect(s.filter((x) => x.hide.includes("m:lats"))).toHaveLength(1);
  });

  it("drops what is planned: the routine itself and the muscles a planned routine trains", () => {
    const left = { ...Object.fromEntries(ALL.map((m) => [m, 2])), lats: 12 };
    expect(pickSuggestions(input({ muscleDays: left })).some((x) => x.routineId === "pull")).toBe(true);
    const planned = pickSuggestions(input({ muscleDays: left, planned: { routineIds: ["pull"], muscles: ["lats", "middle back", "biceps"] } }));
    expect(planned.some((x) => x.routineId === "pull" || x.muscle === "lats")).toBe(false);
  });

  it("keeps a dismissed routine and its muscles away for a week, near-duplicates included", () => {
    const left = { ...Object.fromEntries(ALL.map((m) => [m, 2])), lats: 12, "middle back": 11 };
    const first = pickSuggestions(input({ muscleDays: left })).find((x) => x.hide.includes("m:lats"))!;
    expect(suggestionSubjects(first)).toEqual(["r:pull", "m:lats", "m:middle back"]);
    const hidden = Object.fromEntries(first.hide.map((k) => [k, daysAgo(1)]));
    const after = pickSuggestions(input({ muscleDays: left, hidden }));
    expect(after.some((x) => x.routineId === "pull" || x.hide.includes("m:lats") || x.hide.includes("m:middle back"))).toBe(false);
    // a week on it may come back
    const later = pickSuggestions(input({ muscleDays: left, hidden: Object.fromEntries(first.hide.map((k) => [k, daysAgo(8)])) }));
    expect(later.some((x) => x.hide.includes("m:lats"))).toBe(true);
  });

  it("a whole muscle group none of your routines trains is one tip", () => {
    const noArms = MUSCLES.filter((h) => !["biceps", "triceps", "forearms"].includes(h.muscle));
    const s = pickSuggestions(input({ routineMuscles: noArms, sets28: { ...Object.fromEntries(ALL.map((m) => [m, 12])), biceps: 0, triceps: 0 } }));
    expect(s.find((x) => x.kind === "gap")).toMatchObject({ muscle: "arms", title: "Add exercises for your arms", reason: "None of your routines work your arms", muscles: ["biceps", "triceps", "forearms"] });
    expect(s.some((x) => x.kind === "target" && ["biceps", "triceps", "forearms"].includes(x.muscle!))).toBe(false);
  });

  it("a one-muscle group none of your routines trains is named by its muscle", () => {
    const s = pickSuggestions(input({ routineMuscles: MUSCLES.filter((h) => h.muscle !== "abdominals"), sets28: { ...Object.fromEntries(ALL.map((m) => [m, 12])), abdominals: 0 } }));
    expect(s.find((x) => x.muscle === "abdominals")).toMatchObject({ kind: "target", title: "Add an exercise for your abs", reason: "None of your routines work it", hide: ["m:abdominals"] });
  });

  it("names a specific muscle missing inside a group you train, with where it is and what your routines do train", () => {
    const s = pickSuggestions(input());
    expect(s.find((x) => x.muscle === "lower back")).toMatchObject({
      kind: "target", title: "Add an exercise for your lower back (spinal erectors)",
      reason: "Your routines train your lats and middle back, but not this part of your back", hide: ["m:lower back"],
    });
    expect(s.find((x) => x.muscle === "traps")).toMatchObject({ title: "Add an exercise for your traps (between your neck and shoulders)" });
    // the rest of the group trained: said as such
    const withTraps = [...MUSCLES, { routineId: "pull", muscle: "traps", n: 1, main: true }, { routineId: "legs", muscle: "lower back", n: 1, main: true }];
    const legs = pickSuggestions(input({ routineMuscles: [...withTraps, { routineId: "legs", muscle: "abductors", n: 1, main: true }] }));
    expect(legs.find((x) => x.muscle === "adductors")).toMatchObject({ title: "Add an exercise for your adductors (inner thighs)", reason: "Your routines train the rest of your legs, but not this" });
  });

  it("a muscle only a helper in your routines is suggested on its own, and its dismissal hides only that muscle", () => {
    const withHelper = [...MUSCLES, { routineId: "pull", muscle: "lower back", n: 1, main: false }];
    const s = pickSuggestions(input({ routineMuscles: withHelper }));
    const lb = s.find((x) => x.muscle === "lower back")!;
    expect(lb).toMatchObject({ title: "Add an exercise for your lower back (spinal erectors)", reason: "Your routines only use it as a helper muscle" });
    const after = pickSuggestions(input({ routineMuscles: withHelper, hidden: { "m:lower back": daysAgo(1) } }));
    expect(after.some((x) => x.muscle === "lower back")).toBe(false);
    expect(after.some((x) => x.muscle === "traps")).toBe(true);
  });

  it("uses the app's specific muscles, leaving out only the neck", () => {
    const s = pickSuggestions(input());
    const targets = s.filter((x) => x.kind === "target").map((x) => x.muscle);
    expect(targets).toEqual(["forearms", "lower back", "traps", "adductors"]);
    expect(s.some((x) => x.muscle === "neck" || x.muscle === "back")).toBe(false);
    // a muscle trained outside your routines lately isn't missing
    const done = pickSuggestions(input({ sets28: { ...Object.fromEntries(ALL.map((m) => [m, 12])), "lower back": 3 } }));
    expect(done.some((x) => x.muscle === "lower back")).toBe(false);
  });

  it("planning a routine that trains the muscle as a main muscle takes it away; one that only helps does not", () => {
    const routines = [...MUSCLES, { routineId: "back", muscle: "lower back", n: 2, main: true }];
    const days = { ...Object.fromEntries(ALL.map((m) => [m, 2])), "lower back": 12 };
    const base = input({ routineMuscles: routines, routines: [...PPL, R("back", "Back", 1)], muscleDays: days });
    expect(pickSuggestions(base).find((x) => x.hide.includes("m:lower back"))).toMatchObject({ kind: "missed", title: "Back", reason: "Your lower back (spinal erectors) was last trained 1 week ago" });
    expect(pickSuggestions({ ...base, planned: { routineIds: ["back"], muscles: ["lower back"] } }).some((x) => x.hide.includes("m:lower back"))).toBe(false);
    expect(pickSuggestions({ ...base, planned: { routineIds: ["pull"], muscles: ["lats", "middle back", "biceps"] } }).some((x) => x.hide.includes("m:lower back"))).toBe(true);
  });

  it("puts one of each kind first, so the three on Home are mixed", () => {
    const s = pickSuggestions(input({ routines: [R("push", "Push", 4), R("pull", "Pull", 5), R("legs", "Legs", 1)] }));
    expect(s.slice(0, 2).map((x) => x.kind)).toEqual(["target", "oldest"]);
  });

  it("points out a muscle your routines only use as a helper", () => {
    const s = pickSuggestions(input());
    expect(s.find((x) => x.kind === "target")).toMatchObject({ muscle: "forearms", title: "Add an exercise for your forearms", reason: "Your routines only use it as a helper muscle" });
  });

  it("points out a muscle with far fewer sets than the rest", () => {
    const s = pickSuggestions(input({ sets28: { ...Object.fromEntries(ALL.map((m) => [m, 12])), calves: 2 } }));
    expect(s.find((x) => x.kind === "low")).toMatchObject({ routineId: "legs", reason: "Only 2 sets for your calves in 4 weeks, against 12 for most muscles" });
  });

  it("suggests routines not done for 3 days or more, longest first", () => {
    const s = pickSuggestions(input({ routines: [R("push", "Push", 4), R("pull", "Pull", null), R("legs", "Legs", 1)] })).filter((x) => x.kind === "oldest");
    expect(s.map((x) => [x.title, x.reason])).toEqual([["Pull", "Not done yet"], ["Push", "Last done 4 days ago"]]);
  });

  it("puts a program's next workout first", () => {
    const s = pickSuggestions(input({ programs: [{ program: "5x5", routineId: "legs", name: "Legs", color: null, week: 2, day: 3, deload: false }] }));
    expect(s[0]).toMatchObject({ kind: "program", reason: "Next in 5x5: week 2, workout 3" });
    const d = pickSuggestions(input({ programs: [{ program: "5x5", routineId: "legs", name: "Legs", color: null, week: 4, day: 1, deload: true }] }));
    expect(d[0]).toMatchObject({ kind: "program", reason: "Next in 5x5: week 4, workout 1 (deload)" });
  });
});

describe("dismissalPatch", () => {
  it("clears dismissals past their week and older kinds of key as it saves a new one", () => {
    const at = new Date(NOW);
    const p = dismissalPatch({ "r:a": daysAgo(2), "m:legs": daysAgo(8), "missed:calves": daysAgo(1), "oldest:b": daysAgo(1) }, ["r:c", "m:arms"], at);
    expect(p).toEqual({ "m:legs": null, "missed:calves": null, "oldest:b": null, "r:c": at.toISOString(), "m:arms": at.toISOString() });
    // the nulls are dropped once saved
    expect(withDefaults({ home: { hidden: { "r:a": daysAgo(2), ...p } } }).home.hidden).toEqual({ "r:a": daysAgo(2), "r:c": at.toISOString(), "m:arms": at.toISOString() });
  });
});
