<script setup lang="ts">
// The app mark: the dumbbell of the app icon (public/icon.svg) on a tile in the user's accent colour, so it follows the chosen theme (the launcher icon stays fixed). Clicking it on the rail picks a random look, as in Money Manager.
import { ref } from "vue";
import { shuffle as doShuffle } from "../core/theme";
const props = defineProps<{ shuffle?: boolean }>();
const el = ref<HTMLElement | null>(null);
const shake = ref(false);
// Money Manager's wobble: restart the class each click so repeated clicks shake again.
const click = () => {
  if (!props.shuffle) return;
  shake.value = false;
  requestAnimationFrame(() => { shake.value = true; setTimeout(() => (shake.value = false), 520); });
  doShuffle(el.value);
};
</script>

<template>
  <div ref="el" class="logo" :class="{ click: shuffle, shake }" :title="shuffle ? 'Surprise me with a new look' : undefined" @click="click">
    <svg viewBox="0 0 512 512" aria-hidden="true"><g transform="translate(256 250) rotate(-45) scale(.98)"><rect x="-184" y="-19" width="368" height="38" rx="19"/><rect x="-128" y="-108" width="56" height="216" rx="18"/><rect x="72" y="-108" width="56" height="216" rx="18"/><rect x="-170" y="-74" width="50" height="148" rx="16"/><rect x="120" y="-74" width="50" height="148" rx="16"/><rect class="hl" x="-116" y="-88" width="10" height="72" rx="5"/><rect class="hl" x="84" y="-88" width="10" height="72" rx="5"/></g></svg>
  </div>
</template>
