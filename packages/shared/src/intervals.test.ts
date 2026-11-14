import { describe, expect, it } from "vitest";
import { intervalPhases, intervalAt, intervalTotalS, cleanInterval, cleanIntervalPresets, cleanSounds, intervalSummary, INTERVAL_SOUNDS, INTERVAL_SOUNDS_DEFAULT } from "./intervals";
import { SOUND_IDS } from "./sounds";
import { withDefaults } from "./settings";

describe("interval timer", () => {
  it("lays out rounds, sets and the rest between sets", () => {
    const p = intervalPhases({ prepS: 5, workS: 20, restS: 10, rounds: 2, sets: 2, setRestS: 60 });
    expect(p.map((x) => x.kind)).toEqual(["prep", "work", "rest", "work", "setRest", "work", "rest", "work"]);
    expect(intervalTotalS(p)).toBe(5 + 20 + 10 + 20 + 60 + 20 + 10 + 20);
  });
  it("skips zero-length rests", () => {
    expect(intervalPhases({ prepS: 0, workS: 60, restS: 0, rounds: 3, sets: 1, setRestS: 0 }).map((x) => x.kind)).toEqual(["work", "work", "work"]);
  });
  it("finds the phase from elapsed time", () => {
    const p = intervalPhases({ prepS: 10, workS: 20, restS: 10, rounds: 2, sets: 1, setRestS: 0 });
    expect(intervalAt(p, 0)).toEqual({ index: 0, leftMs: 10_000 });
    expect(intervalAt(p, 12_000)).toEqual({ index: 1, leftMs: 18_000 });
    expect(intervalAt(p, 60_000).index).toBe(p.length);
  });
  it("goes straight on to the next set when the rest between sets is 0", () => {
    const p = intervalPhases({ prepS: 0, workS: 20, restS: 10, rounds: 2, sets: 2, setRestS: 0 });
    expect(p.map((x) => x.kind)).toEqual(["work", "rest", "work", "work", "rest", "work"]);
    expect(p.map((x) => x.set)).toEqual([1, 1, 1, 2, 2, 2]);
  });
  it("is in the next phase exactly at a boundary", () => {
    const p = intervalPhases({ prepS: 10, workS: 20, restS: 10, rounds: 2, sets: 1, setRestS: 0 });
    expect(intervalAt(p, 10_000)).toEqual({ index: 1, leftMs: 20_000 });
    expect(intervalAt(p, 30_000)).toEqual({ index: 2, leftMs: 10_000 });
    expect(intervalAt(p, intervalTotalS(p) * 1000)).toEqual({ index: p.length, leftMs: 0 });
    expect(intervalAt(p, intervalTotalS(p) * 1000 - 1)).toEqual({ index: p.length - 1, leftMs: 1 });
  });
  it("cleans saved setups", () => {
    const junk = [null, 5, "x", { id: "a", name: "  Legs  ", workS: -1, rounds: 500 }, { id: "b" }, { id: "c", name: "   " }, { name: "no id" },
      { id: "a", name: "Again" }, { id: "d", name: "x".repeat(200) }];
    const out = cleanIntervalPresets(junk);
    expect(out.map((x) => x.id)).toEqual(["a", "d"]);
    expect(out[0]).toMatchObject({ name: "Legs", workS: 1, rounds: 99, prepS: 10 });
    expect(out[1]!.name.length).toBe(60);
    expect(cleanIntervalPresets("nope")).toEqual([]);
    expect(cleanIntervalPresets(Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }))).length).toBe(50);
    expect(withDefaults({ intervals: [null, { id: "x", name: "X" }, { id: "x", name: "Y" }] }).intervals.map((x) => x.name)).toEqual(["X"]);
    expect(withDefaults({ intervals: null }).intervals).toEqual([]);
  });
  it("keeps each part's sound, and gives old or bad setups the usual ones", () => {
    expect(cleanInterval({}).sounds).toEqual(INTERVAL_SOUNDS_DEFAULT);
    expect(cleanInterval({ sounds: { work: "bell", rest: "none", done: 5 } as never }).sounds).toEqual({ ...INTERVAL_SOUNDS_DEFAULT, rest: "none" });
    const [p] = cleanIntervalPresets([{ id: "a", name: "A", sounds: { prep: "info", work: "levelUp" } }, { id: "b", name: "B" }]);
    expect(p!.sounds).toMatchObject({ prep: "info", work: "levelUp", done: "achievement" });
    expect(cleanSounds({ work: "warning", rest: "complete", done: "wake", prep: "siren" })).toEqual({ ...INTERVAL_SOUNDS_DEFAULT, work: "warning", rest: "complete", done: "wake" });
    for (const id of INTERVAL_SOUNDS) expect(cleanSounds({ work: id }).work).toBe(id);
    expect(cleanIntervalPresets([{ id: "b", name: "B", sounds: "loud" }])[0]!.sounds).toEqual(INTERVAL_SOUNDS_DEFAULT);
  });
  it("moves the sounds made in the app before the recorded ones to the nearest recorded one, never to silence", () => {
    // the interval timer's own old ids: its "beep" was Bell and its "gong" the small one (the rest timer's differ)
    expect(cleanSounds({ prep: "beep", work: "double", rest: "low", setRest: "gong", done: "triple" }))
      .toEqual({ prep: "notification", work: "checkpoint", rest: "select", setRest: "complete", done: "streak" });
    expect(cleanSounds({ prep: "bright", work: "deepGong", rest: "marimba", setRest: "none", done: "softAlarm" }))
      .toEqual({ prep: "progressStep", work: "achievement", rest: "press", setRest: "none", done: "warning" });
    const old = ["beep", "double", "triple", "high", "low", "rising", "softAlarm", "chime", "marimba", "pulse", "gong", "digital", "wake", "handBell", "shipBell", "tubular", "temple", "bowl", "deepGong", "bright", "click"];
    for (const id of old) expect(SOUND_IDS).toContain(cleanSounds({ work: id }).work);
    expect(cleanIntervalPresets([{ id: "a", name: "A", sounds: { work: "rising", rest: "temple" } }])[0]!.sounds).toMatchObject({ work: "levelUp", rest: "achievement" });
  });
  it("sums the setup up in plain words, leaving out what is 0", () => {
    expect(intervalSummary({ prepS: 10, workS: 40, restS: 20, rounds: 8, sets: 3, setRestS: 60 }))
      .toBe("10s to get ready, then 8 rounds of 40s work and 20s rest. Repeat for 3 sets with 1m rest between sets.");
    expect(intervalSummary({ prepS: 0, workS: 60, restS: 0, rounds: 10, sets: 1, setRestS: 60 })).toBe("10 rounds of 1m work.");
    expect(intervalSummary({ prepS: 5, workS: 90, restS: 30, rounds: 1, sets: 2, setRestS: 0 })).toBe("5s to get ready, then 1 round of 1m 30s work. Repeat for 2 sets.");
  });
  it("cleans bad input", () => {
    expect(cleanInterval({ workS: -3, rounds: 1000 })).toMatchObject({ workS: 1, rounds: 99 });
  });
});
