<script setup lang="ts">
// The computer layout: Money Manager's rail with its gliding highlight, the page, the + button, and the running workout's bar.
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NAV, section } from "./nav";
import { appearanceOpen, startOpen } from "../core/ui";
import { session, signOut } from "../core/session";
import { useMe } from "../api/queries";
import Icon from "../components/Icon.vue";
import Logo from "./Logo.vue";
import MiniBar from "./MiniBar.vue";
import SyncPill from "./SyncPill.vue";
import { useActive } from "../api/queries";
import UpdateButton from "./UpdateButton.vue";
import Menu from "../components/Menu.vue";
import { recording } from "../workout/recording";
import { ivRunning } from "../workout/intervals";
import { useWorkout } from "../workout/useWorkout";
import { useAutoUpdate } from "../core/updater";
// the apps check for (and, if chosen, download) updates on their own while someone is signed in
useAutoUpdate();

const route = useRoute(), router = useRouter();
const cur = computed(() => section(route.name as string));
const me = useMe();
const initial = computed(() => (me.data.value?.user.displayName || session.user?.username || "?").slice(0, 1).toUpperCase());
const nav = ref<HTMLElement | null>(null), pill = ref<HTMLElement | null>(null);

// the highlight glides from the previous page to the open one, stretching on the way (Money Manager's AppNav)
let at: { x: number; y: number; w: number; h: number } | null = null, anim: Animation | null = null;
function place(animate: boolean) {
  const nv = nav.value, p = pill.value; if (!nv || !p) return;
  const b = nv.querySelector<HTMLElement>(".nb.on"), ic = b?.querySelector<HTMLElement>(".ic");
  if (!b || !ic) { p.style.display = "none"; nv.classList.remove("pl"); at = null; return; }
  const to = { x: b.offsetLeft + ic.offsetLeft, y: b.offsetTop + ic.offsetTop, w: ic.offsetWidth, h: ic.offsetHeight };
  p.style.display = ""; p.style.width = to.w + "px"; p.style.height = to.h + "px"; p.style.borderRadius = getComputedStyle(ic).borderTopLeftRadius; nv.classList.add("pl");
  const set = (r: typeof to) => `translate(${r.x}px,${r.y}px) scale(${r.w / to.w},${r.h / to.h})`;
  const from = at; at = to; anim?.cancel();
  p.style.transform = set(to);
  if (!animate || !from || from.y === to.y || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const fwd = to.y > from.y, top = Math.min(from.y, to.y), bot = Math.max(from.y + from.h, to.y + to.h);
  const mid = { x: to.x + to.w * 0.2, y: top, w: to.w * 0.6, h: bot - top };
  anim = p.animate([{ transform: set(from) }, { transform: set(mid), offset: 0.5 }, { transform: set(to) }], { duration: 320, easing: fwd ? "cubic-bezier(.4,0,.2,1)" : "cubic-bezier(.4,0,.2,1)" });
}
watch(cur, () => nextTick(() => place(true)));
const onResize = () => place(false);
let mo: MutationObserver | null = null;
onMounted(() => {
  nextTick(() => place(false)); setTimeout(onResize, 80); addEventListener("resize", onResize);
  mo = new MutationObserver(onResize); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-rad", "data-nav", "data-nsp", "data-fnt"] });
  document.fonts?.ready.then(onResize);
});
onBeforeUnmount(() => { removeEventListener("resize", onResize); mo?.disconnect(); });
const acctMenu = computed(() => [
  { label: me.data.value?.user.displayName || session.user?.username || "Account", icon: "user", run: () => router.push("/settings/account") },
  // Body has no place in the rail's main pages, so it is reached from here (on the phone, from More)
  { label: "Body", icon: "scale", run: () => router.push("/body") },
  { label: "About you", icon: "user", run: () => router.push("/body?tab=details") },
  { label: "Sign out", icon: "logout", run: async () => { await signOut(); } },
]);
const active = useActive();
// the running workout, set up once at start, so its notification's buttons work on any page, also after a reload
useWorkout();
// how many running-session bars float at the bottom (the workout, a recording, the interval timer), so the page leaves room for them
const bars = computed(() => route.name === "workout" ? 0 : (active.data.value ? 1 : 0) + (recording.value && route.name !== "record" ? 1 : 0) + (ivRunning.value && route.name !== "timer" ? 1 : 0));
// one key per page, so moving between pages animates; settings sections animate inside the page instead
const pageKey = (r: any) => (r.name === "settings" ? "settings" : r.path);
// once a page has moved in, anything that appears on it later rises in by itself (see app.css)
const arrived = (el: Element) => el.classList?.add("in");
</script>

<template>
  <div class="shell">
    <nav ref="nav" aria-label="Menu">
      <i ref="pill" class="nbi" style="transform-origin:0 0" />
      <Logo shuffle />
      <button v-for="p in NAV" :key="p.name" type="button" class="nb" :class="{ on: cur === p.name }" :aria-current="cur === p.name ? 'page' : undefined" @click="router.push(p.to)">
        <span class="ic"><Icon :name="p.icon" :size="22" /></span>{{ p.label }}
      </button>
      <div class="navb">
        <UpdateButton />
        <Menu :items="acctMenu" icon="user" label="Account" />
        <button id="themeBtn" type="button" class="nb" @click.stop="appearanceOpen = !appearanceOpen"><span class="ic"><Icon name="palette" :size="22" /></span>Appearance</button>
      </div>
    </nav>
    <main :class="{ withbar: bars > 0, withbar2: bars > 1, withbar3: bars > 2 }"><MiniBar v-if="route.name === 'workout'" strip /><router-view v-slot="{ Component, route: r }"><Suspense><Transition name="page" mode="out-in" appear @after-enter="arrived"><component :is="Component" :key="pageKey(r)" /></Transition></Suspense></router-view></main>
    <button v-if="route.name !== 'workout'" class="fab" aria-label="Start" title="Start a workout or activity (N)" @click="startOpen = true"><Icon name="plus" /></button>
    <MiniBar v-if="route.name !== 'workout'" />
    <SyncPill />
  </div>
</template>
