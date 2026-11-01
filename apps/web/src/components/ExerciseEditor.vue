<script setup lang="ts">
// Your own exercise: name, how it is tracked, muscles, equipment, steps, and photos or a video link.
import { ref } from "vue";
import { MUSCLES, EQUIPMENT, CATEGORIES, muscleName } from "@motus/shared";
import { api, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import Sheet from "./Sheet.vue";
import Icon from "./Icon.vue";

const props = defineProps<{ exercise?: any; name?: string }>();
const emit = defineEmits<{ close: []; saved: [id: string] }>();
const e = props.exercise;
const f = ref({
  name: e?.name ?? props.name ?? "", tracking: e?.tracking ?? "weight_reps", category: e?.category ?? "strength", equipment: e?.equipment ?? "",
  primaryMuscles: [...(e?.primaryMuscles ?? [])] as string[], secondaryMuscles: [...(e?.secondaryMuscles ?? [])] as string[],
  instructions: (e?.instructions ?? []).join("\n"), images: [...(e?.images ?? [])] as string[], videoUrl: e?.videoUrl ?? "", unilateral: e?.unilateral ?? false,
});
const TRACK: [string, string][] = [["weight_reps", "Weight and reps"], ["bodyweight_reps", "Bodyweight reps (+ optional weight)"], ["assisted", "Assisted (weight helps)"], ["reps_only", "Reps only"],
  ["duration", "Time (holds, planks)"], ["weight_duration", "Weight and time (carries)"], ["distance_duration", "Distance and time"], ["distance_weight", "Distance and weight (sled)"]];
const busy = ref(false);
const toggle = (list: string[], m: string, other: string[]) => { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); else { list.push(m); const j = other.indexOf(m); if (j >= 0) other.splice(j, 1); } };
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
    emit("saved", id); emit("close");
  } catch (err) { toastError(err); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="e ? 'Edit exercise' : 'New exercise'" size="wide" @close="emit('close')">
    <div class="fld"><label>Name</label><input v-model="f.name" placeholder="e.g. Landmine press" /></div>
    <div class="frow">
      <div class="fld"><label>Track it by</label><select v-model="f.tracking"><option v-for="[v, l] in TRACK" :key="v" :value="v">{{ l }}</option></select></div>
      <div class="fld"><label>Equipment</label><select v-model="f.equipment"><option value="">None</option><option v-for="q in EQUIPMENT" :key="q" :value="q" style="text-transform:capitalize">{{ q }}</option></select></div>
    </div>
    <div class="fld"><label>Category</label><div class="chips"><button v-for="c in CATEGORIES" :key="c" class="fchip" :class="{ on: f.category === c }" style="text-transform:capitalize" @click="f.category = c">{{ c }}</button></div></div>
    <div class="fld"><label>Main muscles</label><div class="chips"><button v-for="m in MUSCLES" :key="m" class="fchip" :class="{ on: f.primaryMuscles.includes(m) }" @click="toggle(f.primaryMuscles, m, f.secondaryMuscles)">{{ muscleName(m) }}</button></div></div>
    <div class="fld"><label>Also works</label><div class="chips"><button v-for="m in MUSCLES" :key="m" class="fchip" :class="{ on: f.secondaryMuscles.includes(m) }" @click="toggle(f.secondaryMuscles, m, f.primaryMuscles)">{{ muscleName(m) }}</button></div></div>
    <div class="fld"><label>How to do it (one step per line)</label><textarea v-model="f.instructions" rows="4" /></div>
    <div class="fld"><label>Photos</label>
      <div class="row wrap">
        <div v-for="(im, i) in f.images" :key="im" class="thumb lg" style="position:relative"><img :src="mediaUrl(im)" alt="" /><button class="ib sm" style="position:absolute;top:-8px;right:-8px;width:26px;height:26px" aria-label="Remove" @click="f.images.splice(i, 1)"><Icon name="close" :size="14" /></button></div>
        <label class="thumb lg click" title="Add a photo or GIF"><Icon name="camera" /><input type="file" accept="image/*,video/mp4" multiple hidden @change="upload" /></label>
      </div>
    </div>
    <div class="fld"><label>Video link (optional)</label><input v-model="f.videoUrl" placeholder="https://…" /></div>
    <label class="tgl"><div class="grow"><div class="t">One side at a time</div><div class="s">Single-arm or single-leg</div></div><span class="tg"><input v-model="f.unilateral" type="checkbox" /></span></label>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy" @click="save">Save</button></template>
  </Sheet>
</template>
