// Adding an activity type (climbing, padel, a spin class…) from wherever you pick one: the record page, logging one,
// a goal, or Settings → Activities. Two plain questions: its name, and what it tracks.
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { prompt, choose } from "./ask";
import { toast, toastError } from "./toast";

// "On foot" also counts steps while recording (a walk, run or hike); "GPS" is for the rest with a route (a ride, skating).
// `hint` is the short line under a type in Settings → Activity types, `label` the answer in the picker.
export const TRACKS = [
  { value: "foot", label: "Time, distance, route and steps (on foot)", hint: "Time, distance, route and steps", hasDistance: true, hasGps: true, hasSteps: true },
  { value: "gps", label: "Time, distance and route (GPS)", hint: "Time, distance and route", hasDistance: true, hasGps: true, hasSteps: false },
  { value: "distance", label: "Time and distance", hint: "Time and distance", hasDistance: true, hasGps: false, hasSteps: false },
  { value: "time", label: "Time only", hint: "Time only", hasDistance: false, hasGps: false, hasSteps: false },
];
export const tracksOf = (t: { hasDistance: boolean; hasGps: boolean; hasSteps?: boolean }) => (t.hasGps ? (t.hasSteps ? "foot" : "gps") : t.hasDistance ? "distance" : "time");

/** asks, saves and returns the new type's slug (null if cancelled) */
export async function newActivityType(): Promise<string | null> {
  const name = (await prompt("New activity type", { placeholder: "e.g. Climbing", ok: "Next" }))?.trim();
  if (!name) return null;
  const tracks = await choose(`What does ${name} track?`, TRACKS.map(({ value, label }) => ({ value, label })));
  if (!tracks) return null;
  const t = TRACKS.find((x) => x.value === tracks)!;
  try {
    const r = await api.post<{ slug: string }>("/activity-types", { name, hasDistance: t.hasDistance, hasGps: t.hasGps, hasSteps: t.hasSteps });
    invalidate(["activities"]);
    toast(`${name} added`);
    return r.slug;
  } catch (e) { toastError(e); return null; }
}
