<script setup lang="ts">
// The one search box (magnifier inside the field, on the left). Every search in the app uses it, so how the icon sits
// on the field is decided once in app.css (.search): page-specific copies are how the Glass blur kept covering the icon.
// Classes, styles and listeners such as @input go to the wrapper; input events bubble up to it.
import { ref } from "vue";
import Icon from "./Icon.vue";

const q = defineModel<string>({ required: true });
defineProps<{ placeholder: string; autofocus?: boolean }>();
const inp = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => inp.value?.focus() });
</script>

<template>
  <div class="search"><Icon name="search" :size="18" /><input ref="inp" v-model="q" :placeholder="placeholder" :aria-label="placeholder" enterkeyhint="search" :autofocus="autofocus" /></div>
</template>
