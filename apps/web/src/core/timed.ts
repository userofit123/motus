// Timed sets: any exercise counted in reps can be done for time instead (a hold, a stretch, a timed carry), and a timed
// one in reps. Every exercise has its own way (the catalog's, or your own from its editor); anyone can switch it per exercise.
// Switching also converts its sets in every routine (the server does that), so screens holding sets apply the same rule.
import { canTime, isTimed, trackingFor, type Tracking } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { savedToast, toastError } from "./toast";

/** The editor's "Track it by" options, with an example each */
export const TRACK: Record<Tracking, string> = {
  weight_reps: "Weight and reps", bodyweight_reps: "Bodyweight reps (+ optional weight)", assisted: "Assisted (weight helps)", reps_only: "Reps only",
  duration: "Time (holds, planks)", weight_duration: "Weight and time (carries)", distance_duration: "Distance and time", distance_weight: "Distance and weight (sled)",
};
/** What its sets hold, for the exercise's Details */
export const TRACK_DETAIL: Record<Tracking, string> = {
  weight_reps: "Weight and reps", bodyweight_reps: "Reps, with optional added weight", assisted: "Reps, with weight that helps", reps_only: "Reps",
  duration: "Time", weight_duration: "Weight and time", distance_duration: "Distance and time", distance_weight: "Distance and weight",
};

export const TIMED_HINT = "A time for each set, no reps";

/** The ⋮ menu item that switches it (hidden while the feature is off, and for distance exercises); `then` lets a screen
 * show the change before the refetch. */
export const timedItem = (exerciseId: string, tracking: Tracking, featureOn: boolean, then?: (t: Tracking) => void) => {
  const on = isTimed(tracking);
  return {
    label: "Timed sets", hint: TIMED_HINT, icon: "play", checked: on, hidden: !featureOn || !canTime(tracking),
    run: async () => {
      try {
        await api.put(`/exercises/${exerciseId}/prefs`, { timed: !on });
        then?.(trackingFor(tracking, !on));
        invalidate(["exercises", "workouts", "routines", "stats", "goals", "home"]);
        savedToast(on ? "Sets in reps" : "Timed sets");
      } catch (e) { toastError(e); }
    },
  };
};
