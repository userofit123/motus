<script setup lang="ts">
// Home (requirement 9): how you're doing, what's next, what you did last, your goals. Optional cards are added by you.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { HOME_CARDS_OPTIONAL, muscleName } from "@motus/shared";
import { useHome, useSettings, saveSettings } from "../api/queries";
import { queryClient } from "../api/live";
import { useFmt, ago } from "../core/format";
import { startOpen, bodySheet, activitySheet } from "../core/ui";
import { isPhone } from "../core/device";
import Icon from "../components/Icon.vue";
import Sparkline from "../components/Sparkline.vue";
import Ring from "../components/Ring.vue";
import BodyMap from "../components/BodyMap.vue";
import Sheet from "../components/Sheet.vue";
import GoalCard from "../components/GoalCard.vue";
import ScheduleEditor from "../components/ScheduleEditor.vue";

const router = useRouter();
const home = useHome();
const s = useSettings();
const fmt = useFmt();
const h = computed<any>(() => home.data.value);
const cards = computed(() => s.value.home.cards);
const has = (c: string) => cards.value.includes(c);
const custom = ref(false);
const planOpen = ref<any>(null);
const targetOpen = ref(false);
const OPT: Record<string, string> = { volume: "Volume this week", walking: "Walking", bodyweight: "Body weight", records: "Recent records", reminders: "Reminders", feed: "Recent activity", muscles: "Sets per muscle this week", achievements: "Achievements" };
// a dismissed suggestion stays away until your next workout; the list redraws without waiting for the server
const hideSuggestion = (key: string) => {
  queryClient.setQueriesData({ queryKey: ["home"] }, (d: any) => d && { ...d, suggest: d.suggest.filter((x: any) => x.key !== key) });
  saveSettings({ home: { hidden: { [key]: new Date().toISOString() } } });
};
const toggleCard = (c: string) => saveSettings({ home: { cards: has(c) ? cards.value.filter((x) => x !== c) : [...cards.value, c] } });

