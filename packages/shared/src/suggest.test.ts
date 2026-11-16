import { describe, expect, it } from "vitest";
import { pickSuggestions, suggestionSubjects, type SuggestInput } from "./suggest";

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

  it("shows one suggestion per muscle group, so Back doesn't come twice in other words", () => {
    const s = pickSuggestions(input({ muscleDays: { ...Object.fromEntries(ALL.map((m) => [m, 2])), lats: 12, "middle back": 11 } }));
    expect(s.filter((x) => x.hide.includes("m:back"))).toHaveLength(1);
    // and one per routine: Pull isn't also suggested as the oldest routine
    expect(s.filter((x) => x.routineId === "pull")).toHaveLength(1);
  });

  it("drops what is planned: the routine itself and the muscles a planned routine trains", () => {
    const left = { ...Object.fromEntries(ALL.map((m) => [m, 2])), lats: 12 };
    expect(pickSuggestions(input({ muscleDays: left })).some((x) => x.routineId === "pull")).toBe(true);
    const planned = pickSuggestions(input({ muscleDays: left, planned: { routineIds: ["pull"], muscles: ["lats", "middle back", "biceps"] } }));
    expect(planned.some((x) => x.routineId === "pull" || x.muscle === "lats")).toBe(false);
  });

  it("keeps a dismissed routine and muscle group away for a week, near-duplicates included", () => {
    const left = { ...Object.fromEntries(ALL.map((m) => [m, 2])), lats: 12, "middle back": 11 };
    const first = pickSuggestions(input({ muscleDays: left })).find((x) => x.hide.includes("m:back"))!;
    expect(suggestionSubjects(first)).toEqual(["r:pull", "m:back"]);
    const hidden = Object.fromEntries(first.hide.map((k) => [k, daysAgo(1)]));
    const after = pickSuggestions(input({ muscleDays: left, hidden }));
    expect(after.some((x) => x.routineId === "pull" || x.hide.includes("m:back"))).toBe(false);
    // a week on it may come back
    const later = pickSuggestions(input({ muscleDays: left, hidden: Object.fromEntries(first.hide.map((k) => [k, daysAgo(8)])) }));
    expect(later.some((x) => x.hide.includes("m:back"))).toBe(true);
  });

  it("points out a muscle group none of your routines trains", () => {
    const s = pickSuggestions(input({ routineMuscles: MUSCLES.filter((h) => h.muscle !== "abdominals"), sets28: { ...Object.fromEntries(ALL.map((m) => [m, 12])), abdominals: 0 } }));
    expect(s.find((x) => x.kind === "gap")).toMatchObject({ muscle: "core", title: "Add exercises for your core", reason: "None of your routines train your core" });
  });

  it("points out a muscle your routines only use as a helper", () => {
    const s = pickSuggestions(input());
    expect(s.find((x) => x.kind === "target")).toMatchObject({ muscle: "forearms", title: "Add exercises for your forearms", reason: "Your routines only use your forearms as a helper" });
  });

  it("points out a muscle with far fewer sets than the rest", () => {
    const s = pickSuggestions(input({ sets28: { ...Object.fromEntries(ALL.map((m) => [m, 12])), calves: 2 } }));
    expect(s.find((x) => x.kind === "low")).toMatchObject({ routineId: "legs", reason: "Only 2 sets for your calves in 4 weeks, most muscles got 12" });
  });

  it("suggests routines not done for 3 days or more, longest first", () => {
    const s = pickSuggestions(input({ routines: [R("push", "Push", 4), R("pull", "Pull", null), R("legs", "Legs", 1)] })).filter((x) => x.kind === "oldest");
    expect(s.map((x) => [x.title, x.reason])).toEqual([["Pull", "Not done yet"], ["Push", "Last done 4 days ago"]]);
  });

  it("puts a program's next workout first", () => {
    const s = pickSuggestions(input({ programs: [{ program: "5x5", routineId: "legs", name: "Legs", color: null, week: 2, day: 3, deload: false }] }));
    expect(s[0]).toMatchObject({ kind: "program", reason: "Next in 5x5: week 2, workout 3" });
  });
});
