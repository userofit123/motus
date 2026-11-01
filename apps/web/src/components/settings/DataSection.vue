<script setup lang="ts">
// Export & import (requirement 19): everything as JSON, workouts as CSV (Strong's layout), activities, body;
// import a Motus export, Strong / Hevy / FitNotes CSV (with exercise matching), and GPX/TCX activities.
import { ref } from "vue";
import { useFmt } from "../../core/format";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { download } from "../../core/backup";
import { toast, toastError } from "../../core/toast";
import { choose } from "../../core/ask";
import Sheet from "../Sheet.vue";
import ExercisePicker from "../ExercisePicker.vue";

async function exportJson() { const d = await api.get("/export"); download(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }), `motus-export-${new Date().toISOString().slice(0, 10)}.json`); }
async function exportCsv(what: string) { const r = await api.get("/export/csv", { what }); download(new Blob([r.text], { type: "text/csv" }), r.filename); }
async function importJson(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = ""; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.motusRoutine) { await importRoutine(data); return; }
    const mode = await choose("Import this export?", [{ label: "Merge: add what's missing", value: "merge" }, { label: "Replace everything", value: "replace" }]);
    if (!mode) return;
    await api.post("/import", { data, mode }); invalidate(["*"]); toast("Imported");
  } catch (e) { toastError(e); }
}
// a routine shared from another account: its folder isn't here, and exercises are matched by id, then by name
async function importRoutine(data: any) {
  const lib = await api.get<any[]>("/exercises");
  const ids = new Set(lib.map((e) => e.id));
  const byName = new Map(lib.map((e) => [e.name.toLowerCase(), e.id]));
  const exercises = data.exercises.map((e: any) => ({ ...e, id: undefined, exerciseId: ids.has(e.exerciseId) ? e.exerciseId : byName.get(String(e.exercise?.name ?? e.name ?? "").toLowerCase()) })).filter((e: any) => e.exerciseId);
  await api.post("/routines", { ...data, folderId: null, basedOnId: null, exercises });
  invalidate(["routines"]);
  const missing = data.exercises.length - exercises.length;
  toast(missing ? `Routine imported without ${missing} exercise${missing === 1 ? "" : "s"} not in your library` : "Routine imported");
}
// CSV from other apps
const csv = ref<null | { text: string; preview: any; mapping: Record<string, string> }>(null);
const mapFor = ref<string | null>(null);
async function pickCsv(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = ""; if (!f) return;
  try {
    const text = await f.text();
    const preview = await api.post("/import/csv/preview", { text });
    csv.value = { text, preview, mapping: Object.fromEntries(preview.exercises.map((e: any) => [e.name, e.match?.id ?? "new"])) };
  } catch (e) { toastError(e); }
}
async function runCsv() {
  try { const r = await api.post("/import/csv", { text: csv.value!.text, mapping: csv.value!.mapping }); invalidate(["*"]); toast(`Imported ${r.workouts} workouts from ${r.format}`); csv.value = null; } catch (e) { toastError(e); }
}
const nameOf = (name: string) => { const id = csv.value!.mapping[name]; if (id === "new") return "New exercise"; const m = csv.value!.preview.exercises.find((e: any) => e.name === name)?.match; return m?.id === id ? m.name : mapped.value[id!] ?? "Chosen exercise"; };
const mapped = ref<Record<string, string>>({});
async function gpx(ev: Event) {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []); (ev.target as HTMLInputElement).value = "";
  try { const r = await api.post("/activities/import", { files: await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))) }); invalidate(["*"]); toast(`Imported ${r.count} activities`); } catch (e) { toastError(e); }
}
const fmt = useFmt();
</script>

<template>
  <div class="col" style="gap:var(--spg)">
    <div class="sh first"><h2>Export</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Everything (JSON)</div><div class="s">Routines, workouts, notes, reminders, goals, activities, body, settings</div></div><button class="btn o s" @click="exportJson">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Workouts (CSV)</div><div class="s">In Strong's layout, which most fitness apps can import</div></div><button class="btn o s" @click="exportCsv('workouts')">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Activities (CSV)</div></div><button class="btn o s" @click="exportCsv('activities')">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Body (CSV)</div></div><button class="btn o s" @click="exportCsv('body')">Download</button></div>
    </div>
    <div class="sh"><h2>Import</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Motus export or routine file</div><div class="s">.json or .motusroutine</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".json,.motusroutine" hidden @change="importJson" /></label></div>
      <div class="li"><div class="grow"><div class="t">From Strong, Hevy or FitNotes</div><div class="s">Their CSV export; you check how exercise names are matched</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".csv,.tsv,text/csv" hidden @change="pickCsv" /></label></div>
      <div class="li"><div class="grow"><div class="t">Activities (GPX, TCX)</div><div class="s">From a watch, Strava, OpenTracks…</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".gpx,.tcx" multiple hidden @change="gpx" /></label></div>
    </div>
    <Sheet v-if="csv" :title="`Import from ${csv.preview.format}`" size="wide" @close="csv = null">
      <p class="muted" style="margin-bottom:10px">{{ csv.preview.workouts }} workouts, {{ csv.preview.sets }} sets, {{ fmt.date(csv.preview.from) }} – {{ fmt.date(csv.preview.to) }}. Workouts imported before are skipped.</p>
      <div class="list"><div v-for="e in csv.preview.exercises" :key="e.name" class="li"><div class="grow"><div class="t">{{ e.name }}</div><div class="s">→ {{ nameOf(e.name) }}</div></div>
        <button class="qb acc" @click="mapFor = e.name">Change</button><button v-if="csv.mapping[e.name] !== 'new'" class="qb" @click="csv.mapping[e.name] = 'new'">Make new</button></div></div>
      <template #foot><button class="btn o" @click="csv = null">Cancel</button><button class="btn" @click="runCsv">Import</button></template>
    </Sheet>
    <ExercisePicker v-if="mapFor" :title="`Match “${mapFor}” to`" @close="mapFor = null" @pick="(ids) => { csv!.mapping[mapFor!] = ids[0]!; mapped[ids[0]!] = 'Chosen exercise'; mapFor = null; }" />
  </div>
</template>
