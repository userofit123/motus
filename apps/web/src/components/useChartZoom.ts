// Zooming a chart along its time axis, as a video editor's timeline: zoomed in, the chart is drawn wider than its card
// (the x axis stretches, the heights stay) and scrolls sideways under a still card, so a day's minutes or a year's days
// can be looked at closely. At 1x it fits the card exactly as before, with nothing to scroll. Zoomed, the edge with more
// chart beyond it fades out, so it reads as something that scrolls.
//  - a phone: two fingers pinch or spread it, around the point between them; one finger swipes it sideways (the
//    browser's own scrolling, so the page still scrolls up and down over it)
//  - a computer: ctrl or ⌘ with the wheel zooms around the pointer (a trackpad's pinch sends the same); the plain wheel
//    scrolls it sideways, handing the wheel back to the page at either end; the mouse drags it
// Tapping or clicking a chart never opens another page (the developer's rule: the whole column used to): it only shows
// the tip, as a mouse's hover does. A click or a tap pins the tip until a click or tap outside the chart or a scroll. A
// pinned tip over something that opens (a workout, a day) ends with the list rows' chevron and is itself tapped to open
// it; the chevron says so, so it isn't opened by accident. A tip without the chevron never takes the pointer. The tip
// sits above every item under it, inside the chart (useTip's TIP_ROOM), never over one. Tapping the same item again, or
// empty chart space, puts the tip away. While one is pinned, hovering other items shows nothing: one tip at a time, the
// one that was chosen. A click or tap on a chart stays in it, so a card or link around it doesn't take it either. No
// double tap to fit it back: two quick taps on bars are how a finger reads them.
// Charts stacked over the same hours (a night's stages over its heart rate) share one zoom and scroll (shareChartZoom),
// so they stay lined up as a video editor's tracks.
import { computed, inject, nextTick, onBeforeUnmount, provide, ref, watch, type InjectionKey, type Ref } from "vue";

/** How wide an hour can be drawn at most, on every chart over hours (a minute 3px), so stacked ones zoom alike */
export const HOUR_PX = 180;
/** A zoomed time axis's room for a label: about a character's width at the axis size, and the least gap between two */
export const TICK_CH = 6.5, TICK_GAP = 12;
export const tickRoom = (text: string) => text.length * TICK_CH + TICK_GAP;

type Group = { zoom: Ref<number>; x: Ref<number> };
const GROUP: InjectionKey<Group> = Symbol("chartZoom");
/** In a component whose charts cover the same span at the same width: they all zoom and scroll as one */
export function shareChartZoom() { provide(GROUP, { zoom: ref(1), x: ref(0) }); }
/** Whether this chart zooms along with others (its zoom is then the span's, not its own points') */
export const inChartGroup = () => inject(GROUP, null) != null;

type Opts = {
  /** The whole chart, its tip included: a click or tap outside it puts a pinned tip away */
  box: Ref<HTMLElement | null>;
  /** The plot's width at 1x, the part that stretches */
  base: Ref<number>;
  /** px drawn after the plot that don't stretch (a right margin) */
  pad?: number;
  /** The most zoom that still shows something new (a chart with little to spread out stays at 1x) */
  max: () => number;
  /** The data's span (the day, the period): when it changes the chart fits its card again; a live refresh keeps it */
  range: () => unknown;
  /** Puts the tip away */
  clear: () => void;
};

