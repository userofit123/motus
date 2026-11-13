<script lang="ts">
import { GROUPS } from "@motus/shared";

export interface MuscleGroup { id: string; name: string; muscles: string[] }
/** The muscles a filter value stands for: a group's muscles, or one muscle picked on the body. */
export function musclesOf(v: string, groups: MuscleGroup[] = GROUPS): string[] {
  if (!v) return [];
  return groups.find((g) => g.id === v)?.muscles ?? [v];
}
/** The filter value for one muscle: a group that is only this muscle (Core is the abdominals) stands for it, so picking it
 *  on the body lights that group's chip instead of adding a second chip that filters the same. */
export function valueOf(m: string, groups: MuscleGroup[] = GROUPS): string {
  return groups.find((g) => g.muscles.length === 1 && g.muscles[0] === m)?.id ?? m;
}
</script>

<script setup lang="ts">
// The "Muscle group" row of an exercise list's filters: the body (front and back) with the chips (in a grid beside it on desktop,
// in one sideways row under it on phones): tap a muscle to show only exercises that work it as a main muscle, tap it again to clear.
// Groups and muscles share one value, so a group chip lights its muscles on the body, and a muscle picked on the body that is no
// chip of its own (lats, calves) gets a chip right after its group's, to show what is set and to clear it like any other.
// On phones the body is as big as the card allows so small muscles can be hit, which leaves no room for the list: so it folds
// (shut until the user opens it, then remembered per place: the page and the picker), hides while a name is searched, and after
// a pick the results are scrolled up. The fold button shows a tiny copy of the body (what is picked lit) beside its chevron,
// so a shut fold still says what is set.
import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import { groupOf, muscleName } from "@motus/shared";
import FilterRow from "./FilterRow.vue";
import BodyMap from "./BodyMap.vue";
import { isPhone } from "../core/device";
import { readJson, writeJson } from "../core/prefs";

// search: the searched text; the body hides while it is set
const props = defineProps<{ modelValue: string; groups: MuscleGroup[]; place: "page" | "picker"; search?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();
const FOLD_KEY = "motusMuscleBody";
const folds = readJson<{ page?: boolean; picker?: boolean }>(FOLD_KEY, {});
const bodyOpen = ref(folds[props.place] ?? false);
function setOpen(v: boolean) {
  bodyOpen.value = v;
  writeJson(FOLD_KEY, { ...readJson(FOLD_KEY, {}), [props.place]: v });
}
const searching = computed(() => !!props.search);
// outside a search the fold button shows (and a tap changes) the saved fold; while searching the body is hidden unless peeked, and a
// tap on it only shows or hides it for this search (until the text changes), never touching the saved fold
const peek = ref(false);
watch(() => props.search, () => (peek.value = false));
const shown = computed(() => (searching.value ? peek.value : bodyOpen.value));
function toggle() {
  if (searching.value) peek.value = !peek.value;
  else setOpen(!bodyOpen.value);
}
const chosen = computed(() => musclesOf(props.modelValue, props.groups));
const options = computed(() => {
  const opts = props.groups.map((g) => ({ value: g.id, label: g.name }));
  const v = props.modelValue;
  if (!v || props.groups.some((g) => g.id === v)) return opts;
  // after the last chip inside the muscle's own group (Arms, Biceps, Triceps, then Forearms)
  const home = GROUPS.find((g) => g.id === groupOf(v))?.muscles ?? [];
  const at = props.groups.reduce((i, g, j) => (g.muscles.every((m) => home.includes(m)) ? j : i), opts.length - 1);
  opts.splice(at + 1, 0, { value: v, label: muscleName(v) });
  return opts;
});
const caption = computed(() => {
  const v = props.modelValue;
  return !v ? "Tap a muscle to filter" : props.groups.find((g) => g.id === v)?.name ?? muscleName(v);
});
// pressed only where a tap would clear: with a group chosen its muscles are lit, but tapping one narrows to it rather than
// clearing, so they are not "pressed" (a group of one muscle is that muscle, so it is)
const pressed = computed(() => chosen.value.filter((m) => valueOf(m, props.groups) === props.modelValue));
const self = getCurrentInstance();
// on a phone the open body fills the screen: once something is picked, bring the count line up so the results show
// (only when fewer than about two rows of them are in view; clearing to All stays put)
async function set(v: string) {
  emit("update:modelValue", v);
  if (!v || !isPhone.value || !shown.value) return;
  await nextTick();
  const foot = (self?.proxy?.$el as HTMLElement | undefined)?.closest(".fpanel")?.querySelector<HTMLElement>(".ffoot");
  if (!foot) return;
  // the bottom of what is in view: the sheet's body in the picker, the top of the phone's tab bar on a page (measured, as the
  // bar is --tabh plus the safe area --sb, an env() value that reads back unresolved from CSS)
  const sheet = foot.closest(".sh_b")?.getBoundingClientRect().bottom;
  const bottom = sheet ?? document.querySelector(".tabbar")?.getBoundingClientRect().top ?? innerHeight;
  if (foot.getBoundingClientRect().top > bottom - 140)
    foot.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
const tap = (m: string) => {
  const v = valueOf(m, props.groups);
  void set(props.modelValue === v ? "" : v);
};
</script>

<template>
  <FilterRow :model-value="modelValue" label="Muscle group" all="All" :options="options" :fold="isPhone" :open="searching ? shown : bodyOpen" :shown="shown"
    @update:model-value="set" @update:open="toggle">
    <template #foldicon><BodyMap class="ffig" aria-hidden="true" :values="{}" :highlight="chosen" :height="22" /></template>
    <template #aside>
      <div class="mfig">
        <BodyMap pickable :values="{}" :highlight="chosen" :pressed="pressed" :height="isPhone ? undefined : 230" @pick="tap" />
        <span class="tiny" :class="{ on: !!modelValue }">{{ caption }}</span>
      </div>
    </template>
  </FilterRow>
</template>

<style scoped>
/* an inner tile in --s2 on the panel's --s1 card (the app's usual tile-in-card shade) at the row's left edge, the body
   centred in it with what is picked (or the hint) under it; on desktop it keeps its width whatever the caption says, so picking a
   muscle never shifts the chips and it stretches to their height; on phones it is the full row above the chips */
.mfig { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--tdy); padding: var(--cpy) var(--cpx); border-radius: var(--r-md); background: var(--s2); }
html:not(.phone) .mfig { flex: none; }
/* on phones the bodies take the tile's whole width, up to 300px tall (two 80 x 194 bodies and their 4px gap) */
html.phone .mfig { padding: var(--cpy) 0; container-type: inline-size; }
html.phone .mfig :deep(.figs) { height: min(300px, calc((100cqi - 4px) * 194 / 160)); }
.mfig .tiny { width: 0; min-width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfig .on { color: var(--tx); font-weight: 600; }
/* the fold button's tiny body only shows: the whole row stays the fold button, no muscle tooltips; picked lit in the accent as on the big one */
.ffig { pointer-events: none; }
.ffig :deep(.figs) { gap: 1px; }
.ffig :deep([data-t="1"] .m) { fill: var(--acc); }
</style>
