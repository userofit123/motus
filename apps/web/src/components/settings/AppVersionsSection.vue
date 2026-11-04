<script setup lang="ts">
// App & Versions: the version installed here, whether a newer one exists, the download that fits this device
// (in the apps, the in-app updater instead), the other downloads, and the GitHub repository.
import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useSettings, saveSettings } from "../../api/queries";
import { session, isLocalAccount } from "../../core/session";
import { updater } from "../../core/updater";
import { latestRelease, detectPlatform, downloads, newer, REPO, REPO_URL } from "../../core/releases";
import AppSelect from "../AppSelect.vue";

const s = useSettings();
const qc = useQueryClient();
const rel = useQuery({ queryKey: ["static", "release"], queryFn: latestRelease, staleTime: 3600_000, refetchOnWindowFocus: false, retry: false });
const checkNow = () => { rel.refetch(); qc.invalidateQueries({ queryKey: ["static", "update"] }); };
const set = (patch: Record<string, unknown>) => saveSettings({ updates: patch });

const platform = detectPlatform();
const localAccount = ref(true);
isLocalAccount().then((v) => { localAccount.value = v; });
const webVersion = import.meta.env.VITE_VERSION || session.version;
const installed = computed(() => (platform.app && updater.appVersion) || webVersion || "-");
// a server account also runs the server's version; a local account has no server
const serverVersion = computed(() => (!localAccount.value && session.version && session.version !== installed.value ? session.version : ""));
const latest = computed(() => rel.data.value?.latest ?? null);
const isNewer = computed(() => !!latest.value && installed.value !== "-" && newer(latest.value, installed.value));
const status = computed(() => (rel.isFetching.value && !rel.data.value ? "Checking…" : !latest.value ? rel.data.value?.error ?? "No releases found" : isNewer.value ? `Version ${latest.value} available` : "Up to date"));

const all = computed(() => downloads(rel.data.value?.assets ?? []));
// the first matching download for this system (Linux: the AppImage, which runs on any distribution)
const mine = computed(() => all.value.find((d) => d.key === platform.key));
const others = computed(() => all.value.filter((d) => d !== mine.value));
const DOWNLOAD_LABEL: Record<string, string> = { android: "Download the Android app", windows: "Download for Windows", linux: "Download for Linux", mac: "Download for macOS" };
const showServer = computed(() => session.user?.role === "admin" && !localAccount.value && !!latest.value);
const mb = (n?: number) => (n ? ` · ${Math.max(1, Math.round(n / 1e6))} MB` : "");
const notes = computed(() => String(rel.data.value?.notes ?? "").split("\n").filter((l) => l.trim()).slice(0, 30));
</script>

<template>
  <div class="stack">
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Installed version</div><div class="s">{{ installed }} · {{ platform.name }}<template v-if="serverVersion"> · server {{ serverVersion }}</template></div></div><button class="btn o s" @click="checkNow">Check now</button></div>
      <div class="li"><div class="grow"><div class="t">{{ status }}</div>
        <div v-if="platform.app && updater.status" class="s">{{ updater.status }}</div>
        <div v-else-if="platform.key === 'ios'" class="s">There is no iPhone or iPad app yet. Motus works in Safari: tap Share, then Add to Home Screen.</div></div>
        <button v-if="platform.app && isNewer" class="btn s" @click="updater.install()">{{ updater.ready ? "Install" : "Download update" }}</button>
        <a v-else-if="!platform.app && mine" class="btn s" :href="mine.url" target="_blank" rel="noopener">{{ DOWNLOAD_LABEL[mine.key] }}</a></div>
    </div>
    <div v-if="others.length || showServer" class="card">
      <div class="lbl hgap">Other devices</div>
      <div v-for="d in others" :key="d.name" class="li"><div class="grow"><div class="t">{{ d.label }}</div><div class="s">{{ d.name }}{{ mb(d.size) }}</div></div><a class="btn o s" :href="d.url" target="_blank" rel="noopener">Download</a></div>
      <div v-if="showServer" class="li"><div class="grow"><div class="t">Self-hosted server</div><div class="s">Docker image ghcr.io/{{ REPO }}:{{ latest }}</div></div><a class="btn o s" :href="`${REPO_URL}/pkgs/container/motus`" target="_blank" rel="noopener">View</a></div>
    </div>
    <div v-if="platform.app" class="card">
      <label class="tgl"><div class="grow"><div class="t">Check for updates automatically</div></div><span class="tg"><input type="checkbox" :checked="s.updates.autoCheck" @change="set({ autoCheck: ($event.target as HTMLInputElement).checked })" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Download updates automatically</div><div class="s">Then install with one tap (Android asks you to confirm every install)</div></div><span class="tg"><input type="checkbox" :checked="s.updates.autoDownload" @change="set({ autoDownload: ($event.target as HTMLInputElement).checked })" /></span></label>
      <label class="tgl"><div class="grow"><div class="t">Only on Wi-Fi</div></div><span class="tg"><input type="checkbox" :checked="s.updates.wifiOnly" @change="set({ wifiOnly: ($event.target as HTMLInputElement).checked })" /></span></label>
      <div class="li"><div class="grow"><div class="t">Channel</div></div><AppSelect :model-value="s.updates.channel" :options="[{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Beta' }]" title="Channel" style="width:auto" @update:model-value="(v) => set({ channel: v })" /></div>
    </div>
    <div v-if="notes.length" class="card"><div class="lbl hgap">What's new in {{ latest }}</div><div v-for="(l, i) in notes" :key="i" class="tiny" style="color:var(--tx);line-height:1.6">{{ l.replace(/^[-*#]+\s*/, "") }}</div></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Motus on GitHub</div><div class="s">Source code, all releases and installation help</div></div><a class="btn o s" :href="REPO_URL" target="_blank" rel="noopener">Open</a></div>
    </div>
  </div>
</template>
