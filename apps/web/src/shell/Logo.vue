<script setup lang="ts">
// The app mark: the app icon itself (public/icon.svg), so it looks the same in every theme. Clicking it on the rail picks a random look, as in Money Manager.
import { ref } from "vue";
import { shuffle as doShuffle } from "../core/theme";
const props = defineProps<{ shuffle?: boolean }>();
const el = ref<HTMLElement | null>(null);
const click = () => { if (props.shuffle) doShuffle(el.value); };
</script>

<template>
  <div ref="el" class="logo" :class="{ click: shuffle }" :title="shuffle ? 'Surprise me with a new look' : undefined" @click="click">
    <img src="/icon.svg" alt="" draggable="false" />
  </div>
</template>
