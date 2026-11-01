<script setup lang="ts">
// Quick body weight (and, with Body measurements on, any measurement).
import { ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { useFmt, localYmd } from "../core/format";
import { useSettings } from "../api/queries";
import { toCm } from "@motus/shared";
import Sheet from "../components/Sheet.vue";

const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const s = useSettings();
const KINDS: [string, string][] = [["weight", "Body weight"], ["body_fat", "Body fat %"], ["waist", "Waist"], ["chest", "Chest"], ["arm", "Arm"], ["thigh", "Thigh"], ["hips", "Hips"], ["neck", "Neck"]];
const kind = ref("weight"), value = ref<number | null>(null), date = ref(localYmd(new Date())), busy = ref(false);
const unit = () => (kind.value === "weight" ? fmt.value.wu : kind.value === "body_fat" ? "%" : s.value.units.length);
async function save() {
  if (value.value == null) return;
  busy.value = true;
  try {
    const v = kind.value === "weight" ? fmt.value.toKg(value.value) : kind.value === "body_fat" ? value.value : toCm(value.value, s.value.units.length);
    await api.post("/body", { kind: kind.value, value: v, measuredAt: new Date(date.value + "T" + new Date().toTimeString().slice(0, 8)).toISOString() });
    invalidate(["body", "stats", "goals", "home"]);
    toast("Saved");
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet title="Log body" @close="emit('close')">
    <div v-if="s.features.measurements" class="chips" style="margin-bottom:12px"><button v-for="[k, l] in KINDS" :key="k" class="fchip" :class="{ on: kind === k }" @click="kind = k">{{ l }}</button></div>
    <div class="frow"><div class="fld"><label>{{ KINDS.find((x) => x[0] === kind)?.[1] }} ({{ unit() }})</label><input v-model.number="value" type="number" inputmode="decimal" step="0.1" autofocus @keydown.enter="save" /></div>
      <div class="fld"><label>Day</label><input v-model="date" type="date" /></div></div>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy || value == null" @click="save">Save</button></template>
  </Sheet>
</template>
