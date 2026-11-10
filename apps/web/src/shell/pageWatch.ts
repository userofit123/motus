// Moving to another page must never leave the old one on screen. The shells swap pages in two steps: the old page
// plays its way out, then the new one comes in. That way-out waits on the browser's animation frames, which a phone
// can hold back (the app was in the background, the screen went off), and an error part-way through a swap can leave
// the view half-built; either way the address and the tabs move on but the old page stays, and every later move
// queues behind it. So after each move, check that the page on screen is the one asked for, and if an old one is
// still there, build the view afresh (without the animation, in case that is what hung).
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
    still.value = true; view.value++;
    // a page caught half-way out is no longer part of the view, so rebuilding it doesn't take that page away
    void nextTick(() => document.querySelectorAll<HTMLElement>("[data-page]").forEach((el) => el.dataset.page !== want && el.remove()));
    clearTimeout(calm); calm = setTimeout(() => (still.value = false), GRACE);
  };
  const stop = router.afterEach((_to, _from, failure) => {
    if (failure) return;
    clearTimeout(t); t = setTimeout(check, GRACE);
  });
  onBeforeUnmount(() => { stop(); clearTimeout(t); clearTimeout(calm); });
  return { view, still };
}
