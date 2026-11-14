import { describe, it, expect } from "vitest";
import { MIN_NIGHT_H, MIN_NIGHT_MIN, isNight, isNightMin } from "./sleep";

describe("what counts as a night", () => {
  it("is 3 hours asleep or more", () => {
    expect(MIN_NIGHT_H).toBe(3);
    expect(MIN_NIGHT_MIN).toBe(180);
  });
  it("leaves out naps and partial records", () => {
    // the audit's short records: 0.4, 0.5, 0.8 and 2 hours
    for (const h of [0.4, 0.5, 0.8, 2, 2.9]) expect(isNight(h)).toBe(false);
    for (const h of [3, 5.5, 7.2, 11]) expect(isNight(h)).toBe(true);
    expect(isNightMin(179)).toBe(false);
    expect(isNightMin(180)).toBe(true);
  });
});
