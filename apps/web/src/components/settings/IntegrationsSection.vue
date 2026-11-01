<script setup lang="ts">
// Integrations: personal API tokens (scripts, dashboards, Home Assistant), the address for automatic GPX uploads
// (FitoTrack, OpenTracks), and copying workouts for an AI assistant.
import { useFmt } from "../../core/format";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../api/client";
import { prompt, confirm } from "../../core/ask";
import { toast } from "../../core/toast";
import { useSettings } from "../../api/queries";

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
</script>

<template>
  <div class="col" style="gap:var(--spg)">
    <template v-if="s.features.apiTokens">
      <div class="sh first"><h2>API tokens</h2><button class="lnk" @click="create">New token</button></div>
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
    <p v-if="!s.features.apiTokens && !s.features.mcp" class="muted">Switch on Personal API or Ask Claude in Settings → Features.</p>
  </div>
</template>
