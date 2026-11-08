<script setup lang="ts">
// Which day something is planned for: Today and Tomorrow in one tap, any other day from the calendar. Only picks the day;
// the form it sits in saves. Used by every form that plans a day (a schedule, a program's start).
import { computed, nextTick, ref } from "vue";
import { localYmd } from "../core/format";
import DatePicker from "./DatePicker.vue";

const props = defineProps<{ modelValue: string; title?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localYmd(d); };
const today = plus(0), tomorrow = plus(1);
// "Pick a date" stays chosen once tapped, even if the calendar then lands on today
const other = ref(props.modelValue !== today && props.modelValue !== tomorrow);
const which = computed(() => (other.value ? "other" : props.modelValue === today ? "today" : props.modelValue === tomorrow ? "tomorrow" : "other"));
const dp = ref<InstanceType<typeof DatePicker> | null>(null);
function set(d: string) { other.value = false; emit("update:modelValue", d); }
async function pickOther() { other.value = true; await nextTick(); dp.value?.show(); }
</script>

<template>
  <div class="seg block" role="radiogroup" :aria-label="title ?? 'When'">
    <button type="button" :class="{ on: which === 'today' }" @click="set(today)">Today</button>
    <button type="button" :class="{ on: which === 'tomorrow' }" @click="set(tomorrow)">Tomorrow</button>
    <button type="button" :class="{ on: which === 'other' }" @click="pickOther">Pick a date</button>
  </div>
  <DatePicker v-if="which === 'other'" ref="dp" :model-value="modelValue" :title="title ?? 'Choose a day'" @update:model-value="(v: string) => v && emit('update:modelValue', v)" />
</template>
