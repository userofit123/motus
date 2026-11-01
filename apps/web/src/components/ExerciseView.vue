<script setup lang="ts">
// Everything about one exercise (PLAN.md §8.16): what it is and how to do it, every time you did it (with its place in
// that workout), charts, records, notes and reminders, and which routines use it. Shown as a page and as a sheet.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { strengthLevel, LEVELS, e1rm, weightForReps, usesWeight, usesReps, usesDuration, usesDistance, muscleName } from "@motus/shared";
import { useExercise, useExerciseHistory, useNotes, useReminders, useChange, useSettings, useBody } from "../api/queries";
import { api, mediaUrl } from "../api/client";
import { useFmt, ago } from "../core/format";
import { noteSheet, reminderSheet, exerciseSheet } from "../core/ui";
import { confirm } from "../core/ask";
import Icon from "./Icon.vue";
import BodyMap from "./BodyMap.vue";
import LineChart from "./LineChart.vue";
import Menu from "./Menu.vue";
import ExerciseEditor from "./ExerciseEditor.vue";

const props = defineProps<{ id: string; startTab?: string; inSheet?: boolean }>();
const router = useRouter();
const fmt = useFmt();
const settings = useSettings();
const ex = useExercise(computed(() => props.id));
const hist = useExerciseHistory(computed(() => props.id));
const notes = useNotes("exercise", computed(() => props.id));
const rems = useReminders(computed(() => ({ targetId: props.id })));
const tab = ref(props.startTab ?? "about");
const chart = ref("e1rm");
const editing = ref(false);
const e = computed<any>(() => ex.data.value);
const sessions = computed<any[]>(() => hist.data.value?.sessions ?? []);
const tracking = computed(() => e.value?.tracking ?? "weight_reps");
const pending = computed(() => (rems.data.value ?? []).filter((r: any) => r.status === "pending"));
const TABS = computed<[string, string][]>(() => [["about", "About"], ["history", `History${sessions.value.length ? " · " + sessions.value.length : ""}`], ["charts", "Charts"], ["records", "Records"],
  ["notes", `Notes${(notes.data.value?.length ?? 0) + pending.value.length ? " · " + ((notes.data.value?.length ?? 0) + pending.value.length) : ""}`]]);