export function useChartZoom(o: Opts) {
  const g = inject(GROUP, null);
  /** The element that scrolls; the chart is drawn inside it, cw wide */
  const sc = ref<HTMLElement | null>(null);
  const zoom = g?.zoom ?? ref(1), left = ref(0);
  const most = computed(() => Math.max(1, o.max()));
  /** Whether there is anything to zoom (pinch and ctrl+wheel are left to the page otherwise) */
  const can = computed(() => most.value > 1.05);
  const on = computed(() => zoom.value > 1);
  /** The drawn width */
  const cw = computed(() => Math.round(o.base.value * zoom.value) + (o.pad ?? 0));
  // the scroller's classes: zoomable, zoomed, and which edges have more beyond them (faded)
  const cls = computed(() => {
    const end = cw.value - o.base.value - (o.pad ?? 0);
    return { zable: can.value, zon: on.value, zfl: on.value && left.value > 1, zfr: on.value && left.value < end - 1 };
  });
  const clamp = (z: number) => { const c = Math.min(most.value, Math.max(1, z)); return c < 1.02 ? 1 : c; };

  // the scroll is set once the wider chart is drawn, else the old width would cut it short
  const scrollTo = (x: number) => nextTick(() => {
    const el = sc.value; if (!el) return;
    el.scrollLeft = Math.max(0, x); left.value = el.scrollLeft;
    if (g) g.x.value = left.value;
  });
  /** Zoom to z keeping the point `at` px from the scroller's left edge where it is (its middle by default) */
  function set(z: number, at?: number) {
    const el = sc.value, nz = clamp(z);
    if (nz === zoom.value) return;
    const a = at ?? (el?.clientWidth ?? o.base.value) / 2;
    const u = ((el?.scrollLeft ?? 0) + a) / (o.base.value * zoom.value);
    zoom.value = nz;
    scrollTo(u * o.base.value * nz - a);
  }
  const by = (f: number, at?: number) => set(zoom.value * f, at);

  // a clicked or tapped tip stays until a click or tap outside the chart (the mouse can then move onto its link); a
  // hovered one goes when the mouse leaves
  const pinned = ref(false);
  let pinKey: unknown = null, drop = false;
  const unpin = () => { pinKey = null; if (!pinned.value) return; pinned.value = false; o.clear(); };
  /** In a chart's click: the item clicked (null: empty chart space). The same item again, or empty space, puts the pinned
   *  tip away instead of pinning it; nothing a chart's tap does ever opens anything */
  const pick = (key: unknown) => { if (pinned.value && (key == null || key === pinKey)) drop = true; else pinKey = key; };
  const outside = (e: PointerEvent) => { if (pinned.value && !o.box.value?.contains(e.target as Node)) unpin(); };
  // a click in the chart but not on its plot (the fixed label strip, the legend) is empty space too: it puts the tip away.
  // The plot's own clicks stop at the scroller (clickLast) and the tip's at the tip, so only these get here
  const boxClick = () => unpin();
  watch(o.box, (now, was) => { was?.removeEventListener("click", boxClick); now?.addEventListener("click", boxClick); });
  // any scroll (the page under a wheel, or a finger's drag that began on the chart) moves the tip off what it names
  const scrolledAway = () => unpin();
  const unlisten = () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", scrolledAway, true); };
  watch(pinned, (p) => {
    if (!p) return unlisten();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scrolledAway, { capture: true, passive: true });
  });

  // the mouse drags it sideways as a finger does; a drag isn't also a click on what's under it
  let drag: { x: number; left: number; moved: boolean; id: number } | null = null;
  const down = (e: PointerEvent) => {
    if (!on.value || e.pointerType !== "mouse" || e.button !== 0 || !sc.value) return;
    drag = { x: e.clientX, left: sc.value.scrollLeft, moved: false, id: e.pointerId };
  };
  const move = (e: PointerEvent) => {
    const el = sc.value; if (!drag || !el) return;
    if (!(e.buttons & 1)) { drag = null; return; }
    const dx = e.clientX - drag.x;
    // captured only once it is a drag, so a plain click still reaches what's under the pointer
    if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; o.clear(); try { el.setPointerCapture(drag.id); } catch { /* the pointer is gone */ } }
    if (drag.moved) el.scrollLeft = drag.left - dx;
  };
  const release = (e: PointerEvent) => { if (drag?.moved) { try { sc.value?.releasePointerCapture(e.pointerId); } catch { /* already released */ } } };
  const clickFirst = (e: MouseEvent) => { if (drag?.moved) { e.stopPropagation(); e.preventDefault(); } drag = null; };
  // a click or tap on the chart stays in it and pins the tip. The chart's own handlers have set the tip by now (they sit
  // on what's inside, so hear the click first)
  const clickLast = (e: MouseEvent) => {
    e.stopPropagation(); e.preventDefault();
    // a tap on empty space with nothing pinned: the tip a tap's compatibility mouse events showed goes too
    if (drop) { drop = false; unpin(); } else if (pinKey != null) pinned.value = true; else o.clear();
  };
  /** True while the mouse is dragging the chart, when hovering shows no tip */
  const dragging = () => !!drag?.moved;

  const wheel = (e: WheelEvent) => {
    const el = sc.value; if (!el) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (e.ctrlKey || e.metaKey) {
      if (!can.value) return;
      e.preventDefault();
      // a mouse's notch (100) steps about 1.6x, a trackpad's pinch (a few each) smoothly
      by(Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.01), e.clientX - el.getBoundingClientRect().left);
      return;
    }
    if (!on.value || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0 || (dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return;
    e.preventDefault(); el.scrollLeft += dy;
  };

  // two fingers: the zoom follows how far apart they are (from where they started, so it never drifts), and the point
  // that was between them stays between them; one finger is left to the browser
  let pinch: { d0: number; z0: number; u: number } | null = null;
  const two = (t: TouchList, el: HTMLElement) => {
    const a = t[0]!, b = t[1]!, r = el.getBoundingClientRect();
    return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), m: (a.clientX + b.clientX) / 2 - r.left };
  };
  const tstart = (e: TouchEvent) => {
    const el = sc.value; if (!el || e.touches.length !== 2 || !can.value) return;
    const { d, m } = two(e.touches, el);
    pinch = { d0: Math.max(1, d), z0: zoom.value, u: (el.scrollLeft + m) / (o.base.value * zoom.value) };
    unpin(); o.clear();
  };
  const tmove = (e: TouchEvent) => {
    const el = sc.value; if (!pinch || !el || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const { d, m } = two(e.touches, el);
    zoom.value = clamp(pinch.z0 * (d / pinch.d0));
    scrollTo(pinch.u * o.base.value * zoom.value - m);
  };
  const tend = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
  const scrolled = () => {
    const el = sc.value; if (!el || Math.abs(el.scrollLeft - left.value) <= 0.5) return;
    left.value = el.scrollLeft; unpin(); o.clear();
    if (g) g.x.value = left.value;
  };
  // another chart of the group scrolled: this one follows
  if (g) watch(g.x, (x) => nextTick(() => { const el = sc.value; if (el && Math.abs(el.scrollLeft - x) > 0.5) { el.scrollLeft = x; left.value = el.scrollLeft; } }));

  const listen: [string, EventListener, AddEventListenerOptions][] = [
    ["pointerdown", down as EventListener, { capture: true }], ["pointermove", move as EventListener, {}], ["pointerup", release as EventListener, {}],
    ["pointercancel", release as EventListener, {}], ["click", clickFirst as EventListener, { capture: true }], ["click", clickLast as EventListener, {}],
    ["wheel", wheel as EventListener, { passive: false }], ["touchstart", tstart as EventListener, { passive: true }],
    ["touchend", tend as EventListener, { passive: true }], ["touchcancel", tend as EventListener, { passive: true }], ["scroll", scrolled, { passive: true }],
  ];
  // the touchmove that stops the page moving during a pinch can't be passive, which makes the browser wait on it before
  // scrolling the page; so it is there only on a chart that can zoom (one that can't leaves the page's scrolling alone)
  const tmoveOpt = { passive: false };
  const hookMove = () => { const el = sc.value; if (!el) return; el.removeEventListener("touchmove", tmove as EventListener); if (can.value) el.addEventListener("touchmove", tmove as EventListener, tmoveOpt); };
  watch(can, hookMove);
  watch(sc, (now, was) => {
    for (const [n, f, opt] of listen) { was?.removeEventListener(n, f, opt); now?.addEventListener(n, f, opt); }
    was?.removeEventListener("touchmove", tmove as EventListener);
    hookMove();
    // a new scroller (the chart was empty for a while) starts where the zoom says, not where the old one was
    left.value = 0;
    if (now && on.value) scrollTo(g ? g.x.value : 0);
  });

  /** Back to fitting the card */
  const reset = () => { zoom.value = 1; left.value = 0; if (g) g.x.value = 0; if (sc.value) sc.value.scrollLeft = 0; unpin(); };
  watch(() => String(o.range()), reset);
  // less to spread out than before (fewer bars): no more zoom than there is now
  watch(most, (m) => { if (zoom.value > m) set(m); });
  // a new width (the phone turned, the window resized): the same time stays in the middle of the view
  watch(o.base, (now, was) => {
    const el = sc.value; if (!el || !on.value || !was) return;
    const view = was + (o.pad ?? 0), u = (el.scrollLeft + view / 2) / (was * zoom.value);
    scrollTo(u * now * zoom.value - (now + (o.pad ?? 0)) / 2);
  });
  onBeforeUnmount(() => {
    unlisten();
    o.box.value?.removeEventListener("click", boxClick);
    for (const [n, f, opt] of listen) sc.value?.removeEventListener(n, f, opt);
    sc.value?.removeEventListener("touchmove", tmove as EventListener);
  });

  return { sc, cls, zoom, left, on, can, cw, most, set, by, scrollTo, reset, pinned, pick, unpin, dragging };
}

