import { describe, expect, it } from "vitest";
import { routeSplits } from "./route";

// metres north along a meridian to latitude, so distances are exact to haversine's radius
const M = (m: number) => m / ((6371000 * Math.PI) / 180);
const pt = (m: number, t: number) => [M(m), 34.8, t];

describe("routeSplits", () => {
  it("has none for points whose time is 0 or doesn't increase", () => {
    expect(routeSplits([[32, 34.8, 0], [32.01, 34.8, 0], [32.02, 34.8, 0]], 1000)).toEqual([]);
    expect(routeSplits([pt(0, 1000), pt(600, 1100), pt(1200, 1100), pt(2400, 1300)], 1000)).toEqual([]);
  });
  it("cuts a unit mid-step and shares that step's time in proportion", () => {
    // 600 m in 100 s, then 600 m in 80 s; the km ends 400 m into the second step, at 100 + 53.33 s
    const s = routeSplits([pt(0, 1000), pt(600, 1100), pt(1200, 1180)], 1000);
    expect(s[0]!.n).toBe(1);
    expect(s[0]!.s).toBe(Math.round(100 + (80 * 400) / 600));
    expect(s[0]!.partial).toBeUndefined();
    // the rest: 200 m of 1000 is over the 0.1 cut: partial, scaled to a full unit (26.67 s / 0.2)
    expect(s[1]).toEqual({ n: 2, s: Math.round((80 * 200) / 600 / 0.2), partial: true, fraction: 0.2 });
  });
  it("closes every unit a long step crosses, each with its share of the time", () => {
    // one 2500 m step in 90 s, after a short first one
    const s = routeSplits([pt(0, 1000), pt(100, 1020), pt(2600, 1110)], 1000);
    expect(s.map((x) => x.n)).toEqual([1, 2, 3]);
    const per = (90 * 900) / 2500; // 900 m of the long step finish the first km
    expect(s[0]!.s).toBe(Math.round(20 + per));
    expect(s[1]!.s).toBe(Math.round((90 * 1000) / 2500));
    expect(s[2]!.partial).toBe(true);
    expect(s[2]!.fraction).toBe(0.6);
  });
  it("keeps a last part under a unit partial, and leaves out one of a tenth or less", () => {
    const run = (end: number) => routeSplits([pt(0, 1000), pt(500, 1100), pt(1000, 1200), pt(end, 1200 + (end - 1000) / 5)], 1000);
    const s = routeSplits([pt(0, 1000), pt(500, 1100), pt(1000, 1200), pt(1970, 1394)], 1000);
    expect(s.map((x) => x.n)).toEqual([1, 2]);
    expect(s[1]).toMatchObject({ partial: true, fraction: 0.97 });
    expect(s[0]!.partial).toBeUndefined();
    expect(run(1090).length).toBe(1);
  });
});
