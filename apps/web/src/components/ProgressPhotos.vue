<script setup lang="ts">
// Progress photos (optional feature): private photos kept with your body log, compared side by side. Shown on Body → Photos.
import { computed, ref } from "vue";
import { useBody } from "../api/queries";
import { api, mediaUrl } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { toast, toastError } from "../core/toast";
import { confirm } from "../core/ask";
import Icon from "./Icon.vue";

const body = useBody("photo");
const fmt = useFmt();
const photos = computed(() => (body.data.value ?? []) as any[]);
const pick = ref<string[]>([]);
async function add(ev: Event) {
  let added = 0;
  for (const f of Array.from((ev.target as HTMLInputElement).files ?? [])) {
    try {
      const r = await api.post("/media", f);
      await api.post("/body", { kind: "photo", value: 0, note: r.id.startsWith("data:") ? r.id : "media:" + r.id, measuredAt: new Date(f.lastModified || Date.now()).toISOString() });
      added++;
    } catch (e) { toastError(e); }
  }
  invalidate(["body"]);
  if (added) toast(added === 1 ? "Photo added" : `${added} photos added`);
}
const toggle = (id: string) => { const i = pick.value.indexOf(id); if (i >= 0) pick.value.splice(i, 1); else { pick.value.push(id); if (pick.value.length > 2) pick.value.shift(); } };
const chosen = computed(() => photos.value.filter((p) => pick.value.includes(p.id)).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)));
// a long-press is easy to do by accident, so it asks first
async function del(id: string) { if (!(await confirm("Delete this photo?", { ok: "Delete", danger: true }))) return; await api.del(`/body/${id}`); invalidate(["body"]); pick.value = pick.value.filter((x) => x !== id); toast("Photo deleted"); }
</script>

<template>
  <div class="card">
    <div class="row hgap"><b class="grow">Progress photos</b><label class="btn tonal s" style="cursor:pointer"><Icon name="camera" :size="16" />Add<input type="file" accept="image/*" multiple hidden @change="add" /></label></div>
    <div v-if="chosen.length === 2" class="grid g2" style="margin-bottom:12px">
      <div v-for="p in chosen" :key="p.id"><img :src="mediaUrl(p.note)" style="width:100%;border-radius:var(--r-md);aspect-ratio:3/4;object-fit:cover" alt="" /><div class="tiny center" style="margin-top:4px">{{ fmt.date(p.measuredAt, { day: "numeric", month: "short", year: "numeric" }) }}</div></div>
    </div>
    <div v-if="!photos.length" class="tiny">Only you can see them. Tap two to compare.</div>
    <div class="row wrap" style="gap:8px">
      <div v-for="p in photos" :key="p.id" class="thumb lg click" :style="pick.includes(p.id) ? { outline: '2px solid var(--acc)' } : undefined" style="position:relative" @click="toggle(p.id)" @contextmenu.prevent="del(p.id)">
        <img :src="mediaUrl(p.note)" alt="" loading="lazy" />
      </div>
    </div>
    <p v-if="photos.length" class="tiny" style="margin-top:8px">Tap two photos to compare them. Right-click or long-press to delete.</p>
  </div>
</template>
