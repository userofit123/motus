<script setup lang="ts">
// Adding an activity: record it live (walk, run, ride: GPS on the phone) or type it in (any type, any day).
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useActivityTypes } from "../api/queries";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { useFmt, localYmd } from "../core/format";
import { toM } from "@motus/shared";
import Sheet from "../components/Sheet.vue";
import Icon from "../components/Icon.vue";

const props = defineProps<{ o: { id?: string; type?: string } }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const types = useActivityTypes();
const fmt = useFmt();
const type = ref(props.o.type ?? "walk");
const t = computed(() => (types.data.value ?? []).find((x: any) => x.slug === type.value));
const now = new Date();
const f = ref({ date: localYmd(now), time: now.toTimeString().slice(0, 5), minutes: 30 as number | null, distance: null as number | null, steps: null as number | null, notes: "", name: "" });
const busy = ref(false);
async function save() {
  busy.value = true;
  try {
    const startedAt = new Date(`${f.value.date}T${f.value.time}`).toISOString();
    await api.post("/activities", { type: type.value, name: f.value.name, startedAt, durationS: Math.round((f.value.minutes ?? 0) * 60), distanceM: f.value.distance ? toM(f.value.distance, fmt.value.du) : null, steps: f.value.steps, notes: f.value.notes, source: "manual" });
    invalidate(["activities", "stats", "goals", "home", "calendar"]);
    toast("Saved");
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
function record() { emit("close"); router.push(`/activities/record?type=${type.value}`); }
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
  <Sheet title="Activity" @close="emit('close')">
    <div class="chips" style="margin-bottom:14px"><button v-for="x in types.data.value ?? []" :key="x.slug" class="fchip" :class="{ on: type === x.slug }" @click="type = x.slug"><Icon :name="x.icon" :size="15" />{{ x.name }}</button></div>
    <button v-if="t?.hasGps" class="optb" style="margin-bottom:14px" @click="record"><span class="oi"><Icon name="map" /></span><div class="grow"><div class="t">Record now</div><div class="s">Time, distance and your route</div></div><Icon name="right" /></button>
    <h2 style="margin-top:4px">Or type it in</h2>
    <div class="frow"><div class="fld"><label>Day</label><input v-model="f.date" type="date" /></div><div class="fld"><label>Start</label><input v-model="f.time" type="time" /></div></div>
    <div class="frow">
      <div class="fld"><label>Minutes</label><input v-model.number="f.minutes" type="number" inputmode="numeric" min="0" /></div>
      <div v-if="t?.hasDistance !== false" class="fld"><label>Distance ({{ fmt.du }})</label><input v-model.number="f.distance" type="number" inputmode="decimal" step="0.01" min="0" /></div>
      <div v-if="type === 'walk' || type === 'run' || type === 'hike'" class="fld"><label>Steps</label><input v-model.number="f.steps" type="number" inputmode="numeric" min="0" /></div>
    </div>
    <div class="fld"><label>Notes</label><input v-model="f.notes" /></div>
    <label class="qb" style="cursor:pointer"><Icon name="upload" :size="16" />Import GPX or TCX files<input type="file" accept=".gpx,.tcx,application/gpx+xml" multiple hidden @change="importFiles" /></label>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>
