// Adding an activity type (climbing, padel, a spin class…) from wherever you pick one: the record page, logging one,
// a goal, or Settings → Activities. Two plain questions: its name, and what it tracks.
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { prompt, choose } from "./ask";
import { toast, toastError } from "./toast";

export const TRACKS = [
  { value: "gps", label: "Time, distance and route (GPS)", hasDistance: true, hasGps: true },
  { value: "distance", label: "Time and distance", hasDistance: true, hasGps: false },
  { value: "time", label: "Time only", hasDistance: false, hasGps: false },
];
export const tracksOf = (t: { hasDistance: boolean; hasGps: boolean }) => (t.hasGps ? "gps" : t.hasDistance ? "distance" : "time");

/** asks, saves and returns the new type's slug (null if cancelled) */
export async function newActivityType(): Promise<string | null> {
  const name = (await prompt("New activity type", { placeholder: "e.g. Climbing", ok: "Next" }))?.trim();
  if (!name) return null;
  const tracks = await choose(`What does ${name} track?`, TRACKS.map(({ value, label }) => ({ value, label })));
  if (!tracks) return null;
  const t = TRACKS.find((x) => x.value === tracks)!;
  try {
    const r = await api.post<{ slug: string }>("/activity-types", { name, hasDistance: t.hasDistance, hasGps: t.hasGps });
    invalidate(["activities"]);
    toast(`${name} added`);
    return r.slug;
  } catch (e) { toastError(e); return null; }
}
