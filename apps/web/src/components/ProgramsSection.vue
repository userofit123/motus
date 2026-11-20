<script setup lang="ts">
// Programs (optional feature): weeks of routines done in order, with deload weeks. Each card says where you are and opens the program's page.
import { ref } from "vue";
import { useRouter } from "vue-router";
import { usePrograms } from "../api/queries";
import type { Program } from "@motus/shared";
import { useFmt } from "../core/format";
import { useProgramMenu } from "../core/programMenu";
import Icon from "./Icon.vue";
import MuscleFig from "./MuscleFig.vue";
import Menu from "./Menu.vue";
import ProgramEditor from "./ProgramEditor.vue";

const router = useRouter();
const programs = usePrograms();
const edit = ref<Program | null | undefined>(undefined); // undefined: closed; null: a new one
const pm = useProgramMenu();
const start = (p: Program) => router.push(`/routines/${p.state.next!.routineId}/start?program=${p.id}${p.state.next!.deload ? `&deload=${p.deloadPct}` : ""}`);
const fmt = useFmt();
/** "Week 2 of 6 · Next: Push A"; before a start date still to come "Starts Mon 23 Nov · Next: Push A", and with no date
 *  before its first workout "Starts with Push A" (short, so the workout's name fits at phone width), as Home says it
 *  (the program's page adds its length and end) */
const where = (p: Program) => {
  if (!p.state.total) return "No routines yet";
  if (p.state.finished) return `All ${p.weeks.length} weeks done`;
  const n = p.state.next!, name = `${n.name}${n.deload ? " (deload)" : ""}`;
  if (!p.startsOn) return `Starts with ${name}`;
  return `${p.calendarWeek === 0 ? `Starts ${fmt.value.day(p.startsOn)}` : `Week ${n.week} of ${p.weeks.length}`} · Next: ${name}`;
};
// the Routines page's Programs tab puts "New program" in its header, so it opens the editor from there
defineExpose({ create: () => (edit.value = null) });
</script>

<template>
  <section>
    <div v-if="programs.data.value && !programs.data.value.length" class="card empty">
      <Icon name="layers" :size="34" /><b>No programs yet</b>A program puts routines in order over weeks (e.g. A, B, A then B, A, B), with lighter deload weeks to recover. Motus then tells you what's next and how you're keeping up.
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="edit = null">Create one</button></div>
    </div>
    <div class="grid gauto">
      <div v-for="p in programs.data.value ?? []" :key="p.id" class="card click wbody" @click="router.push(`/programs/${p.id}`)">
        <!-- every muscle the program's routines work, on the left like the routine cards -->
        <MuscleFig :routine="p.weeks.flatMap((w) => w.days)" />
        <div class="grow" style="min-width:0">
        <div class="row"><b class="grow">{{ p.name }}</b><span @click.stop><Menu :items="pm.items(p, { edit: () => (edit = p) })" /></span></div>
        <div class="tiny">{{ p.state.done }} of {{ p.state.total }} workouts done{{ p.active || p.state.finished ? "" : " · paused" }}</div>
        <div class="pbar" style="margin:10px 0"><i :style="{ width: (p.state.total ? p.state.done / p.state.total : 0) * 100 + '%' }" /></div>
        <div class="row"><div class="grow ellipsis" :class="{ pos: p.state.finished, muted: !p.active && !p.state.finished }" style="font-weight:600">{{ where(p) }}</div>
          <button v-if="p.active && p.state.next" class="btn o s" @click.stop="start(p)"><Icon name="play" :size="14" />Start</button></div>
        </div>
      </div>
    </div>
    <ProgramEditor v-if="edit !== undefined" :program="edit" @close="edit = undefined" @saved="(id) => !edit && router.push(`/programs/${id}`)" />
  </section>
</template>

