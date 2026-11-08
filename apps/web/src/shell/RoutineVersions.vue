<script setup lang="ts">
// A routine's earlier versions, opened from its ⋮ menu on the list or on its own page.
import { useQuery } from "@tanstack/vue-query";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { useFmt } from "../core/format";
import { confirm } from "../core/ask";
import { toast } from "../core/toast";
import Sheet from "../components/Sheet.vue";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const versions = useQuery({ queryKey: ["routines", "versions", props.id], queryFn: () => api.get(`/routines/${props.id}/versions`) });
async function restore(v: { id: string }) {
  if (!(await confirm("Restore this version?", { text: "The current version is kept in the history too.", ok: "Restore" }))) return;
  await api.post(`/routines/${props.id}/versions/${v.id}/restore`); invalidate(["routines"]); emit("close"); toast("Restored");
}
</script>

<template>
  <Sheet title="Earlier versions" @close="emit('close')">
    <div v-if="!versions.data.value?.length" class="tiny">Each time you save changes, the version before is kept here.</div>
    <div class="list"><div v-for="v in versions.data.value" :key="v.id" class="li"><div class="grow"><div class="t">{{ fmt.date(v.createdAt, { day: "numeric", month: "short", year: "numeric" }) }} {{ fmt.time(v.createdAt) }}</div><div class="s">{{ v.name }} · {{ v.exercises }} exercises</div></div><button class="btn o s" @click="restore(v)">Restore</button></div></div>
  </Sheet>
</template>
