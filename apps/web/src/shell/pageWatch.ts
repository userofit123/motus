// Moving to another page must never leave the old one on screen. The shells swap pages in two steps: the old page
// plays its way out, then the new one comes in. Sometimes the way out never finishes (cause not found yet): the address
// and the tabs move on but the old page stays, and every later move queues behind it. So after each move, check that
// the page on screen is the one asked for, and if an old one is still there, build the view afresh (without the
// animation, in case that is what hung). The console.warn is there to help find the cause.
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from "vue-router";

// a normal swap is done in well under a second (way out 0.12 s; a page waits at most 1.5 s for its data, but by then
// the old page is already gone), so a page left over after this long is stuck
const GRACE = 2500;

export function usePageWatch(keyOf: (r: RouteLocationNormalizedLoaded) => string) {
  const route = useRoute(), router = useRouter();
  /** bumped to rebuild the page view from scratch */
  const view = ref(0);
  /** true while a rebuilt page comes in without its animation */
  const still = ref(false);
  let t: ReturnType<typeof setTimeout> | undefined, calm: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    const want = keyOf(route);
    const left = [...document.querySelectorAll<HTMLElement>("[data-page]")].filter((el) => el.dataset.page !== want);
    if (!left.length) return;
    console.warn(`The page for ${route.fullPath} did not replace ${left.map((el) => el.dataset.page).join(", ")}; rebuilding the view`);
    // pages on screen now are all stale; whatever of them survives the rebuild is stuck and is taken out by hand
    const stale = [...document.querySelectorAll<HTMLElement>("[data-page]")];
    // switch the animation off first and rebuild on the next tick, so the old view leaves without a transition
    still.value = true;
    void nextTick(() => {
      view.value++;
      void nextTick(() => stale.forEach((el) => el.isConnected && el.remove()));
    });
    clearTimeout(calm); calm = setTimeout(() => (still.value = false), GRACE);
  };
  const stop = router.afterEach((_to, _from, failure) => {
    if (failure) return;
    clearTimeout(t); t = setTimeout(check, GRACE);
  });
  onBeforeUnmount(() => { stop(); clearTimeout(t); clearTimeout(calm); });
  return { view, still };
}