const CHARTS = computed<[string, string][]>(() => [
  ...(usesWeight(tracking.value) && usesReps(tracking.value) ? [["e1rm", "Est. 1RM"], ["max", "Heaviest"], ["volume", "Volume"]] as [string, string][] : []),
  ...(usesReps(tracking.value) ? [["reps", "Reps"]] as [string, string][] : []),
  ...(usesDuration(tracking.value) ? [["duration", "Time"]] as [string, string][] : []),
  ...(usesDistance(tracking.value) ? [["distance", "Distance"]] as [string, string][] : []),
]);
const points = computed(() => sessions.value.map((s) => {
  const y = chart.value === "e1rm" ? s.e1rm : chart.value === "max" ? s.maxWeightKg : chart.value === "volume" ? s.volumeKg : chart.value === "reps" ? s.reps : chart.value === "duration" ? s.durationS : s.distanceM;
  return { x: new Date(s.startedAt).getTime(), y: y == null ? null : ["e1rm", "max", "volume"].includes(chart.value) ? fmt.value.fromKg(y) : chart.value === "distance" ? fmt.value.distNum(y) : y, id: s.workoutId, label: s.workoutName };
}).filter((p) => p.y != null) as any[]);
// the time of day you usually do it, in this device's time zone
const usualHour = computed(() => {
  const c = new Map<number, number>();
  for (const x of sessions.value) { const h = new Date(x.startedAt).getHours(); c.set(h, (c.get(h) ?? 0) + 1); }
  const h = [...c].sort((a, b) => b[1] - a[1])[0]?.[0];
  return h == null ? "" : fmt.value.time(new Date(2000, 0, 1, h).toISOString());
});
const best1rm = computed(() => hist.data.value?.records?.e1rm?.value ?? null);
const setText = (s: any) => [s.weightKg != null && usesWeight(tracking.value) ? fmt.value.w(s.weightKg) + " " + fmt.value.wu : "", s.reps != null && usesReps(tracking.value) ? (s.weightKg != null && usesWeight(tracking.value) ? "× " : "") + s.reps : "", s.durationS ? fmt.value.clock(s.durationS) : "", s.distanceM ? fmt.value.dist(s.distanceM) : ""].filter(Boolean).join(" ");
const REC: Record<string, string> = { maxWeight: "Heaviest weight", e1rm: "Best estimated 1RM", maxReps: "Most reps in a set", setVolume: "Best set (weight × reps)", sessionVolume: "Most volume in a session", maxDuration: "Longest", maxDistance: "Farthest" };
const recVal = (k: string, v: number) => (["maxWeight", "e1rm", "setVolume", "sessionVolume"].includes(k) ? fmt.value.wu_(v) : k === "maxDuration" ? fmt.value.clock(v) : k === "maxDistance" ? fmt.value.dist(v) : String(v));
const fav = useChange((v: boolean) => api.put(`/exercises/${props.id}/prefs`, { ...(e.value?.prefs ?? {}), favourite: v }), ["exercises"]);
const delNote = useChange((id: string) => api.del(`/notes/${id}`), ["notes"]);
const remDone = useChange((id: string, status: string) => api.put(`/reminders/${id}`, { status }), ["reminders"]);
const pinNote = useChange((n: any) => api.put(`/notes/${n.id}`, { pinned: !n.pinned }), ["notes"]);
const own = computed(() => !!e.value?.ownerId);
// strength standards (optional feature): needs a body weight
const bodyQ = useBody("weight");
const standard = computed(() => {
  const bw = (bodyQ.data.value as any[] | undefined)?.[0]?.value;
  return settings.value.features.standards && e.value && best1rm.value ? strengthLevel(e.value.name, best1rm.value, Number(bw ?? 0), settings.value.profile.sex) : null;
});
async function del() {
  if (!(await confirm(`Delete ${e.value.name}?`, { text: "If it has history it is archived instead, so your past workouts keep it.", ok: "Delete", danger: true }))) return;
  await api.del(`/exercises/${props.id}`);
  exerciseSheet.value = null;
  router.push("/exercises");
}
function openWorkout(id: string) { exerciseSheet.value = null; router.push(`/workouts/${id}`); }
const menu = computed(() => [
  { label: e.value?.favourite ? "Remove from favourites" : "Add to favourites", icon: "star", run: () => fav.run(!e.value?.favourite) },
  { label: "Remind me next time", icon: "bell", run: () => (reminderSheet.value = { targetType: "exercise", targetId: props.id, label: e.value.name }) },
  { label: "Add a note", icon: "note", run: () => (noteSheet.value = { targets: [{ type: "exercise", id: props.id, label: e.value.name }] }) },
  { label: "Edit", icon: "edit", run: () => (editing.value = true), hidden: !own.value },
  { label: "Make my own copy", icon: "copy", run: async () => { const r = await api.post("/exercises", { ...e.value, name: e.value.name + " (mine)" }); exerciseSheet.value = null; router.push(`/exercises/${r.id}`); }, hidden: own.value },
  { label: "Open as a page", icon: "right", run: () => { exerciseSheet.value = null; router.push(`/exercises/${props.id}`); }, hidden: !props.inSheet },
  { label: "Delete", icon: "trash", danger: true, run: del, hidden: !own.value, sep: true },
]);
</script>

