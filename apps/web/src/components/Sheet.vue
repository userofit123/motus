<script setup lang="ts">
// A sheet: a bottom sheet on the phone, a centred window on a computer. Closes with Esc, Back, a tap outside,
// or on the phone by pulling it down (from anywhere on it, unless its content is scrolled down).
import { onMounted, onBeforeUnmount, ref } from "vue";
import { isPhone } from "../core/device";
import { sheetOpened, sheetClosed } from "../core/sheets";
import Icon from "./Icon.vue";

// noHistory: no Back step of its own (see core/leave.ts)
const props = defineProps<{ title?: string; size?: "wide" | "full"; noClose?: boolean; noHistory?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !props.noClose) { e.stopPropagation(); emit("close"); } };
const root = ref<HTMLElement | null>(null), sheet = ref<HTMLElement | null>(null);
let backId = 0, pulledAway = false;
onMounted(() => {
  addEventListener("keydown", key); document.body.style.overflow = "hidden";
  if (!props.noClose && !props.noHistory) backId = sheetOpened(() => emit("close"));
  if (isPhone.value && !props.noClose) {
    sheet.value!.addEventListener("touchstart", tstart, { passive: true });
    sheet.value!.addEventListener("touchmove", tmove, { passive: false });
    sheet.value!.addEventListener("touchend", tend);
    sheet.value!.addEventListener("touchcancel", tend);
  }
});
// However a sheet is closed (its own buttons or the page), a copy of it plays the closing animation for a moment.
onBeforeUnmount(() => {
  removeEventListener("keydown", key); document.body.style.overflow = "";
  if (backId) sheetClosed(backId);
  const el = root.value;
  if (!el || pulledAway || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add("leaving"); ghost.setAttribute("aria-hidden", "true"); ghost.style.pointerEvents = "none";
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 240);
});

// pulling down: decided on the first few pixels; a pull only starts when whatever is under the finger is scrolled to the top
let x0 = 0, y0 = 0, t0 = 0, dy = 0, mode: "" | "pull" | "no" = "", scroller: HTMLElement | null = null;
function scrollParent(t: EventTarget | null) {
  for (let el = t as HTMLElement | null; el && el !== sheet.value; el = el.parentElement) {
    const o = getComputedStyle(el).overflowY;
    if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}
function tstart(e: TouchEvent) {
  const t = e.touches[0]!;
  x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); dy = 0;
  mode = e.touches.length > 1 || (e.target as HTMLElement).closest("input[type=range], textarea, .leaflet-container, [data-nopull]") ? "no" : "";
  scroller = scrollParent(e.target);
}
function tmove(e: TouchEvent) {
  if (mode === "no") return;
  const t = e.touches[0]!, dx = t.clientX - x0, d = t.clientY - y0;
  if (!mode) {
    if (Math.abs(d) < 8 && Math.abs(dx) < 8) return;
    if (d <= 0 || Math.abs(dx) > Math.abs(d) || (scroller && scroller.scrollTop > 0)) { mode = "no"; return; }
    mode = "pull"; y0 = t.clientY;
    sheet.value!.style.transition = "none";
  }
  e.preventDefault();
  dy = Math.max(0, t.clientY - y0);
  sheet.value!.style.transform = `translateY(${dy}px)`;
  root.value!.style.backgroundColor = `color-mix(in srgb, var(--scrim) ${Math.max(0, 100 - (dy / sheet.value!.offsetHeight) * 100)}%, transparent)`;
}
function tend() {
  if (mode !== "pull") { mode = ""; return; }
  mode = "";
  const s = sheet.value!, fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
  s.style.transition = "transform .22s var(--ease)";
  root.value!.style.transition = "background-color .22s";
  if (dy > Math.min(140, s.offsetHeight / 3) || fast) {
    pulledAway = true;
    s.style.transform = "translateY(100%)";
    root.value!.style.backgroundColor = "transparent";
    setTimeout(() => emit("close"), 200);
  } else {
    s.style.transform = "";
    root.value!.style.backgroundColor = "";
  }
}
</script>

<template>
  <Teleport to="body">
    <div ref="root" class="scr" @mousedown.self="!noClose && emit('close')">
      <div ref="sheet" class="sht" :class="size" role="dialog" :aria-label="title">
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
