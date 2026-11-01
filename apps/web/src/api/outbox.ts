// Changes made without a connection (in the gym's basement) wait here, on the device, and are sent in order when the
// connection is back (PLAN.md §2.2). Each one is replayed exactly once; the screen already shows it.
import { ref } from "vue";
import { api, ApiError } from "./client";
import { readJson, writeJson } from "../core/prefs";
import { invalidate } from "./live";

interface Item { method: "post" | "put" | "del"; path: string; body?: unknown; at: number }
const KEY = "motusOutbox";
export const waiting = ref<Item[]>(readJson(KEY, []));
const save = () => writeJson(KEY, waiting.value);
let flushing = false;

/** Sends a change now, or keeps it for later when the server can't be reached. Errors from the server itself are thrown. */
export async function send<T = unknown>(method: Item["method"], path: string, body?: unknown): Promise<T | null> {
  if (waiting.value.length) { waiting.value.push({ method, path, body, at: Date.now() }); save(); flush(); return null; }
  try {
    return (await (api as any)[method](path, body)) as T;
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) { waiting.value.push({ method, path, body, at: Date.now() }); save(); return null; }
    throw e;
  }
}
export async function flush() {
  if (flushing || !waiting.value.length) return;
  flushing = true;
  try {
    while (waiting.value.length) {
      const it = waiting.value[0]!;
      try { await (api as any)[it.method](it.path, it.body); }
      catch (e) { if (e instanceof ApiError && e.status === 0) break; /* the server refused it: drop it rather than block the rest */ }
      waiting.value.shift(); save();
    }
    if (!waiting.value.length) invalidate(["workouts", "home"]);
  } finally { flushing = false; }
}
addEventListener("online", flush);
setInterval(flush, 15000);