const today = new Date();
const greeting = computed(() => { const hr = today.getHours(); return hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"; });
const weeks = computed<any[]>(() => h.value?.weeks ?? []);
const tw = computed(() => h.value?.thisWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
const lw = computed(() => h.value?.lastWeek ?? { workouts: 0, timeS: 0, volumeKg: 0, walkM: 0 });
// how many muscle groups were worked in the last 7 days
const groups = computed<any[]>(() => h.value?.groupDays ?? []);
const worked = computed(() => groups.value.filter((g) => g.days != null && g.days < 7).length);
const condition = computed(() => !h.value?.last ? "Nothing worked yet" : `${worked.value}/${groups.value.length} groups`);
// minutes until there is an hour's worth, then hours and minutes
const hm = (sec: number) => { const m = Math.round(sec / 60); return m < 60 ? [[m, "min"]] : m % 60 ? [[Math.floor(m / 60), "h"], [m % 60, "min"]] : [[m / 60, "h"]]; };
const lastBw = computed(() => h.value?.bodyweight?.[0]);
const bwTrend = computed(() => [...(h.value?.bodyweight ?? [])].reverse().map((x: any) => x.value));
const delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);
const start = (p: any) => router.push(`/routines/${p.routineId}/start${p.scheduleId ? `?schedule=${p.scheduleId}&date=${p.date}` : ""}`);
const dayName = (d: string) => { const t = new Date().toLocaleDateString("sv-SE"); const tm = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE"); return d === t ? "Today" : d === tm ? "Tomorrow" : fmt.value.date(d, { weekday: "long" }); };
</script>

<template>
  <div class="page">
    <div class="ph">
      <div><h1>{{ isPhone ? greeting : "Home" }}</h1><div class="sub">{{ fmt.dateLong(today.toISOString()) }}</div></div>
    </div>
    <template v-if="h">
      <!-- the four stat cards, like the screenshot's top row -->
      <div class="grid g4">
        <div class="card hero stat click" @click="targetOpen = true">
          <div class="lbl"><span class="bi"><Icon name="calendar" :size="15" /></span>This week</div>
          <div class="row" style="margin-top:8px"><div class="val" style="margin:0">{{ tw.workouts }}<small>of {{ h.weekGoal }}</small></div><Ring :pct="tw.workouts / Math.max(1, h.weekGoal)" :size="40" color="var(--onc)" style="margin-inline-start:auto" /></div>
          <div class="sub">{{ tw.workouts >= h.weekGoal ? "Weekly target reached" : `Weekly target: ${h.weekGoal} workouts` }}</div>
          <Sparkline :values="weeks.map((w) => w.workouts)" color="var(--onc)" />
        </div>
        <div class="card stat click" @click="targetOpen = true">
          <div class="lbl"><span class="bi"><Icon name="flame" :size="15" /></span>Streak</div>
          <div class="val">{{ h.streak }}<small>{{ h.streak === 1 ? "week" : "weeks" }}</small></div>
          <div class="sub">{{ h.streak ? `in a row with ${h.weekGoal}+ workouts` : `Weeks in a row with ${h.weekGoal}+ workouts` }}</div>
          <Sparkline :values="weeks.map((w) => Math.min(1, w.workouts / Math.max(1, h.weekGoal)))" />
        </div>
        <div class="card stat click" @click="router.push('/stats')">
          <div class="lbl"><span class="bi"><Icon name="clock" :size="15" /></span>Time this week</div>
          <div class="val"><template v-for="([v, u], i) in hm(tw.timeS)" :key="i">{{ i ? " " : "" }}{{ v }}<small>{{ u }}</small></template></div>
          <div class="sub">vs {{ fmt.dur(lw.timeS, true) }} last week</div>
          <Sparkline :values="weeks.map((w) => w.timeS)" />
        </div>
        <div class="card stat click" @click="router.push('/stats?tab=muscles')">
          <div class="lbl"><span class="bi"><Icon name="activity" :size="15" /></span>Muscles</div>
          <div class="cond">
            <div class="grow"><div class="ct">{{ condition }}</div><div v-if="h.last" class="sub">worked in the last 7 days</div></div>
            <BodyMap :values="h.muscles7" :height="isPhone ? 80 : 78" />
          </div>
        </div>
      </div>

      <div class="grid g2" style="margin-top:0">
        <!-- up next -->
        <section>
          <div class="sh"><h2>Up next</h2><div class="row" style="gap:14px"><button class="lnk" @click="planOpen = { rule: 'once' }"><Icon name="plus" :size="14" />Plan</button><button class="lnk" @click="router.push('/history')">Calendar <Icon name="right" :size="14" /></button></div></div>
          <div class="card">
            <div v-if="!h.upNext.length" class="empty" style="padding:18px"><b>Nothing planned</b>Plan a routine for certain days, and it shows here and in the calendar.<br /><button class="btn tonal" @click="planOpen = { rule: 'once' }">Plan a workout</button></div>
            <div v-else class="list">
              <div v-for="p in h.upNext" :key="p.scheduleId + p.date" class="li">
                <span class="dot" :style="p.color ? { background: p.color } : undefined" />
                <div class="grow"><div class="t">{{ p.name }}</div><div class="s">{{ dayName(p.date) }}{{ p.timeOfDay ? " · " + p.timeOfDay : "" }}</div></div>
                <button v-if="p.routineId" class="btn s" :class="{ o: dayName(p.date) !== 'Today' }" @click="start(p)">Start</button>
                <button v-else class="btn s o" @click="activitySheet = { type: p.activityType }">Log</button>
              </div>
            </div>
          </div>
        </section>
        <!-- suggestions: worked out from your order of routines and the muscles you've worked -->
        <section v-if="h.suggest.length">
          <div class="sh"><h2>Suggested</h2></div>
          <div class="card"><TransitionGroup name="mv" tag="div" class="list">
            <div v-for="x in h.suggest" :key="x.kind + (x.routineId ?? x.muscle)" class="li">
              <span class="bi sg"><Icon :name="x.kind === 'order' || x.kind === 'program' ? 'routines' : x.kind === 'oldest' ? 'clock' : 'activity'" :size="16" /></span>
              <div class="grow"><div class="t">{{ x.title }}</div><div class="s">{{ x.reason }}</div></div>
              <template v-if="x.routineId">
                <button class="ib sm" aria-label="Plan" title="Plan" @click="planOpen = { rule: 'once', routineId: x.routineId }"><Icon name="calendar" :size="18" /></button>
                <button class="btn s o" @click="router.push(`/routines/${x.routineId}/start`)">Start</button>
              </template>
              <button v-else class="btn s o" @click="router.push(`/exercises?muscle=${encodeURIComponent(x.muscle)}`)">Exercises</button>
              <button class="ib sm plain" aria-label="Not now" title="Not now: hide until your next workout" @click="hideSuggestion(x.key)"><Icon name="close" :size="16" /></button>
            </div>
          </TransitionGroup></div>
        </section>
        <!-- previous workout -->
        <section>
          <div class="sh"><h2>Previous workout</h2><button class="lnk" @click="router.push('/history?view=list')">All <Icon name="right" :size="14" /></button></div>
          <div v-if="h.last" class="card click" @click="router.push(`/workouts/${h.last.id}`)">
            <div class="row"><span class="dot" :style="h.last.color ? { background: h.last.color } : undefined" /><b class="grow">{{ h.last.name }}</b><span class="tiny">{{ fmt.date(h.last.startedAt, { weekday: "short", day: "numeric", month: "short" }) }}</span></div>
            <div class="grid g3 keep" style="margin-top:12px;gap:8px">
              <div><div class="lbl">Duration</div><div style="font-weight:600;font-size:18px">{{ fmt.dur(h.last.durationS, true) }}</div></div>
              <div><div class="lbl">Sets</div><div style="font-weight:600;font-size:18px">{{ h.last.setCount }}</div></div>
              <div><div class="lbl">Volume</div><div style="font-weight:600;font-size:18px">{{ fmt.vol(h.last.volumeKg) }}</div></div>
            </div>
            <div class="tiny" style="margin-top:8px">{{ h.daysSinceLast === 0 ? "Today" : h.daysSinceLast === 1 ? "Yesterday" : `${h.daysSinceLast} days ago` }}</div>
          </div>
          <div v-else class="card empty" style="padding:22px"><b>No workouts yet</b>Your last workout will show here.<br /><button class="btn tonal" @click="startOpen = true">Start one</button></div>
        </section>
      </div>

      <section v-if="has('goals')">
        <div class="sh"><h2>Goals</h2><button class="lnk" @click="router.push('/goals')">All <Icon name="right" :size="14" /></button></div>
        <div v-if="h.goals.length" class="grid g3"><GoalCard v-for="g in h.goals" :key="g.id" :goal="g" compact @click="router.push('/goals')" /></div>
        <div v-else class="card empty" style="padding:18px"><b>No goals yet</b>Set one for a lift, a routine, a muscle group, walking or your body.<br /><button class="btn tonal" @click="router.push('/goals?new=1')">Set a goal</button></div>
      </section>

      <!-- optional cards -->
      <div class="grid g2">
        <section v-if="has('volume')"><div class="sh"><h2>Volume this week</h2></div><div class="card stat"><div class="val">{{ fmt.vol(tw.volumeKg) }}</div><div class="sub">{{ delta(tw.volumeKg, lw.volumeKg) >= 0 ? "+" : "" }}{{ delta(tw.volumeKg, lw.volumeKg) }}% vs last week</div><Sparkline :values="weeks.map((w) => w.volumeKg)" /></div></section>
        <section v-if="has('walking')"><div class="sh"><h2>Walking</h2><button class="lnk" @click="activitySheet = { type: 'walk' }">Add <Icon name="plus" :size="14" /></button></div><div class="card stat"><div class="val">{{ fmt.dist(tw.walkM, 1) }}</div><div class="sub">this week · {{ fmt.dist(lw.walkM, 1) }} last week</div><Sparkline :values="weeks.map((w) => w.walkM)" /></div></section>
        <section v-if="has('bodyweight')"><div class="sh"><h2>Body weight</h2><button class="lnk" @click="bodySheet = true">Log <Icon name="plus" :size="14" /></button></div>
          <div class="card stat click" @click="router.push('/body')"><div class="val">{{ lastBw ? fmt.w(lastBw.value) : "—" }}<small>{{ fmt.wu }}</small></div><div class="sub">{{ lastBw ? ago(lastBw.at) : "Not logged yet" }}</div><Sparkline v-if="bwTrend.length > 1" :values="bwTrend" /></div></section>
        <section v-if="has('reminders')"><div class="sh"><h2>Reminders</h2></div>
          <div class="card"><div v-if="!h.reminders.length" class="tiny">No reminders waiting.</div><div class="list"><div v-for="r in h.reminders" :key="r.id" class="li"><Icon name="bell" :size="18" class="acc" /><div class="grow"><div class="t">{{ r.body }}</div><div class="s">{{ r.targetName }}</div></div></div></div></div></section>
        <section v-if="has('feed')"><div class="sh"><h2>Recent activity</h2></div>
          <div class="card"><div class="list"><div v-for="x in h.feed" :key="x.id" class="li click" @click="router.push(x.kind === 'workout' ? `/workouts/${x.id}` : `/activities/${x.id}`)">
            <Icon :name="x.kind === 'workout' ? 'dumbbell' : x.type === 'walk' ? 'walk' : 'activity'" :size="18" class="muted" /><div class="grow"><div class="t">{{ x.name || x.type }}</div><div class="s">{{ fmt.date(x.startedAt, { weekday: "short", day: "numeric", month: "short" }) }}</div></div>
            <span class="tiny">{{ x.kind === "workout" ? fmt.dur(x.durationS, true) : x.distanceM ? fmt.dist(x.distanceM, 1) : fmt.dur(x.durationS, true) }}</span></div></div></div></section>
        <section v-if="has('muscles')"><div class="sh"><h2>Sets per muscle · 7 days</h2></div>
          <div class="card"><div class="row" style="align-items:flex-start"><BodyMap :values="h.muscles7" :height="160" legend /><div class="grow col" style="gap:4px"><div v-for="[m, n] in Object.entries(h.muscles7).sort((a: any, b: any) => b[1] - a[1]).slice(0, 7)" :key="m" class="row tiny"><span class="grow" style="color:var(--tx)">{{ muscleName(m) }}</span>{{ Math.round(Number(n) * 10) / 10 }}</div></div></div></div></section>
      </div>

      <div class="center" style="margin-top:28px"><button class="qb" @click="custom = true"><Icon name="layers" :size="16" />Customise home</button></div>
    </template>
    <div v-else-if="home.isLoading.value" class="grid g4"><div v-for="i in 4" :key="i" class="card stat" style="opacity:.4" /></div>

    <ScheduleEditor v-if="planOpen" :schedule="planOpen" @close="planOpen = null" />
    <Sheet v-if="targetOpen" title="Weekly target" @close="targetOpen = false">
      <p class="tiny" style="margin-bottom:12px">How many workouts you aim for each week. Each week you reach it adds to your streak. This is separate from Goals, where you can set more specific ones.</p>
      <div class="seg block"><button v-for="n in 7" :key="n" :class="{ on: s.weeklyGoal === n }" @click="saveSettings({ weeklyGoal: n })">{{ n }}</button></div>
      <template #foot><button class="btn" @click="targetOpen = false">Done</button></template>
    </Sheet>
    <Sheet v-if="custom" title="Customise home" @close="custom = false">
      <p class="tiny" style="margin-bottom:8px">The summary, up next, your previous workout and goals are always here. Add more if you want them.</p>
      <label class="tgl"><div class="grow"><div class="t">Goals</div></div><span class="tg"><input type="checkbox" :checked="has('goals')" @change="toggleCard('goals')" /></span></label>
      <label v-for="c in HOME_CARDS_OPTIONAL.filter((x) => x !== 'achievements' || s.features.achievements)" :key="c" class="tgl"><div class="grow"><div class="t">{{ OPT[c] }}</div></div><span class="tg"><input type="checkbox" :checked="has(c)" @change="toggleCard(c)" /></span></label>
    </Sheet>
  </div>
</template>
