import { describe, expect, it } from "vitest";
import { zoneLoad, sessionLoad, loadTrend } from "./load";

describe("training load", () => {
  it("weights each zone's minutes by its number", () => {
    expect(zoneLoad([10, 10, 0, 5, 1])).toBe(10 + 20 + 20 + 5);
  });

  it("takes a session's heart rate load, its sets, or its minutes", () => {
    // 30 minutes at 150 of 200 (zone 3, 75%; the last sample counts a minute): 90
    const hr = Array.from({ length: 30 }, (_, i) => [i * 60, 150] as const);
    expect(sessionLoad({ hr, maxHr: 200, sets: 10 })).toBe(90);
    // a strength session's sets count more than its low heart rate
    expect(sessionLoad({ hr, maxHr: 200, sets: 30 })).toBe(120);
    // no max heart rate: the sets
    expect(sessionLoad({ hr, maxHr: null, sets: 10 })).toBe(40);
    // an activity without heart rate: its minutes
    expect(sessionLoad({ minutes: 45 })).toBe(90);
  });

  it("compares the last 7 days with the weekly average of 28 (acute:chronic)", () => {
    const today = "2026-11-28";
    const day = (n: number) => new Date(Date.parse(today + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);
    const even = Array.from({ length: 28 }, (_, i) => ({ date: day(i), load: 100 }));
    expect(loadTrend(even, today, day(27))).toEqual({ week: 700, usual: 700, ratio: 1, state: "steady", left: null });
    // a heavy last week
    const heavy = even.map((d, i) => (i < 7 ? { ...d, load: 200 } : d));
    expect(loadTrend(heavy, today, day(27))).toMatchObject({ week: 1400, usual: 875, ratio: 1.6, state: "much higher" });
    // a rest week
    expect(loadTrend(even.filter((_, i) => i >= 7), today, day(27))).toMatchObject({ week: 0, ratio: 0, state: "lighter" });
    // under three weeks since the first session: no comparison yet
    expect(loadTrend(even.slice(0, 14), today, day(13))).toMatchObject({ ratio: null, state: null, left: 8 });
    // the last day of the wait
    expect(loadTrend(even.slice(0, 21), today, day(20))).toMatchObject({ ratio: null, left: 1 });
    // three weeks or more since the first session but nothing in the last 4 weeks: no usual, and nothing to wait for
    expect(loadTrend([], today, day(40))).toMatchObject({ ratio: null, state: null, left: null });
  });
});
