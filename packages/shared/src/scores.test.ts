import { describe, expect, it } from "vitest";
import { sleepRange, sleepScore, effortMinutes, activityScore, groupSets, strengthScore, stepsTarget, ageOf, scoresFor, type ScoreNight } from "./scores";
import { muscleSets } from "./muscles";

// a night: hours asleep, hours in bed, bed time as minutes from noon (11 pm = 660), woken that long after
const night = (asleepH: number, bedH: number, bedAt = 660): ScoreNight => ({ asleepMin: asleepH * 60, inBedMin: bedH * 60, bedAt, wakeAt: bedAt + bedH * 60 });

describe("health scores", () => {
  it("takes the recommended sleep hours by age", () => {
    expect(sleepRange(null)).toEqual([7, 9]);
    expect(sleepRange(16)).toEqual([8, 10]);
    expect(sleepRange(40)).toEqual([7, 9]);
    expect(sleepRange(70)).toEqual([7, 8]);
  });

  it("needs three nights for a sleep score", () => {
    expect(sleepScore([night(8, 8.5), night(8, 8.5)], 30)).toBeNull();
  });

  it("scores a week of good, regular nights 100", () => {
    const s = sleepScore(Array.from({ length: 7 }, () => night(7.5, 8)), 30)!;
    expect(s.score).toBe(100);
    expect(s.label).toBe("Good");
    expect(s.weakest).toBeNull();
  });

  it("weighs duration 50, efficiency 25 and regularity 25", () => {
    // 2 of 4 nights in 7-9 h, every night 85 %+ asleep, every night regular: 50 * 0.5 + 25 + 25 = 75
    const s = sleepScore([night(6, 6.5), night(6, 6.5), night(8, 8.5), night(8, 8.5)], 30)!;
    expect(s.parts.map((p) => [p.key, p.value, p.target])).toEqual([["duration", 2, 4], ["efficiency", 4, 4], ["regularity", 4, 4]]);
    expect(s.score).toBe(75);
    expect(s.weakest).toBe("duration");
  });

  it("scores efficiency only on nights the band split into asleep and awake, from its own minutes", () => {
    // typed hours (8) against a 9-hour record would read 89 %; the band's own 7 h reads 78 %
    const typed = { ...night(8, 9), bandAsleepMin: 7 * 60 };
    const s = sleepScore([typed, typed, typed, { ...night(8, 8), bandAsleepMin: null }], 30)!;
    expect(s.parts.find((p) => p.key === "efficiency")).toMatchObject({ value: 0, target: 3 });
    expect(s.parts.find((p) => p.key === "efficiency")!.extra).toMatchObject({ nights: 4 });
    // fewer than three such nights: efficiency is left out (weight 0, never the weakest), the score from the other two
    const t = sleepScore([typed, ...Array.from({ length: 3 }, () => ({ ...night(8, 8.5), bandAsleepMin: null }))], 30)!;
    expect(t.parts.map((p) => [p.key, p.weight])).toEqual([["duration", 50], ["efficiency", 0], ["regularity", 25]]);
    expect(t.parts.find((p) => p.key === "efficiency")).toMatchObject({ value: 1, target: 4, extra: { left: 1 } });
    expect(t.score).toBe(100);
    expect(t.weakest).toBeNull();
  });

  it("counts the nights under and over the hours, so the line can say which", () => {
    const s = sleepScore([night(6, 6.5), night(6, 6.5), night(10, 10.5), night(8, 8.5)], 30)!;
    expect(s.parts[0]).toMatchObject({ value: 1, target: 4, extra: { short: 2, long: 1 } });
  });

  it("counts a night off its usual times as irregular", () => {
    const s = sleepScore([night(8, 8.5), night(8, 8.5), night(8, 8.5), night(8, 8.5, 840)], 30)!;
    expect(s.parts.find((p) => p.key === "regularity")!.value).toBe(3);
  });

  it("counts moderate and vigorous minutes from heart rate", () => {
    // max 200: 130 bpm is 65 % (moderate), 160 is 80 % (vigorous), 100 is 50 % (neither); a minute between samples
    const hr: [number, number][] = [[0, 130], [60, 130], [120, 160], [180, 100], [240, 100]];
    expect(effortMinutes(hr, 200)).toEqual({ moderate: 2, vigorous: 1 });
  });

  it("counts a vigorous minute as two of WHO's 150", () => {
    const s = activityScore({ moderate: 50, vigorous: 25, minutesDays: 7, activityMin: 0, activityMinOffHr: 0, stepDays: [] }, 30)!;
    expect(s.parts).toHaveLength(1);
    expect(s.parts[0]!.value).toBe(100);
    expect(s.score).toBe(67);
  });

  it("takes the steps target by age and leaves out a part without data", () => {
    expect(stepsTarget(30)).toBe(8000);
    expect(stepsTarget(65)).toBe(6000);
    const s = activityScore({ moderate: 0, vigorous: 0, minutesDays: 1, activityMin: 0, activityMinOffHr: 0, stepDays: [6000, 6000, 6000, 0] }, 65)!;
    expect(s.parts.map((p) => p.key)).toEqual(["steps"]);
    expect(s.score).toBe(100);
    expect(activityScore({ moderate: 0, vigorous: 0, minutesDays: 0, activityMin: 0, activityMinOffHr: 0, stepDays: [9000] }, 30)).toBeNull();
  });

  it("lets only recorded activities stand in when heart rate covers too few days", () => {
    // 2 days of heart rate: its 90 minutes don't count, the week's 40 activity minutes do
    const a = activityScore({ moderate: 90, vigorous: 0, minutesDays: 2, activityMin: 40, activityMinOffHr: 10, stepDays: [] }, 30)!;
    expect(a.parts[0]!.value).toBe(40);
    expect(activityScore({ moderate: 90, vigorous: 0, minutesDays: 2, activityMin: 0, activityMinOffHr: 0, stepDays: [] }, 30)).toBeNull();
    // enough heart rate: its minutes plus the activities on days without it
    expect(activityScore({ moderate: 90, vigorous: 0, minutesDays: 3, activityMin: 40, activityMinOffHr: 10, stepDays: [] }, 30)!.parts[0]!.value).toBe(100);
  });

  it("scores adults only", () => {
    expect(scoresFor(17)).toBe(false);
    expect(scoresFor(18)).toBe(true);
    expect(scoresFor(null)).toBe(true);
  });

  it("sums sets per muscle into groups as Stats → Muscles does", () => {
    const g = groupSets(muscleSets([{ primary: ["quadriceps", "glutes"], secondary: ["hamstrings", "lower back"], sets: 4 }]));
    expect(g.legs).toBe(10);
    expect(g.back).toBe(2);
    expect(g.chest).toBe(0);
  });

  it("scores strength on WHO's 2 days and 10 sets per group", () => {
    const s = strengthScore({ days: 1, sets: { chest: 12, lats: 6, "middle back": 4, quadriceps: 9 } });
    // days 50 * 0.5, groups 50 * 2/6
    expect(s.score).toBe(42);
    expect(s.label).toBe("Low");
    expect(s.weakest).toBe("groups");
  });

  it("works out the age from the year of birth", () => {
    expect(ageOf(1990, new Date(2026, 5, 1))).toBe(36);
    expect(ageOf(null)).toBeNull();
  });
});
