<script setup lang="ts">
// The rest timer (requirement 11): a big countdown, −30/−15/+15/+30, tap the time to type an exact one, pause, skip,
// and "keep this rest" to make the change the exercise's rest from now on. Ring on a computer, bottom sheet on a phone.
import { computed } from "vue";
import { clock } from "@motus/shared";
import { rest, restLeft, restActive, adjustRest, setRest, pauseRest, resumeRest, finishRest } from "./runtime";
import { prompt } from "../core/ask";
import { useWorkout } from "./useWorkout";
import Icon from "../components/Icon.vue";

const props = defineProps<{ variant: "ring" | "sheet" }>();
const W = useWorkout();
const left = computed(() => restLeft());
const pct = computed(() => (rest.totalS ? left.value / rest.totalS : 0));
const R = 96, C = 2 * Math.PI * R;
async function exact() {
  const v = await prompt("Rest time", { value: clock(left.value), placeholder: "m:ss or seconds", ok: "Set" });
  if (!v) return;
  const m = /^(\d+):(\d{1,2})$/.exec(v.trim());
  const secs = m ? +m[1]! * 60 + +m[2]! : Number(v);
  if (Number.isFinite(secs) && secs >= 0) setRest(secs);
}
// make the adjusted time this exercise's rest for the rest of the workout
const changed = computed(() => rest.setId && Math.abs(rest.totalS - (findSet()?.restPlannedS ?? rest.totalS)) >= 1);
function findSet() { for (const e of W.state.w?.exercises ?? []) { const s = e.sets.find((x) => x.id === rest.setId); if (s) return s; } return null; }
function keep() {
  for (const e of W.state.w?.exercises ?? []) {
    const s = e.sets.find((x) => x.id === rest.setId);
    if (!s) continue;
    const last = e.sets.indexOf(s) === e.sets.length - 1;
    W.patchExercise(e, last ? { restAfterS: rest.totalS } : { restS: rest.totalS });
    for (const x of e.sets) if (!x.done) x.restPlannedS = null;
  }
}
</script>

<template>
  <Transition name="rs">
  <div v-if="restActive() || rest.done && rest.endAt">
    <div v-if="variant === 'ring'" class="card rest">
      <div class="lbl" style="justify-content:center;display:flex">{{ rest.done ? "Rest over" : rest.label }}</div>
      <div class="ringw" style="margin-top:8px">
        <svg width="210" height="210" viewBox="0 0 210 210"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--acc)" /><stop offset="1" stop-color="var(--acc2)" /></linearGradient></defs>
          <circle cx="105" cy="105" :r="R" fill="none" stroke="var(--s2)" stroke-width="10" /><circle cx="105" cy="105" :r="R" fill="none" stroke="url(#rg)" stroke-width="10" stroke-linecap="round" :stroke-dasharray="C" :stroke-dashoffset="C * (1 - pct)" style="transition:stroke-dashoffset .25s linear" /></svg>
        <div class="tv"><b @click="exact">{{ clock(left) }}</b><span>{{ rest.pausedLeftS != null ? "paused" : "of " + clock(rest.totalS) }}</span></div>
      </div>
      <div class="adj"><button class="btn o s" @click="adjustRest(-30)">−30</button><button class="btn o s" @click="adjustRest(-15)">−15</button><button class="btn o s" @click="adjustRest(15)">+15</button><button class="btn o s" @click="adjustRest(30)">+30</button></div>
      <div class="adj" style="margin-top:8px">
        <button class="qb" @click="rest.pausedLeftS != null ? resumeRest() : pauseRest()"><Icon :name="rest.pausedLeftS != null ? 'play' : 'pause'" :size="16" />{{ rest.pausedLeftS != null ? "Resume" : "Pause" }}</button>
        <button class="qb acc" @click="finishRest(true)"><Icon name="skip" :size="16" />{{ rest.done ? "Close" : "Skip" }}</button>
      </div>
      <button v-if="changed" class="qb" style="margin:6px auto 0" @click="keep">Use {{ clock(rest.totalS) }} for this exercise</button>
      <div class="next">{{ rest.next }}</div>
    </div>
    <div v-if="variant !== 'ring'" class="restsheet" role="timer">
      <div class="row">
        <div class="grow"><div class="tiny">{{ rest.done ? "Rest over" : rest.label }} · {{ rest.next }}</div><div class="big" @click="exact">{{ clock(left) }}</div></div>
        <button class="ib" :aria-label="rest.pausedLeftS != null ? 'Resume' : 'Pause'" @click="rest.pausedLeftS != null ? resumeRest() : pauseRest()"><Icon :name="rest.pausedLeftS != null ? 'play' : 'pause'" /></button>
        <button class="btn" @click="finishRest(true)">{{ rest.done ? "Close" : "Skip" }}</button>
      </div>
      <div class="restbar"><i :style="{ width: pct * 100 + '%' }" /></div>
      <div class="row" style="justify-content:space-between"><button class="btn o s" @click="adjustRest(-30)">−30</button><button class="btn o s" @click="adjustRest(-15)">−15</button><button class="btn o s" @click="adjustRest(15)">+15</button><button class="btn o s" @click="adjustRest(30)">+30</button></div>
      <button v-if="changed" class="qb" style="margin:6px auto 0;display:flex" @click="keep">Use {{ clock(rest.totalS) }} for this exercise</button>
    </div>
  </div>
  </Transition>
</template>
