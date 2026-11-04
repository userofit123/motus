<script setup lang="ts">
// Creating and editing a routine (requirements 5, 6, 11): exercises, sets with targets, rest between sets (per kind of
// set, and per set), after each exercise, supersets, how numbers are pre-filled, and progression rules. Two tabs: the
// exercises (folding cards, dragged to reorder) and an overview. Drafts are kept on this device.
// At /workout/plan the same editor plans a one-off workout ("Empty workout" in the + sheet): its one button starts it,
// and it is saved as a routine too only when asked.
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usesWeight, usesReps, usesDuration, usesDistance, musclesWorked, estimate, restAfterSet, dropWeightKg, restDefaultsOf, duration, muscleName, toM, fromM, muscleSets } from "@motus/shared";
import { useRoutine, useRoutines, useFolders, useExercises, useSettings, useTemplates, loaded } from "../api/queries";
import { api, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt, SET_KINDS } from "../core/format";
import { readJson, writeJson } from "../core/prefs";
import { toast, toastError } from "../core/toast";
import { prompt } from "../core/ask";
import { useLeaveGuard, goBack } from "../core/leave";
import { startWorkout } from "../workout/start";
import { exerciseSheet } from "../core/ui";
import { isPhone } from "../core/device";
import { startDrag } from "../core/drag";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Collapse from "../components/Collapse.vue";
import ExercisePicker from "../components/ExercisePicker.vue";
import RestPicker from "../components/RestPicker.vue";
import NumStep from "../components/NumStep.vue";
import AppSelect from "../components/AppSelect.vue";
import BodyMap from "../components/BodyMap.vue";
import MuscleFig from "../components/MuscleFig.vue";
import TemplateList from "../components/TemplateList.vue";
import RadioList from "../components/RadioList.vue";

const route = useRoute(), router = useRouter();
const planMode = computed(() => route.name === "workout-plan");
const id = computed(() => (planMode.value ? "new" : String(route.params.id)));
const isNew = computed(() => id.value === "new");
const src = useRoutine(id);
const all = useExercises();
const folders = useFolders();
const routines = useRoutines();
const templates = useTemplates();
const s = useSettings();
const fmt = useFmt();
const COLORS = ["#f8b396", "#f47b99", "#9fb0ff", "#80cbc4", "#c5e1a5", "#ffcc80", "#ce93d8", "#b0bec5"];
type RestTarget = { ex: number; set?: number; kind: "between" | "after" | "set" | "rep" | "warmup" | "drop" | "failure" };
// a planned workout keeps its own draft, apart from a new routine's
const draftKey = computed(() => `motusDraft:${planMode.value ? "plan" : id.value}`);
const r = ref<any>(null);
const dirty = ref(false), busy = ref(false), picking = ref<null | { replace?: number }>(null), restFor = ref<null | RestTarget>(null);
const starter = ref(false), starterView = ref<"" | "templates" | "copy">("");
const tab = ref<"exercises" | "overview">("exercises");
// planning a workout: keep it as a routine as well (named like the workout), off unless asked
const asRoutine = ref(false);
const exById = computed(() => new Map((all.data.value ?? []).map((e) => [e.id, e])));

