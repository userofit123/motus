<script setup lang="ts">
// A sheet: a bottom sheet on the phone, a centred window on a computer. Closes with Esc or a tap outside.
import { onMounted, onBeforeUnmount, ref } from "vue";
import Icon from "./Icon.vue";

const props = defineProps<{ title?: string; size?: "wide" | "full"; noClose?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !props.noClose) { e.stopPropagation(); emit("close"); } };
onMounted(() => { addEventListener("keydown", key); document.body.style.overflow = "hidden"; });
const root = ref<HTMLElement | null>(null);
// However a sheet is closed (its own buttons or the page), a copy of it plays the closing animation for a moment.
onBeforeUnmount(() => {
  removeEventListener("keydown", key); document.body.style.overflow = "";
  const el = root.value;
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add("leaving"); ghost.setAttribute("aria-hidden", "true"); ghost.style.pointerEvents = "none";
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 240);
});
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="scr" @mousedown.self="!noClose && emit('close')">
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
