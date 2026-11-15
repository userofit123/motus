import { describe, expect, it } from "vitest";
import { activityClimb, activityDistance, tracksDistance, bandStepsVerdict, stepsTyped, appSteps } from "./activity";

const walk = { hasDistance: true, hasGps: true }, yoga = { hasDistance: false, hasGps: false }, swim = { hasDistance: true, hasGps: false };

describe("activityDistance", () => {
  it("counts a type that tracks distance", () => {
    expect(activityDistance({ distanceM: 2500 }, walk)).toBe(2500);
    expect(activityDistance({ distanceM: "1200.5" }, swim)).toBe(1200.5);
  });
  it("leaves out a time only type's distance", () => {
    expect(activityDistance({ distanceM: 2500, source: "manual" }, yoga)).toBeNull();
    expect(tracksDistance({}, yoga)).toBe(false);
  });
  it("keeps Health Connect's, a routed one's and an unknown type's", () => {
    expect(activityDistance({ distanceM: 900, source: "health_connect" }, yoga)).toBe(900);
    expect(activityDistance({ distanceM: 900, hasRoute: true }, yoga)).toBe(900);
    expect(activityDistance({ distanceM: 900, route: [[1, 2]] }, yoga)).toBe(900);
    expect(activityDistance({ distanceM: 900 }, undefined)).toBe(900);
  });
  it("is null for none or 0", () => {
    expect(activityDistance({ distanceM: null }, walk)).toBeNull();
    expect(activityDistance({ distanceM: 0 }, walk)).toBeNull();
  });
});

describe("activityClimb", () => {
  it("counts only where the type records a route or there is one", () => {
    expect(activityClimb({ elevationM: 40 }, walk)).toBe(40);
    expect(activityClimb({ elevationM: 0 }, walk)).toBe(0);
    expect(activityClimb({ elevationM: 40 }, swim)).toBeNull();
    expect(activityClimb({ elevationM: 40, hasRoute: true }, swim)).toBe(40);
    expect(activityClimb({ elevationM: null }, walk)).toBeNull();
  });
});

describe("bandStepsVerdict", () => {
  const base = { steps: 1500, covered: true, app: 1387, counts: true, typed: false };
  it("says why the device's count isn't used, in the engine's order", () => {
    expect(bandStepsVerdict(base)).toBe("use");
    expect(bandStepsVerdict({ ...base, typed: true })).toBe("typed");
    expect(bandStepsVerdict({ ...base, counts: false })).toBe("notCounted");
    expect(bandStepsVerdict({ ...base, steps: null })).toBe("none");
    expect(bandStepsVerdict({ ...base, covered: false })).toBe("partial");
    expect(bandStepsVerdict({ ...base, steps: 1387 })).toBe("phone");
    expect(bandStepsVerdict({ ...base, steps: 310 })).toBe("far");
    expect(bandStepsVerdict({ ...base, steps: 310, app: 150 })).toBe("use");
  });
  it("reads the typed and the app's own count from the row", () => {
    expect(stepsTyped({ source: "manual", steps: 900, stepsSource: null })).toBe(true);
    expect(stepsTyped({ source: "gps", steps: 900, stepsSource: null })).toBe(false);
    expect(appSteps({ steps: 1500, stepsSource: "band", stepsApp: 1387 })).toBe(1387);
    expect(appSteps({ steps: 1387, stepsSource: null })).toBe(1387);
  });
});
