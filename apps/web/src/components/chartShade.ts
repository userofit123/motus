// A session's span on a time chart (LineChart, BarChart and the Calendar day's timeline share it): at least SHADE_MIN px
// wide so a 5-minute walk can still be tapped, tinted in its colour at SHADE_TINT with a strip along the top
// (ChartShade.vue draws it). One place, so a workout looks the same on every chart.
export const SHADE_MIN = 8;
/** How much of its colour a span is tinted with */
export const SHADE_TINT = 16;
/** A span's left edge and width from where its (already clamped) start and end fall on the chart */
export const shadeSpan = (x0: number, x1: number) => ({ x: x0, w: Math.max(SHADE_MIN, x1 - x0) });
export const shadeFill = (color: string) => `color-mix(in srgb, ${color} ${SHADE_TINT}%, transparent)`;