const MIN = 60_000, DAY = 86_400_000;
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720].map((m) => m * MIN).concat([1, 2, 7, 14, 30, 91, 182, 365].map((d) => d * DAY));
/** A zoomed time axis's label times from x0 to x1 drawn `width` px wide: the shortest step that leaves `need` px for a
 *  label (tickRoom), on whole minutes, hours, days, weeks (from Mondays) or months of the local clock, so they land on
 *  10:00 and 1 Dec through clock changes. dates: the labels are dates, never closer than a day, as a date can't say more. */
export function timeTicks(x0: number, x1: number, width: number, need: number, dates: boolean) {
  if (!(x1 > x0) || width <= 0) return [];
  const perMs = width / (x1 - x0);
  const step = STEPS.find((s) => (!dates || s >= DAY) && s * perMs >= need) ?? STEPS.at(-1)!;
  const at = new Date(x0); at.setHours(0, 0, 0, 0);
  if (step >= 7 * DAY && step < 30 * DAY) at.setDate(at.getDate() - ((at.getDay() + 6) % 7));
  if (step >= 30 * DAY) at.setDate(1);
  const nth = (k: number) => {
    const d = new Date(at);
    if (step < DAY) d.setMinutes(k * (step / MIN));
    else if (step < 30 * DAY) d.setDate(d.getDate() + k * (step / DAY));
    else d.setMonth(d.getMonth() + k * Math.round(step / (30.4 * DAY)));
    return d.getTime();
  };
  const out: number[] = [];
  for (let k = 0; out.length < 500; k++) { const t = nth(k); if (t > x1) break; if (t >= x0) out.push(t); }
  return out;
}
