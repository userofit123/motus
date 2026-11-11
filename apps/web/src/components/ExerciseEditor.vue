<script setup lang="ts">
// Your own exercise: name, how it is tracked, muscles, equipment, steps, and photos or a video link.
import { ref, computed } from "vue";
import { MUSCLES, EQUIPMENT, CATEGORIES, muscleName, categoryName } from "@motus/shared";
import { api, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useSettings } from "../api/queries";
import { toast, toastError } from "../core/toast";
import Sheet from "./Sheet.vue";
import AppSelect from "./AppSelect.vue";
import ChoiceTiles from "./ChoiceTiles.vue";
import Icon from "./Icon.vue";
import { SIDES_HINT } from "../core/sides";
import { TRACK } from "../core/timed";

const props = defineProps<{ exercise?: any; name?: string }>();
const emit = defineEmits<{ close: []; saved: [id: string] }>();
const e = props.exercise;
const settings = useSettings();
const sidesOn = computed(() => !!settings.value?.features?.unilateral);
const f = ref({
  name: e?.name ?? props.name ?? "", tracking: e?.tracking ?? "weight_reps", category: e?.category ?? "strength", equipment: e?.equipment ?? "",
  primaryMuscles: [...(e?.primaryMuscles ?? [])] as string[], secondaryMuscles: [...(e?.secondaryMuscles ?? [])] as string[],
  instructions: (e?.instructions ?? []).join("\n"), images: [...(e?.images ?? [])] as string[], videoUrl: e?.videoUrl ?? "", unilateral: e?.unilateral ?? false,
});
const busy = ref(false);
const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const MUSCLE_OPTS = MUSCLES.map((m) => ({ value: m, label: muscleName(m) }));
// a muscle is either main or helping: ticking it in one list takes it out of the other
function setMuscles(k: "primaryMuscles" | "secondaryMuscles", v: string[]) {
  const other = k === "primaryMuscles" ? "secondaryMuscles" : "primaryMuscles";
  f.value[k] = v; f.value[other] = f.value[other].filter((m) => !v.includes(m));
}
async function upload(ev: Event) {
  const files = (ev.target as HTMLInputElement).files;
  for (const file of Array.from(files ?? []).slice(0, 4)) {
    try { const r = await api.post("/media", file); f.value.images.push("media:" + r.id); } catch (err) { toastError(err); }
  }
}
async function save() {
  if (!f.value.name.trim()) return toast("Give it a name", { kind: "err" });
  busy.value = true;
  try {
    const body = { ...f.value, equipment: f.value.equipment || null, instructions: f.value.instructions.split("\n").map((s: string) => s.trim()).filter(Boolean) };
    let id = e?.id;
    if (e) await api.put(`/exercises/${e.id}`, body); else id = (await api.post("/exercises", body)).id;
    invalidate(["exercises", "routines", "workouts"]);
    toast(e ? "Exercise saved" : "Exercise created");
    emit("saved", id); emit("close");
  } catch (err) { toastError(err); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="e ? 'Edit exercise' : 'New exercise'" size="wide" @close="emit('close')">
    <div class="fld"><label>Name</label><input v-model="f.name" placeholder="e.g. Landmine press" /></div>
    <div class="fld"><label>Track it by</label><AppSelect v-model="f.tracking" :options="Object.entries(TRACK).map(([value, label]) => ({ value, label }))" title="Track it by" /></div>
    <div class="frow">
      <div class="fld"><label>Category</label><AppSelect v-model="f.category" :options="CATEGORIES.map((c) => ({ value: c, label: categoryName(c) }))" title="Category" /></div>
      <div class="fld"><label>Equipment</label><AppSelect v-model="f.equipment" :options="[{ value: '', label: 'None' }, ...EQUIPMENT.map((q) => ({ value: q, label: cap(q) }))]" title="Equipment" /></div>
    </div>
    <div class="fld"><label>Main muscles</label><ChoiceTiles :model-value="f.primaryMuscles" :options="MUSCLE_OPTS" multiple compact label="Main muscles" @update:model-value="(v) => setMuscles('primaryMuscles', v)" /></div>
    <div class="fld"><label>Also works</label><ChoiceTiles :model-value="f.secondaryMuscles" :options="MUSCLE_OPTS" multiple compact label="Also works" @update:model-value="(v) => setMuscles('secondaryMuscles', v)" /></div>
    <div class="fld"><label>How to do it (one step per line)</label><textarea v-model="f.instructions" rows="4" /></div>
    <div class="fld"><label>Photos</label>
      <div class="row wrap">
        <div v-for="(im, i) in f.images" :key="im" class="thumb lg" style="position:relative"><img :src="mediaUrl(im)" alt="" /><button class="ib sm" style="position:absolute;top:-8px;right:-8px;width:26px;height:26px" aria-label="Remove" @click="f.images.splice(i, 1)"><Icon name="close" :size="14" /></button></div>
        <label class="thumb lg click" title="Add a photo or GIF"><Icon name="camera" /><input type="file" accept="image/*,video/mp4" multiple hidden @change="upload" /></label>
      </div>
    </div>
    <div class="fld"><label>Video link (optional)</label><input v-model="f.videoUrl" placeholder="https://…" /></div>
    <label v-if="sidesOn" class="tgl"><div class="grow"><div class="t">One side at a time</div><div class="s">Single-arm or single-leg: {{ SIDES_HINT.toLowerCase() }}</div></div><span class="tg"><input v-model="f.unilateral" type="checkbox" /></span></label>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>
