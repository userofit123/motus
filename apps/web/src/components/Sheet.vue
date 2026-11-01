<script setup lang="ts">
// A sheet: a bottom sheet on the phone, a centred window on a computer. Closes with Esc or a tap outside.
import { onMounted, onBeforeUnmount } from "vue";
import Icon from "./Icon.vue";

const props = defineProps<{ title?: string; size?: "wide" | "full"; noClose?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !props.noClose) { e.stopPropagation(); emit("close"); } };
onMounted(() => { addEventListener("keydown", key); document.body.style.overflow = "hidden"; });
onBeforeUnmount(() => { removeEventListener("keydown", key); document.body.style.overflow = ""; });
</script>

<template>
  <Teleport to="body">
    <div class="scr" @mousedown.self="!noClose && emit('close')">
      <div class="sht" :class="size" role="dialog" :aria-label="title">
        <div class="sh_h">
          <slot name="head"><b>{{ title }}</b></slot>
          <button v-if="!noClose" class="ib sm plain" aria-label="Close" @click="emit('close')"><Icon name="close" /></button>
        </div>
        <div class="sh_b"><slot /></div>
        <div v-if="$slots.foot" class="sh_f"><slot name="foot" /></div>
      </div>
    </div>
  </Teleport>
</template>
