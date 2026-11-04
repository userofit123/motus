<script setup lang="ts">
// The interval timer (optional feature "intervalTimer", started from the + menu): work and rest in rounds, optionally
// in sets with a longer rest between them. The timer itself runs in workout/intervals.ts, so it keeps going on other
// pages; this page sets it up and shows it big enough to read from across the room.
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { INTERVAL_STARTERS, clock, duration, intervalSummary, type IntervalConfig, type IntervalPreset, type IntervalSound, type IntervalSounds } from "@motus/shared";
import { useMe, useSettings, saveSettings } from "../api/queries";
import { goBack } from "../core/leave";
import { prompt, confirm } from "../core/ask";
import { askNotificationPermission } from "../workout/native";
import { iv, ivPhases, ivNow, ivRunning, ivDone, ivElapsedS, ivTotalS, PHASE_NAME, SOUND_NAME, playIntervalSound, setIntervalConfig, startIntervals, pauseIntervals, resumeIntervals, stopIntervals, skipInterval } from "../workout/intervals";
import AppSelect from "../components/AppSelect.vue";
import Icon from "../components/Icon.vue";
import Menu, { type MenuItem } from "../components/Menu.vue";
import NumStep from "../components/NumStep.vue";
import Ring from "../components/Ring.vue";

const router = useRouter();
const me = useMe();
const s = useSettings();
// switched off in Settings → Features: the page isn't there either (unless a timer is still running from before)
watch(() => !!me.data.value && !s.value.features.intervalTimer && iv.startedAt == null, (off) => { if (off) router.replace("/"); }, { immediate: true });

const started = computed(() => iv.startedAt != null);
const paused = computed(() => iv.pausedAt != null);
const phase = computed(() => ivPhases.value[ivNow.value.index] ?? null);
const next = computed(() => ivPhases.value[ivNow.value.index + 1] ?? null);
const leftS = computed(() => Math.ceil(ivNow.value.leftMs / 1000));
const pct = computed(() => (phase.value ? 1 - ivNow.value.leftMs / (phase.value.durS * 1000) : 1));
const where = computed(() => {
  const p = phase.value;
  if (!p) return iv.cfg.rounds === 1 ? "1 round done" : `${iv.cfg.rounds} rounds done`;
  return `Round ${p.round} of ${iv.cfg.rounds}${iv.cfg.sets > 1 ? ` · Set ${p.set} of ${iv.cfg.sets}` : ""}`;
});

// your saved setups; until you save one, the starting ones (Tabata, HIIT, every minute)
const presets = computed<IntervalPreset[]>(() => (s.value.intervals?.length ? s.value.intervals : INTERVAL_STARTERS));
const same = (a: IntervalConfig, b: IntervalConfig) => (["prepS", "workS", "restS", "rounds", "sets", "setRestS"] as const).every((k) => a[k] === b[k]);
const current = computed(() => presets.value.find((p) => p.name === iv.name && same(p, iv.cfg)) ?? null);
const set = (k: keyof IntervalConfig, v: number) => setIntervalConfig({ [k]: v }, "");
// tapping the chosen one again lets it go: the values stay, as a setup of your own; a preset without sounds of its
// own gets the usual ones, not the last preset's
const pick = (p: IntervalPreset) => (current.value?.id === p.id ? setIntervalConfig(iv.cfg, "") : setIntervalConfig({ sounds: undefined, ...p }, p.name));

const plan = computed(() => intervalSummary(iv.cfg));

// Timer settings: the sound at the start of each part (only the parts this setup has), kept with the preset
const soundOpts = (Object.keys(SOUND_NAME) as IntervalSound[]).map((value) => ({ value, label: SOUND_NAME[value] }));
// the play buttons (by each part, and by each sound in the list) only let you hear it; with sounds off they do nothing
const canPlay = (v: IntervalSound) => s.value.workout.sound && v !== "none";
const soundRows = computed(() => {
  const c = iv.cfg, rows: [keyof IntervalSounds, string][] = [];
  if (c.prepS) rows.push(["prep", PHASE_NAME.prep]);
  rows.push(["work", PHASE_NAME.work]);
  if (c.restS && c.rounds > 1) rows.push(["rest", PHASE_NAME.rest]);
  if (c.sets > 1 && c.setRestS) rows.push(["setRest", PHASE_NAME.setRest]);
  rows.push(["done", "Finish"]);
  return rows;
});
async function setSound(k: keyof IntervalSounds, v: IntervalSound) {
  const p = current.value, sounds = { ...iv.cfg.sounds, [k]: v };
  setIntervalConfig({ sounds }, iv.name);
  // a saved preset keeps the choice straight away; a starting one keeps it once saved as a preset
  if (p && s.value.intervals?.some((x) => x.id === p.id)) await saveSettings({ intervals: s.value.intervals.map((x) => (x.id === p.id ? { ...x, sounds } : x)) });
}

