<script setup lang="ts">
// Updates: the version running, whether a newer one exists, and (in the apps) downloading and installing it.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useSettings, saveSettings } from "../../api/queries";
import { api } from "../../api/client";
import { session } from "../../core/session";
import { native } from "../../core/device";
import { updater } from "../../core/updater";

const s = useSettings();
const upd = useQuery({ queryKey: ["static", "update"], queryFn: () => api.get("/update-check"), staleTime: 3600_000 });
const set = (patch: Record<string, unknown>) => saveSettings({ updates: patch });
const notes = computed(() => String(upd.data.value?.notes ?? "").split("\n").filter((l) => l.trim()).slice(0, 30));
</script>

<template>
  <div class="col" style="gap:var(--spg)">
    <div class="card">
      <div class="li"><div class="grow"><div class="t">This version</div><div class="s">{{ updater.appVersion || session.version }}{{ native.android ? " (Android app)" : native.desktop ? " (desktop app)" : "" }} · server {{ session.version }}</div></div><button class="btn o s" @click="upd.refetch()">Check now</button></div>
      <div class="li"><div class="grow"><div class="t">{{ upd.data.value?.newer ? `Version ${upd.data.value.latest} is available` : upd.data.value?.latest ? "You're up to date" : upd.data.value?.error ?? "Checking…" }}</div>
        <div v-if="updater.status" class="s">{{ updater.status }}</div></div>
        <button v-if="upd.data.value?.newer && (native.android || native.desktop)" class="btn s" @click="updater.install()">{{ updater.ready ? "Install" : "Download" }}</button>
        <a v-else-if="upd.data.value?.newer" class="btn o s" :href="upd.data.value.url" target="_blank" rel="noopener">Release notes</a></div>
    </div>
    <div class="card">
      <label class="tgl"><div class="grow"><div class="t">Check for updates automatically</div></div><span class="tg"><input type="checkbox" :checked="s.updates.autoCheck" @change="set({ autoCheck: ($event.target as HTMLInputElement).checked })" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Download updates automatically</div><div class="s">Then install with one tap (Android asks you to confirm every install)</div></div><span class="tg"><input type="checkbox" :checked="s.updates.autoDownload" @change="set({ autoDownload: ($event.target as HTMLInputElement).checked })" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Only on Wi-Fi</div></div><span class="tg"><input type="checkbox" :checked="s.updates.wifiOnly" @change="set({ wifiOnly: ($event.target as HTMLInputElement).checked })" /></span></label>
      <div class="li"><div class="grow"><div class="t">Channel</div></div><select :value="s.updates.channel" style="width:auto" @change="set({ channel: ($event.target as HTMLSelectElement).value })"><option value="stable">Stable</option><option value="beta">Beta</option></select></div>
    </div>
    <div v-if="notes.length" class="card"><div class="lbl" style="margin-bottom:6px">What's new in {{ upd.data.value.latest }}</div><div v-for="(l, i) in notes" :key="i" class="tiny" style="color:var(--tx);line-height:1.6">{{ l.replace(/^[-*#]+\s*/, "") }}</div></div>
    <p class="tiny">Updates are published on GitHub. Self-hosted servers update with Docker (see the docs).</p>
  </div>
</template>
