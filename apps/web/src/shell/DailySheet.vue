<script setup lang="ts">
// The daily log sheet (from + and the Home card's Log): steps, sleep, water, mood for a day, with the last week below.
// Values save as they're typed, so there is no Save button, only Done.
import { computed, ref } from "vue";
import { useSettings } from "../api/queries";
import { localYmd } from "../core/format";
import Sheet from "../components/Sheet.vue";
import DatePicker from "../components/DatePicker.vue";
import DailyLog from "../components/DailyLog.vue";

const emit = defineEmits<{ close: [] }>();
const s = useSettings();
const day = ref(localYmd(new Date()));
const title = computed(() => (s.value.features.dailyLog ? "Daily log" : "Steps"));
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <div class="fld"><label>Day</label><DatePicker v-model="day" title="Day" /></div>
    <DailyLog :day="day" history />
    <template #foot><button class="btn" @click="emit('close')">Done</button></template>
  </Sheet>
</template>
