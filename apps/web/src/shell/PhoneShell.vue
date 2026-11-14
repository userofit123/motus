<script setup lang="ts">
// The phone layout: the page, and six tabs with Start after Routines (PLAN.md §8.1).
import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { section } from "./nav";
import { startOpen } from "../core/ui";
import Icon from "../components/Icon.vue";
import MiniBar from "./MiniBar.vue";
import UpdateNotice from "./UpdateNotice.vue";
import SyncPill from "./SyncPill.vue";
import PullRefresh from "./PullRefresh.vue";
import { useActive, useSettings } from "../api/queries";
import { usePullRefresh, refreshAll } from "../core/pullRefresh";
import { sheetIsOpen } from "../core/sheets";
import { recording } from "../workout/recording";
import { ivRunning } from "../workout/intervals";
import { useWorkout } from "../workout/useWorkout";
import { useAutoUpdate } from "../core/updater";
// the apps check for (and, if chosen, download) updates on their own while someone is signed in
useAutoUpdate();

const route = useRoute(), router = useRouter();
const cur = computed(() => section(route.name as string));
const TABS = [
  { name: "home", label: "Home", icon: "home", to: "/" },
  { name: "history", label: "Calendar", icon: "calendar", to: "/history" },
  { name: "routines", label: "Routines", icon: "routines", to: "/routines" },
  { name: "start" },
  { name: "goals", label: "Goals", icon: "goals", to: "/goals" },
  { name: "stats", label: "Stats", icon: "stats", to: "/stats" },
  { name: "more", label: "More", icon: "moreH", to: "/more" },
];
// the pages listed on the More tab
const IN_MORE = ["more", "exercises", "body", "settings"];
const moreOn = computed(() => IN_MORE.includes(cur.value));
const hideBar = computed(() => route.name === "workout");
const active = useActive();
// the running workout, set up once at start, so its notification's buttons work on any page, also after a reload
useWorkout();
// how many running-session bars sit above the tabs (the workout, a recording, the interval timer), so the page leaves room for them
const bars = computed(() => hideBar.value ? 0 : (active.data.value ? 1 : 0) + (recording.value && route.name !== "record" ? 1 : 0) + (ivRunning.value && route.name !== "timer" ? 1 : 0));
// Each page gets its own <Suspense> (keyed by page): the page waits for its data inside it (see loaded() in api/queries)
// and comes in whole. One Suspense shared by all pages broke when a page was left before its data came: Vue then
// mounted the next page late or not at all, so a tab tap while Home was still loading made later taps do nothing.
// A Suspense of its own is thrown away with the page, half-loaded or not. (So the old page goes at once; only the
// new one animates in.)
const pageKey = (r: any) => r.path;
// once a page has moved in, anything that appears on it later rises in by itself (see app.css)
const arrived = (el: Element) => el.classList?.add("in");

// moving between tabs slides sideways, towards the tab you chose; anything else rises in
const ORDER = ["home", "history", "routines", "goals", "stats", "more"];
const tabOf = (name: unknown) => { const c = section(name as string); return ORDER.indexOf(IN_MORE.includes(c) ? "more" : c); };
const motion = ref("page");
const stop = router.beforeEach((to, from) => {
  const a = tabOf(from.name), b = tabOf(to.name);
  motion.value = a >= 0 && b >= 0 && a !== b ? (b > a ? "tnx" : "tpv") : "page";
});
onBeforeUnmount(stop);

// where a touch belongs to what's under it (typing, scrolling sideways, a chart, a map, the bottom bars), not to the
// page's tab swipe or pull to refresh
const OWN_GESTURE = ".dock, input, textarea, select, .hscroll, .chips, .seg, .tabs, .leaflet-container, .cal, .chart, [data-noswipe]";
const ownGesture = (e: TouchEvent) => !!(e.target as HTMLElement).closest(OWN_GESTURE);

// pulling down at the very top of any page but the workout reads Health Connect, syncs with the server and reloads
const settings = useSettings();
const pr = usePullRefresh(
  (e) => !hideBar.value && !sheetIsOpen() && !ownGesture(e) && !(e.target as HTMLElement).closest(".dragh, [data-nopull]")
    && document.documentElement.style.overflow !== "hidden", // something holds the page still (core/scrollLock.ts)
  () => refreshAll(!!settings.value.features.healthConnect));

// on a tab's own page, a sideways swipe anywhere (cards or empty space) goes to the next or previous tab
let x0 = 0, y0 = 0, t0 = 0, ok = false;
function ts(e: TouchEvent) {
  const t = e.touches[0]!;
  x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  ok = e.touches.length === 1 && ORDER.includes(route.name as string) && !sheetIsOpen() && !ownGesture(e)
    && x0 > 24 && x0 < innerWidth - 24; // the screen edges belong to the phone's own back gesture
  pr.start(e);
}
function te(e: TouchEvent) {
  const pulled = pr.pulling.value; // a pull is never also a tab swipe
  pr.end();
  if (!ok || pulled) return;
  const t = e.changedTouches[0]!, dx = t.clientX - x0, dy = t.clientY - y0;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.3 || Date.now() - t0 > 900) return; // a natural thumb swipe drifts a little
  const next = ORDER[ORDER.indexOf(route.name as string) + (dx < 0 ? 1 : -1)];
  const tab = TABS.find((x) => x.name === next);
  if (tab?.to) router.push(tab.to);
}
</script>

<template>
  <div class="pshell" @touchstart.passive="ts" @touchmove.passive="pr.move" @touchend.passive="te" @touchcancel.passive="pr.end(true)" :class="{ withbar: bars > 0, withbar2: bars > 1, withbar3: bars > 2, withstrip: hideBar && (!!recording || ivRunning) }" :style="hideBar ? { paddingBottom: 0 } : undefined">
    <MiniBar v-if="hideBar" strip />
    <div class="pmain"><router-view v-slot="{ Component, route: r }"><Suspense :key="pageKey(r)"><Transition :name="motion" appear @after-enter="arrived"><component :is="Component" /></Transition></Suspense></router-view></div>
    <div v-if="!hideBar" class="dock">
      <UpdateNotice />
      <MiniBar />
      <div class="tabbar">
        <template v-for="t in TABS" :key="t.name">
          <button v-if="t.name === 'start'" aria-label="Start" @click="startOpen = true"><span class="start"><Icon name="plus" /></span></button>
          <button v-else :class="{ on: t.name === 'more' ? moreOn : cur === t.name }" @click="router.push(t.to!)"><span class="ic"><Icon :name="t.icon!" :size="22" /></span>{{ t.label }}</button>
        </template>
      </div>
    </div>
    <SyncPill />
    <PullRefresh :dist="pr.dist.value" :pulling="pr.pulling.value" :busy="pr.busy.value" :done="pr.done.value" />
  </div>
</template>
