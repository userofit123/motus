<script setup lang="ts">
// Log body: weight, or (with Body measurements on) a whole tape session on one screen, since people measure
// everything at once. Opened with bodySheet = true for weight, or = a measure's id to land on that measurement.
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { api } from "../api/client";
import { invalidate } from "../api/live";
import { toast, toastError } from "../core/toast";
import { useFmt, localYmd, ago } from "../core/format";
import { useSettings, useBody } from "../api/queries";
import { bodySheet } from "../core/ui";
import { TAPE_MEASURES, bodyUnit } from "@motus/shared";
import Sheet from "../components/Sheet.vue";
import DatePicker from "../components/DatePicker.vue";

const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const s = useSettings();
const body = useBody();
const asked = typeof bodySheet.value === "string" ? bodySheet.value : "weight";
const mode = ref<"weight" | "tape">(asked !== "weight" && s.value.features.measurements ? "tape" : "weight");
const date = ref(localYmd(new Date())), busy = ref(false);
// left/right pairs share a row, one box per side
const ROWS = TAPE_MEASURES.filter((m) => m.side !== "right").map((m) => ({ key: m.pair ? m.id.slice(0, -2) : m.id, name: m.pair ?? m.name, how: m.how, ids: m.pair ? [m.id, m.id.slice(0, -1) + "r"] : [m.id] }));
const vals = reactive<Record<string, number | null>>({ weight: null });
// the newest entry per kind, shown as the hint so a new value is easy to compare
const last = computed(() => { const m = new Map<string, any>(); for (const b of body.data.value ?? []) if (!m.has(b.kind)) m.set(b.kind, b); return m; });
const unit = (k: string) => { const u = bodyUnit(k); return u === "kg" ? fmt.value.wu : u === "%" ? "%" : fmt.value.lu; };
const shown = (k: string) => { const b = last.value.get(k); if (!b) return ""; const u = bodyUnit(k); return u === "kg" ? fmt.value.w(b.value) : u === "%" ? String(Number(b.value)) : fmt.value.len(Number(b.value)); };
const store = (k: string, v: number) => { const u = bodyUnit(k); return u === "kg" ? fmt.value.toKg(v) : u === "%" ? v : fmt.value.toCm(v); };
const filled = computed(() => (mode.value === "weight" ? ["weight"] : ROWS.flatMap((r) => r.ids)).filter((k) => typeof vals[k] === "number" && !Number.isNaN(vals[k])));
const lastWeight = computed(() => last.value.get("weight"));

onMounted(async () => { await nextTick(); const el = document.getElementById(`bm-${mode.value === "weight" ? "weight" : asked.replace(/_[lr]$/, "_l")}`) as HTMLInputElement | null; el?.focus(); el?.scrollIntoView({ block: "center" }); });

async function save() {
  if (!filled.value.length) return;
  busy.value = true;
  try {
    // the day picked, at the current time of day, so several entries on one day keep their order
    const measuredAt = new Date(date.value + "T" + new Date().toTimeString().slice(0, 8)).toISOString();
    await api.post("/body", { measuredAt, entries: filled.value.map((k) => ({ kind: k, value: store(k, vals[k]!) })) });
    invalidate(["body", "stats", "goals", "home"]);
    toast(mode.value === "weight" ? "Body weight saved" : filled.value.length === 1 ? "Measurement saved" : `${filled.value.length} measurements saved`);
    emit("close");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <Sheet :title="mode === 'weight' ? 'Log body weight' : 'Log measurements'" @close="emit('close')">
    <div v-if="s.features.measurements" class="seg block hgap"><button :class="{ on: mode === 'weight' }" @click="mode = 'weight'">Weight</button><button :class="{ on: mode === 'tape' }" @click="mode = 'tape'">Measurements</button></div>
    <!-- one field under the other: the number is what matters, the day is usually today -->
    <div v-if="mode === 'weight'" class="fld"><label for="bm-weight">Body weight ({{ fmt.wu }})</label><input id="bm-weight" v-model.number="vals.weight" type="number" inputmode="decimal" step="0.1" :placeholder="shown('weight')" @keydown.enter="save" />
      <div v-if="lastWeight" class="tiny bs-hint">Last {{ shown("weight") }} {{ fmt.wu }}, {{ ago(lastWeight.measuredAt) }}</div></div>
    <div class="fld"><label>Day</label><DatePicker v-model="date" title="Day" /></div>
    <template v-if="mode === 'tape'">
      <p class="tiny hgap">Fill in the ones you measured; the grey number is your last one. Measure the same way each time so the numbers compare.</p>
      <div class="list">
        <div v-for="r in ROWS" :key="r.key" class="li bs-row">
          <div class="grow"><div class="t">{{ r.name }} <span class="tiny">({{ unit(r.ids[0]!) }})</span></div><div v-if="r.how" class="s">{{ r.how }}</div></div>
          <label v-for="k in r.ids" :key="k" class="bs-in"><span v-if="r.ids.length > 1" class="tiny">{{ k.endsWith("_l") ? "L" : "R" }}</span>
            <input :id="`bm-${k}`" v-model.number="vals[k]" type="number" inputmode="decimal" step="0.1" :placeholder="shown(k)" :aria-label="`${r.name}${r.ids.length > 1 ? (k.endsWith('_l') ? ' left' : ' right') : ''}`" @keydown.enter="save" /></label>
        </div>
      </div>
    </template>
    <template #foot><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="busy || !filled.length" @click="save">Save{{ filled.length > 1 ? ` ${filled.length}` : "" }}</button></template>
  </Sheet>
</template>

<style scoped>
.bs-hint { margin-top: 4px; }
.bs-row { gap: 8px; }
.bs-in { display: flex; align-items: center; gap: 4px; flex: none; }
.bs-in input { width: 76px; text-align: end; }
</style>
