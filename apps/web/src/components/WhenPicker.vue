<script setup lang="ts">
// Which day something is planned for: Today and Tomorrow in one tap, any other day from the calendar. Only picks the day;
// the form it sits in saves. Used by every form that plans a day (a schedule, a program's start). none: the label of a
// fourth choice for no day at all (the value is then ""), for a day that may be left open.
import { computed, nextTick, ref } from "vue";
import { localYmd } from "../core/format";
import DatePicker from "./DatePicker.vue";

const props = defineProps<{ modelValue: string; title?: string; none?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return localYmd(d); };
const today = plus(0), tomorrow = plus(1);
// "Pick a date" stays chosen once tapped, even if the calendar then lands on today
const other = ref(!!props.modelValue && props.modelValue !== today && props.modelValue !== tomorrow);
const which = computed(() => (other.value ? "other" : props.none && !props.modelValue ? "none" : props.modelValue === today ? "today" : props.modelValue === tomorrow ? "tomorrow" : "other"));
const dp = ref<InstanceType<typeof DatePicker> | null>(null);
function set(d: string) { other.value = false; emit("update:modelValue", d); }
async function pickOther() { other.value = true; await nextTick(); dp.value?.show(); }
</script>

<template>
  <div class="seg block" :class="{ four: none }" role="radiogroup" :aria-label="title ?? 'When'">
    <button type="button" role="radio" :aria-checked="which === 'today'" :class="{ on: which === 'today' }" @click="set(today)">Today</button>
    <button type="button" role="radio" :aria-checked="which === 'tomorrow'" :class="{ on: which === 'tomorrow' }" @click="set(tomorrow)">Tomorrow</button>
    <button type="button" role="radio" :aria-checked="which === 'other'" :class="{ on: which === 'other' }" @click="pickOther">Pick a date</button>
    <button v-if="none" type="button" role="radio" :aria-checked="which === 'none'" :class="{ on: which === 'none' }" @click="set('')">{{ none }}</button>
  </div>
  <DatePicker v-if="which === 'other'" ref="dp" :model-value="modelValue" :title="title ?? 'Choose a day'" @update:model-value="(v: string) => v && emit('update:modelValue', v)" />
</template>

<style scoped>
/* four choices still fit one row on a phone (360px): the same pills, a little less room around each label */
.seg.four button { padding-inline: 6px; }
</style>
