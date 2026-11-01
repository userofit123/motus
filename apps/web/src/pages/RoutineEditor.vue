<script setup lang="ts">
// Creating and editing a routine (requirements 5, 6, 11): exercises, sets with targets, rest between sets and after each
// exercise (and per set), supersets, how numbers are pre-filled, and progression rules. Drafts are kept on this device.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usesWeight, usesReps, usesDuration, usesDistance, estimate, restAfterSet, duration, muscleName, toM, fromM } from "@motus/shared";
import { useRoutine, useRoutines, useFolders, useExercises, useSettings, useTemplates } from "../api/queries";
import { api, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { readJson, writeJson } from "../core/prefs";
import { toast, toastError } from "../core/toast";
import { confirm } from "../core/ask";
import { exerciseSheet } from "../core/ui";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Sheet from "../components/Sheet.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import RestPicker from "../components/RestPicker.vue";
import BodyMap from "../components/BodyMap.vue";

const route = useRoute(), router = useRouter();
const id = computed(() => String(route.params.id));
const isNew = computed(() => id.value === "new");
const src = useRoutine(id);
const all = useExercises();
const folders = useFolders();
const routines = useRoutines();
const templates = useTemplates();
const s = useSettings();
const fmt = useFmt();
const COLORS = ["#f8b396", "#f47b99", "#9fb0ff", "#80cbc4", "#c5e1a5", "#ffcc80", "#ce93d8", "#b0bec5"];
const draftKey = computed(() => `motusDraft:${id.value}`);
const r = ref<any>(null);
const dirty = ref(false), busy = ref(false), picking = ref<null | { replace?: number }>(null), restFor = ref<null | { ex: number; set?: number; kind: "between" | "after" | "set" | "rep" }>(null);
const starter = ref(false);
const exById = computed(() => new Map((all.data.value ?? []).map((e) => [e.id, e])));

function load(data: any) {
  r.value = JSON.parse(JSON.stringify(data));
  dirty.value = false;
}
watch([src.data, isNew], () => {
  const d = readJson<any>(draftKey.value, null);
  if (d && d.__for === id.value) { r.value = d; dirty.value = true; return; }
  if (isNew.value) { load({ name: "", description: "", folderId: null, color: null, exercises: [] }); starter.value = true; }
  else if (src.data.value) load(src.data.value);
}, { immediate: true });
watch(r, (v) => { if (v && dirty.value) writeJson(draftKey.value, { ...v, __for: id.value }); }, { deep: true });
const touch = () => { dirty.value = true; };

const blankSet = (e: any) => {
  const last = e.sets.at(-1);
  return last ? { ...last, id: undefined, kind: last.kind === "warmup" ? "normal" : last.kind } : { kind: "normal", reps: 8, repsMax: null, weightKg: null, durationS: usesDuration(exById.value.get(e.exerciseId)?.tracking ?? "weight_reps") ? 30 : null, distanceM: null, rpe: null, restS: null };
};
function addExercises(ids: string[]) {
  if (picking.value?.replace != null) {
    const e = r.value.exercises[picking.value.replace];
    e.exerciseId = ids[0]; e.exercise = exById.value.get(ids[0]!);
  } else for (const eid of ids) {
    const ex = exById.value.get(eid);
    const timed = usesDuration(ex?.tracking ?? "weight_reps") && !usesReps(ex?.tracking ?? "weight_reps");
    r.value.exercises.push({ exerciseId: eid, exercise: ex, superset: null, restS: null, restAfterS: null, repRestS: null, prefill: "last", prefillScope: "any", progression: null, note: "",
      sets: [0, 1, 2].map(() => ({ kind: "normal", reps: timed ? null : 8, repsMax: null, weightKg: null, durationS: timed ? 30 : null, distanceM: null, rpe: null, restS: null })) });
  }
  picking.value = null; touch();
}
const move = (i: number, d: number) => { const a = r.value.exercises; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; touch(); };
const removeEx = (i: number) => { r.value.exercises.splice(i, 1); touch(); };
const addSet = (e: any) => { e.sets.push(blankSet(e)); touch(); };
const removeSet = (e: any, j: number) => { e.sets.splice(j, 1); touch(); };
const KINDS: [string, string][] = [["normal", "Normal"], ["warmup", "Warm-up"], ["drop", "Drop set"], ["failure", "To failure"]];
const kindShort = (k: string, n: number) => (k === "warmup" ? "W" : k === "drop" ? "D" : k === "failure" ? "F" : String(n));
const setNo = (e: any, j: number) => e.sets.slice(0, j + 1).filter((x: any) => x.kind !== "warmup").length;
let ssn = 0;
function superset(i: number) {
  const a = r.value.exercises, cur = a[i], nx = a[i + 1];
  if (!nx) return;
  const tag = cur.superset ?? nx.superset ?? String.fromCharCode(65 + (new Set(a.map((x: any) => x.superset).filter(Boolean)).size + ssn++) % 26);
  cur.superset = tag; nx.superset = tag; touch();
}
const unsuperset = (i: number) => { r.value.exercises[i].superset = null; touch(); };
const restDefaults = computed(() => ({ betweenSetsS: s.value.workout.restBetweenSetsS, afterExerciseS: s.value.workout.restAfterExerciseS }));
const est = computed(() => r.value ? estimate(r.value.exercises.map((e: any) => ({ sets: e.sets.map((x: any, j: number) => ({ ...x, restS: restAfterSet({ setRestS: x.restS, exRestS: e.restS, isLastSet: j === e.sets.length - 1, exRestAfterS: e.restAfterS }, restDefaults.value) })) }))) : null);
const muscles = computed(() => { const o: Record<string, number> = {}; for (const e of r.value?.exercises ?? []) for (const m of exById.value.get(e.exerciseId)?.primaryMuscles ?? []) o[m] = (o[m] ?? 0) + e.sets.length; return o; });
const restLabel = (v: number | null, fallback: number) => (v == null ? `${fmt.value.clock(fallback)}` : fmt.value.clock(v));
function setRest(v: number | null) {
  const t = restFor.value!; const e = r.value.exercises[t.ex];
  if (t.kind === "between") e.restS = v; else if (t.kind === "after") e.restAfterS = v; else if (t.kind === "rep") e.repRestS = v; else e.sets[t.set!].restS = v;
  restFor.value = null; touch();
}
const wIn = (kg: number | null) => (kg == null ? "" : String(Math.round(fmt.value.fromKg(kg) * 100) / 100));
const wOut = (v: string) => (v === "" ? null : fmt.value.toKg(Number(v)));
const dIn = (m: number | null) => (m == null ? "" : String(Math.round(fromM(m, fmt.value.du) * 100) / 100));
const dOut = (v: string) => (v === "" ? null : toM(Number(v), fmt.value.du));
const nOut = (v: string) => (v === "" ? null : Number(v));

async function save(thenStart = false) {
  if (!r.value.name.trim()) { toast("Give the routine a name", { kind: "err" }); return; }
  busy.value = true;
  try {
    const body = { ...r.value, exercises: r.value.exercises.map((e: any) => ({ ...e, exercise: undefined })) };
    let rid = id.value;
    if (isNew.value) rid = (await api.post("/routines", body)).id; else await api.put(`/routines/${rid}`, body);
    localStorage.removeItem(draftKey.value);
    dirty.value = false;
    invalidate(["routines", "home", "calendar"]);
    toast("Routine saved");
    router.replace(thenStart ? `/routines/${rid}/start` : `/routines/${rid}`);
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
async function cancel() {
  if (dirty.value && !(await confirm("Discard your changes?", { ok: "Discard", danger: true }))) return;
  localStorage.removeItem(draftKey.value);
  router.back();
}
async function startFrom(kind: "template" | "copy", v: string) {
  const full = kind === "copy" ? await api.get(`/routines/${v}`) : null;
  if (full) { load({ ...full, id: undefined, name: full.name + " (copy)", basedOnId: full.id, pinned: false, exercises: full.exercises.map((e: any) => ({ ...e, id: undefined })) }); dirty.value = true; }
  else { const x = await api.post("/routines", { template: v }); invalidate(["routines"]); router.replace(`/routines/${x.id}/edit`); }
  starter.value = false;
}
const exMenu = (e: any, i: number) => [
  { label: "About this exercise", icon: "info", run: () => (exerciseSheet.value = e.exerciseId) },
  { label: "Replace", icon: "swap", run: () => (picking.value = { replace: i }) },
  { label: "Move up", icon: "up", run: () => move(i, -1), hidden: i === 0 },
  { label: "Move down", icon: "down", run: () => move(i, 1), hidden: i === r.value.exercises.length - 1 },
  { label: "Superset with next", icon: "link", run: () => superset(i), hidden: !s.value.features.supersets || i === r.value.exercises.length - 1 },
  { label: "Remove from superset", icon: "link", run: () => unsuperset(i), hidden: !e.superset },
  { label: "Rest between reps", icon: "timer", run: () => (restFor.value = { ex: i, kind: "rep" }) },
  { label: e.prefill === "target" ? "Pre-fill from last time" : "Always use these targets", icon: "refresh", run: () => { e.prefill = e.prefill === "target" ? "last" : "target"; touch(); } },
  { label: "Remove", icon: "trash", danger: true, sep: true, run: () => removeEx(i) },
];
const setMenu = (e: any, j: number) => [
  ...(s.value.features.setTypes ? KINDS.map(([k, l]) => ({ label: l, icon: e.sets[j].kind === k ? "check" : undefined, run: () => { e.sets[j].kind = k; touch(); } })) : []),
  { label: "Rest after this set", icon: "timer", run: () => (restFor.value = { ex: r.value.exercises.indexOf(e), set: j, kind: "set" }), sep: s.value.features.setTypes },
  { label: "Remove set", icon: "trash", danger: true, run: () => removeSet(e, j) },
];
const tr = (e: any) => exById.value.get(e.exerciseId)?.tracking ?? e.exercise?.tracking ?? "weight_reps";
</script>

<template>
  <div v-if="r" class="page">
    <button class="back" @click="cancel"><Icon name="left" :size="16" />{{ isNew ? "Routines" : "Back" }}</button>
    <div class="ph">
      <div class="grow"><input v-model="r.name" class="in" placeholder="Routine name" style="font-size:24px;font-weight:600;padding:8px 12px;max-width:520px" @input="touch" /></div>
      <div class="acts"><button class="btn o keep" :disabled="busy" @click="save(false)">Save</button></div>
    </div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start">
      <div>
        <div v-if="starter && isNew" class="card" style="margin-bottom:var(--spg)">
          <div class="row"><b class="grow">Start from scratch, or from…</b><button class="ib sm plain" @click="starter = false"><Icon name="close" :size="16" /></button></div>
          <div class="chips" style="margin-top:10px">
            <span class="tiny" style="align-self:center">Templates:</span>
            <button v-for="t in templates.data.value ?? []" :key="t.slug" class="fchip" @click="startFrom('template', t.slug)">{{ t.name }}</button>
          </div>
          <div v-if="routines.data.value?.length" class="chips" style="margin-top:8px">
            <span class="tiny" style="align-self:center">Copy a routine:</span>
            <button v-for="x in routines.data.value" :key="x.id" class="fchip" @click="startFrom('copy', x.id)">{{ x.name }}</button>
          </div>
        </div>

        <div v-for="(e, i) in r.exercises" :key="i" class="card" style="margin-bottom:var(--spg)" :style="e.superset ? { borderInlineStart: '3px solid var(--acc)' } : undefined">
          <div class="row" style="margin-bottom:10px">
            <div class="thumb sm click" @click="exerciseSheet = e.exerciseId"><img v-if="(exById.get(e.exerciseId) ?? e.exercise)?.images?.[0]" :src="mediaUrl((exById.get(e.exerciseId) ?? e.exercise).images[0])" alt="" /><Icon v-else name="dumbbell" :size="18" /></div>
            <div class="grow"><div style="font-weight:600">{{ (exById.get(e.exerciseId) ?? e.exercise)?.name }}</div>
              <div class="tiny">{{ e.superset ? `Superset ${e.superset} · ` : "" }}{{ e.prefill === "target" ? "Uses these targets" : "Pre-filled from last time" }}{{ e.repRestS ? ` · ${e.repRestS}s between reps` : "" }}</div></div>
            <Menu :items="exMenu(e, i)" />
          </div>
          <table class="sets">
            <thead><tr><th>Set</th>
              <th v-if="usesWeight(tr(e))">{{ fmt.wu }}</th><th v-if="usesReps(tr(e))">Reps</th><th v-if="usesReps(tr(e))" class="hide-p">to</th>
              <th v-if="usesDuration(tr(e))">Sec</th><th v-if="usesDistance(tr(e))">{{ fmt.du }}</th><th v-if="s.features.rpe">RPE</th><th /></tr></thead>
            <tbody>
              <tr v-for="(x, j) in e.sets" :key="j">
                <td><button class="sk" :class="{ w: x.kind === 'warmup', d: x.kind === 'drop', f: x.kind === 'failure' }">{{ kindShort(x.kind, setNo(e, j)) }}</button></td>
                <td v-if="usesWeight(tr(e))"><input class="vin" inputmode="decimal" :value="wIn(x.weightKg)" placeholder="–" @change="x.weightKg = wOut(($event.target as HTMLInputElement).value); touch()" /></td>
                <td v-if="usesReps(tr(e))"><input class="vin" inputmode="numeric" :value="x.reps ?? ''" placeholder="–" @change="x.reps = nOut(($event.target as HTMLInputElement).value); touch()" /></td>
                <td v-if="usesReps(tr(e))" class="hide-p"><input class="vin" inputmode="numeric" :value="x.repsMax ?? ''" placeholder="–" title="Top of a rep range (optional)" @change="x.repsMax = nOut(($event.target as HTMLInputElement).value); touch()" /></td>
                <td v-if="usesDuration(tr(e))"><input class="vin" inputmode="numeric" :value="x.durationS ?? ''" placeholder="–" @change="x.durationS = nOut(($event.target as HTMLInputElement).value); touch()" /></td>
                <td v-if="usesDistance(tr(e))"><input class="vin" inputmode="decimal" :value="dIn(x.distanceM)" placeholder="–" @change="x.distanceM = dOut(($event.target as HTMLInputElement).value); touch()" /></td>
                <td v-if="s.features.rpe"><input class="vin" inputmode="decimal" :value="x.rpe ?? ''" placeholder="–" @change="x.rpe = nOut(($event.target as HTMLInputElement).value); touch()" /></td>
                <td style="width:40px"><Menu :items="setMenu(e, j)" icon="more" label="Set options" /></td>
              </tr>
            </tbody>
          </table>
          <div class="row wrap" style="margin-top:8px;gap:6px">
            <button class="qb acc" @click="addSet(e)"><Icon name="plus" :size="16" />Set</button>
            <div class="grow" />
            <button class="fchip" title="Rest between sets" @click="restFor = { ex: i, kind: 'between' }"><Icon name="timer" :size="14" />{{ restLabel(e.restS, s.workout.restBetweenSetsS) }} between sets</button>
            <button class="fchip" title="Rest after this exercise" @click="restFor = { ex: i, kind: 'after' }"><Icon name="timer" :size="14" />{{ restLabel(e.restAfterS, s.workout.restAfterExerciseS) }} after</button>
          </div>
          <div v-if="e.sets.some((x: any) => x.restS != null)" class="tiny" style="margin-top:4px">Some sets have their own rest: {{ e.sets.map((x: any, j: number) => x.restS != null ? `set ${j + 1} ${fmt.clock(x.restS)}` : "").filter(Boolean).join(", ") }}</div>
          <details v-if="s.features.progression" class="fold" style="margin-top:8px">
            <summary class="tiny" style="display:flex;gap:6px;cursor:pointer">Progression {{ e.progression ? `· ${e.progression.kind === "double" ? "double" : "linear"} +${fmt.w(e.progression.incrementKg)} ${fmt.wu}` : "· off" }}</summary>
            <div class="frow" style="margin-top:8px">
              <div class="fld"><label>Rule</label><select :value="e.progression?.kind ?? ''" @change="(ev) => { const v = (ev.target as HTMLSelectElement).value; e.progression = v ? { kind: v, incrementKg: e.progression?.incrementKg ?? 2.5, deloadAfter: 3, deloadPct: 10 } : null; touch(); }">
                <option value="">Off</option><option value="linear">Add weight when all reps are done</option><option value="double">Fill the rep range, then add weight</option></select></div>
              <div v-if="e.progression" class="fld"><label>Add ({{ fmt.wu }})</label><input class="in" type="number" step="0.5" :value="wIn(e.progression.incrementKg)" @change="e.progression.incrementKg = wOut(($event.target as HTMLInputElement).value) ?? 2.5; touch()" /></div>
              <div v-if="e.progression" class="fld"><label>Deload after misses</label><input v-model.number="e.progression.deloadAfter" class="in" type="number" min="1" max="10" @change="touch" /></div>
            </div>
          </details>
          <input v-model="e.note" class="in" placeholder="Note for this exercise in this routine (seat height, grip…)" style="margin-top:8px;font-size:13px" @input="touch" />
        </div>
        <button class="btn tonal block lg" @click="picking = {}"><Icon name="plus" />Add exercises</button>
      </div>

      <div class="col" style="gap:var(--spg);position:sticky;top:24px">
        <div class="card">
          <div class="lbl">Estimated time</div>
          <div class="val" style="font-size:28px">{{ est ? duration(est.totalS, true) : "—" }}</div>
          <div class="tiny">{{ r.exercises.length }} exercises · {{ r.exercises.reduce((a: number, e: any) => a + e.sets.length, 0) }} sets · {{ est ? `${duration(est.restS, true)} of rest` : "" }}</div>
          <BodyMap :values="muscles" :height="140" style="margin-top:12px" />
          <div class="chips" style="margin-top:6px;justify-content:center"><span v-for="m in Object.keys(muscles)" :key="m" class="mchip">{{ muscleName(m) }}</span></div>
        </div>
        <div class="card">
          <div class="fld"><label>Description</label><textarea v-model="r.description" rows="2" @input="touch" /></div>
          <div class="fld"><label>Folder</label><select v-model="r.folderId" @change="touch"><option :value="null">No folder</option><option v-for="f in folders.data.value ?? []" :key="f.id" :value="f.id">{{ f.name }}</option></select></div>
          <div class="fld" style="margin-bottom:0"><label>Colour</label><div class="row" style="gap:6px"><button v-for="c in COLORS" :key="c" class="dot click" :style="{ background: c, width: '24px', height: '24px', border: r.color === c ? '2px solid var(--tx)' : '0' }" @click="r.color = c; touch()" /><button class="qb" style="padding:2px 6px" @click="r.color = null; touch()">None</button></div></div>
        </div>
        <button class="btn block lg" :disabled="busy || !r.exercises.length" @click="save(true)"><Icon name="play" :size="18" />Save and start</button>
      </div>
    </div>
    <ExercisePicker v-if="picking" :multi="picking.replace == null" :title="picking.replace != null ? 'Replace with' : 'Add exercises'" @close="picking = null" @pick="addExercises" />
    <RestPicker v-if="restFor" :title="restFor.kind === 'between' ? 'Rest between sets' : restFor.kind === 'after' ? 'Rest after this exercise' : restFor.kind === 'rep' ? 'Rest between reps' : 'Rest after this set'"
      :value="restFor.kind === 'between' ? r.exercises[restFor.ex].restS : restFor.kind === 'after' ? r.exercises[restFor.ex].restAfterS : restFor.kind === 'rep' ? r.exercises[restFor.ex].repRestS : r.exercises[restFor.ex].sets[restFor.set!].restS"
      :default-label="restFor.kind === 'between' ? `Default (${fmt.clock(s.workout.restBetweenSetsS)})` : restFor.kind === 'after' ? `Default (${fmt.clock(s.workout.restAfterExerciseS)})` : restFor.kind === 'rep' ? 'Off' : 'Same as the exercise'"
      :presets="restFor.kind === 'rep' ? [5, 10, 15, 20, 30, 45, 60] : undefined" @close="restFor = null" @pick="setRest" />
  </div>
</template>

<style scoped>
@media (max-width: 860px) { .grid[style*="300px"] { grid-template-columns: 1fr !important; } .col[style*="sticky"] { position: static !important; } .hide-p { display: none; } }
</style>
