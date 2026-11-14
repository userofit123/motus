<script setup lang="ts">
// Integrations: Health Connect on the Android app (a band through Gadgetbridge, a scale, a watch), personal API tokens
// (scripts, dashboards, Home Assistant), the address for automatic GPX uploads (FitoTrack, OpenTracks), and copying
// workouts for an AI assistant.
import { useFmt } from "../../core/format";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../api/client";
import { prompt, confirm } from "../../core/ask";
import { toast } from "../../core/toast";
import { useSettings } from "../../api/queries";
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { healthSupported, healthStatus, connectHealth, openHealthSettings, syncHealth, lastSync, syncing, type HealthStatus } from "../../native/health";

const s = useSettings();
const sessions = useQuery({ queryKey: ["settings", "sessions"], queryFn: () => api.get("/auth/sessions") });
async function create() {
  const name = await prompt("Name the token", { placeholder: "e.g. Home Assistant" }); if (!name) return;
  const r = await api.post("/auth/tokens", { name });
  await navigator.clipboard?.writeText(r.token).catch(() => {});
  await confirm("Your new token", { text: `${r.token}\n\nIt was copied. It won't be shown again. Send it as "Authorization: Bearer <token>".`, ok: "Done" });
  sessions.refetch();
}
async function revoke(id: string) { await api.del(`/auth/sessions/${id}`); sessions.refetch(); toast("Token removed"); }
const origin = location.origin;
const fmt = useFmt();

// Health Connect: whether this phone has it, what Motus may read, and when it last read
const hc = ref<HealthStatus | null>(null);
const readHc = async () => { if (healthSupported() && s.value.features.healthConnect) hc.value = await healthStatus().catch(() => null); };
onMounted(() => { void readHc(); document.addEventListener("visibilitychange", readHc); });
onBeforeUnmount(() => document.removeEventListener("visibilitychange", readHc));
const KIND_NAMES: Record<string, string> = { steps: "steps", sleep: "sleep", weight: "weight", sessions: "workouts", heartRate: "heart rate" };
const allowed = computed(() => {
  const names = (hc.value?.granted ?? []).map((k) => KIND_NAMES[k]).filter(Boolean) as string[];
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
});
const hcText = computed(() => {
  if (!healthSupported()) return "Only in the Motus app for Android";
  if (!hc.value) return "-";
  if (hc.value.available === "update") return "Install or update Health Connect from the Play Store first";
  if (hc.value.available === "no") return "Not available on this phone (needs Android 9 or newer)";
  return hc.value.granted.length ? `Allowed: ${allowed.value}` : "Not allowed yet";
});
const connected = computed(() => !!hc.value?.granted.length);
async function connect() {
  try { hc.value = await connectHealth(); if (hc.value.granted.length) await sync(); } catch (e) { toast((e as Error).message); }
}
async function sync() {
  try {
    const r = await syncHealth();
    if (!r) return;
    const n = r.steps + r.sleep + r.weight + r.activities;
    toast(n ? [r.steps && `${r.steps} ${r.steps === 1 ? "day" : "days"} of steps`, r.sleep && `${r.sleep} ${r.sleep === 1 ? "night" : "nights"} of sleep`,
      r.weight && `${r.weight} weight ${r.weight === 1 ? "entry" : "entries"}`, r.activities && `${r.activities} ${r.activities === 1 ? "activity" : "activities"}`].filter(Boolean).join(", ") + " added" : "Up to date");
  } catch (e) { toast((e as Error).message || "Health Connect could not be read"); }
}
const lastText = computed(() => lastSync.value ? `${fmt.value.date(lastSync.value)} ${fmt.value.time(lastSync.value)}` : "Not yet");
</script>

<template>
  <div class="stack">
    <template v-if="s.features.healthConnect">
      <div class="sh first"><h2>Health Connect</h2><button v-if="connected" class="lnk" :disabled="syncing" @click="sync">Sync now</button></div>
      <div class="card">
        <div class="li"><div class="grow"><div class="t">Health Connect on this device</div><div class="s">{{ hcText }}</div></div>
          <button v-if="hc?.available === 'yes' && !connected" class="btn s" @click="connect">Allow</button>
          <button v-else-if="connected" class="btn o s" @click="openHealthSettings">Change</button></div>
        <div v-if="connected" class="li"><div class="grow"><div class="t">Last sync</div><div class="s">{{ lastText }}</div></div></div>
      </div>
      <p class="tiny">Motus reads what other apps wrote to Health Connect, such as a band connected through Gadgetbridge (its Settings → External integrations → Health Connect). It reads when you open the app; steps and sleep you type in yourself stay as they are.</p>
    </template>
    <template v-if="s.features.apiTokens">
      <div class="sh" :class="{ first: !s.features.healthConnect }"><h2>API tokens</h2><button class="lnk" @click="create">New token</button></div>
      <div class="card">
        <div v-for="t in (sessions.data.value ?? []).filter((x: any) => x.platform === 'api')" :key="t.id" class="li"><div class="grow"><div class="t">{{ t.deviceName }}</div><div class="s">Created {{ fmt.date(t.createdAt) }}</div></div><button class="qb danger" @click="revoke(t.id)">Remove</button></div>
        <div v-if="!(sessions.data.value ?? []).some((x: any) => x.platform === 'api')" class="tiny">No tokens yet. Every page of Motus is backed by the same API under {{ origin }}/api.</div>
      </div>
      <div class="card"><div class="t" style="font-weight:600">Automatic GPX uploads</div>
        <p class="tiny" style="margin-top:4px">Point FitoTrack, OpenTracks or any app that posts GPX/TCX files at:</p>
        <code style="display:block;margin-top:8px;font-size:12.5px;word-break:break-all">POST {{ origin }}/api/upload/track?type=walk</code>
        <p class="tiny" style="margin-top:6px">with the header <code>Authorization: Bearer &lt;token&gt;</code> and the file as the body.</p></div>
    </template>
    <div v-if="s.features.mcp" class="card"><div class="t" style="font-weight:600">Ask Claude</div><p class="tiny" style="margin-top:4px">A finished workout's ⋮ menu has "Copy for an AI assistant": paste it into Claude or any assistant to talk it through. With an API token, an MCP server or script can read your history from the API.</p></div>
    <p v-if="!s.features.apiTokens && !s.features.mcp && !s.features.healthConnect" class="muted">Switch on Health Connect, Personal API or Ask Claude in Settings → Features.</p>
  </div>
</template>