async function savePreset() {
  const name = (await prompt("Save as a preset", { value: iv.name || "", placeholder: "Name", ok: "Save" }))?.trim();
  if (!name) return;
  const rest = presets.value.filter((p) => p.name !== name);
  await saveSettings({ intervals: [...rest, { id: crypto.randomUUID(), name, ...iv.cfg }] });
  setIntervalConfig(iv.cfg, name);
}
async function deletePreset(p: IntervalPreset) {
  if (!(await confirm(`Delete ${p.name}?`, { ok: "Delete", danger: true }))) return;
  await saveSettings({ intervals: presets.value.filter((x) => x.id !== p.id) });
}
async function stop() {
  if (ivRunning.value && !(await confirm("Stop the timer?", { ok: "Stop", danger: true }))) return;
  stopIntervals();
}
function primary() {
  if (ivDone.value) { stopIntervals(); askNotificationPermission(); startIntervals(); }
  else if (!started.value) { askNotificationPermission(); startIntervals(); }
  else if (paused.value) resumeIntervals();
  else pauseIntervals();
}
const primaryLabel = computed(() => (ivDone.value ? "Start again" : !started.value ? "Start" : paused.value ? "Resume" : "Pause"));

// only on the setup screen; once started, Stop takes its place
const menu = computed<MenuItem[]>(() => [
  { label: `Delete ${current.value?.name ?? ""}`, icon: "trash", danger: true, hidden: !current.value || !s.value.intervals?.some((x) => x.id === current.value!.id), run: () => deletePreset(current.value!) },
]);
</script>

