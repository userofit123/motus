// One side at a time (single-arm, single-leg): such an exercise gets left and right sets, and its weight is what one
// side moves, so a one-arm row with 60 kg on the handle is logged as 60 on each side's set (volume adds both sets up).
// Every exercise has a default (the catalog's from its name, your own from its editor); anyone can switch it per exercise.
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { savedToast, toastError } from "./toast";

export const SIDES_HINT = "Left and right sets, weight for one side";

/** The ⋮ menu item that switches it; `then` lets a screen show the change before the refetch. */
export const sidesItem = (exerciseId: string, on: boolean, then?: (on: boolean) => void) => ({
  label: "One side at a time", hint: SIDES_HINT, icon: "left", checked: on,
  run: async () => {
    try {
      await api.put(`/exercises/${exerciseId}/prefs`, { unilateral: !on });
      then?.(!on);
      invalidate(["exercises", "workouts", "routines"]);
      savedToast(on ? "Both sides together" : "One side at a time");
    } catch (e) { toastError(e); }
  },
});
