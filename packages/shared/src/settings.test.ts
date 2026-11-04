import { describe, expect, it } from "vitest";
import { cleanHomeSections, cleanGoalsOrder, orderGoals, withDefaults, HOME_SECTIONS } from "./settings";

const ids = (x: { id: string }[]) => x.map((s) => s.id);

describe("Home sections", () => {
  it("gives a new account the default order", () => {
    expect(withDefaults({}).home.sections).toEqual(HOME_SECTIONS);
  });
  it("drops unknown ids and repeats, and appends the missing ones with their default", () => {
    const out = cleanHomeSections([{ id: "previous", on: false }, { id: "nope", on: true }, { id: "volume", on: true }, { id: "previous", on: true }, "x", null]);
    expect(out.slice(0, 2)).toEqual([{ id: "previous", on: false }, { id: "volume", on: true }]);
    expect(ids(out)).toEqual(["previous", "volume", ...ids(HOME_SECTIONS).filter((id) => id !== "previous" && id !== "volume")]);
    expect(out.find((s) => s.id === "upnext")?.on).toBe(true);
    expect(out.find((s) => s.id === "feed")?.on).toBe(false);
  });
  it("keeps the default on/off when a saved one isn't a boolean", () => {
    expect(cleanHomeSections([{ id: "feed", on: "yes" }])[0]).toEqual({ id: "feed", on: false });
  });
  it("carries over the older list of switched-on cards", () => {
    const s = withDefaults({ home: { cards: ["stats", "upnext", "feed"] } });
    expect("cards" in s.home).toBe(false);
    const on = (id: string) => s.home.sections.find((x) => x.id === id)?.on;
    expect([on("feed"), on("goals"), on("volume"), on("upnext")]).toEqual([true, false, false, true]);
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
});