<template>
  <div class="page">
    <button class="back" @click="goBack(router, '/')"><Icon name="left" :size="16" /><span>Back</span></button>
    <div class="ph">
      <div><h1>{{ iv.name || "Interval timer" }}</h1><div class="sub">{{ iv.cfg.rounds }} × {{ clock(iv.cfg.workS) }} work{{ iv.cfg.restS ? ` / ${clock(iv.cfg.restS)} rest` : "" }}{{ iv.cfg.sets > 1 ? ` · ${iv.cfg.sets} sets` : "" }} · {{ duration(ivTotalS) }}</div></div>
      <div class="acts">
        <button v-if="started" class="ib" :aria-label="ivDone ? 'Change the setup' : 'Stop'" :title="ivDone ? 'Change the setup' : 'Stop'" @click="stop"><Icon :name="ivDone ? 'edit' : 'close'" /></button>
        <Menu v-else-if="menu.some((i) => !i.hidden)" :items="menu" label="Timer options" />
      </div>
    </div>

    <template v-if="!started">
      <div class="chips hgap"><button v-for="p in presets" :key="p.id" class="fchip" :class="{ on: current?.id === p.id }" :aria-pressed="current?.id === p.id" @click="pick(p)">{{ p.name }}</button></div>
      <p class="tiny plan">{{ plan }}</p>
      <div class="card flush">
        <div class="li"><div class="grow"><div class="t">Get ready</div><div class="s">Before the first round</div></div><NumStep :value="iv.cfg.prepS" :step="5" :max="600" unit="s" label="get ready seconds" @set="(v) => set('prepS', v)" /></div>
        <div class="li"><div class="grow"><div class="t">Work</div><div class="s">Each round</div></div><NumStep :value="iv.cfg.workS" :step="5" :min="5" :max="3600" unit="s" label="work seconds" @set="(v) => set('workS', v)" /></div>
        <div class="li"><div class="grow"><div class="t">Rest</div><div class="s">Between rounds</div></div><NumStep :value="iv.cfg.restS" :step="5" :max="3600" unit="s" label="rest seconds" @set="(v) => set('restS', v)" /></div>
        <div class="li"><div class="grow"><div class="t">Rounds</div><div class="s">Work and rest, repeated</div></div><NumStep :value="iv.cfg.rounds" :min="1" :max="99" label="rounds" @set="(v) => set('rounds', v)" /></div>
        <div class="li"><div class="grow"><div class="t">Sets</div><div class="s">All the rounds repeated</div></div><NumStep :value="iv.cfg.sets" :min="1" :max="20" label="sets" @set="(v) => set('sets', v)" /></div>
        <div v-if="iv.cfg.sets > 1" class="li"><div class="grow"><div class="t">Rest between sets</div><div class="s">In place of the last round's rest</div></div><NumStep :value="iv.cfg.setRestS" :step="15" :max="3600" unit="s" label="seconds between sets" @set="(v) => set('setRestS', v)" /></div>
      </div>
      <div class="row spt go">
        <button class="btn o lg" @click="savePreset"><Icon name="star" />Save as a preset</button>
        <button class="btn lg" @click="primary"><Icon name="play" />{{ primaryLabel }}</button>
      </div>
      <div class="sh"><h2>Timer settings</h2></div>
      <div class="card flush">
        <div v-for="[k, label] in soundRows" :key="k" class="li">
          <div class="grow"><div class="t">{{ label }}</div><div v-if="k === 'done'" class="s">When all rounds are done</div></div>
          <AppSelect :model-value="iv.cfg.sounds[k]" :options="soundOpts" :title="`${label} sound`" @change="(v: IntervalSound) => setSound(k, v)">
            <template #end="{ option }">
              <button v-if="option.value !== 'none'" type="button" class="ib sm plain" :disabled="!canPlay(option.value)" :aria-label="`Play ${option.label}`" :title="`Play ${option.label}`" @click.stop="playIntervalSound(option.value)"><Icon name="play" /></button>
            </template>
          </AppSelect>
          <button type="button" class="ib sm plain" :disabled="!canPlay(iv.cfg.sounds[k])" :aria-label="`Play ${SOUND_NAME[iv.cfg.sounds[k]]}`" :title="`Play ${SOUND_NAME[iv.cfg.sounds[k]]}`" @click="playIntervalSound(iv.cfg.sounds[k])"><Icon name="play" /></button>
        </div>
      </div>
      <p class="tiny plan spt">{{ s.workout.sound ? "Each sound plays when that part starts. With the app in the background, notifications use the phone's notification sound." : "Sounds are off in Settings → Workout." }}</p>
    </template>

    <div v-else class="face" :class="phase?.kind ?? 'done'">
      <div class="dial">
        <Ring :pct="pct" :size="280" :stroke="10" color="var(--ph)" />
        <div class="mid">
          <div class="pn">{{ phase ? PHASE_NAME[phase.kind] : "Done" }}</div>
          <div class="cd">{{ phase ? clock(leftS) : clock(ivTotalS) }}</div>
          <div class="wh">{{ where }}</div>
        </div>
      </div>
      <div class="foot muted">
        <span>{{ paused ? "Paused" : next ? `Next: ${PHASE_NAME[next.kind]} ${clock(next.durS)}` : phase ? "Last one" : "Well done" }}</span>
        <span class="sep">·</span>
        <span>{{ clock(Math.max(0, ivTotalS - ivElapsedS)) }} left</span>
      </div>
    </div>

    <div v-if="started" class="row spt go">
      <button v-if="ivRunning" class="ib" aria-label="Previous part" title="Previous part: restart this part, or go back one" @click="skipInterval(-1)"><Icon name="skipBack" /></button>
      <button class="btn lg" @click="primary"><Icon :name="!paused && !ivDone ? 'pause' : 'play'" />{{ primaryLabel }}</button>
      <button v-if="ivRunning" class="ib" aria-label="Next part" title="Next part" @click="skipInterval(1)"><Icon name="skip" /></button>
    </div>
  </div>
</template>

<style scoped>
/* each part has its own colour from the theme, so you can tell work from rest at a glance */
.face { --ph: var(--acc); display: flex; flex-direction: column; align-items: center; gap: var(--hg); }
.face.rest { --ph: var(--pos); }
.face.setRest { --ph: var(--warn); }
.face.prep, .face.done { --ph: var(--tx2); }
/* The running face fits the screen without scrolling: the dial gives up height for everything else on the page
   (header, the line under it, the buttons, the shell's tabs and padding, and any running-session bars). */
.dial { position: relative; width: clamp(160px, calc(100dvh - 420px - var(--st) - var(--sb) - var(--room, 0px)), 280px); max-width: 100%; aspect-ratio: 1; container-type: inline-size; }
/* set on the shell, which carries the bar count, and inherited down to the dial */
:global(.withbar) { --room: 70px; }
:global(.withbar2) { --room: 125px; }
:global(.withbar3) { --room: 180px; }
.dial :deep(.ring) { width: 100%; height: 100%; }
.mid { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.pn { color: var(--ph); font-weight: 700; font-size: var(--fs-lg); text-transform: uppercase; letter-spacing: 1px; }
.cd { font-size: clamp(40px, 30cqi, 92px); font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; color: var(--tx); }
.wh { color: var(--tx2); font-size: var(--fs-sm); }
.foot { display: flex; align-items: center; gap: var(--hg); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
.go { justify-content: center; gap: var(--hg); flex-wrap: wrap; }
.plan { margin: 0 0 var(--hg); }
.plan.spt { margin: var(--spg) 0 0; }
</style>
