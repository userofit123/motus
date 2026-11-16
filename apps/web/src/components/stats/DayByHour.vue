<script setup lang="ts">
// The Calendar day card's "Day by hour" (M-253): its header and chart, with two ways to see the day's minutes-long
// stretches better than at the card's size. Wider draws the hours about 40px each and lets them scroll sideways under
// the names, which stay put; tapped again it fits the day back to the card. Full screen shows the chart alone across the
// whole screen, on its side: on a phone it asks for the browser's full screen and landscape, and where the phone stays
// upright (the app's window is held upright, or the browser can't turn it) it turns the chart itself; on a computer it is
// a large window. Back, Esc and the close button leave it, as a sheet's.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "../Icon.vue";
import DayTimeline from "./DayTimeline.vue";
import type { DayTimeline as Timeline } from "./dayTimeline";
import type { DaySession } from "./daySessions";
import { useFmt } from "../../core/format";
import { sheetOpened, sheetClosed } from "../../core/sheets";
import { lockScroll } from "../../core/scrollLock";

const props = defineProps<{ tl: Timeline; day: string; sessions: DaySession[] }>();
const emit = defineEmits<{ open: [tab: "sleep" | "steps" | "heart"]; pick: [id: string] }>();
const fmt = useFmt();
// ready: hidden until the screen has (or hasn't) turned, so the full screen never shows first one way, then the other
const wide = ref(false), full = ref(false), rot = ref(false), ready = ref(false);
const title = computed(() => `Day by hour · ${fmt.value.date(props.day, { weekday: "short", day: "numeric", month: "short" })}`);

const phone = () => document.documentElement.classList.contains("phone");
const upright = () => { if (ready.value) rot.value = full.value && phone() && innerHeight > innerWidth; };
type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };
async function openFull() {
  full.value = true; ready.value = false;
  // turned only once the browser has said whether it turns the screen, so a phone that can doesn't flash it turned
  if (!phone()) { ready.value = true; return; }
  try { await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); } catch { /* not offered: the chart turns itself */ }
  try { await (screen.orientation as Lockable | undefined)?.lock?.("landscape"); } catch { /* the same */ }
  ready.value = true; upright();
}
function closeFull() {
  if (!full.value) return;
  full.value = false; rot.value = false;
  try { (screen.orientation as Lockable | undefined)?.unlock?.(); } catch { /* never locked */ }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
// a lane or a session opens its page, which leaves the full screen first
const open = (tab: "sleep" | "steps" | "heart") => { closeFull(); emit("open", tab); };
const pick = (id: string) => { closeFull(); emit("pick", id); };

const key = (e: KeyboardEvent) => { if (e.key === "Escape" && full.value) { e.stopPropagation(); closeFull(); } };
let backId = 0, unlock = () => {};
watch(full, (on) => {
  if (on) { backId = sheetOpened(closeFull); unlock = lockScroll(); }
  else { sheetClosed(backId); unlock(); }
});
// Back on a phone first leaves the browser's full screen, without a step the router sees: that closes this too
const left = () => { if (!document.fullscreenElement && full.value) closeFull(); };
onMounted(() => { addEventListener("resize", upright); addEventListener("keydown", key); document.addEventListener("fullscreenchange", left); });
onBeforeUnmount(() => { removeEventListener("resize", upright); removeEventListener("keydown", key); document.removeEventListener("fullscreenchange", left); closeFull(); });
</script>

<template>
  <div class="lbl hgap"><span class="grow">Day by hour</span>
    <button type="button" class="ib sm plain dbh-b" :aria-pressed="wide" :aria-label="wide ? 'Fit to the card' : 'Make wider'" :title="wide ? 'Fit to the card' : 'Make wider'" @click="wide = !wide"><Icon :name="wide ? 'narrow' : 'widen'" /></button>
    <button type="button" class="ib sm plain dbh-b" aria-label="Full screen" title="Full screen" @click="openFull"><Icon name="expand" /></button>
  </div>
  <DayTimeline :tl="tl" :day="day" :sessions="sessions" :wide="wide" @open="open" @pick="pick" />
  <Teleport to="body">
    <div v-if="full" class="scr dbh-scr" :style="ready ? undefined : { visibility: 'hidden' }" @mousedown.self="closeFull">
      <div class="sht full dbh-full" :class="{ rot }" role="dialog" :aria-label="title">
        <div class="sh_h"><b>{{ title }}</b><button type="button" class="ib sm plain" aria-label="Close" @click="closeFull"><Icon name="close" /></button></div>
        <div class="sh_b"><DayTimeline :tl="tl" :day="day" :sessions="sessions" full :rot="rot" @open="open" @pick="pick" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* as the learn button in a header: the header keeps its height, the last icon lines up with the card's edge */
.dbh-b { flex: none; margin: -10px 0; color: var(--tx2); }
.dbh-b:hover, .dbh-b[aria-pressed="true"] { color: var(--acc); }
.dbh-b + .dbh-b { margin-inline: -8px -9px; }
</style>
