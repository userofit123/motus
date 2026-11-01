<script setup lang="ts">
// The app mark: a rising line on the accent gradient. Clicking it on the rail picks a random look, as in Money Manager.
import { ref } from "vue";
import { shuffle as doShuffle } from "../core/theme";
const props = defineProps<{ shuffle?: boolean }>();
const el = ref<HTMLElement | null>(null);
const click = () => { if (props.shuffle) doShuffle(el.value); };
</script>

<template>
  <div ref="el" class="logo" :class="{ click: shuffle }" :title="shuffle ? 'Surprise me with a new look' : undefined" @click="click">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16c2-5.5 4-8 5.5-8s2 4.2 3.2 4.2S14.8 9.5 20 6" /></svg>
  </div>
</template>
