<script setup lang="ts">
// Export & import (requirement 19): a Motus file (JSON) with everything or only some parts (routines with their folders,
// programs, workouts) that any Motus account can import, workouts as CSV (Strong's layout), activities, body;
// import a Motus file, Strong / Hevy / FitNotes CSV (with exercise matching), and GPX/TCX activities.
import { ref } from "vue";
import { useFmt } from "../../core/format";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { saveFile } from "../../core/saveFile";
import { toast, toastError } from "../../core/toast";
import { choose, confirm } from "../../core/ask";
import { useSettings } from "../../api/queries";
import Sheet from "../Sheet.vue";
import ExercisePicker from "../ExercisePicker.vue";

const s = useSettings();
// what goes into the Motus file; all of them is the same as a backup
const parts = ref<null | Record<string, boolean>>(null);
const PART_LABELS = [
  { id: "routines", t: "Routines and folders", s: "With any custom exercises they use" },
  { id: "programs", t: "Programs", s: "Their routines come along" },
  { id: "workouts", t: "Workouts", s: "Finished workouts with their sets and notes" },
  { id: "other", t: "Everything else", s: "Notes on exercises and activities, reminders, goals, body, settings" },
];
// with Programs switched off its choice is hidden, and any programs simply go along with the routines
const partList = () => PART_LABELS.filter((p) => parts.value![p.id === "programs" && !s.value.features.programs ? "routines" : p.id]).map((p) => p.id);
async function exportJson() {
  try {
    const list = partList();
    const d = await api.get("/export", { parts: list.join(",") });
    const what = list.length === PART_LABELS.length ? "export" : list.join("-");
    // the choice stays open when the desktop app's save dialog is cancelled
    if (await saveFile(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }), `motus-${what}-${new Date().toISOString().slice(0, 10)}.json`)) parts.value = null;
  } catch (e) { toastError(e); }
}
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
// what a Motus file holds (or what an import added), from its row counts per table
const COUNTED: [string, string, string?][] = [
  ["routines", "routine"], ["programs", "program"], ["exercises", "custom exercise"], ["workouts", "workout"], ["notes", "note"], ["reminders", "reminder"], ["goals", "goal"],
  ["activities", "activity", "activities"], ["body_metrics", "body measurement"], ["daily_logs", "daily log entry", "daily log entries"],
];
const summary = (c: Record<string, number>) => COUNTED.filter(([k]) => c[k]).map(([k, one, many]) => plural(c[k]!, one, many)).join(", ");
// a file with only settings or exercise preferences in it still has something to add
const anyRows = (c: Record<string, number>) => Object.values(c).some((n) => n > 0);
async function exportCsv(what: string) {
  try { const r = await api.get("/export/csv", { what }); await saveFile(new Blob([r.text], { type: "text/csv" }), r.filename); } catch (e) { toastError(e); }
}
async function importJson(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = ""; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.motusRoutine) { await importRoutine(data); return; }
    const pv = await api.post("/import/preview", { data });
    const c = pv.counts;
    const what = summary(c) || (anyRows(c) || pv.settings ? "Settings and other details" : "Nothing to add");
    // a file with only some parts can only be added; replacing would empty everything it doesn't hold
    const mode = pv.whole
      ? await choose("Import this Motus file?", [{ label: "Merge: add what's missing", value: "merge" }, { label: "Replace everything", value: "replace" }], `${what}.`)
      : (await confirm("Import this Motus file?", { text: `${what}. Added to what you have; things already here aren't added twice.`, ok: "Import" })) && "merge";
    if (!mode) return;
    const r = await api.post("/import", { data, mode }); invalidate(["*"]);
    const added = summary(r);
    toast(added ? `Imported ${added}` : "Imported");
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
  <div class="stack">
    <div class="sh first"><h2>Export</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Motus file</div><div class="s">Routines and folders, programs, workouts or everything. Import it into any Motus account.</div></div><button class="btn o s" @click="parts = { routines: true, programs: true, workouts: true, other: true }">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Workouts (CSV)</div><div class="s">In Strong's layout, which most fitness apps can import</div></div><button class="btn o s" @click="exportCsv('workouts')">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Activities (CSV)</div></div><button class="btn o s" @click="exportCsv('activities')">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Body (CSV)</div></div><button class="btn o s" @click="exportCsv('body')">Download</button></div>
    </div>
    <div class="sh"><h2>Import</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Motus file or routine</div><div class="s">From this or another account (.json or .motusroutine)</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".json,.motusroutine" hidden @change="importJson" /></label></div>
      <div class="li"><div class="grow"><div class="t">From Strong, Hevy or FitNotes</div><div class="s">Their CSV export; you check how exercise names are matched</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".csv,.tsv,text/csv" hidden @change="pickCsv" /></label></div>
      <div class="li"><div class="grow"><div class="t">Activities (GPX, TCX)</div><div class="s">From a watch, Strava, OpenTracks…</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".gpx,.tcx" multiple hidden @change="gpx" /></label></div>
    </div>
    <Sheet v-if="parts" title="Motus file" @close="parts = null">
      <div class="list">
        <template v-for="p in PART_LABELS" :key="p.id">
          <label v-if="p.id !== 'programs' || s.features.programs" class="tgl"><div class="grow"><div class="t">{{ p.t }}</div><div class="s">{{ p.s }}</div></div><span class="tg"><input v-model="parts[p.id]" type="checkbox" /></span></label>
        </template>
      </div>
      <template #foot><button class="btn o" @click="parts = null">Cancel</button><button class="btn" :disabled="!partList().length" @click="exportJson">Download</button></template>
    </Sheet>
    <Sheet v-if="csv" :title="`Import from ${csv.preview.format}`" size="wide" @close="csv = null">
      <p class="muted hgap">{{ csv.preview.workouts }} workouts, {{ csv.preview.sets }} sets, {{ fmt.date(csv.preview.from) }} - {{ fmt.date(csv.preview.to) }}. Workouts imported before are skipped.</p>
      <div class="list"><div v-for="e in csv.preview.exercises" :key="e.name" class="li"><div class="grow"><div class="t">{{ e.name }}</div><div class="s">→ {{ nameOf(e.name) }}</div></div>
        <button class="qb acc" @click="mapFor = e.name">Change</button><button v-if="csv.mapping[e.name] !== 'new'" class="qb" @click="csv.mapping[e.name] = 'new'">Make new</button></div></div>
      <template #foot><button class="btn o" @click="csv = null">Cancel</button><button class="btn" @click="runCsv">Import</button></template>
    </Sheet>
    <ExercisePicker v-if="mapFor" :title="`Match “${mapFor}” to`" @close="mapFor = null" @pick="(ids) => { csv!.mapping[mapFor!] = ids[0]!; mapped[ids[0]!] = 'Chosen exercise'; mapFor = null; }" />
  </div>
</template>
