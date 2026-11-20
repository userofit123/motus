import { describe, expect, it } from "vitest";
import { programEnd, weeksText } from "./programs";

describe("programs", () => {
  it("ends on the last day of the last week", () => {
    expect(programEnd("2026-11-23", 1)).toBe("2026-11-29");
    expect(programEnd("2026-11-23", 8)).toBe("2027-01-17");
    expect(programEnd(null, 8)).toBeNull();
    expect(programEnd("2026-11-23", 0)).toBeNull();
  });
  it("counts weeks in words", () => {
    expect([weeksText(0), weeksText(1), weeksText(8)]).toEqual(["0 weeks", "1 week", "8 weeks"]);
  });
});
