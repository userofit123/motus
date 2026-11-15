<script setup lang="ts">
// A line of parts joined by dots ("3 sets of 8 · 47.5 kg · 5 on each side") that wraps between whole parts on a narrow
// screen with no dot at the start or end of any line. Each part carries its dot (its own element, spaced by the row's
// gap) on the side facing the part before it, and the row reaches one dot and gap past the box's edge, so the dot that
// would open a line (or, right-aligned with `end`, close it) falls outside the box and is clipped. Styles in app.css.
// A part's cls styles the whole part; lead is plain words before its text and tcls styles only the text ("now" +2.1 kg);
// icon: a small icon before the text, kept on one line with it (a heart before "112 bpm").
import Icon from "./Icon.vue";
type Part = string | { text: string; cls?: string; lead?: string; tcls?: string; icon?: string };
defineProps<{ parts: Part[]; end?: boolean }>();
</script>

<template>
  <span class="dotl" :class="{ end }"><span class="dotl-in"><span v-for="(p, i) in parts" :key="i" class="dotl-p" :class="typeof p === 'string' ? undefined : p.cls"><span v-if="!end" class="sep" aria-hidden="true">·</span><span v-if="typeof p === 'string'">{{ p }}</span><span v-else :class="{ 'dotl-ic': p.icon }"><template v-if="p.lead">{{ p.lead + " " }}</template><Icon v-if="p.icon" :name="p.icon" :size="12" /><span :class="p.tcls">{{ p.text }}</span></span><span v-if="end" class="sep" aria-hidden="true">·</span></span></span></span>
</template>
