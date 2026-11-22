<script setup lang="ts">
// One line-icon set for the whole app (24-unit grid, 1.8 stroke), drawn in the current text colour.
defineProps<{ name: string; size?: number }>();
</script>

<script lang="ts">
const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  history: "M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2",
  calendar: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4",
  // a calendar with one day crossed out: a day off between workouts (not "bed", which is sleep)
  dayOff: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 2v4M16 2v4M8 14h.01M8 17.5h.01M12 14h.01M12 17.5h.01M14.75 13.75l2.5 2.5M17.25 13.75l-2.5 2.5",
  routines: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  dumbbell: "M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12",
  goals: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  stats: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  play: "M7 4.5v15l12-7.5z",
  pause: "M8 5v14M16 5v14",
  more: "M12 6h.01M12 12h.01M12 18h.01",
  moreH: "M6 12h.01M12 12h.01M18 12h.01",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5 10 17 19 7",
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  split: "M15 3 9 21M3 3v7h4.5M16.5 21v-7h2.25a2 2 0 0 1 0 4h-2.25M18.75 18 21 21",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  shrink: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
  // the search glass with a plus or a minus in it: zoom a chart in (it spreads out and scrolls sideways) or out
  zoomIn: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6M11 8v6",
  zoomOut: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3M8 11h6",
  down: "M6 9l6 6 6-6",
  up: "M18 15l-6-6-6 6",
  timer: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M9 2h6",
  note: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  skip: "M5 4l10 8-10 8zM19 5v14",
  skipBack: "M19 4 9 12l10 8zM5 5v14",
  forward: "M4 6l7 6-7 6zM13 6l7 6-7 6z",
  swap: "M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  copy: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  pin: "M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  walk: "M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 22l2-7 3 3v6M7 12l2-5 4 1 2 4 3 1M11 15l-1-4",
  run: "M14 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM5 22l4-6 3 2 1 5M7 11l3-4 4 1 2 4h4M12 18l1-6",
  cycle: "M5.5 20a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18.5 20a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 17.5V14l-3-3 4-3 2 3h3",
  hike: "M4 20l5-9 4 5 3-3 4 7zM12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  swim: "M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 14l4-6 4 3 3-1M15 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  yoga: "M12 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 20h16M7 13l5-3 5 3M12 10v5l-4 5M12 15l4 5",
  stretch: "M12 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 8h16M12 8v6l-4 7M12 14l4 7",
  sport: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  row: "M3 17h18M6 17l3-7h6l3 7M12 10V5M9 5h6",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  scale: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 10a4 4 0 0 1 8 0M12 10l1.5-2",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3",
  flame: "M12 22c4 0 7-3 7-7 0-5-4-7-5-12-2 2-3 4-3 6-1-1-2-2-2-4-2 2-4 5-4 10 0 4 3 7 7 7z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  download: "M12 4v12M7 11l5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  users: "M17 21a6 6 0 0 0-12 0M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21a5 5 0 0 0-4-4.9M16 3.1a4 4 0 0 1 0 7.8",
  palette: "M12 21a9 9 0 1 1 9-9c0 2.5-2 3-3.5 3H15a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 21zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
  drag: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  folder: "M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  archive: "M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  refresh: "M21 12a9 9 0 0 1-15.3 6.4L3 16M3 12a9 9 0 0 1 15.3-6.4L21 8M21 3v5h-5M3 21v-5h5",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  // the link icon's two halves pulled apart, with the break marked at both ends
  unlink: "M18.5 12.5l1.5-1.5a5 5 0 0 0-7-7l-1.5 1.5M5.5 11.5 4 13a5 5 0 0 0 7 7l1.5-1.5M8 2v3M2 8h3M16 19v3M19 16h3",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
  steps: "M8 15c-1.5 0-3-1-3-4s1-6 3-6 2.5 3 2.5 5-1 5-2.5 5zM8 15v3a2 2 0 0 0 4 0v-1M16 11c1.5 0 3-1 3-4s-1-5-3-5-2.5 3-2.5 4 1 5 2.5 5zM16 11v3a2 2 0 0 1-4 0",
  moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z",
  bed: "M2 5v14M2 15h20M22 19v-7a3 3 0 0 0-3-3h-8v6M5 12h3",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z",
  // a plain heart: heart rate (a day's range or average, the curves, a workout's); with a beat through it: resting heart
  // rate; a wave: heart rate variability (HRV), the beat-to-beat swing; apart from "activity" (an imported workout of an
  // unknown type)
  heartPulse: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8zM3.2 12h6.3l.5-1 2 4.5 2-7 1.5 3.5h5.3",
  wave: "M2 12c1.5-4.5 3.5-4.5 5 0s3.5 4.5 5 0 3.5-4.5 5 0 3.5 4.5 5 0",
  // a training weight with a rising arrow on it: Training load, how much training the last days held (M-245); not bars,
  // which are Stats'
  load: "M9 8V6a3 3 0 0 1 6 0v2M6 8h12l2 12H4zM9.5 16.5l2.5-2.5 2.5 2.5",
  // a ring not yet closed with a pulse in it: the Activity score, a week's moving against the guidelines (apart from
  // "steps", a day's count, "bolt", active minutes, and "activity", an imported workout)
  moveRing: "M21 12a9 9 0 1 1-2.6-6.4M7 12h2.5l1.5-3 2 6 1.5-3H17",
  // a dial: Readiness, how ready you are to train
  gauge: "M3.3 18a10 10 0 1 1 17.4 0M12 14l4-5",
  water: "M12 2.7S6 9.5 6 14a6 6 0 0 0 12 0c0-4.5-6-11.3-6-11.3z",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01",
  camera: "M4 8a2 2 0 0 1 2-2h2l2-2h4l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  share: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13",
  sound: "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  layers: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  device: "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  key: "M15.5 7.5 19 4M21 2l-2 2 3 3-3 3-3-3M10.6 13.4a5 5 0 1 1-7.1 7.1 5 5 0 0 1 7.1-7.1z",
  learn: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6",
  // a heart with an arrow down: heart rate recovery, how far it falls in a minute of rest
  heartDown: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8zM12 8.5v6M9.5 12l2.5 2.5 2.5-2.5",
  // motion lines behind an arrow: speed
  speed: "M3 8h6M2 12h9M3 16h6M14 6l6 6-6 6",
  // a metronome: cadence, steps or pedal turns a minute
  cadence: "M10 3h4l5 18H5zM7.2 14h9.6M12 14l2-7",
  // a leg, side view, hip to foot: the thigh (quads in front, hamstrings behind)
  thigh: "M7.5 2.5h6.5l.8 8.5c.2 2.2-.6 4.4-.9 6.6l-.1 1.4 4.2 1.6c.8.3.6 1.4-.3 1.4H9.8l-.2-3.2c-.2-2.3-1.4-4.4-1.5-6.8L7.5 2.5z",
  // Routine check rows (M-298): Progression as steps going up; a muscle fixed at one end and pulled long at the other;
  // a deload week as three week blocks with the middle one pushed down, lighter than its neighbours
  climb: "M3 20h5v-5h5v-5h5V4M15 7l3-3 3 3",
  lengthen: "M3 5v14M3 12h1.5M4.5 12c2.6-4 7.4-4 10 0-2.6 4-7.4 4-10 0zM14.5 12h7M19 9.5l2.5 2.5-2.5 2.5",
  deload: "M2 10.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 8 10.5v8A1.5 1.5 0 0 1 6.5 20h-3A1.5 1.5 0 0 1 2 18.5zM9 17a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 17v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 18.5zM16 10.5a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5zM12 3v8.5M9.5 9 12 11.5 14.5 9",
};
</script>

<template>
  <svg class="ico" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="ICONS[name] ?? ICONS.activity" />
  </svg>
</template>
