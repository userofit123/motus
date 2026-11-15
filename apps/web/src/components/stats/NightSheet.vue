<script setup lang="ts">
// One night in full, opened from Home's and History's night: the same night as Stats → Sleep's Night view (NightView),
// in a sheet.
import { computed } from "vue";
import { useFmt } from "../../core/format";
import Sheet from "../Sheet.vue";
import NightView from "./NightView.vue";

const props = defineProps<{ date: string }>();
const emit = defineEmits<{ close: [] }>();
const fmt = useFmt();
const title = computed(() => fmt.value.date(props.date, { weekday: "long", day: "numeric", month: "long" }));
</script>

<template>
  <Sheet :title="title" @close="emit('close')"><div class="wkc"><NightView :date="date" /></div></Sheet>
</template>
