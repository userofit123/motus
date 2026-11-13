<script lang="ts">
// The notice that a newer version of the app exists (PLAN.md §12.3 "Notify"), from the app's own checks (when the app
// opens, when it comes back to the front and every few hours, as App & Versions sets them). Download starts the download
// here, View opens App & Versions, Dismiss hides it. With "Download updates automatically" on, the download has already
// started when the notice shows, so it shows the progress instead of a Download button. Only in the apps: a browser has
// nothing to download (the rail's Update button says what to do there).
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { updater, updateAvailable } from "../core/updater";
import { detectPlatform } from "../core/releases";
import Icon from "../components/Icon.vue";

// dismissed for this version until the app is opened again (kept outside the component, so signing out and in again
// doesn't bring it back); a newer version shows again
const dismissed = ref("");
</script>

<script setup lang="ts">
const route = useRoute(), router = useRouter();
const app = detectPlatform().app;
// a ready download of this version installs; any other ready file is an older one and gives way to this one
const readyHere = computed(() => updater.ready && updater.stagedVersion === updateAvailable.value);
// App & Versions says all this itself, so the notice keeps out of its way there
const shown = computed(() => app && !!updateAvailable.value && dismissed.value !== updateAvailable.value && route.path !== "/settings/versions");
const sub = computed(() => (updater.downloading ? updater.status || "Downloading"
  : readyHere.value ? "Downloaded, ready to install"
  : !updater.ready && updater.status ? updater.status // a failed download says why
  : `Installed version ${updater.appVersion}`));
function download() {
  if (updater.ready && !readyHere.value) updater.forget();
  void updater.install();
}
const view = () => router.push("/settings/versions");
const dismiss = () => { dismissed.value = updateAvailable.value; };
</script>

<template>
  <div v-if="shown" id="toasts">
    <div class="toast info" role="status">
      <span class="ti"><Icon name="download" :size="16" /></span>
      <div class="tm">
        <b>Version {{ updateAvailable }} is available</b>
        <div>{{ sub }}</div>
        <div v-if="updater.downloading && updater.progress !== null" class="pbar"><i :style="{ width: Math.round((updater.progress ?? 0) * 100) + '%' }"></i></div>
        <div class="tacts">
          <button v-if="!updater.downloading" type="button" class="tu" @click="readyHere ? updater.install() : download()">{{ readyHere ? "Install" : "Download" }}</button>
          <button type="button" class="tu" @click="view">View</button>
          <button type="button" class="tu" @click="dismiss">Dismiss</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the bar sits between the text and the buttons, spaced like the App & Versions bar */
.pbar { margin-top: var(--lpy); }
</style>
