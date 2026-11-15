import { describe, expect, it } from "vitest";
import { maxHeartRate, zoneOf, zoneMinutes, highRestingDays } from "./heart";

describe("heart rate zones", () => {
  it("uses the max of your own, else 220 - age, else none", () => {
    expect(maxHeartRate({ maxHr: 185, birthYear: 1990 })).toEqual({ bpm: 185, own: true });
    expect(maxHeartRate({ birthYear: 1990 }, new Date(2026, 5, 1))).toEqual({ bpm: 184, own: false });
    expect(maxHeartRate({})).toBeNull();
  });
  it("puts a beat in its zone", () => {
    expect(zoneOf(90, 200)).toBe(-1);
    expect(zoneOf(100, 200)).toBe(0);
    expect(zoneOf(150, 200)).toBe(2);
    expect(zoneOf(199, 200)).toBe(4);
  });
  it("counts each sample up to the next, a long gap at most 5 minutes", () => {
    const m = zoneMinutes([[0, 150], [60, 150], [120, 170], [3600, 150]], 200).get("")!;
    expect(m[2]).toBeCloseTo(3); // two of 60s, and the last sample's minute
    expect(m[3]).toBeCloseTo(5);
  });
});

describe("high resting heart rate", () => {
  it("flags a day well above the 28 before it, once 7 are read", () => {
    const days = Array.from({ length: 10 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, value: 55 }));
    expect(highRestingDays([...days, { date: "2026-11-11", value: 62 }])).toEqual([{ date: "2026-11-11", value: 62, usual: 55 }]);
    expect(highRestingDays([...days, { date: "2026-11-11", value: 58 }])).toEqual([]);
    expect(highRestingDays([...days.slice(0, 5), { date: "2026-11-06", value: 70 }])).toEqual([]);
  });
});
