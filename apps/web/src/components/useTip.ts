// A chart's hover tip (.ctip) over a point, kept inside the chart: centred over its point, and slid sideways just as far
// as it takes so it never runs past either edge (a long tip, "7h 15m · Sat 14 Nov · 23:05-6:40", near the edge of a
// phone-wide chart). Its width is measured, since what it says changes from point to point. span: where across the chart
// the tip will lie, so a pinned tip can be raised above everything under it (it is clicked, so it mustn't cover a bar).
// A pinned tip never rises above the chart's own top: charts whose tips open something keep TIP_ROOM free at their top
// for it, so it covers neither their items nor the headers and controls above the chart. A tip is never wider than its
// chart: one line, its bold head kept and the rest cut short with an ellipsis (.ctip-r).
import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/** The tip's gap above its point */
const GAP = 10;
/** The room every chart with tips keeps at its top for a pinned tip: the tip (about 27px: 12px text, 6px padding above and below), its
 *  gap, and a little to spare */
export const TIP_ROOM = 40;
/** The chevron at the end of a tip that opens: its 13px icon, plus the tip's .28em gap, less its -2px/-3px margins */
export const CHEVRON_W = 11;

export function useTip(W: Ref<number>) {
  const el = ref<HTMLElement | null>(null);
  // its measured width and height, and whether the chevron was in it when measured
  const tw = ref(0), th = ref(0), hadGo = ref(false);
  const measure = () => { const e = el.value; tw.value = e?.offsetWidth ?? 0; th.value = e?.offsetHeight ?? 0; hadGo.value = !!e?.querySelector(".ctip-go"); };
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
  watch(el, (now, was) => { if (was) ro?.unobserve(was); if (now) { measure(); ro?.observe(now); } });
  onBeforeUnmount(() => ro?.disconnect());
  // the width it will have: a chevron just shown or just gone is counted before the next measure, so the tip doesn't jump
  const width = (go: boolean) => Math.min(W.value, tw.value + (go === hadGo.value ? 0 : go ? CHEVRON_W : -CHEVRON_W));
  const leftOf = (x: number, go: boolean) => Math.max(0, Math.min(W.value - width(go), x - width(go) / 2));
  /** The tip's place: x across the chart in px, top its point's height (px, or a CSS length); the tip sits above it.
   *  go: it ends with the chevron; pinned: it stays below the chart's top */
  const style = (x: number, top: number | string, go = false, pinned = false) => {
    const t = typeof top === "number" ? (pinned ? Math.max(top, th.value + GAP) : top) + "px" : top;
    const maxWidth = W.value + "px";
    if (!tw.value) return { left: x + "px", top: t, maxWidth, transform: `translate(-50%, calc(-100% - ${GAP}px))` };
    return { left: leftOf(x, go) + "px", top: t, maxWidth, transform: `translateY(calc(-100% - ${GAP}px))` };
  };
  /** Where the tip centred on x will lie across the chart, from its left to its right edge in px */
  const span = (x: number, go = false) => {
    if (!tw.value) return { lo: x, hi: x };
    const lo = leftOf(x, go);
    return { lo, hi: lo + width(go) };
  };
  return { el, style, span };
}
