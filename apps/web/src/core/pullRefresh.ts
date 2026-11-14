// Pull to refresh on phones (shell/PhoneShell.vue): pulling down at the very top of a page shows a small round spinner
// that follows the finger with resistance; letting go past THRESHOLD updates everything at once: reads Health Connect
// (when on), syncs the offline copy with the server (when there is one), checks for a new app version (in the apps),
// reloads the screen, and then says in one toast what it did. Listeners stay passive: at the top of the page the
// browser has nothing to scroll for a downward pull, so nothing needs preventing (the overscroll glow is switched off in
// app.css instead).
import { ref } from "vue";
import { sync, schedule } from "../api/replica";
import { invalidate, queryClient, reloadQueued } from "../api/live";
import { healthSupported, syncHealth, healthAdded } from "../native/health";
import { updater, updateAvailable } from "./updater";
import { releaseQuery, detectPlatform } from "./releases";
import { toast } from "./toast";

/** How far (after resistance) the spinner must come down for a release to refresh */
export const THRESHOLD = 70;
// where the spinner rests while the refresh runs, and how far it can be pulled at most
const HOLD = THRESHOLD, MAX = 100;
// the finger moves ~1.7x further than the spinner, and past the threshold it gets stiffer still
const resist = (raw: number) => { const r = raw * 0.6; return Math.min(MAX, r <= THRESHOLD ? r : THRESHOLD + (r - THRESHOLD) * 0.35); };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(done: () => boolean, maxMs: number) {
  const end = Date.now() + maxMs;
  while (!done() && Date.now() < end) await wait(60);
}

/** Send and fetch the offline copy's changes now, and wait for that run to finish (at most 20 s).
 *  What happened, for the summary: "" without an offline copy. */
async function syncCopy(): Promise<string> {
  if (!sync.on) return "";
  const was = sync.syncing, at = sync.lastAt;
  schedule(0);
  // a run already going is waited for as it is (it starts another one by itself if asked meanwhile)
  if (!was) await until(() => sync.syncing, 1500);
  await until(() => !sync.syncing, 20_000);
  // only a run that got through moves lastAt (api/replica.ts); one the server answered with an error leaves its message
  if (sync.lastAt > at) return "Synced with the server";
  return sync.online && sync.error ? "Couldn't sync with the server" : "Couldn't reach the server";
}

/** Health Connect, when on and allowed: what it added ("" when nothing new or nothing allowed). */
async function readHealth(on: boolean): Promise<string> {
  if (!on || !healthSupported()) return "";
  try {
    const r = await syncHealth();
    const added = r ? healthAdded(r) : "";
    return added ? `${added} added from Health Connect` : "";
  } catch { return "Couldn't read Health Connect"; }
}

/** The apps look for a new version as Check now does (the same cached answer App & Versions shows); a newer one shows
 *  the update notice, as an automatic check would. In a browser there is nothing to install: "". */
async function checkUpdate(): Promise<string> {
  if (!detectPlatform().app) return "";
  const r = await queryClient.fetchQuery(releaseQuery).catch(() => null);
  if (!r?.latest) return "Couldn't check for updates";
  updater.latest = r.latest;
  if (!updater.appVersion) return "";
  return updateAvailable.value ? `Version ${updateAvailable.value} available` : "Motus is up to date";
}

/** What a pull does: Health Connect, the server and the update check side by side, then every screen on show reloads,
 *  and one toast sums it up: "Synced with the server · 3 days of steps added from Health Connect · Motus is up to date". */
export async function refreshAll(healthOn: boolean) {
  const t0 = Date.now();
  // the server first in the summary (it is what most pulls are for), the update last
  const said = await Promise.all([syncCopy(), readHealth(healthOn), checkUpdate()]);
  invalidate(["*"]);
  await wait(40); // the gathered reload starts after 30 ms (api/live.ts)
  await until(() => !reloadQueued.value && !queryClient.isFetching(), 10_000);
  // a refresh that was over at once still shows the spinner for a moment, so the pull reads as done, not ignored
  const left = 600 - (Date.now() - t0);
  if (left > 0) await wait(left);
  const parts = said.filter(Boolean);
  toast(parts.length ? parts.join(" · ") : "Up to date", { kind: parts.some((p) => p.startsWith("Couldn't")) ? "err" : "ok", ms: 5000 });
}

/** The gesture. allowed(e): may a pull start from this touch (page, target, nothing open). */
export function usePullRefresh(allowed: (e: TouchEvent) => boolean, refresh: () => Promise<void>) {
  const dist = ref(0), pulling = ref(false), busy = ref(false), done = ref(false);
  let x0 = 0, y0 = 0, mode: "" | "pull" | "no" = "no";
  // a list inside the page that scrolls on its own and isn't at its top takes the pull for itself
  const innerScrolled = (t: EventTarget | null) => {
    for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
      if (el.scrollTop > 0) { const o = getComputedStyle(el).overflowY; if (o === "auto" || o === "scroll") return true; }
    }
    return false;
  };
  const atTop = () => (document.scrollingElement?.scrollTop ?? scrollY) <= 0;
  function start(e: TouchEvent) {
    mode = "no";
    if (busy.value || done.value || e.touches.length !== 1 || !atTop() || !allowed(e) || innerScrolled(e.target)) return;
    x0 = e.touches[0]!.clientX; y0 = e.touches[0]!.clientY; mode = "";
  }
  function move(e: TouchEvent) {
    if (mode === "no") return;
    const t = e.touches[0]!, dx = t.clientX - x0, dy = t.clientY - y0;
    if (!mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      // only a mostly vertical, downward drag; a sideways one is the tab swipe's
      if (dy <= 0 || dy < Math.abs(dx) * 1.5 || !atTop()) { mode = "no"; return; }
      mode = "pull"; pulling.value = true; y0 = t.clientY; // counted from here, so the spinner doesn't jump in
    }
    dist.value = resist(Math.max(0, t.clientY - y0));
  }
  function end(cancel = false) {
    if (mode !== "pull") { mode = "no"; return; }
    mode = "no"; pulling.value = false;
    if (cancel || dist.value < THRESHOLD) { dist.value = 0; return; }
    busy.value = true; dist.value = HOLD;
    // done: the whole ring shrinks away where it is (rather than going blank while it slides back up)
    refresh().finally(() => { busy.value = false; done.value = true; setTimeout(() => { dist.value = 0; done.value = false; }, 200); });
  }
  return { dist, pulling, busy, done, start, move, end };
}
