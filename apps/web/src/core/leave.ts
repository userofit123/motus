// Leaving a page with unsaved changes, by its own Back, the phone's Back or the browser's: ask first (PLAN.md §10.0).
import { getCurrentInstance, onBeforeUnmount } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, type Router, type RouteLocationNormalized } from "vue-router";
import { confirm } from "./ask";
import { sheetIsOpen, backPressed } from "./sheets";

export function useLeaveGuard(dirty: () => boolean, o: { title?: string; text?: string; onDiscard?: () => void } = {}) {
  // Whether this page is still on screen: a page that registers this after an await (its data loading) may already be
  // gone, and a guard that outlives its page would ask "Discard your changes?" about a page nobody is on.
  const alive = { v: true };
  const inst = getCurrentInstance();
  // already unmounted when this runs (registered after an await): nothing to guard, and no unmount hook will fire
  if (inst?.isUnmounted) alive.v = false;
  const ask = async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    // a sheet closing takes back its own history step, which the router sees as a visit to this same page
    if (!alive.v || !dirty() || to.fullPath === from.fullPath) return true;
    // Back with a sheet open only closes the sheet (core/sheets.ts cancels the move), so there's nothing to ask
    if (backPressed() && sheetIsOpen()) return true;
    const ok = await confirm(o.title ?? "Discard your changes?", { text: o.text, ok: "Discard", danger: true, noHistory: true });
    if (ok) o.onDiscard?.();
    return ok;
  };
  // registered through the instance captured above: vue-router's hooks use getCurrentInstance, which is empty after
  // an await, so a late call would register nothing (or on the wrong page)
  if (inst && alive.v) {
    onBeforeRouteLeave(ask);
    onBeforeRouteUpdate(ask);
  }
  // closing or reloading the tab: the browser asks with its own words
  const unload = (e: BeforeUnloadEvent) => { if (alive.v && dirty()) e.preventDefault(); };
  addEventListener("beforeunload", unload);
  const stop = () => { alive.v = false; removeEventListener("beforeunload", unload); };
  if (inst && alive.v) onBeforeUnmount(stop, inst); else stop();
}

/** A page's own Back: one step back, or to `fallback` when the page was opened directly (nothing to go back to). */
export function goBack(router: Router, fallback: string) {
  if (history.state?.back) router.back(); else router.replace(fallback);
}
