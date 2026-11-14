<script setup lang="ts">
// A line of parts joined by dots ("3 sets of 8 · 47.5 kg · 5 on each side") that wraps between whole parts on a narrow
// screen with no dot at the start or end of any line. Each part carries its dot (its own element, spaced by the row's
// gap) on the side facing the part before it, and the row reaches one dot and gap past the box's edge, so the dot that
// would open a line (or, right-aligned with `end`, close it) falls outside the box and is clipped. Styles in app.css.
defineProps<{ parts: (string | { text: string; cls?: string })[]; end?: boolean }>();
</script>

<template>
  <span class="dotl" :class="{ end }"><span class="dotl-in"><span v-for="(p, i) in parts" :key="i" class="dotl-p" :class="typeof p === 'string' ? undefined : p.cls"><span v-if="!end" class="sep" aria-hidden="true">·</span><span>{{ typeof p === "string" ? p : p.text }}</span><span v-if="end" class="sep" aria-hidden="true">·</span></span></span></span>
</template>
