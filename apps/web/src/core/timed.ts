// Timed sets: any exercise counted in reps can be done for time instead (a hold, a stretch, a timed carry), and a timed
// one in reps. Every exercise has its own way (the catalog's, or your own from its editor); anyone can switch it per exercise.
import { canTime, trackingFor, usesDuration, type Tracking } from "@motus/shared";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { savedToast, toastError } from "./toast";

/** What an exercise tracks, in words (the editor's "Track it by" and the exercise's Details) */
export const TRACK: Record<Tracking, string> = {
  weight_reps: "Weight and reps", bodyweight_reps: "Bodyweight reps (+ optional weight)", assisted: "Assisted (weight helps)", reps_only: "Reps only",
  duration: "Time (holds, planks)", weight_duration: "Weight and time (carries)", distance_duration: "Distance and time", distance_weight: "Distance and weight (sled)",
};

export const TIMED_HINT = "Each set is a time instead of reps";

/** The ⋮ menu item that switches it (hidden for distance exercises); `then` lets a screen show the change before the refetch. */
export const timedItem = (exerciseId: string, tracking: Tracking, then?: (t: Tracking) => void) => {
  const on = usesDuration(tracking);
  return {
    label: "Timed sets", hint: TIMED_HINT, icon: "clock", checked: on, hidden: !canTime(tracking),
    run: async () => {
      try {
        await api.put(`/exercises/${exerciseId}/prefs`, { timed: !on });
        then?.(trackingFor(tracking, !on));
        invalidate(["exercises", "workouts", "routines", "stats", "goals"]);
        savedToast(on ? "Reps instead of time" : "Timed sets");
      } catch (e) { toastError(e); }
    },
  };
};
