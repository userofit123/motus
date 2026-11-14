// A chart's hover tip (.ctip) over a point, kept inside the chart: centred over its point, and slid sideways just as far
// as it takes so it never runs past either edge (a long tip, "7h 15m · Sat 14 Nov · 23:05-6:40", near the edge of a
// phone-wide chart). Its width is measured, since what it says changes from point to point.
import { onBeforeUnmount, ref, watch, type Ref } from "vue";

export function useTip(W: Ref<number>) {
  const el = ref<HTMLElement | null>(null);
  const tw = ref(0);
  const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { tw.value = el.value?.offsetWidth ?? 0; });
  watch(el, (now, was) => { if (was) ro?.unobserve(was); if (now) { tw.value = now.offsetWidth; ro?.observe(now); } });
  onBeforeUnmount(() => ro?.disconnect());
  /** The tip's place: x across the chart in px, top as a CSS length (its point's height); the tip sits above it */
  const style = (x: number, top: string) => {
    if (!tw.value) return { left: x + "px", top, transform: "translate(-50%, calc(-100% - 10px))" };
    const left = Math.max(0, Math.min(W.value - tw.value, x - tw.value / 2));
    return { left: left + "px", top, transform: "translateY(calc(-100% - 10px))" };
  };
  return { el, style };
}
