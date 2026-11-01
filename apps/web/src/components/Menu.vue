<script setup lang="ts">
// The ⋮ menu: where secondary actions live, so screens stay calm (PLAN.md §10.0).
import { ref, nextTick, onBeforeUnmount } from "vue";
import Icon from "./Icon.vue";

export interface MenuItem { label: string; icon?: string; run: () => void; danger?: boolean; sep?: boolean; hidden?: boolean }
const props = defineProps<{ items: MenuItem[]; icon?: string; label?: string }>();
const open = ref(false), pos = ref({ top: 0, left: 0 }), btn = ref<HTMLElement | null>(null), el = ref<HTMLElement | null>(null);
async function toggle() {
  open.value = !open.value;
  if (!open.value) return;
  const b = btn.value!.getBoundingClientRect();
  pos.value = { top: b.bottom + 6, left: b.right };
  await nextTick();
  const m = el.value!.getBoundingClientRect();
  pos.value = { top: b.bottom + 6 + m.height > innerHeight - 8 ? Math.max(8, b.top - m.height - 6) : b.bottom + 6, left: Math.max(8, Math.min(b.right - m.width, innerWidth - m.width - 8)) };
  setTimeout(() => addEventListener("click", away, true));
}
const away = (e: Event) => { if (!el.value?.contains(e.target as Node)) { e.stopPropagation(); close(); } };
const close = () => { open.value = false; removeEventListener("click", away, true); };
const pick = (i: MenuItem) => { close(); i.run(); };
onBeforeUnmount(close);
</script>

<template>
  <button ref="btn" class="ib sm plain" :aria-label="label ?? 'More'" @click.stop="toggle"><Icon :name="icon ?? 'more'" /></button>
  <Teleport to="body">
    <div v-if="open" ref="el" class="mnu" :style="{ top: pos.top + 'px', left: pos.left + 'px' }" role="menu">
      <template v-for="(i, k) in props.items.filter((x) => !x.hidden)" :key="k">
        <hr v-if="i.sep" />
        <button :class="{ danger: i.danger }" role="menuitem" @click="pick(i)"><Icon v-if="i.icon" :name="i.icon" :size="18" />{{ i.label }}</button>
      </template>
    </div>
  </Teleport>
</template>
