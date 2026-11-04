<script setup lang="ts">
// Logging an activity done earlier: any type, any day, typed in (or imported from GPX/TCX files). Recording one live with
// GPS is its own page (Start → Record), offered here only as a quiet link for a walk, run or ride you're about to do.
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useActivityTypes } from "../api/queries";
import { newActivityType } from "../core/activityTypes";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { useFmt, localYmd } from "../core/format";
import { toM } from "@motus/shared";
import { recording } from "../workout/recording";
import Sheet from "../components/Sheet.vue";
import DatePicker from "../components/DatePicker.vue";
import TimePicker from "../components/TimePicker.vue";
import AppSelect from "../components/AppSelect.vue";
import Icon from "../components/Icon.vue";

const props = defineProps<{ o: { id?: string; type?: string } }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const types = useActivityTypes();
const fmt = useFmt();
const type = ref(props.o.type ?? "walk");
const t = computed(() => (types.data.value ?? []).find((x: any) => x.slug === type.value));
// the same types as recording and goals; the last choice adds a new one and picks it
const NEW = "__new";
watch(type, async (v, old) => { if (v !== NEW) return; type.value = old; const slug = await newActivityType(); if (slug) { await types.refetch(); type.value = slug; } });
const now = new Date();
const f = ref({ date: localYmd(now), time: now.toTimeString().slice(0, 5), minutes: 30 as number | null, distance: null as number | null, steps: null as number | null, notes: "", name: "" });
const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    const startedAt = new Date(`${f.value.date}T${f.value.time}`).toISOString();
    await api.post("/activities", { type: type.value, name: f.value.name, startedAt, durationS: Math.round((f.value.minutes ?? 0) * 60), distanceM: f.value.distance ? toM(f.value.distance, fmt.value.du) : null, steps: t.value?.hasSteps ? f.value.steps : null, notes: f.value.notes, source: "manual" });
    invalidate(["activities", "stats", "goals", "home", "calendar"]);
    toast(`${t.value?.name ?? "Activity"} saved`);
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
function record() { emit("close"); router.push(recording.value ? "/activities/record" : `/activities/record?type=${type.value}`); }
async function importFiles(ev: Event) {
  const files = Array.from((ev.target as HTMLInputElement).files ?? []);
  try {
    const list = await Promise.all(files.map(async (fl) => ({ name: fl.name, text: await fl.text() })));
    const r = await api.post("/activities/import", { files: list });
    invalidate(["activities", "stats", "goals", "home", "calendar"]);
    toast(`Imported ${r.count} ${r.count === 1 ? "activity" : "activities"}`);
    emit("close");
  } catch (e) { toastError(e); }
}
</script>

<template>
  <Sheet title="Log an activity" @close="emit('close')">
    <div class="fld"><label>Activity</label><AppSelect v-model="type" :options="[...(types.data.value ?? []).map((x: any) => ({ value: x.slug, label: x.name })), { value: NEW, label: 'New activity type…' }]" title="Activity" /></div>
    <div class="frow"><div class="fld"><label>Day</label><DatePicker v-model="f.date" title="Day" /></div><div class="fld"><label>Start</label><TimePicker v-model="f.time" title="Start" /></div></div>
    <div class="frow">
      <div class="fld"><label>Minutes</label><input v-model.number="f.minutes" type="number" inputmode="numeric" min="0" /></div>
      <div v-if="t?.hasDistance !== false" class="fld"><label>Distance ({{ fmt.du }})</label><input v-model.number="f.distance" type="number" inputmode="decimal" step="0.01" min="0" /></div>
      <div v-if="t?.hasSteps" class="fld"><label>Steps</label><input v-model.number="f.steps" type="number" inputmode="numeric" min="0" /></div>
    </div>
    <div class="fld"><label>Notes</label><input v-model="f.notes" /></div>
    <div class="row" style="flex-wrap:wrap;gap:4px">
      <label class="qb" style="cursor:pointer"><Icon name="upload" :size="16" />Import GPX or TCX files<input type="file" accept=".gpx,.tcx,application/gpx+xml" multiple hidden @change="importFiles" /></label>
      <button class="qb acc" @click="record"><Icon name="map" :size="16" />{{ recording ? "Back to the recording" : t?.hasGps ? "Doing it now? Record it with GPS" : "Doing it now? Time it" }}</button>
    </div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>
