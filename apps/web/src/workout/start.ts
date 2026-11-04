// Starting a workout from anywhere: if one is already running, ask instead of failing (go back to it, or discard it and
// start this one). Returns false when nothing was started.
import { api, ApiError } from "../api/client";
import { choose } from "../core/ask";
import { router } from "../router";
import { replacingWorkout } from "./useWorkout";

export async function startWorkout(body: Record<string, unknown>): Promise<boolean> {
  try { await api.post("/workouts/start", body); return true; }
  catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
    const v = await choose("A workout is already in progress", [{ label: "Go back to it", value: "resume" }, { label: "Discard it and start this one", value: "new" }]);
    if (v === "resume") router.push("/workout");
    if (v !== "new") return false;
    const replaced = replacingWorkout();
    await api.post("/workouts/start", { ...body, force: true });
    replaced();
    return true;
  }
}
