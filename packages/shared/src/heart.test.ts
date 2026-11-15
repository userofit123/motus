import { describe, expect, it } from "vitest";
import { maxHeartRate, zoneOf, zoneMinutes, highRestingDays, setSpans, exercisePeaks, restRecovery } from "./heart";

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

describe("heart rate over a workout's sets", () => {
  const t0 = 1_000_000;
  const sets = [
    { id: "a", weId: "e1", doneS: t0 + 100, restS: 90 },
    { id: "b", weId: "e1", doneS: t0 + 230, restS: 120 },
    { id: "c", weId: "e2", doneS: t0 + 400, restS: null, durationS: 30 },
  ];
  it("places each set and the rest after it", () => {
    expect(setSpans(sets, t0)).toEqual([
      { id: "a", weId: "e1", a: t0 + 60, b: t0 + 100, restB: t0 + 190 },
      { id: "b", weId: "e1", a: t0 + 190, b: t0 + 230, restB: t0 + 350 },
      { id: "c", weId: "e2", a: t0 + 370, b: t0 + 400, restB: null },
    ]);
  });
  it("leaves sets all ticked at one moment off the clock", () => {
    expect(setSpans([{ id: "a", weId: "e", doneS: t0 }, { id: "b", weId: "e", doneS: t0 }], t0 - 600)).toEqual([]);
  });
  it("finds each exercise's peak and the fall in a minute of rest", () => {
    const sp = setSpans(sets, t0);
    const hr: [number, number][] = [[t0 + 90, 150], [t0 + 100, 155], [t0 + 160, 120], [t0 + 225, 160], [t0 + 290, 130], [t0 + 390, 140]];
    expect(exercisePeaks(hr, sp, t0)).toEqual(new Map([["e1", { avgHr: 146, maxHr: 160 }], ["e2", { avgHr: 135, maxHr: 140 }]]));
    expect(restRecovery(hr, sp)).toEqual({ drop: 33, rests: 2 });
  });
});