// every exercise and set gets a key of its own on this screen (_k), so open cards and dragging follow the right one
const nk = () => Math.random().toString(36).slice(2, 10);
const keyed = (e: any) => { e._k ??= nk(); e.sets.forEach((x: any) => (x._k ??= nk())); return e; };
const open = ref(new Set<string>());
// fold: every exercise folded (an existing routine opens as an overview); keep: as they were (a draft reloaded after a live update)
function load(data: any, folds: "fold" | "keep" = "fold") {
  const was = !!r.value;
  r.value = JSON.parse(JSON.stringify(data));
  r.value.exercises.forEach(keyed);
  if (folds === "fold") open.value = new Set();
  else if (!was) open.value = new Set(r.value.exercises.map((e: any) => e._k));
  dirty.value = false;
}
watch([src.data, isNew, planMode], () => {
  const d = readJson<any>(draftKey.value, null);
  const forKey = planMode.value ? "plan" : id.value;
  if (d && d.__for === forKey) { asRoutine.value = !!d.__asRoutine; load(d, "keep"); dirty.value = true; return; }
  // a planned workout opens straight on the exercise list to pick from
  if (planMode.value) { if (!r.value) { load({ name: "Workout", description: "", folderId: null, color: null, exercises: [] }); picking.value = {}; } }
  else if (isNew.value) { load({ name: "", description: "", folderId: null, color: null, exercises: [] }); starter.value = true; }
  else if (src.data.value) load(src.data.value);
}, { immediate: true });
watch([r, asRoutine], ([v]) => { if (v && dirty.value) writeJson(draftKey.value, { ...v, __for: planMode.value ? "plan" : id.value, __asRoutine: asRoutine.value }); }, { deep: true });
const touch = () => { dirty.value = true; };
const isOpen = (e: any) => open.value.has(e._k);
const toggle = (e: any) => { if (isOpen(e)) open.value.delete(e._k); else open.value.add(e._k); };
const allOpen = computed(() => !!r.value?.exercises.length && r.value.exercises.every(isOpen));
async function goTo(e: any) {
  tab.value = "exercises"; open.value.add(e._k);
  await nextTick();
  document.querySelector(`[data-k="${e._k}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
const toggleAll = () => { open.value = new Set(allOpen.value ? [] : r.value.exercises.map((e: any) => e._k)); };

const blankSet = (e: any) => {
  const last = e.sets.at(-1);
  return { ...(last ? { ...last, id: undefined, kind: last.kind === "warmup" || last.kind === "drop" ? "normal" : last.kind, restS: null } : { kind: "normal", reps: 8, repsMax: null, weightKg: null, durationS: usesDuration(tr(e)) ? 30 : null, distanceM: null, rpe: null, restS: null }), _k: nk() };
};
function addExercises(ids: string[]) {
  if (picking.value?.replace != null) {
    const e = r.value.exercises[picking.value.replace];
    e.exerciseId = ids[0]; e.exercise = exById.value.get(ids[0]!);
  } else for (const eid of ids) {
    const ex = exById.value.get(eid);
    const timed = usesDuration(ex?.tracking ?? "weight_reps") && !usesReps(ex?.tracking ?? "weight_reps");
    const e = keyed({ exerciseId: eid, exercise: ex, superset: null, restS: null, restAfterS: null, restByKind: null, repRestS: null, prefill: "last", prefillScope: "any", progression: null, note: "",
      sets: [0, 1, 2].map(() => ({ kind: "normal", reps: timed ? null : 8, repsMax: null, weightKg: null, durationS: timed ? 30 : null, distanceM: null, rpe: null, restS: null })) });
    r.value.exercises.push(e);
    open.value.add(e._k);
  }
  // exercises chosen by hand: the "How do you want to start?" choice is made
  if (ids.length) starter.value = false;
  picking.value = null; touch();
}
const reorder = (a: any[], from: number, to: number) => { a.splice(to, 0, a.splice(from, 1)[0]); if (a === r.value.exercises) tidySupersets(); touch(); };
const move = (i: number, d: number) => { const j = i + d; if (j >= 0 && j < r.value.exercises.length) reorder(r.value.exercises, i, j); };
const removeEx = (i: number) => { r.value.exercises.splice(i, 1); tidySupersets(); touch(); };
const addSet = (e: any) => { e.sets.push(blankSet(e)); touch(); };
// a set's drops go with it
const removeSet = (e: any, j: number) => { e.sets.splice(j, e.sets[j].kind === "drop" ? 1 : 1 + dropsAfter(e, j)); touch(); };
/** A drop set: straight after a set (or its last drop), lighter, no rest in between. */
const dropsAfter = (e: any, j: number) => { let n = 0; while (e.sets[j + 1 + n]?.kind === "drop") n++; return n; };
function addDrop(e: any, j: number) {
  const at = j + 1 + dropsAfter(e, j), from = e.sets[at - 1];
  e.sets.splice(at, 0, { ...from, id: undefined, _k: nk(), kind: "drop", weightKg: dropWeightKg(from.weightKg, fmt.value.wu), repsMax: null, restS: null });
  touch();
}
const dragEx = (ev: PointerEvent, i: number) =>
  startDrag(ev, { list: (ev.currentTarget as HTMLElement).closest(".exlist") as HTMLElement, index: i, before: () => (open.value = new Set()), move: (a, b) => reorder(r.value.exercises, a, b) });
const dragSet = (ev: PointerEvent, e: any, j: number) =>
  startDrag(ev, { list: (ev.currentTarget as HTMLElement).closest(".slist") as HTMLElement, index: j, move: (a, b) => reorder(e.sets, a, b) });

// drops are numbered within their set: D1, D2…
const kindShort = (e: any, j: number) => { const k = e.sets[j].kind; if (k !== "drop") return k === "warmup" ? "W" : k === "failure" ? "F" : String(setNo(e, j)); let n = 1; while (e.sets[j - n]?.kind === "drop") n++; return `D${n}`; };
const setNo = (e: any, j: number) => e.sets.slice(0, j + 1).filter((x: any) => x.kind !== "warmup" && x.kind !== "drop").length;
// a superset is a run of neighbouring exercises with the same letter
const inSupersetWithNext = (i: number) => { const a = r.value.exercises; return !!a[i]?.superset && a[i].superset === a[i + 1]?.superset; };
const freeTag = () => { const used = new Set(r.value.exercises.map((x: any) => x.superset)); for (let c = 65; c < 91; c++) if (!used.has(String.fromCharCode(c))) return String.fromCharCode(c); return "Z"; };
/** After any change to the list: a superset left with one exercise is no superset, and runs that came apart get their own letters. */
function tidySupersets() {
  const a = r.value.exercises, seen = new Set<string>();
  for (let i = 0; i < a.length;) {
    const tag = a[i].superset; let j = i + 1;
    if (!tag) { i++; continue; }
    while (j < a.length && a[j].superset === tag) j++;
    const run = a.slice(i, j);
    if (run.length < 2) run.forEach((x: any) => (x.superset = null));
    else if (seen.has(tag)) { const t = freeTag(); run.forEach((x: any) => (x.superset = t)); seen.add(t); }
    else seen.add(tag);
    i = j;
  }
}
function superset(i: number) {
  const a = r.value.exercises, cur = a[i], nx = a[i + 1];
  if (!nx) return;
  const tag = cur.superset ?? nx.superset ?? freeTag();
  // joining two supersets: the next one's exercises all take this letter
  const old = nx.superset;
  for (let j = i + 1; j < a.length && (j === i + 1 || (old && a[j].superset === old)); j++) a[j].superset = tag;
  cur.superset = tag; tidySupersets(); touch();
}
const unsuperset = (i: number) => { r.value.exercises[i].superset = null; tidySupersets(); touch(); };
const restDefaults = computed(() => restDefaultsOf(s.value.workout));
const plannedRest = (e: any, x: any, j: number) => restAfterSet({ setRestS: x.restS, kind: x.kind, nextKind: e.sets[j + 1]?.kind, byKindS: e.restByKind, exRestS: e.restS, isLastSet: j === e.sets.length - 1, exRestAfterS: e.restAfterS }, restDefaults.value);
const est = computed(() => r.value ? estimate(r.value.exercises.map((e: any) => ({ sets: e.sets.map((x: any, j: number) => ({ ...x, restS: plannedRest(e, x, j) })) }))) : null);
const setCount = computed(() => (r.value?.exercises ?? []).reduce((a: number, e: any) => a + e.sets.length, 0));
const muscles = computed(() => muscleSets((r.value?.exercises ?? []).map((e: any) => { const x = e.exercise ?? exById.value.get(e.exerciseId); return { primary: x?.primaryMuscles ?? [], secondary: x?.secondaryMuscles ?? [], sets: e.sets.length }; })));
const worked = computed(() => musclesWorked((r.value?.exercises ?? []).map((e: any) => { const x = e.exercise ?? exById.value.get(e.exerciseId); return { primary: x?.primaryMuscles ?? [], secondary: x?.secondaryMuscles ?? [] }; })));
const exOf = (e: any) => exById.value.get(e.exerciseId) ?? e.exercise;
const exName = (e: any) => exOf(e)?.name ?? "";
const exImg = (e: any) => exOf(e)?.images?.[0];

/** "3 × 8-12 · 60 kg": the working sets in one line, for folded cards and the overview */
function setSummary(e: any) {
  const work = e.sets.filter((x: any) => x.kind !== "warmup" && x.kind !== "drop"), warm = e.sets.filter((x: any) => x.kind === "warmup").length;
  const drops = e.sets.length - work.length - warm;
  const t = tr(e), f = fmt.value;
  const same = (k: string) => work.length && work.every((x: any) => x[k] === work[0][k]);
  const reps = (x: any) => (x.repsMax ? `${x.reps ?? "?"}-${x.repsMax}` : `${x.reps ?? "-"}`);
  let what = "";
  if (usesReps(t)) what = same("reps") && same("repsMax") ? `${work.length} × ${reps(work[0])}` : work.map(reps).join(", ");
  else if (usesDuration(t)) what = same("durationS") && work[0]?.durationS ? `${work.length} × ${f.clock(work[0].durationS)}` : `${work.length} sets`;
  else what = `${work.length} sets`;
  const w = usesWeight(t) && same("weightKg") && work[0]?.weightKg != null ? ` · ${f.w(work[0].weightKg)} ${f.wu}` : "";
  return `${what}${w}${warm ? ` · ${warm} warm-up` : ""}${drops ? ` · ${drops} drop${drops === 1 ? "" : "s"}` : ""}`;
}

// rest after each kind of set; normal sets use the exercise's own rest, the others fall back to the person's default for the kind, then to it
const KIND_REST: [k: "warmup" | "drop" | "failure", label: string][] = [["warmup", "Warm-up sets"], ["drop", "Drop sets"], ["failure", "To-failure sets"]];
const workRest = (e: any) => e.restS ?? s.value.workout.restBetweenSetsS;
const kindRest = (e: any, k: "warmup" | "drop" | "failure") => e.restByKind?.[k] ?? s.value.workout.restByKindS?.[k] ?? workRest(e);
function restGet(t: RestTarget): number | null {
  const e = r.value.exercises[t.ex];
  if (t.kind === "between") return e.restS;
  if (t.kind === "after") return e.restAfterS;
  if (t.kind === "rep") return e.repRestS;
  if (t.kind === "set") return e.sets[t.set!].restS;
  return e.restByKind?.[t.kind] ?? null;
}
function setRest(v: number | null) {
  const t = restFor.value!; const e = r.value.exercises[t.ex];
  if (t.kind === "between") e.restS = v; else if (t.kind === "after") e.restAfterS = v; else if (t.kind === "rep") e.repRestS = v;
  else if (t.kind === "set") e.sets[t.set!].restS = v;
  else { const m = { ...(e.restByKind ?? {}) }; if (v == null) delete m[t.kind]; else m[t.kind] = v; e.restByKind = Object.keys(m).length ? m : null; }
  restFor.value = null; touch();
}
const restTitle = (t: RestTarget) => ({ between: "Rest after a normal set", after: "Rest after the last set", rep: "Timer between reps", set: `Rest after set ${t.set! + 1}`,
  warmup: "Rest after a warm-up set", drop: "Rest after a drop set", failure: "Rest after a set to failure" })[t.kind];
function restDefault(t: RestTarget) {
  const e = r.value.exercises[t.ex], c = fmt.value.clock, w = s.value.workout;
  if (t.kind === "between") return `Default (${c(w.restBetweenSetsS)})`;
  if (t.kind === "after") return `Default (${c(w.restAfterExerciseS)})`;
  if (t.kind === "rep") return "Off";
  if (t.kind === "set") return "No custom rest";
  return w.restByKindS?.[t.kind] != null ? `Default (${c(w.restByKindS[t.kind]!)})` : `Same as normal sets (${c(workRest(e))})`;
}
// the top of a rep range is hidden on phones to save room, unless the progression rule needs it
const showRange = (e: any) => e.progression?.kind === "double" || !isPhone.value;
const cols = (e: any) => {
  const t = tr(e);
  const n = [usesWeight(t), usesReps(t), usesReps(t) && showRange(e), usesDuration(t), usesDistance(t), s.value.features.rpe].filter(Boolean).length;
  return { gridTemplateColumns: `36px repeat(${n}, minmax(0, 1fr)) 40px` };
};

async function pickFolder(v: string) {
  if (v !== "__new") { r.value.folderId = v || null; touch(); return; }
  const name = await prompt("New folder", { placeholder: "e.g. Push / Pull / Legs", ok: "Create" });
  if (name) {
    try { r.value.folderId = (await api.post("/folders", { name })).id; invalidate(["routines"]); touch(); } catch (e) { toastError(e); }
  }
}
function fromScratch() { starter.value = false; picking.value = {}; }

// progression: what each rule does, in plain words
const PROG = [
  { value: "", label: "Off", hint: "The weight stays as you enter it, or as you lifted last time." },
  { value: "linear", label: "Add weight when every set is done", hint: "When you complete the target reps in every normal set, your next workout starts heavier." },
  { value: "double", label: "Add reps first, then weight", hint: "Work in a rep range, for example 8 to 12. Add reps each workout; once every set reaches the top, the weight goes up and you start again from the bottom." },
];
function setProg(e: any, k: string) {
  // lowering by a fixed weight is the default: it lands on weights the gym has, where 10% often doesn't
  const p = e.progression;
  e.progression = k ? { kind: k, incrementKg: p?.incrementKg ?? 2.5, deloadAfter: p?.deloadAfter ?? 3, deloadPct: p?.deloadPct ?? 10,
    deloadKg: p ? p.deloadKg ?? null : fmt.value.toKg(fmt.value.wu === "lb" ? 10 : 5) } : null;
  // a rep range needs a top: start with 4 above the target
  if (k === "double") e.sets.forEach((x: any) => { if (x.kind !== "warmup" && x.kind !== "drop" && x.reps != null && !x.repsMax) x.repsMax = x.reps + 4; });
  touch();
}
const firstWork = (e: any) => e.sets.find((x: any) => x.kind !== "warmup" && x.kind !== "drop") ?? {};
function setRange(e: any, k: "reps" | "repsMax", n: number) { e.sets.forEach((x: any) => { if (x.kind !== "warmup" && x.kind !== "drop") x[k] = n; }); touch(); }
const wNum = (kg: number | null) => (kg == null ? null : Math.round(fmt.value.fromKg(kg) * 100) / 100);
const restSummary = (e: any) => `${fmt.value.clock(workRest(e))} between sets, ${fmt.value.clock(e.restAfterS ?? s.value.workout.restAfterExerciseS)} after the last one${e.sets.some((x: any) => x.restS != null) ? ", some sets their own" : ""}`;
const progSummary = (e: any) => !e.progression ? "Off" : e.progression.kind === "double" ? `Reps first, then +${fmt.value.w(e.progression.incrementKg)} ${fmt.value.wu}` : `+${fmt.value.w(e.progression.incrementKg)} ${fmt.value.wu} when every set is done`;
const wIn = (kg: number | null) => (kg == null ? "" : String(Math.round(fmt.value.fromKg(kg) * 100) / 100));
const wOut = (v: string) => (v === "" ? null : fmt.value.toKg(Number(v)));
const dIn = (m: number | null) => (m == null ? "" : String(Math.round(fromM(m, fmt.value.du) * 100) / 100));
const dOut = (v: string) => (v === "" ? null : toM(Number(v), fmt.value.du));
const nOut = (v: string) => (v === "" ? null : Number(v));

// what the server takes: no looked-up exercise or screen keys
const bodyOf = () => ({ ...r.value, exercises: r.value.exercises.map((e: any) => ({ ...e, exercise: undefined, _k: undefined, sets: e.sets.map((x: any) => ({ ...x, _k: undefined })) })) });
async function save(thenStart = false) {
  if (!r.value.name.trim()) { toast("Give the routine a name", { kind: "err" }); return; }
  busy.value = true;
  try {
    const body = bodyOf();
    let rid = id.value;
    if (isNew.value) rid = (await api.post("/routines", body)).id; else await api.put(`/routines/${rid}`, body);
    localStorage.removeItem(draftKey.value);
    dirty.value = false;
    invalidate(["routines", "home", "calendar"]);
    toast("Routine saved");
    router.replace(thenStart ? `/routines/${rid}/start` : `/routines/${rid}`);
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
/** Planning a workout: start it with these exercises and sets; saved as a routine first when asked, and started from it. */
async function startPlanned() {
  const name = r.value.name.trim() || "Workout";
  busy.value = true;
  try {
    const body = { ...bodyOf(), name };
    let w;
    if (asRoutine.value) {
      const rid = (await api.post("/routines", body)).id;
      toast("Routine saved");
      invalidate(["routines", "calendar"]);
      w = await startWorkout({ routineId: rid });
    } else w = await startWorkout({ name, exercises: body.exercises });
    if (!w) return;
    localStorage.removeItem(draftKey.value);
    dirty.value = false;
    invalidate(["workouts", "home"]);
    if (w) router.replace("/workout");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
// leaving with changes asks first, however it happens (this Back, the phone's, the browser's)
useLeaveGuard(() => dirty.value, { title: planMode.value ? "Discard this workout plan?" : undefined,
  onDiscard: () => { localStorage.removeItem(draftKey.value); dirty.value = false; } });
const cancel = () => goBack(router, planMode.value ? "/" : "/routines");
async function startFrom(kind: "template" | "copy", v: string) {
  const full = kind === "copy" ? await api.get(`/routines/${v}`) : null;
  if (full) { load({ ...full, id: undefined, name: full.name + " (copy)", basedOnId: full.id, pinned: false, exercises: full.exercises.map((e: any) => ({ ...e, id: undefined })) }); dirty.value = true; }
  else { const x = await api.post("/routines", { template: v }); invalidate(["routines"]); router.replace(`/routines/${x.id}/edit`); }
  starter.value = false;
}
const exMenu = (e: any, i: number) => [
  { label: "About this exercise", icon: "info", run: () => (exerciseSheet.value = e.exerciseId) },
  { label: "Swap for another exercise", hint: "Keeps these sets, rests and notes", icon: "swap", run: () => (picking.value = { replace: i }) },
  { label: "Move up", icon: "up", run: () => move(i, -1), hidden: i === 0 },
  { label: "Move down", icon: "down", run: () => move(i, 1), hidden: i === r.value.exercises.length - 1 },
  { label: "Superset with next", hint: "Do one set of each in turn, resting after the pair", icon: "link", run: () => superset(i), hidden: !s.value.features.supersets || i === r.value.exercises.length - 1 || inSupersetWithNext(i) },
  { label: "Remove from superset", icon: "link", run: () => unsuperset(i), hidden: !e.superset },
  e.prefill === "target"
    ? { label: "Start with last time's numbers", hint: "Instead of the numbers set here", icon: "refresh", run: () => { e.prefill = "last"; touch(); } }
    : { label: "Always start with these numbers", hint: "Instead of what you did last time", icon: "refresh", run: () => { e.prefill = "target"; touch(); } },
  { label: "Remove", icon: "trash", danger: true, sep: true, run: () => removeEx(i) },
];
const setMenu = (e: any, j: number) => e.sets[j].kind === "drop" ? [
  { label: "Add another drop", hint: "Lower the weight again and keep going", icon: "arrowDown", run: () => addDrop(e, j) },
  { label: "Remove drop", icon: "trash", danger: true, sep: true, run: () => removeSet(e, j) },
] : [
  ...(s.value.features.setTypes ? SET_KINDS.map(([k, l, ic]) => ({ label: l, icon: ic, checked: e.sets[j].kind === k, run: () => { e.sets[j].kind = k; touch(); } })) : []),
  ...(s.value.features.setTypes && e.sets[j].kind !== "warmup" ? [{ label: dropsAfter(e, j) ? "Add another drop" : "Add a drop set", hint: "Straight after this set: lower the weight and keep going", icon: "arrowDown", sep: true, run: () => addDrop(e, j) }] : []),
  { label: e.sets[j].restS != null ? "Change the rest after this set" : "Custom rest after this set", icon: "timer", run: () => (restFor.value = { ex: r.value.exercises.indexOf(e), set: j, kind: "set" }), sep: s.value.features.setTypes },
  { label: "Remove set", icon: "trash", danger: true, run: () => removeSet(e, j) },
];
const tr = (e: any) => exById.value.get(e.exerciseId)?.tracking ?? e.exercise?.tracking ?? "weight_reps";
// show the page once its data is in, all at once
await loaded(src, all, folders, routines, templates);
</script>

<template>
  <div v-if="r" class="page">
    <button class="back" @click="cancel"><Icon name="left" :size="16" /><span>{{ isNew && !planMode ? "Routines" : "Back" }}</span></button>
    <div v-if="planMode" class="tiny pl-k">New workout</div>
    <div class="ph">
      <div class="grow"><input v-model="r.name" class="in" :placeholder="planMode ? 'Workout name' : 'Routine name'" style="font-size:24px;font-weight:600;padding:8px 12px;max-width:520px" @input="touch" /></div>
      <div v-if="planMode" class="acts">
        <button class="btn keep" :disabled="busy" @click="startPlanned"><Icon name="play" :size="18" />Start workout</button>
      </div>
      <div v-else class="acts">
        <button class="btn o keep" :disabled="busy" @click="save(false)">Save</button>
        <button class="btn keep" :disabled="busy || !r.exercises.length" @click="save(true)"><Icon name="play" :size="18" />Save and start</button>
      </div>
    </div>

    <div class="tabs">
      <button :class="{ on: tab === 'exercises' }" @click="tab = 'exercises'">Exercises · {{ r.exercises.length }}</button>
      <button :class="{ on: tab === 'overview' }" @click="tab = 'overview'">Overview</button>
      <span class="grow" />
      <span v-if="r.exercises.length" class="tiny tabmeta">{{ setCount }} sets · about {{ est ? duration(est.totalS, true) : "-" }}</span>
    </div>

    <div v-show="tab === 'exercises'" class="body">
      <div v-if="planMode" class="card plan-opt">
        <label class="tgl"><div class="grow"><div class="t">Also save as a routine</div><div class="s">{{ asRoutine ? `Saved as “${r.name.trim() || "Workout"}” when you start, to do again later` : "Keep this plan to start again later" }}</div></div><span class="tg"><input v-model="asRoutine" type="checkbox" @change="touch" /></span></label>
        <div v-if="asRoutine" class="fld" style="margin:10px 0 0"><label>Folder</label><AppSelect :model-value="r.folderId ?? ''" :options="[{ value: '', label: 'No folder' }, ...(folders.data.value ?? []).map((f: any) => ({ value: f.id, label: f.name })), { value: '__new', label: 'New folder…' }]" title="Folder" @update:model-value="pickFolder" /></div>
      </div>
      <div v-if="starter && isNew && !planMode && !r.exercises.length" class="card starter">
        <div class="row">
          <button v-if="starterView" class="ib sm plain" aria-label="Back" @click="starterView = ''"><Icon name="left" :size="18" /></button>
          <div class="grow"><div class="st-t">{{ starterView === "templates" ? "Templates" : starterView === "copy" ? "Copy one of your routines" : "How do you want to start?" }}</div>
            <div class="tiny">{{ starterView ? "Pick one; you can change everything afterwards." : "You can change everything afterwards." }}</div></div>
          <button class="ib sm plain" aria-label="Close" @click="starter = false"><Icon name="close" :size="16" /></button>
        </div>
        <div v-if="!starterView" class="opt-list" style="margin-top:14px">
          <button class="optb" @click="fromScratch"><span class="oi"><Icon name="plus" /></span><span class="grow"><span class="t">Start from scratch</span><span class="s" style="display:block">Pick your own exercises</span></span><Icon name="right" :size="18" /></button>
          <button class="optb" @click="starterView = 'templates'"><span class="oi"><Icon name="layers" /></span><span class="grow"><span class="t">Use a template</span><span class="s" style="display:block">{{ templates.data.value?.length ?? 0 }} ready-made routines: full body, push / pull / legs, upper / lower…</span></span><Icon name="right" :size="18" /></button>
          <button v-if="routines.data.value?.length" class="optb" @click="starterView = 'copy'"><span class="oi"><Icon name="copy" /></span><span class="grow"><span class="t">Copy one of your routines</span><span class="s" style="display:block">Start from a routine you already have</span></span><Icon name="right" :size="18" /></button>
        </div>
        <TemplateList v-else-if="starterView === 'templates'" @pick="(slug) => startFrom('template', slug)" />
        <!-- your routines, drawn like the Routines list's cards: the muscles each works on the left -->
        <div v-else class="opt-list" style="margin-top:14px">
          <button v-for="x in routines.data.value" :key="x.id" class="optb wbody" @click="startFrom('copy', x.id)">
            <MuscleFig :muscles="x.muscles" :helpers="x.helpers" />
            <div class="grow" style="align-self:center;min-width:0"><div class="t row" style="gap:8px"><span class="dot" :style="{ background: x.color ?? undefined }" /><span class="ellipsis">{{ x.name }}</span></div><div class="s">{{ x.exerciseCount }} exercises · {{ x.setCount }} sets</div><div class="s ellipsis">{{ x.exerciseNames.join(" · ") }}</div></div>
            <Icon name="copy" style="align-self:center" />
          </button>
        </div>
      </div>

      <div v-if="r.exercises.length > 1" class="row hgap">
        <span class="tiny grow hint"><Icon name="drag" :size="14" />Drag to reorder</span>
        <button class="qb" style="padding:4px 8px;font-size:12.5px" @click="toggleAll">{{ allOpen ? "Collapse all" : "Expand all" }}</button>
      </div>
      <div class="exlist">
        <div v-for="(e, i) in r.exercises" :key="e._k" data-drag :data-k="e._k" class="card ex" :class="{ sup: e.superset }">
          <div class="exh">
            <button class="ib sm plain dragh" aria-label="Drag to reorder" @pointerdown="dragEx($event, i)"><Icon name="drag" :size="18" /></button>
            <MuscleFig sm :muscles="exOf(e)?.primaryMuscles" :helpers="exOf(e)?.secondaryMuscles" />
            <div class="thumb sm click" @click="exerciseSheet = e.exerciseId"><img v-if="exImg(e)" :src="mediaUrl(exImg(e))" alt="" /><Icon v-else name="dumbbell" :size="18" /></div>
            <button class="exn" :aria-expanded="isOpen(e)" @click="toggle(e)">
              <span class="t">{{ exName(e) }}</span>
              <span class="tiny">{{ e.superset ? `Superset ${e.superset} · ` : "" }}{{ isOpen(e) ? (e.prefill === "target" ? "Starts with these numbers" : "Starts with last time's numbers") : setSummary(e) }}</span>
            </button>
            <button class="ib sm plain chev" :class="{ on: isOpen(e) }" :aria-label="isOpen(e) ? 'Collapse' : 'Expand'" @click="toggle(e)"><Icon name="down" :size="18" /></button>
            <Menu :items="exMenu(e, i)" />
          </div>

          <Collapse :open="isOpen(e)"><div class="exb">
            <div class="sgrid shead" :style="cols(e)"><span>Set</span>
              <span v-if="usesWeight(tr(e))">{{ fmt.wu }}</span><span v-if="usesReps(tr(e))">Reps</span><span v-if="usesReps(tr(e)) && showRange(e)">Up to</span>
              <span v-if="usesDuration(tr(e))">Sec</span><span v-if="usesDistance(tr(e))">{{ fmt.du }}</span><span v-if="s.features.rpe">RPE</span><span /></div>
            <div class="slist">
              <div v-for="(x, j) in e.sets" :key="x._k" data-drag class="sitem" :class="{ drop: x.kind === 'drop' }">
                <div class="sgrid" :style="cols(e)">
                  <button class="sk dragh" :class="{ w: x.kind === 'warmup', d: x.kind === 'drop', f: x.kind === 'failure' }" title="Drag to reorder" @pointerdown="dragSet($event, e, j)">{{ kindShort(e, j) }}</button>
                  <input v-if="usesWeight(tr(e))" class="vin" inputmode="decimal" :value="wIn(x.weightKg)" placeholder="-" @change="x.weightKg = wOut(($event.target as HTMLInputElement).value); touch()" />
                  <input v-if="usesReps(tr(e))" class="vin" inputmode="numeric" :value="x.reps ?? ''" placeholder="-" @change="x.reps = nOut(($event.target as HTMLInputElement).value); touch()" />
                  <input v-if="usesReps(tr(e)) && showRange(e)" class="vin" inputmode="numeric" :value="x.repsMax ?? ''" placeholder="-" title="Top of a rep range (optional)" @change="x.repsMax = nOut(($event.target as HTMLInputElement).value); touch()" />
                  <input v-if="usesDuration(tr(e))" class="vin" inputmode="numeric" :value="x.durationS ?? ''" placeholder="-" @change="x.durationS = nOut(($event.target as HTMLInputElement).value); touch()" />
                  <input v-if="usesDistance(tr(e))" class="vin" inputmode="decimal" :value="dIn(x.distanceM)" placeholder="-" @change="x.distanceM = dOut(($event.target as HTMLInputElement).value); touch()" />
                  <input v-if="s.features.rpe" class="vin" inputmode="decimal" :value="x.rpe ?? ''" placeholder="-" @change="x.rpe = nOut(($event.target as HTMLInputElement).value); touch()" />
                  <Menu :items="setMenu(e, j)" icon="more" label="Set options" />
                </div>
                <div v-if="x.restS != null" class="sgrid rrow" :style="cols(e)">
                  <button class="sk r" title="Custom rest after this set" @click="restFor = { ex: i, set: j, kind: 'set' }">R</button>
                  <button class="rpill" @click="restFor = { ex: i, set: j, kind: 'set' }"><Icon name="timer" :size="14" />{{ x.restS === 0 ? "No rest" : `${fmt.clock(x.restS)} rest` }}</button>
                  <button class="ib sm plain" aria-label="Remove this rest" @click="x.restS = null; touch()"><Icon name="close" :size="14" /></button>
                </div>
              </div>
            </div>
            <button class="qb acc" style="margin-top:6px" @click="addSet(e)"><Icon name="plus" :size="16" />Add set</button>

            <details class="fold sect prog">
              <summary class="sect-h"><span class="si"><Icon name="timer" :size="16" /></span><span class="grow"><b>Rest after each set</b><span class="tiny">{{ restSummary(e) }}</span></span></summary>
              <div class="tiny" style="margin:-2px 0 8px">Faded times are your defaults from Settings.</div>
              <div class="rgrid">
                <button class="ritem" @click="restFor = { ex: i, kind: 'between' }"><span>Normal sets</span><b :class="{ dim: e.restS == null }">{{ fmt.clock(workRest(e)) }}</b></button>
                <template v-if="s.features.setTypes">
                  <button v-for="[k, l] in KIND_REST" :key="k" class="ritem" @click="restFor = { ex: i, kind: k }"><span>{{ l }}</span><b :class="{ dim: e.restByKind?.[k] == null }">{{ fmt.clock(kindRest(e, k)) }}</b></button>
                </template>
                <button class="ritem" @click="restFor = { ex: i, kind: 'after' }"><span>After the last set</span><b :class="{ dim: e.restAfterS == null }">{{ fmt.clock(e.restAfterS ?? s.workout.restAfterExerciseS) }}</b></button>
              </div>
              <div class="tiny" style="margin-top:6px">For a different rest after one set, use that set's ⋮ menu; it shows as <b>R</b>.</div>
            </details>

            <div class="sect">
              <div class="sect-h"><span class="si"><Icon name="clock" :size="16" /></span><span class="grow"><b>Timer between reps</b><span class="tiny">Beeps every few seconds during a set, for slow or paused reps</span></span>
                <button class="ritem" style="flex:none" @click="restFor = { ex: i, kind: 'rep' }"><b :class="{ dim: !e.repRestS }">{{ e.repRestS ? `Every ${e.repRestS} s` : "Off" }}</b></button></div>
            </div>

            <details v-if="s.features.progression && (!planMode || asRoutine)" class="fold sect prog">
              <summary class="sect-h"><span class="si"><Icon name="arrowUp" :size="16" /></span><span class="grow"><b>Automatic weight increase</b><span class="tiny">{{ progSummary(e) }}</span></span></summary>
              <div class="tiny" style="margin:8px 0 10px">Motus can raise the weight for you when you're ready, and lower it when you keep missing your reps. You'll see why when the workout starts.</div>
              <RadioList :model-value="e.progression?.kind ?? ''" :options="PROG" @update:model-value="(k) => setProg(e, k)" />
              <div v-if="e.progression" class="pset">
                <div v-if="e.progression.kind === 'double' && usesReps(tr(e))" class="prow">
                  <div class="pl"><div class="t">Rep range</div><div class="s">For every normal set</div></div>
                  <div class="pc"><NumStep :value="firstWork(e).reps ?? null" :min="1" :max="100" label="lowest reps" @set="(v) => setRange(e, 'reps', v)" /><span class="tiny">to</span>
                    <NumStep :value="firstWork(e).repsMax ?? null" :min="1" :max="100" label="highest reps" @set="(v) => setRange(e, 'repsMax', v)" /></div>
                </div>
                <div class="prow">
                  <div class="pl"><div class="t">Add each time</div><div class="s">{{ e.progression.kind === "double" ? "Once every set reaches the top of the range" : "Once every set reaches its reps" }}</div></div>
                  <div class="pc"><NumStep :value="wNum(e.progression.incrementKg)" :step="fmt.wu === 'lb' ? 1 : 0.5" :max="100" :unit="fmt.wu" label="weight to add" @set="(v) => { e.progression.incrementKg = fmt.toKg(v); touch(); }" /></div>
                </div>
                <div class="prow">
                  <div class="pl"><div class="t">Lower the weight after</div><div class="s">Missed reps this many workouts in a row</div></div>
                  <div class="pc"><NumStep :value="e.progression.deloadAfter ?? 3" :min="1" :max="10" :unit="(e.progression.deloadAfter ?? 3) === 1 ? 'workout' : 'workouts'" label="workouts" @set="(v) => { e.progression.deloadAfter = v; touch(); }" /></div>
                </div>
                <div class="prow">
                  <div class="pl"><div class="t">Lower it by</div><div class="s">{{ e.progression.deloadKg ? "A fixed amount, handy for machines" : "A share of the weight" }}</div></div>
                  <div class="pc">
                    <div class="seg mini"><button :class="{ on: !!e.progression.deloadKg }" @click="e.progression.deloadKg = e.progression.deloadKg || fmt.toKg(fmt.wu === 'lb' ? 10 : 5); touch()">{{ fmt.wu }}</button><button :class="{ on: !e.progression.deloadKg }" @click="e.progression.deloadKg = null; touch()">%</button></div>
                    <NumStep v-if="!e.progression.deloadKg" :value="e.progression.deloadPct ?? 10" :step="5" :min="5" :max="50" unit="%" label="percent to lower" @set="(v) => { e.progression.deloadPct = v; touch(); }" />
                    <NumStep v-else :value="wNum(e.progression.deloadKg)" :step="fmt.wu === 'lb' ? 5 : 2.5" :min="fmt.wu === 'lb' ? 1 : 0.5" :max="500" :unit="fmt.wu" label="weight to lower" @set="(v) => { e.progression.deloadKg = fmt.toKg(v); touch(); }" />
                  </div>
                </div>
              </div>
            </details>
            <div class="sect"><input v-model="e.note" class="in" placeholder="Note: seat height, grip…" style="font-size:13px" @input="touch" /></div>
          </div></Collapse>
        </div>
      </div>
      <button class="btn tonal block lg" @click="picking = {}"><Icon name="plus" />Add exercises</button>
    </div>

    <div v-show="tab === 'overview'" class="grid ov" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start">
      <div class="stack">
        <div class="card">
          <div class="row" style="gap:24px;flex-wrap:wrap">
            <div><div class="lbl">Estimated time</div><div class="val" style="font-size:28px">{{ est ? duration(est.totalS, true) : "-" }}</div></div>
            <div><div class="lbl">Working</div><div class="val" style="font-size:20px">{{ est ? duration(est.workS, true) : "-" }}</div></div>
            <div><div class="lbl">Resting</div><div class="val" style="font-size:20px">{{ est ? duration(est.restS, true) : "-" }}</div></div>
          </div>
          <div class="tiny" style="margin-top:6px">{{ r.exercises.length }} exercises · {{ setCount }} sets</div>
        </div>
        <div class="card">
          <div class="flbl">Exercises</div>
          <div v-if="!r.exercises.length" class="tiny">No exercises yet.</div>
          <div class="list">
            <div v-for="(e, i) in r.exercises" :key="e._k" class="li click" @click="goTo(e)">
              <span class="ovn">{{ i + 1 }}</span>
              <div class="grow"><div class="t">{{ exName(e) }}</div><div class="tiny">{{ setSummary(e) }} · rest {{ fmt.clock(workRest(e)) }}{{ e.superset ? ` · superset ${e.superset}` : "" }}</div></div>
              <Icon name="right" :size="16" />
            </div>
          </div>
        </div>
        <div v-if="!planMode || asRoutine" class="card">
          <div class="fld"><label>Description</label><textarea v-model="r.description" rows="3" placeholder="What this routine is for, how to run it…" @input="touch" /></div>
          <div class="frow">
            <div class="fld"><label>Folder</label><AppSelect :model-value="r.folderId ?? ''" :options="[{ value: '', label: 'No folder' }, ...(folders.data.value ?? []).map((f: any) => ({ value: f.id, label: f.name })), { value: '__new', label: 'New folder…' }]" title="Folder" @update:model-value="pickFolder" /></div>
          </div>
          <div class="fld" style="margin-bottom:0"><label>Colour</label><div class="row wrap" style="gap:6px"><button v-for="c in COLORS" :key="c" class="dot click" :style="{ background: c, width: '24px', height: '24px', border: r.color === c ? '2px solid var(--tx)' : '0' }" @click="r.color = c; touch()" /><button class="qb" style="padding:2px 6px" @click="r.color = null; touch()">None</button></div></div>
        </div>
      </div>
      <div class="card">
        <div class="flbl">Muscles worked</div>
        <BodyMap :values="muscles" :highlight="worked.primary" :secondary="worked.secondary" :height="180" legend />
        <div class="chips" style="margin-top:6px;justify-content:center"><span v-for="m in [...worked.primary, ...worked.secondary]" :key="m" class="mchip">{{ muscleName(m) }}</span></div>
      </div>
    </div>

    <ExercisePicker v-if="picking" :multi="picking.replace == null" :title="picking.replace != null ? 'Swap for' : 'Add exercises'" @close="picking = null" @pick="addExercises" />
    <RestPicker v-if="restFor" :title="restTitle(restFor)" :value="restGet(restFor)" :default-label="restDefault(restFor)"
      :presets="restFor.kind === 'rep' ? [5, 10, 15, 20, 30, 45, 60] : undefined" @close="restFor = null" @pick="setRest" />
  </div>
</template>

<style scoped>
@media (max-width: 860px) {
  .ov { grid-template-columns: 1fr !important; }
  .ph { flex-wrap: wrap; } .ph .grow { flex-basis: 100%; } .ph .acts { width: 100%; } .ph .acts .btn { flex: 1; justify-content: center; }
}
.tabs { align-items: center; }
.tabmeta { white-space: nowrap; padding-inline: 4px; }
.body { max-width: 860px; }
.starter, .plan-opt { margin-bottom: var(--spg); }
.pl-k { margin-bottom: 2px; }
.st-t { font-size: 17px; font-weight: 600; }

.exlist { display: flex; flex-direction: column; gap: var(--spg); margin-bottom: var(--spg); }
.ex { text-align: start; }
/* not .ss: that is the settings-section class in sections.css, whose padding: 0 !important emptied the card */
.ex.sup { border-inline-start: 3px solid var(--acc); }
.exh { display: flex; align-items: center; gap: 8px; margin: -4px; }
.exh .dragh { color: var(--tx2); margin-inline-end: -4px; }
.exn { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: 0; background: none; color: var(--tx); text-align: start; cursor: pointer; padding: 4px 0; }
.exn .t { font-weight: 600; }
.exn .tiny { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.chev svg { transition: transform .2s; transform: rotate(-90deg); }
html.he .chev svg { transform: rotate(90deg); }
.chev.on svg { transform: none; }
.exb { margin-top: 12px; }

.sgrid { display: grid; align-items: center; gap: 6px; padding: calc(var(--tdy) / 2) 0; }
.sgrid > .vin { justify-self: center; }
.shead { font-size: 11px; font-weight: 600; color: var(--tx2); text-transform: uppercase; letter-spacing: .6px; text-align: center; padding-bottom: 6px; }
.shead > span:first-child { text-align: start; }
.slist { display: flex; flex-direction: column; }
.sitem { border-radius: var(--r-sm); }
.sk { display: inline-grid; place-items: center; min-width: 30px; height: 30px; padding: 0 6px; border-radius: 8px; background: var(--s2); color: var(--tx); font-size: 12.5px; font-weight: 600; border: 0; }
.sk.w { color: var(--c2); }
.sk.d { color: var(--c1); }
/* a drop hangs off the set above it */
.sitem.drop .sk { translate: 8px 0; }
.sk.f { color: var(--neg); }
.sk.r { background: var(--accc); color: var(--onc); cursor: pointer; }
.rrow { padding-top: 0; }
.rrow .rpill { grid-column: 2 / -2; justify-self: start; }
.rpill { display: inline-flex; align-items: center; gap: 6px; border: 1px dashed var(--ol); background: none; color: var(--tx2); border-radius: var(--pill); padding: 4px 12px; font-size: 12.5px; cursor: pointer; }
.rpill:hover { color: var(--tx); border-color: var(--acc); }

.sect { margin-top: calc(var(--cpy) - 1px); padding-top: calc(var(--cpy) - 1px); border-top: 1px solid var(--ol); text-align: start; }
/* the sections of an open exercise share one header: icon tile, title, a line saying what it is or how it's set */
.sect-h { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; color: var(--tx); }
.sect-h .si { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: var(--s2); color: var(--acc); flex: none; }
.sect-h b { display: block; font-size: 14px; font-weight: 600; }
.sect-h .tiny { display: block; }
.rgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
.ritem { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 12px; border-radius: var(--r-sm); border: 0; background: var(--s2); color: var(--tx); font-size: 13px; cursor: pointer; text-align: start; }
.ritem:hover { background: color-mix(in srgb, var(--acc) 12%, var(--s2)); }
.ritem b { font-variant-numeric: tabular-nums; }
.ritem b.dim { color: var(--tx2); font-weight: 500; }
.prog > summary { cursor: pointer; margin-bottom: 0; }
.pset { margin-top: 12px; padding: 2px calc(var(--cpx) - 2px); border-radius: var(--r-md); background: var(--s2); }
.prow { display: flex; align-items: center; gap: 12px; padding: calc(var(--lpy) + 2px) 0; border-bottom: 1px solid var(--ol); }
.prow:last-child { border-bottom: 0; }
.prow .pl { flex: 1; min-width: 0; }
.prow .pl .t { font-size: 14px; font-weight: 500; }
.prow .pl .s { font-size: 12px; color: var(--tx2); margin-top: 2px; }
.prow .pc { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
/* on the shaded panel a plain .seg would vanish: give it its own outline so it reads as a switch */
.seg.mini { margin: 0; flex: none; background: var(--s1); box-shadow: inset 0 0 0 1px var(--ol); }
.seg.mini button { padding: 6px 14px; font-size: 13px; min-height: 32px; min-width: 44px; }
@media (max-width: 600px) { .prow { flex-wrap: wrap; } .prow .pc { width: 100%; justify-content: flex-start; } }
.hint { display: inline-flex; align-items: center; gap: 4px; }
.ovn { width: 26px; height: 26px; border-radius: 8px; background: var(--s2); display: grid; place-items: center; font-size: 12.5px; font-weight: 600; color: var(--tx2); flex: none; }
</style>
