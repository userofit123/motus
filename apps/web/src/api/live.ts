// Live updates (PLAN.md §5): the server announces which topics a change touched, and every cached screen filed under
// one of those topics reloads. The same happens on this device right after its own changes.
import { ref } from "vue";
import { QueryClient } from "@tanstack/vue-query";
import { server } from "./client";

export const queryClient = new QueryClient({
  // "always": with the offline copy, reading works without a connection, so queries must not wait for one
  defaultOptions: { queries: { staleTime: 30_000, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: true, networkMode: "always" }, mutations: { networkMode: "always" } },
});

// One change is announced more than once: on the device the engine announces it while saving and the screen that made it
// asks again once the save is back; with a server its live message and the answer arrive together. Each reload of a
// running workout is a big read, and on the device's database (one query at a time) a second one held up the next
// tap, so the topics asked for within a moment are gathered and every screen reloads once.
const GATHER_MS = 30;
const asked = new Set<string>();
// true from the moment a reload is queued until it has started, so a screen can tell "waiting for a reload" from "nothing
// there" (the queries only say they are fetching once the reload has begun)
export const reloadQueued = ref(false);
let gathering: ReturnType<typeof setTimeout> | null = null;
export function invalidate(topics: string[]) {
  for (const t of topics) asked.add(t);
  reloadQueued.value = true;
  gathering ??= setTimeout(() => {
    const all = [...asked];
    asked.clear(); gathering = null;
    if (all.includes("*")) queryClient.invalidateQueries();
    else queryClient.invalidateQueries({ predicate: (q) => all.includes(String(q.queryKey[0])) });
    reloadQueued.value = false; // invalidating marks the queries as fetching in the same step
  }, GATHER_MS);
}

// a change on the server: reload the screens it touched (or, with an offline copy, fetch it into that copy)
let remote = (topics: string[]) => invalidate(topics);
export const setRemoteHandler = (fn: (topics: string[]) => void) => { remote = fn; };

let es: EventSource | null = null, retry = 1000, poll: ReturnType<typeof setInterval> | null = null;
const liveState = { connected: false };
export function startLive() {
  stopLive();
  try {
    // the apps sign in with a token, which EventSource cannot send: they fall back to checking every 30 s
    if (server.value.token) { poll = setInterval(() => remote(["home", "calendar", "workouts"]), 30_000); return; }
    es = new EventSource(server.value.base + "/api/events", { withCredentials: true });
    es.addEventListener("hello", () => { liveState.connected = true; retry = 1000; });
    es.addEventListener("change", (e) => { try { remote(JSON.parse((e as MessageEvent).data).topics); } catch { /* ignore a bad message */ } });
    es.onerror = () => {
      liveState.connected = false;
      es?.close(); es = null;
      setTimeout(startLive, retry);
      retry = Math.min(retry * 2, 60_000);
    };
  } catch { /* no live updates; screens still refresh on focus */ }
}
export function stopLive() { es?.close(); es = null; if (poll) clearInterval(poll); poll = null; }
