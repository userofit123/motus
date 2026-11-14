<script setup lang="ts">
// Integrations: Health Connect on the Android app (a band through Gadgetbridge, a scale, a watch), personal API tokens
// (scripts, dashboards, Home Assistant), the address for automatic GPX uploads (FitoTrack, OpenTracks), and copying
// workouts for an AI assistant.
import { useFmt } from "../../core/format";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../api/client";
import { prompt, confirm, choose } from "../../core/ask";
import { useRouter } from "vue-router";
import Icon from "../Icon.vue";
import { toast } from "../../core/toast";
import { useSettings } from "../../api/queries";
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { healthSupported, healthStatus, connectHealth, openHealthSettings, syncHealth, lastSync, syncing, type HealthStatus, type HealthResult } from "../../native/health";

const s = useSettings();
const router = useRouter();
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
const KIND_NAMES: Record<string, string> = { steps: "steps", sleep: "sleep", weight: "weight", sessions: "workouts", heartRate: "heart rate", restingHr: "resting heart rate", spo2: "blood oxygen", hrv: "HRV" };
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
// what a read added, as a toast: "3 days of steps, 2 nights of sleep, steps from your band for 2 activities, heart rate for 3 sessions added"
const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
function report(r: HealthResult | null) {
  if (!r) return;
  const parts = [r.steps && `${many(r.steps, "day", "days")} of steps`, r.sleep && `${many(r.sleep, "night", "nights")} of sleep`,
    r.weight && `${r.weight} weight ${r.weight === 1 ? "entry" : "entries"}`, r.activities && many(r.activities, "activity", "activities"),
    r.restingHr && `${many(r.restingHr, "day", "days")} of resting heart rate`, r.spo2 && `${many(r.spo2, "day", "days")} of blood oxygen`,
    r.hrv && `${many(r.hrv, "day", "days")} of HRV`,
    r.ranges?.steps && `steps from your band for ${many(r.ranges.steps, "activity", "activities")}`,
    r.ranges?.hr && `heart rate for ${many(r.ranges.hr, "session", "sessions")}`].filter(Boolean);
  toast(parts.length ? `${parts.join(", ")} added` : "Up to date");
}
async function sync() {
  try { report(await syncHealth()); } catch (e) { toast((e as Error).message || "Health Connect could not be read"); }
}
// Import past data: Health Connect lets a new app see 30 days; further back needs its "past data" access, which some
// phones don't offer at all
const pastText = computed(() => hc.value?.history ? "Steps, sleep, weight, heart data and workouts from before"
  : hc.value?.historyAvailable ? "The last 30 days; further back asks Health Connect first" : "The last 30 days, as far as Health Connect goes on this phone");
const PAST = [{ value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }, { value: "365", label: "Last year" }, { value: "all", label: "Everything" }];
async function importPast() {
  const more = hc.value?.history || hc.value?.historyAvailable;
  const pick = more ? await choose("Import from how far back?", PAST, hc.value?.history ? undefined : "Going back further than 30 days asks Health Connect to allow past data.") : "30";
  if (!pick) return;
  try {
    if (pick !== "30" && !hc.value?.history) {
      hc.value = await connectHealth();
      if (!hc.value.history) return toast("Past data wasn't allowed, so Motus can read the last 30 days only");
    }
    const from = pick === "all" ? new Date("2000-01-01T00:00:00") : new Date(Date.now() - Number(pick) * 86_400_000);
    report(await syncHealth({ from }));
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
        <div v-if="connected" class="li"><div class="grow"><div class="t">Import past data</div><div class="s">{{ pastText }}</div></div>
          <button class="btn o s" :disabled="syncing" @click="importPast">Import</button></div>
        <div class="li click" role="button" tabindex="0" @click="router.push('/settings/health')" @keydown.enter="router.push('/settings/health')"><div class="grow"><div class="t">Imported data</div><div class="s">Everything that came in, to correct or delete</div></div><Icon name="right" :size="16" class="muted" /></div>
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
