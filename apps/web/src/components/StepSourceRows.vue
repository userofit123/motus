<script setup lang="ts">
// The rows of a "Where these steps came from" sheet: each app that saved steps to Health Connect (the worn device first,
// then the rest by count), which one Motus uses, and under them, set apart by a line, the number they are weighed
// against (Health Connect's total for a day, the count Motus kept for an activity). One look for both sheets.
import { useFmt } from "../core/format";
import { sourceName, type StepSource } from "../native/health";
import Icon from "./Icon.vue";

const props = defineProps<{
  sources: StepSource[]; phoneName?: string; used: string | null;
  total: { icon: string; label: string; sub: string; value: number | null; used: boolean };
}>();
const fmt = useFmt();
// the kind the source's records name ("chest strap" from an older build); a band app that names none (Gadgetbridge often)
const WORN_NAMES: Record<string, string> = { watch: "the watch", band: "the band", ring: "the ring", "chest strap": "the chest strap", chestStrap: "the chest strap" };
const srcSub = (s: StepSource) => s.band ? `Counted by ${WORN_NAMES[s.device] ?? "the device you wear"}` : s.phone ? "Counted by the phone" : "Another app";
const srcIcon = (s: StepSource) => (s.band ? "activity" : s.phone ? "device" : "link");
const list = () => [...props.sources].sort((a, b) => Number(b.band) - Number(a.band) || b.steps - a.steps);
</script>

<template>
  <div class="list">
    <div v-for="src in list()" :key="src.app + (src.band ? ':band' : '')" class="li">
      <span class="bi sg"><Icon :name="srcIcon(src)" :size="16" /></span>
      <div class="grow"><div class="t">{{ sourceName(src, phoneName) }}<span v-if="used === src.app && src.band" class="mchip hi-chip">Used</span></div><div class="s">{{ srcSub(src) }}</div></div>
      <b class="num">{{ fmt.num(src.steps, 0) }}</b>
    </div>
  </div>
  <div class="li hc-tot">
    <span class="bi sg"><Icon :name="total.icon" :size="16" /></span>
    <div class="grow"><div class="t">{{ total.label }}<span v-if="total.used" class="mchip hi-chip">Used</span></div><div class="s">{{ total.sub }}</div></div>
    <b class="num">{{ total.value == null ? "-" : fmt.num(total.value, 0) }}</b>
  </div>
</template>

<style scoped>
.hi-chip { margin-inline-start: 6px; }
.hc-tot { margin-top: var(--tdy); border-top: 1px solid var(--ol); border-bottom: 0; }
</style>
