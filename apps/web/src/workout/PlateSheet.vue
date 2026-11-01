<script setup lang="ts">
// Which plates to load on each side of the bar for a weight.
import { computed, ref } from "vue";
import { plates } from "@motus/shared";
import { useSettings } from "../api/queries";
import { useFmt } from "../core/format";
import Sheet from "../components/Sheet.vue";

const props = defineProps<{ kg: number }>();
const emit = defineEmits<{ close: [] }>();
const s = useSettings();
const fmt = useFmt();
const target = ref(Math.round(fmt.value.fromKg(props.kg) * 100) / 100);
const bar = ref(Math.round(fmt.value.fromKg(s.value.barKg) * 100) / 100);
const res = computed(() => plates(target.value, bar.value, fmt.value.wu === "kg" ? s.value.platesKg : s.value.platesLb));
const COL = ["#e55353", "#3b7ddd", "#f0c043", "#3bb273", "#e8e8e8", "#9aa0a6", "#c9c9c9"];
</script>

<template>
  <Sheet title="Plate calculator" @close="emit('close')">
    <div class="frow"><div class="fld"><label>Weight ({{ fmt.wu }})</label><input v-model.number="target" class="in" type="number" step="0.5" /></div><div class="fld"><label>Bar ({{ fmt.wu }})</label><input v-model.number="bar" class="in" type="number" step="0.5" /></div></div>
    <div class="row" style="justify-content:center;gap:3px;margin:16px 0;height:110px;align-items:center">
      <div style="width:60px;height:10px;background:var(--tx2);border-radius:3px" />
      <div v-for="(p, i) in res.perSide" :key="i" :style="{ width: '14px', height: 40 + Math.min(60, p * (fmt.wu === 'kg' ? 2.4 : 1.2)) + 'px', background: COL[(fmt.wu === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5]).indexOf(p)] ?? 'var(--acc)', borderRadius: '3px' }" :title="String(p)" />
    </div>
    <div class="center" style="font-weight:600">Each side: {{ res.perSide.length ? res.perSide.join(" + ") : "nothing" }} {{ fmt.wu }}</div>
    <div v-if="res.leftover" class="center tiny" style="margin-top:4px">{{ res.leftover }} {{ fmt.wu }} can't be made with your plates</div>
    <p class="tiny center" style="margin-top:10px">Your bar and plates are in Settings → Workout.</p>
  </Sheet>
</template>
