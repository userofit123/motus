<script lang="ts">
// The notice that a newer version of the app exists (PLAN.md §12.3.2 "Update available: 1.4.0"), from the app's own
// checks (when the app opens, when it comes back to the front and every few hours, as App & Versions sets them).
// Download update starts the download here, View opens App & Versions, the × hides it. With "Download updates
// automatically" on, the download has already started when the notice shows, so it shows the progress instead of a
// button. Only in the apps: a browser has nothing to download (the rail's Update button says what to do there).
// Never during a workout (§12.3.6): it waits until the workout ends (a background download may go on meanwhile).
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { updater, updateAvailable } from "../core/updater";
import { detectPlatform } from "../core/releases";
import { useActive } from "../api/queries";
import Icon from "../components/Icon.vue";

// dismissed for this version until the app is opened again (kept outside the component, so signing out and in again
// doesn't bring it back); a newer version shows again
const dismissed = ref("");
</script>

<script setup lang="ts">
const route = useRoute(), router = useRouter();
const app = detectPlatform().app;
const active = useActive();
// a ready download of this version installs; any other ready file is an older one and gives way to this one
const readyHere = computed(() => updater.ready && updater.stagedVersion === updateAvailable.value);
// App & Versions says all this itself, so the notice keeps out of its way there. The workout check waits for the answer:
// before it, "no workout" only means "not known yet", and the notice would flash when the app opens during a workout.
const shown = computed(() => app && !!updateAvailable.value && dismissed.value !== updateAvailable.value
  && active.isFetched.value && !active.data.value && route.path !== "/settings/versions");
// screen readers announce a status line whose text changes, not one that arrives already filled, so the line is always
// there and gets its text a moment after the notice shows (also when it shows as the app opens, once the line exists)
const announce = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
watch(shown, (on) => {
  clearTimeout(timer);
  announce.value = "";
  if (on) timer = setTimeout(() => { announce.value = `Update available: ${updateAvailable.value}`; }, 150);
}, { immediate: true });
const sub = computed(() => (updater.downloading ? updater.status || "Downloading"
  : readyHere.value ? "Downloaded, ready to install"
  : !updater.ready && updater.status ? updater.status // a failed download says why
  : `Installed version ${updater.appVersion}`));
function primary() {
  if (readyHere.value) return void updater.install();
  if (updater.ready) updater.forget();
  void updater.install();
}
const view = () => router.push("/settings/versions");
const dismiss = () => { dismissed.value = updateAvailable.value; };

// on the desktop the notice floats at the bottom: the short messages and the page's end make room for its height
const el = ref<HTMLElement | null>(null);
const root = document.documentElement;
const ro = typeof ResizeObserver === "undefined" ? null
  : new ResizeObserver(([e]) => { if (e) root.style.setProperty("--upnh", `${Math.ceil(e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height)}px`); });
watch(el, (n, o) => {
  if (o) ro?.unobserve(o);
  if (n) ro?.observe(n); else root.style.removeProperty("--upnh");
});
onBeforeUnmount(() => { clearTimeout(timer); ro?.disconnect(); root.style.removeProperty("--upnh"); });
</script>

<template>
  <span class="upn-live" role="status">{{ announce }}</span>
  <div v-if="shown" ref="el" class="upn">
    <span class="upn-ic"><Icon name="download" :size="15" /></span>
    <div class="upn-txt">
      <b>Update available: {{ updateAvailable }}</b>
      <div class="s">{{ sub }}</div>
      <div v-if="updater.downloading && updater.progress !== null" class="pbar"><i :style="{ width: Math.round(updater.progress * 100) + '%' }"></i></div>
    </div>
    <div class="upn-acts">
      <button type="button" class="btn tonal s" @click="view">View</button>
      <button v-if="!updater.downloading" type="button" class="btn s" @click="primary">{{ readyHere ? `Install ${updateAvailable}` : "Download update" }}</button>
    </div>
    <button type="button" class="ib sm plain" aria-label="Close" title="Close" @click="dismiss"><Icon name="close" :size="16" /></button>
  </div>
</template>
