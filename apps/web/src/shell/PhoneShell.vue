<script setup lang="ts">
// The phone layout: the page, and five tabs with Start in the middle (PLAN.md §8.1).
import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { section } from "./nav";
import { startOpen } from "../core/ui";
import Icon from "../components/Icon.vue";
import MiniBar from "./MiniBar.vue";
import { useActive } from "../api/queries";
import { sheetIsOpen } from "../core/sheets";

const route = useRoute(), router = useRouter();
const cur = computed(() => section(route.name as string));
const TABS = [
  { name: "home", label: "Home", icon: "home", to: "/" },
  { name: "history", label: "Calendar", icon: "calendar", to: "/history" },
  { name: "start" },
  { name: "routines", label: "Routines", icon: "routines", to: "/routines" },
  { name: "more", label: "More", icon: "moreH", to: "/more" },
];
const moreOn = computed(() => ["more", "exercises", "goals", "stats", "settings"].includes(cur.value));
const hideBar = computed(() => route.name === "workout");
const active = useActive();
// one key per page, so moving between pages animates
const pageKey = (r: any) => r.path;

// moving between tabs slides sideways, towards the tab you chose; anything else rises in
const ORDER = ["home", "history", "routines", "more"];
const tabOf = (name: unknown) => { const c = section(name as string); return ORDER.indexOf(["exercises", "goals", "stats", "settings"].includes(c) ? "more" : c); };
const motion = ref("page");
const stop = router.beforeEach((to, from) => {
  const a = tabOf(from.name), b = tabOf(to.name);
  motion.value = a >= 0 && b >= 0 && a !== b ? (b > a ? "tnx" : "tpv") : "page";
});
onBeforeUnmount(stop);

// on a tab's own page, a sideways swipe goes to the next or previous tab
let x0 = 0, y0 = 0, t0 = 0, ok = false;
function ts(e: TouchEvent) {
  const t = e.touches[0]!;
  x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  ok = e.touches.length === 1 && ORDER.includes(route.name as string) && !sheetIsOpen()
    && !(e.target as HTMLElement).closest("input, textarea, select, .hscroll, .chips, .seg, .tabs, .leaflet-container, .cal, .chart, [data-noswipe]")
    && x0 > 24 && x0 < innerWidth - 24; // the screen edges belong to the phone's own back gesture
}
function te(e: TouchEvent) {
  if (!ok) return;
  const t = e.changedTouches[0]!, dx = t.clientX - x0, dy = t.clientY - y0;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - t0 > 600) return;
  const next = ORDER[ORDER.indexOf(route.name as string) + (dx < 0 ? 1 : -1)];
  const tab = TABS.find((x) => x.name === next);
  if (tab?.to) router.push(tab.to);
}
</script>

<template>
  <div class="pshell" :class="{ withbar: !!active.data.value && !hideBar }" :style="hideBar ? { paddingBottom: 0 } : undefined">
    <div class="pmain" @touchstart.passive="ts" @touchend.passive="te"><router-view v-slot="{ Component, route: r }"><Transition :name="motion" mode="out-in"><component :is="Component" :key="pageKey(r)" /></Transition></router-view></div>
    <div v-if="!hideBar" class="dock">
      <MiniBar />
      <div class="tabbar">
        <template v-for="t in TABS" :key="t.name">
          <button v-if="t.name === 'start'" aria-label="Start" @click="startOpen = true"><span class="start"><Icon name="plus" /></span></button>
          <button v-else :class="{ on: t.name === 'more' ? moreOn : cur === t.name }" @click="router.push(t.to!)"><span class="ic"><Icon :name="t.icon!" :size="22" /></span>{{ t.label }}</button>
        </template>
      </div>
    </div>
  </div>
</template>
