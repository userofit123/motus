import { describe, expect, it } from "vitest";
import { cleanHomeBlocks, cleanGoalsOrder, orderGoals, withDefaults, HOME_BLOCKS, WORKOUT_SOUNDS } from "./settings";

const ids = (x: { id: string }[]) => x.map((s) => s.id);

describe("Home blocks", () => {
  it("gives a new account the default order", () => {
    expect(withDefaults({}).home.blocks).toEqual(HOME_BLOCKS);
  });
  it("drops unknown ids and repeats, and appends the missing ones with their default", () => {
    const out = cleanHomeBlocks([{ id: "previous", on: false }, { id: "nope", on: true }, { id: "feed", on: true }, { id: "previous", on: true }, "x", null]);
    expect(out.slice(0, 2)).toEqual([{ id: "previous", on: false }, { id: "feed", on: true }]);
    expect(ids(out)).toEqual(["previous", "feed", ...ids(HOME_BLOCKS).filter((id) => id !== "previous" && id !== "feed")]);
    expect(out.find((s) => s.id === "upnext")?.on).toBe(true);
    expect(out.find((s) => s.id === "records")?.on).toBe(false);
  });
  it("drops the old Streak and Steps blocks from a saved layout, keeping the rest in its order", () => {
    const out = cleanHomeBlocks([{ id: "today", on: true }, { id: "streak", on: true }, { id: "week", on: false }, { id: "steps", on: true }, { id: "pinned", on: true }]);
    expect(ids(out).slice(0, 3)).toEqual(["today", "week", "pinned"]);
    expect(out.some((s) => s.id === "streak" || s.id === "steps")).toBe(false);
  });
  it("drops the old Body weight block from a saved layout, keeping the rest in its order", () => {
    const out = cleanHomeBlocks([{ id: "today", on: true }, { id: "bodyweight", on: true }, { id: "muscles", on: false }, { id: "week", on: true }]);
    expect(ids(out).slice(0, 3)).toEqual(["today", "muscles", "week"]);
    expect(out.some((s) => s.id === "bodyweight")).toBe(false);
  });
  it("keeps the default on/off when a saved one isn't a boolean", () => {
    expect(cleanHomeBlocks([{ id: "feed", on: "yes" }])[0]).toEqual({ id: "feed", on: false });
    // Today can't be switched off, even from a saved order that says so
    expect(cleanHomeBlocks([{ id: "today", on: false }])[0]).toEqual({ id: "today", on: true });
  });
  it("drops the older Home's sections and cards", () => {
    const s = withDefaults({ home: { cards: ["feed"], sections: [{ id: "volume", on: true }], goals: [{ id: "g", streak: true }] } });
    expect("cards" in s.home || "sections" in s.home).toBe(false);
    expect(s.home.blocks).toEqual(HOME_BLOCKS);
    expect(s.home.goals).toEqual([{ id: "g", streak: true }]);
  });
});

describe("Goal order", () => {
  it("keeps ids only, each once", () => {
    expect(cleanGoalsOrder(["a", 3, "b", "a", null, ""])).toEqual(["a", "b"]);
    expect(cleanGoalsOrder("a")).toEqual([]);
    expect(withDefaults({ goalsOrder: ["x", "x", 1] }).goalsOrder).toEqual(["x"]);
    expect(withDefaults({}).goalsOrder).toEqual([]);
  });
  it("puts ordered goals first, drops unknown ids and appends new goals at the end", () => {
    const g = (id: string) => ({ id });
    expect(orderGoals([g("new"), g("b"), g("a"), g("c")], ["a", "gone", "b"]).map((x) => x.id)).toEqual(["a", "b", "new", "c"]);
    expect(orderGoals([g("b"), g("a")], []).map((x) => x.id)).toEqual(["b", "a"]);
  });
  it("drops the old fixed weekly and step targets and the starting-goal marks from saved settings", () => {
    const out = withDefaults({ weeklyGoal: 4, stepGoal: 12000, goalsSeeded: true, stepGoalSeeded: true, firstDay: 0 }) as unknown as Record<string, unknown>;
    for (const k of ["weeklyGoal", "stepGoal", "goalsSeeded", "stepGoalSeeded"]) expect(k in out).toBe(false);
    expect(out.firstDay).toBe(0);
    expect("weeklyGoal" in withDefaults({})).toBe(false);
  });
});

describe("Workout cue sound and volume", () => {
  it("defaults to the beep at full level, and drops the old unused top-level sound", () => {
    const s = withDefaults({ sound: "chime" });
    expect([s.workout.cueSound, s.workout.cueVolume]).toEqual(["beep", 100]);
    expect("sound" in s).toBe(false);
  });
  it("keeps a valid choice and makes a bad one safe", () => {
    expect(withDefaults({ workout: { cueSound: "wood", cueVolume: 40 } }).workout).toMatchObject({ cueSound: "wood", cueVolume: 40 });
    expect(withDefaults({ workout: { cueSound: "nope", cueVolume: 500 } }).workout).toMatchObject({ cueSound: "beep", cueVolume: 100 });
    expect(withDefaults({ workout: { cueVolume: 0 } }).workout.cueVolume).toBe(10);
  });
  it("gives the countdown the one sound chosen before there were two, until one is chosen for it", () => {
    expect(withDefaults({}).workout.tickSound).toBe("beep");
    expect(withDefaults({ workout: { cueSound: "wood" } }).workout).toMatchObject({ cueSound: "wood", tickSound: "wood" });
    expect(withDefaults({ workout: { cueSound: "gong" } }).workout).toMatchObject({ cueSound: "gong", tickSound: "beep" });
    expect(withDefaults({ workout: { cueSound: "wood", tickSound: "click" } }).workout.tickSound).toBe("click");
    expect(withDefaults({ workout: { tickSound: "nope" } }).workout.tickSound).toBe("beep");
  });
  it("offers every sound for both the rest over and the countdown", () => {
    for (const id of WORKOUT_SOUNDS) expect(withDefaults({ workout: { cueSound: id, tickSound: id } }).workout).toMatchObject({ cueSound: id, tickSound: id });
    expect(withDefaults({ workout: { tickSound: "double" } }).workout.tickSound).toBe("double");
  });
});