<template>
  <div v-if="e">
    <div class="row" style="align-items:flex-start;margin-bottom:14px">
      <div class="grow">
        <h1 v-if="!inSheet" style="font-size:var(--fs-h1);font-weight:600;letter-spacing:-.6px">{{ e.name }}</h1>
        <div class="chips" style="margin-top:6px">
          <span v-for="m in e.primaryMuscles" :key="m" class="mchip" style="color:var(--tx)">{{ muscleName(m) }}</span>
          <span v-for="m in e.secondaryMuscles" :key="m" class="mchip">{{ muscleName(m) }}</span>
          <span v-if="e.equipment" class="mchip" style="text-transform:capitalize">{{ e.equipment }}</span>
          <Icon v-if="e.favourite" name="star" :size="16" style="color:var(--acc)" />
        </div>
      </div>
      <Menu :items="menu" />
    </div>
    <div class="tabs">
      <button v-for="[k, l] in TABS" :key="k" :class="{ on: tab === k }" @click="tab = k">{{ l }}</button>
    </div>

    <Transition name="sw" mode="out-in">
    <div v-if="tab === 'about'" class="grid" :class="inSheet ? '' : 'g2'">
      <div>
        <div v-if="e.images?.length" class="media">
          <img :src="mediaUrl(e.images[0])" :alt="e.name" loading="lazy" />
          <img v-if="e.images[1]" class="b" :src="mediaUrl(e.images[1])" alt="" loading="lazy" />
        </div>
        <a v-if="e.videoUrl" :href="e.videoUrl" target="_blank" rel="noopener" class="qb acc" style="margin-top:8px"><Icon name="play" />Watch a video</a>
        <div class="card" style="margin-top:var(--spg)"><BodyMap :values="{}" :highlight="e.primaryMuscles" :secondary="e.secondaryMuscles" :height="200" legend /></div>
      </div>
      <div>
        <div v-if="sessions[0]" class="card" style="margin-bottom:var(--spg)">
          <div class="lbl">Last time · {{ ago(sessions[0].startedAt) }}</div>
          <div style="margin:6px 0 2px;font-weight:600">{{ sessions[0].sets.map(setText).join(", ") }}</div>
          <div class="tiny">{{ sessions[0].workoutName }} · exercise {{ sessions[0].position }} of {{ sessions[0].ofN }}</div>
        </div>
        <h2 style="margin-top:0">How to do it</h2>
        <ol v-if="e.instructions?.length" class="steps"><li v-for="(s, i) in e.instructions" :key="i">{{ s }}</li></ol>
        <p v-else class="muted">No instructions yet.</p>
        <h2>Details</h2>
        <dl class="kv">
          <template v-if="e.level"><dt>Level</dt><dd>{{ e.level }}</dd></template>
          <template v-if="e.mechanic"><dt>Type</dt><dd>{{ e.mechanic }}</dd></template>
          <template v-if="e.force"><dt>Force</dt><dd>{{ e.force }}</dd></template>
          <dt>Category</dt><dd>{{ e.category }}</dd>
          <template v-if="e.routines?.length"><dt>In routines</dt><dd style="text-transform:none">{{ e.routines.map((r: any) => r.name).join(", ") }}</dd></template>
        </dl>
        <p v-if="e.license" class="tiny" style="margin-top:16px">From {{ e.author }} · {{ e.license }}</p>
      </div>
    </div>

    <div v-else-if="tab === 'history'">
      <div v-if="hist.data.value?.summary?.timesDone" class="grid g3" style="margin-bottom:var(--spg)">
        <div class="card tight"><div class="lbl">Times done</div><div class="val" style="font-size:24px">{{ hist.data.value.summary.timesDone }}</div><div class="tiny">since {{ fmt.date(hist.data.value.summary.firstAt, { month: "short", year: "numeric" }) }}</div></div>
        <div class="card tight"><div class="lbl">Usually</div><div class="val" style="font-size:24px">#{{ hist.data.value.summary.usualPosition }}</div><div class="tiny">in the workout · first {{ Math.round(hist.data.value.summary.firstPositionShare * 100) }}% of the time</div></div>
        <div class="card tight"><div class="lbl">Last done</div><div class="val" style="font-size:24px">{{ ago(hist.data.value.summary.lastAt) }}</div><div class="tiny">usually around {{ usualHour }}</div></div>
      </div>
      <div v-if="!sessions.length" class="empty"><Icon name="history" :size="32" /><b>Not done yet</b>Its history will show here after your first workout with it.</div>
      <div v-if="sessions.length" class="card list">
        <div v-for="s in sessions" :key="s.workoutId" class="li click" @click="openWorkout(s.workoutId)">
          <div class="grow">
            <div class="t">{{ fmt.date(s.startedAt, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) }} <span class="tiny">· {{ s.workoutName }} · #{{ s.position }} of {{ s.ofN }}</span></div>
            <div class="s">{{ s.sets.map(setText).join(" · ") || (s.status === "skipped" ? "Skipped" : "") }}</div>
          </div>
          <div class="r tiny"><div v-if="s.e1rm">1RM {{ fmt.wu_(s.e1rm) }}</div><div v-if="s.volumeKg">{{ fmt.vol(s.volumeKg) }}</div></div>
        </div>
      </div>
    </div>

    <div v-else-if="tab === 'charts'">
      <div class="chips" style="margin-bottom:12px"><button v-for="[k, l] in CHARTS" :key="k" class="fchip" :class="{ on: chart === k }" @click="chart = k">{{ l }}</button></div>
      <div class="card"><LineChart :points="points" :height="220" :fmt="(v) => fmt.num(v, 1)" @pick="openWorkout" /></div>
    </div>

    <div v-else-if="tab === 'records'">
      <div v-if="!sessions.length" class="empty"><Icon name="trophy" :size="32" /><b>No records yet</b></div>
      <div class="grid g2">
        <div v-for="(r, k) in hist.data.value?.records ?? {}" :key="k" class="card tight click" @click="openWorkout(r.workoutId)">
          <div class="lbl">{{ REC[k] ?? k }}</div>
          <div class="val" style="font-size:24px">{{ recVal(String(k), r.value) }}</div>
          <div class="tiny">{{ r.detail ? r.detail + " · " : "" }}{{ fmt.date(r.at, { day: "numeric", month: "short", year: "numeric" }) }}</div>
        </div>
      </div>
      <div v-if="standard" class="card" style="margin-top:var(--spg)">
        <div class="lbl">Strength standard</div>
        <div style="font-weight:600;font-size:20px;margin-top:4px">{{ standard.level }}</div>
        <div class="tiny">1RM {{ fmt.num(standard.ratio, 2) }}× body weight{{ standard.next ? ` · ${standard.next.level} at ${fmt.wu_(standard.next.kg)}` : "" }}</div>
        <div class="row" style="gap:4px;margin-top:10px"><div v-for="(t, i) in standard.thresholds" :key="i" class="grow" style="text-align:center"><div class="pbar" style="height:6px"><i :style="{ width: best1rm! >= t ? '100%' : '0%' }" /></div><div class="tiny" style="margin-top:3px">{{ LEVELS[i] }}</div></div></div>
        <p class="tiny" style="margin-top:8px">A rough guide from common gym rules of thumb, using your latest body weight{{ settings.profile.sex ? "" : " (set your sex in Settings → Account for a closer match)" }}.</p>
      </div>
      <template v-if="best1rm">
        <h2>Rep maxes</h2>
        <table class="sets"><thead><tr><th>Reps</th><th>Best done</th><th>Estimated</th><th>% of 1RM</th></tr></thead>
          <tbody><tr v-for="n in [1, 2, 3, 4, 5, 6, 8, 10, 12]" :key="n"><td>{{ n }}</td><td>{{ hist.data.value?.repMax?.[n] ? fmt.wu_(hist.data.value.repMax[n].weightKg) : "—" }}</td><td>{{ fmt.wu_(weightForReps(best1rm, n)) }}</td><td class="muted">{{ Math.round((weightForReps(best1rm, n) / best1rm) * 100) }}%</td></tr></tbody>
        </table>
      </template>
    </div>

    <div v-else-if="tab === 'notes'">
      <div class="row" style="margin-bottom:10px">
        <button class="btn tonal s" @click="noteSheet = { targets: [{ type: 'exercise', id: props.id, label: e.name }] }"><Icon name="plus" :size="16" />Note</button>
        <button class="btn o s" @click="reminderSheet = { targetType: 'exercise', targetId: props.id, label: e.name }"><Icon name="bell" :size="16" />Reminder</button>
      </div>
      <div v-for="r in pending" :key="r.id" class="banner"><Icon name="bell" /><div class="grow"><b>{{ r.body }}</b><div class="tiny">{{ r.trigger === "next" ? "Shows next time" : r.trigger === "every" ? "Shows every time" : r.trigger === "after_n" ? `After ${r.triggerN} sessions` : `From ${fmt.date(r.triggerDate)}` }}</div>
        <div class="acts"><button class="qb acc" @click="remDone.run(r.id, 'done')">Done</button><button class="qb" @click="remDone.run(r.id, 'dismissed')">Dismiss</button></div></div></div>
      <div v-if="!notes.data.value?.length && !pending.length" class="empty"><Icon name="note" :size="32" /><b>No notes yet</b>Write how it felt, what to change, or whether it suits you.</div>
      <div class="list">
        <div v-for="n in notes.data.value" :key="n.id" class="li">
          <div class="grow">
            <div style="white-space:pre-wrap">{{ n.body }}</div>
            <div class="s"><Icon v-if="n.pinned" name="pin" :size="12" style="display:inline;vertical-align:-1px" /> {{ fmt.date(n.createdAt, { day: "numeric", month: "short", year: "numeric" }) }}{{ n.workoutName ? " · " + n.workoutName : "" }}{{ n.difficulty ? " · difficulty " + n.difficulty + "/5" : "" }}<span v-for="t in n.tags" :key="t" class="mchip" style="margin-inline-start:6px">{{ t }}</span></div>
          </div>
          <Menu :items="[{ label: n.pinned ? 'Unpin' : 'Pin (show during workouts)', icon: 'pin', run: () => pinNote.run(n) }, { label: 'Edit', icon: 'edit', run: () => (noteSheet = { targets: [{ type: n.targetType, id: n.targetId, label: e.name }], edit: n }) }, { label: 'Delete', icon: 'trash', danger: true, run: () => delNote.run(n.id) }]" />
        </div>
      </div>
    </div>
    </Transition>
    <ExerciseEditor v-if="editing" :exercise="e" @close="editing = false" />
  </div>
  <div v-else class="empty">Loading…</div>
</template>
