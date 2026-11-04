<script setup lang="ts">
// Settings (requirement 15), in sections: a list on the left on a computer, one screen per section on a phone.
import { goBack } from "../core/leave";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { READY_FEATURES, EQUIPMENT, NOTE_TAGS_DEFAULT, workdaysOf, type Settings } from "@motus/shared";
import { WEEKDAYS } from "../core/goals";
import { useMe, useSettings, saveSettings, loaded } from "../api/queries";
import { session, signOut } from "../core/session";
import { isPhone, layoutChoice, setLayout } from "../core/device";
import { appearanceOpen } from "../core/ui";
import { prompt } from "../core/ask";
import { toast } from "../core/toast";
import { askNotificationPermission, notificationState, isNativeApp, type NotificationState } from "../workout/native";
import Icon from "../components/Icon.vue";
import RestPicker from "../components/RestPicker.vue";
import AppSelect from "../components/AppSelect.vue";
import ChoiceTiles from "../components/ChoiceTiles.vue";
import Menu from "../components/Menu.vue";
import BackupSection from "../components/settings/BackupSection.vue";
import ActivityTypesSection from "../components/settings/ActivityTypesSection.vue";
import AccountSection from "../components/settings/AccountSection.vue";
import DataSection from "../components/settings/DataSection.vue";
import AdminSection from "../components/settings/AdminSection.vue";
import AppVersionsSection from "../components/settings/AppVersionsSection.vue";
import ChangelogSection from "../components/settings/ChangelogSection.vue";
import AccountsSection from "../components/settings/AccountsSection.vue";
import IntegrationsSection from "../components/settings/IntegrationsSection.vue";
import ActivityLogSection from "../components/settings/ActivityLogSection.vue";
import { native } from "../core/device";

const route = useRoute(), router = useRouter();
const me = useMe();
const s = useSettings();
const sec = computed(() => String(route.params.section || (isPhone.value ? "" : "account")));
// the sections in groups, so the list reads as a few short ones: [key, name, icon, what's in it]
type Section = [key: string, name: string, icon: string, hint: string];
const GROUPS = computed<[string, Section[]][]>(() => [
  ["You", [["account", "Account", "user", "Name, password, devices, sync"],
    ...((globalThis as any).motusNative?.accounts ? [["accounts", "Accounts on this device", "layers", "Switch or add accounts"] as Section] : [])]],
  ["Training", [["workout", "Workout defaults", "dumbbell", "Rest times, timer, filling in sets"], ["activities", "Activity types", "walk", "Walk, run, ride and your own"], ["features", "Features", "sparkle", "Switch extras on or off"]]],
  ["App", [["units", "Units & formats", "scale", "kg or lb, dates, work week"], ["appearance", "Appearance", "palette", "Colours, style, layout"], ["notifications", "Notifications", "bell", "Planned workouts"]]],
  ["Your data", [["backup", "Backup & restore", "download", "A copy of everything"], ["data", "Export & import", "upload", "CSV, other apps"], ["log", "Activity log", "history", "Everything you changed"]]],
  ["About", [["versions", "App & Versions", "refresh", "Installed version, downloads"], ["changelog", "What's new", "sparkle", "Release notes"], ...(s.value.features.apiTokens || s.value.features.mcp ? [["integrations", "Integrations", "link", "API tokens, Ask Claude"] as Section] : []),
    ...(session.user?.role === "admin" ? [["admin", "Server admin", "server", "People, invites, sign-ups"] as Section] : []), ["about", "About Motus", "info", "Version, credits"]]],
]);
const SECTIONS = computed(() => GROUPS.value.flatMap(([, xs]) => xs));
const go = (k: string) => router.push(`/settings/${k}`);
const DAY_OPTS = computed(() => Array.from({ length: 7 }, (_, i) => (i + s.value.firstDay) % 7).map((d) => ({ value: d, label: WEEKDAYS[d]!.slice(0, 3) })));
const set = (patch: Record<string, unknown>) => saveSettings(patch);
const w = computed(() => s.value.workout);

// units
function system(v: "metric" | "imperial") { set({ units: v === "metric" ? { system: v, weight: "kg", distance: "km", length: "cm" } : { system: v, weight: "lb", distance: "mi", length: "in" } }); }
const sec2 = (v: number) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
async function editRest(k: "restBetweenSetsS" | "restAfterExerciseS") {
  const v = await prompt(k === "restBetweenSetsS" ? "Rest between sets" : "Rest after an exercise", { value: sec2(w.value[k]), placeholder: "m:ss" });
  if (!v) return; const m = /^(\d+):(\d{1,2})$/.exec(v.trim()); const secs = m ? +m[1]! * 60 + +m[2]! : Number(v);
  if (Number.isFinite(secs)) set({ workout: { [k]: secs } });
}
// rest after warm-up, drop and to-failure sets; unset follows "Rest between sets"
const KIND_REST: [k: "warmup" | "drop" | "failure", label: string][] = [["warmup", "Rest after a warm-up set"], ["drop", "Rest after a drop set"], ["failure", "Rest after a set to failure"]];
const kindRest = ref<null | "warmup" | "drop" | "failure">(null);
function pickKindRest(v: number | null) { set({ workout: { restByKindS: { [kindRest.value!]: v } } }); kindRest.value = null; }
async function editPlates() {
  const k = s.value.units.weight === "kg" ? "platesKg" : "platesLb";
  const v = await prompt("Your plates", { value: (s.value[k] as number[]).join(", "), text: `In ${s.value.units.weight}, separated by commas.` });
  if (v) set({ [k]: v.split(/[ ,]+/).map(Number).filter((x) => x > 0) });
}
type Toggle = [keyof Settings["workout"], string, string];
const TOGGLES: Record<"fill" | "timer" | "during", Toggle[]> = {
  fill: [["prefillFromLast", "Fill in last time's numbers", "Otherwise each routine's targets"], ["showPrevious", "Show last time's numbers", "Beside each set"]],
  timer: [["autoRest", "Start the rest timer when a set is ticked", ""], ["restEndNext", "Go to the next set when the rest ends", "Otherwise it waits on \"Rest over\" until you tap Next set"], ["sound", "Sound when the rest ends", ""], ["vibrate", "Vibrate when the rest ends", ""],
    ["warn10", "Warn 10 seconds before the rest ends", ""], ["countdown", "3-2-1 before timed sets", ""], ["lockScreen", "Rest timer on the lock screen", "Android app"]],
  during: [["autoAdvance", "Go to the next exercise when one is done", ""], ["keepAwake", "Keep the screen on", ""], ["sessionNotice", "Show the workout as a notification", "Its name, the exercise and set you're on, and how far along you are"],
    ["showReminders", "Show reminders and pinned notes", ""], ["confirmSkip", "Ask before skipping an exercise", ""]],
};
// quick tags for notes: the list replaces as a whole (lists aren't merged), so every change sends all of it
const tagsOf = () => s.value.noteTags ?? [];
function setTags(list: string[], msg: string) { set({ noteTags: list }); toast(msg); }
async function addNoteTag() {
  const t = (await prompt("New tag", { placeholder: "e.g. Grip", ok: "Add" }))?.trim().slice(0, 40); if (!t) return;
  if (tagsOf().some((x) => x.toLowerCase() === t.toLowerCase())) return toast(`"${t}" is already there`);
  setTags([...tagsOf(), t], `Tag "${t}" added`);
}
async function renameNoteTag(i: number) {
  const t = (await prompt("Rename tag", { value: tagsOf()[i], ok: "Save" }))?.trim().slice(0, 40); if (!t || t === tagsOf()[i]) return;
  setTags(tagsOf().map((x, k) => (k === i ? t : x)), "Tag renamed");
}
function moveNoteTag(i: number, d: number) { const l = [...tagsOf()]; [l[i], l[i + d]] = [l[i + d]!, l[i]!]; setTags(l, "Tags reordered"); }
const removeNoteTag = (i: number) => setTags(tagsOf().filter((_, k) => k !== i), `Tag "${tagsOf()[i]}" removed`);
// gym profiles
async function addGym() {
  const name = await prompt("Gym name", { placeholder: "e.g. Home, Work gym" }); if (!name) return;
  set({ gyms: [...s.value.gyms, { id: crypto.randomUUID(), name, equipment: [...EQUIPMENT] }], activeGym: s.value.activeGym ?? undefined });
}
const setEquip = (g: any, equipment: string[]) => set({ gyms: s.value.gyms.map((x) => (x.id === g.id ? { ...x, equipment } : x)) });
const EQUIP_OPTS = EQUIPMENT.map((q) => ({ value: q, label: q.replace(/\b\w/g, (c) => c.toUpperCase()) }));
const delGym = (g: any) => set({ gyms: s.value.gyms.filter((x) => x.id !== g.id), activeGym: s.value.activeGym === g.id ? null : s.value.activeGym });
const groups = computed(() => { const m = new Map<string, typeof READY_FEATURES>(); for (const f of READY_FEATURES) m.set(f.group, [...(m.get(f.group) ?? []), f]); return [...m]; });
// only the notifications the app actually sends are offered
const NOTIF: [keyof Settings["notifications"], string, string][] = [["scheduled", "Planned workouts", "Before a routine's scheduled time"]];
// asked of Android in the app (its web view has no browser notifications, which used to read as "Not available here"),
// of the browser otherwise
const notifPerm = ref<NotificationState | null>(null);
// on a phone, the system's own permission screen can come up over the app; coming back, show what was chosen there
const readPerm = () => { void notificationState().then((v) => (notifPerm.value = v)); };
readPerm();
async function allowNotifications() { try { await askNotificationPermission(); } finally { readPerm(); } }
onMounted(() => { addEventListener("focus", readPerm); document.addEventListener("visibilitychange", readPerm); });
onBeforeUnmount(() => { removeEventListener("focus", readPerm); document.removeEventListener("visibilitychange", readPerm); });
// show the page once its data is in, all at once
await loaded(me);
</script>

<template>
  <div class="page">
    <div class="ph"><div><button v-if="isPhone && sec" class="back" @click="goBack(router, '/settings')"><Icon name="left" :size="16" /><span>Settings</span></button><h1>{{ isPhone && sec ? SECTIONS.find((x) => x[0] === sec)?.[1] : "Settings" }}</h1></div></div>
    <div :class="isPhone ? '' : 'grid'" :style="isPhone ? undefined : { gridTemplateColumns: '220px minmax(0,1fr)', alignItems: 'start' }">
      <!-- phone: the groups as short lists, each row saying what's inside -->
      <div v-if="isPhone && !sec">
        <template v-for="([g, xs], gi) in GROUPS" :key="g">
          <div class="sh" :class="{ first: gi === 0 }"><h2>{{ g }}</h2></div>
          <div class="card flush">
            <div v-for="[k, l, ic, h] in xs" :key="k" class="li click" @click="go(k)"><span class="bi sg"><Icon :name="ic" :size="17" /></span><div class="grow"><div class="t">{{ l }}</div><div class="s">{{ h }}</div></div><Icon name="right" :size="16" class="muted" /></div>
          </div>
        </template>
        <div class="card flush spt"><div class="li click" @click="signOut()"><span class="bi sg"><Icon name="logout" :size="17" /></span><span class="grow t">Sign out</span></div></div>
      </div>
      <!-- computer: the same groups down the side -->
      <!-- a div, not <nav>: the app's <nav> styles are the side rail's -->
      <div v-else-if="!isPhone" class="card snav" role="navigation" aria-label="Settings sections">
        <template v-for="[g, xs] in GROUPS" :key="g">
          <div class="sng">{{ g }}</div>
          <button v-for="[k, l, ic] in xs" :key="k" type="button" class="sni" :class="{ on: sec === k }" :aria-current="sec === k ? 'page' : undefined" @click="go(k)"><Icon :name="ic" :size="17" /><span>{{ l }}</span></button>
        </template>
      </div>

      <Transition name="sw" mode="out-in"><div v-if="sec" :key="sec" class="stack">
        <AccountSection v-if="sec === 'account'" />
        <template v-else-if="sec === 'units'">
          <div class="card">
            <div class="fld"><label>Measurement system</label><div class="seg block"><button :class="{ on: s.units.system === 'metric' }" @click="system('metric')">Metric</button><button :class="{ on: s.units.system === 'imperial' }" @click="system('imperial')">Imperial</button></div></div>
            <div class="frow">
              <div class="fld"><label>Weight</label><AppSelect :model-value="s.units.weight" :options="['kg', 'lb']" title="Weight" @update:model-value="(v) => set({ units: { weight: v } })" /></div>
              <div class="fld"><label>Distance</label><AppSelect :model-value="s.units.distance" :options="[{ value: 'km', label: 'km' }, { value: 'mi', label: 'miles' }]" title="Distance" @update:model-value="(v) => set({ units: { distance: v } })" /></div>
              <div class="fld"><label>Body measurements</label><AppSelect :model-value="s.units.length" :options="[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'inches' }]" title="Body measurements" @update:model-value="(v) => set({ units: { length: v } })" /></div>
            </div>
            <p class="tiny">Your data is stored in kg and metres, so switching never changes what you logged.</p>
          </div>
          <div class="card">
            <div class="frow">
              <div class="fld"><label>First day of the week</label><AppSelect :model-value="s.firstDay" :options="[{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }]" title="First day of the week" @update:model-value="(v) => set({ firstDay: v })" /></div>
              <div class="fld"><label>Dates</label><AppSelect :model-value="s.dateFormat" :options="[{ value: 'dmy', label: '31 Dec 2026' }, { value: 'mdy', label: 'Dec 31, 2026' }, { value: 'ymd', label: '2026-12-31' }]" title="Dates" @update:model-value="(v) => set({ dateFormat: v })" /></div>
              <div class="fld"><label>Clock</label><AppSelect :model-value="s.clock" :options="[{ value: '24', label: '24-hour' }, { value: '12', label: '12-hour' }]" title="Clock" @update:model-value="(v) => set({ clock: v })" /></div>
            </div>
            <!-- for goals that count on workdays; until chosen it follows the first day of the week -->
            <div class="fld" style="margin-bottom:0"><label>Work week</label><ChoiceTiles :model-value="workdaysOf(s)" :options="DAY_OPTS" multiple compact min="56px" label="Work week" @update:model-value="(v) => set({ workdays: [...v].sort() })" />
              <p class="tiny" style="margin-top:6px">{{ s.workdays?.length ? "Your choice." : `From the first day of the week: ${s.firstDay === 0 ? "Sunday to Thursday" : "Monday to Friday"}.` }} Used by goals that count on workdays.
                <button v-if="s.workdays?.length" class="lnk inl" @click="set({ workdays: null })">Follow the first day again</button></p></div>
          </div>
        </template>

        <template v-else-if="sec === 'workout'">
          <p class="muted" style="margin:0">How every workout starts out. A routine or an exercise can set its own rest, numbers and timer; these apply wherever it doesn't.</p>
          <div class="sh"><h2>Rest</h2></div>
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Rest between sets</div><div class="s">When an exercise has no rest of its own</div></div><button class="qb acc" @click="editRest('restBetweenSetsS')">{{ sec2(w.restBetweenSetsS) }}</button></div>
            <div class="li"><div class="grow"><div class="t">Rest after an exercise</div><div class="s">The longer break before the next exercise</div></div><button class="qb acc" @click="editRest('restAfterExerciseS')">{{ sec2(w.restAfterExerciseS) }}</button></div>
            <template v-if="s.features.setTypes">
              <div v-for="[k, l] in KIND_REST" :key="k" class="li"><div class="grow"><div class="t">{{ l }}</div><div class="s">{{ w.restByKindS?.[k] == null ? "Same as between sets" : "When a routine doesn't set its own" }}</div></div>
                <button class="qb acc" @click="kindRest = k">{{ w.restByKindS?.[k] == null ? sec2(w.restBetweenSetsS) : sec2(w.restByKindS[k]!) }}</button></div>
            </template>
          </div>
          <div class="sh"><h2>Filling in sets</h2></div>
          <div class="card">
            <label v-for="[k, l, d] in TOGGLES.fill" :key="k" class="tgl"><div class="grow"><div class="t">{{ l }}</div><div v-if="d" class="s">{{ d }}</div></div><span class="tg"><input type="checkbox" :checked="w[k] as boolean" @change="set({ workout: { [k]: ($event.target as HTMLInputElement).checked } })" /></span></label>
            <div class="li"><div class="grow"><div class="t">Last time's numbers come from</div></div><AppSelect :model-value="w.prefillScope" :options="[{ value: 'any', label: 'Any routine' }, { value: 'routine', label: 'The same routine' }]" title="Last time's numbers come from" style="width:auto" @update:model-value="(v) => set({ workout: { prefillScope: v } })" /></div>
            <div class="li"><div class="grow"><div class="t">After a workout, update its routine</div><div class="s">When you changed things: exercises added, sets left unticked, other weights or reps</div></div><AppSelect :model-value="w.updateRoutine" :options="[{ value: 'ask', label: 'Ask' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }]" title="Update the routine" style="width:auto" @update:model-value="(v) => set({ workout: { updateRoutine: v } })" /></div>
          </div>
          <template v-for="[h, list] in [['Rest timer', TOGGLES.timer], ['During a workout', TOGGLES.during]] as const" :key="h">
            <div class="sh"><h2>{{ h }}</h2></div>
            <div class="card"><label v-for="[k, l, d] in list" :key="k" class="tgl"><div class="grow"><div class="t">{{ l }}</div><div v-if="d" class="s">{{ d }}</div></div><span class="tg"><input type="checkbox" :checked="w[k] as boolean" @change="set({ workout: { [k]: ($event.target as HTMLInputElement).checked } })" /></span></label></div>
          </template>
          <div class="sh"><h2>Weights</h2></div>
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Weight steps</div><div class="s">Used by reminders and progression</div></div><input type="number" step="0.25" :value="s.units.weight === 'kg' ? s.increments.kg : s.increments.lb" style="width:90px" @change="set({ increments: { [s.units.weight]: Number(($event.target as HTMLInputElement).value) || 2.5 } })" /><span class="tiny">{{ s.units.weight }}</span></div>
            <div v-if="s.features.plates || s.features.warmupCalc" class="li"><div class="grow"><div class="t">Bar weight</div></div><input type="number" step="0.5" :value="s.barKg" style="width:90px" @change="set({ barKg: Number(($event.target as HTMLInputElement).value) || 20 })" /><span class="tiny">kg</span></div>
            <div v-if="s.features.plates" class="li"><div class="grow"><div class="t">Your plates</div><div class="s">{{ (s.units.weight === "kg" ? s.platesKg : s.platesLb).join(", ") }} {{ s.units.weight }}</div></div><button class="qb acc" @click="editPlates">Edit</button></div>
          </div>
          <div class="sh"><h2>Note tags</h2><button class="lnk" @click="addNoteTag">Add</button></div>
          <div class="card">
            <p class="tiny" style="margin:0 0 6px">Offered as quick tags when you write a note. Notes you already tagged keep their tags.</p>
            <div v-for="(t, i) in s.noteTags" :key="t" class="li"><span class="grow">{{ t }}</span>
              <Menu :label="`${t} options`" :items="[{ label: 'Rename', icon: 'edit', run: () => renameNoteTag(i) }, { label: 'Move up', icon: 'up', hidden: i === 0, run: () => moveNoteTag(i, -1) }, { label: 'Move down', icon: 'down', hidden: i === s.noteTags.length - 1, run: () => moveNoteTag(i, 1) }, { label: 'Remove', icon: 'trash', danger: true, run: () => removeNoteTag(i) }]" /></div>
            <div v-if="!s.noteTags.length" class="li"><span class="grow tiny">No tags. Add your own, or bring back the starting ones.</span><button class="qb acc" @click="setTags([...NOTE_TAGS_DEFAULT], 'Starting tags restored')">Restore</button></div>
          </div>
          <template v-if="s.features.gyms">
            <div class="sh"><h2>Gyms</h2><button class="lnk" @click="addGym">Add</button></div>
            <div v-if="!s.gyms.length" class="card tiny">Add the places you train and what equipment each has; adding exercises then shows what's there.</div>
            <div v-for="g in s.gyms" :key="g.id" class="card">
              <div class="row hgap"><b class="grow">{{ g.name }}</b><button class="btn s" :class="{ o: s.activeGym !== g.id }" @click="set({ activeGym: g.id })">{{ s.activeGym === g.id ? "Here now" : "I'm here" }}</button><button class="qb danger" @click="delGym(g)">Remove</button></div>
              <ChoiceTiles :model-value="g.equipment" :options="EQUIP_OPTS" multiple compact :label="`Equipment at ${g.name}`" @update:model-value="(v) => setEquip(g, v)" />
            </div>
          </template>
        </template>

        <template v-else-if="sec === 'features'">
          <p class="muted" style="margin:0">Motus shows only what you use. Switch on what you want; switched off, a feature is gone from every screen.</p>
          <template v-for="[g, fs] in groups" :key="g"><div class="sh"><h2>{{ g }}</h2></div>
            <div class="card"><label v-for="f in fs" :key="f.id" class="tgl"><div class="grow"><div class="t">{{ f.name }}</div><div class="s">{{ f.desc }}</div></div><span class="tg"><input type="checkbox" :checked="!!s.features[f.id]" @change="set({ features: { [f.id]: ($event.target as HTMLInputElement).checked } })" /></span></label></div></template>
        </template>

        <template v-else-if="sec === 'appearance'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Colours, background, style and layout</div><div class="s">The Appearance panel</div></div><button class="btn s" data-theme-open @click.stop="appearanceOpen = true">Open</button></div>
            <div class="li"><div class="grow"><div class="t">Layout</div><div class="s">Phone or computer layout, or choose by screen size</div></div>
              <AppSelect :model-value="layoutChoice" :options="[{ value: 'auto', label: 'Automatic' }, { value: 'desktop', label: 'Computer' }, { value: 'phone', label: 'Phone' }]" title="Layout" style="width:auto" @update:model-value="setLayout" /></div>
          </div>
        </template>

        <template v-else-if="sec === 'notifications'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Notifications on this device</div><div class="s">{{ notifPerm === "granted" ? "Allowed: workouts, rests, activities and the interval timer show while they run" : notifPerm === "denied" ? (isNativeApp() ? "Blocked: allow them for Motus in the phone's settings" : "Blocked in your browser settings") : notifPerm === "unsupported" ? "This browser can't show notifications" : notifPerm === "prompt" ? "Not allowed yet" : "-" }}</div></div><button v-if="notifPerm === 'prompt'" class="btn s" @click="allowNotifications">Allow</button></div>
            <label v-for="[k, l, d] in NOTIF" :key="k" class="tgl"><div class="grow"><div class="t">{{ l }}</div><div v-if="d" class="s">{{ d }}</div></div><span class="tg"><input type="checkbox" :checked="s.notifications[k]" @change="set({ notifications: { [k]: ($event.target as HTMLInputElement).checked } })" /></span></label>
          </div>
          <p class="tiny">Sounds and vibration when a rest ends are in <button class="lnk inl" @click="go('workout')">Workout defaults</button>.</p>
        </template>

        <ActivityTypesSection v-else-if="sec === 'activities'" />
        <BackupSection v-else-if="sec === 'backup'" />
        <DataSection v-else-if="sec === 'data'" />
        <ActivityLogSection v-else-if="sec === 'log'" />
        <AppVersionsSection v-else-if="sec === 'versions'" />
        <ChangelogSection v-else-if="sec === 'changelog'" />
        <AccountsSection v-else-if="sec === 'accounts'" />
        <IntegrationsSection v-else-if="sec === 'integrations'" />
        <AdminSection v-else-if="sec === 'admin'" />

        <template v-else-if="sec === 'about'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Motus</div><div class="s">Version {{ session.version }} · API level {{ session.apiLevel }}</div></div></div>
            <div class="li"><div class="grow"><div class="t">Exercise library</div><div class="s">free-exercise-db by yuhonas, released to the public domain (Unlicense)</div></div></div>
            <div class="li"><div class="grow"><div class="t">Look and feel</div><div class="s">From Money Manager. Fonts: Inter and Nunito (SIL Open Font License)</div></div></div>
            <div class="li"><div class="grow"><div class="t">Source</div><div class="s">github.com/userofit123/motus</div></div></div>
          </div>
        </template>
      </div></Transition>
    </div>
    <RestPicker v-if="kindRest" :title="KIND_REST.find((x) => x[0] === kindRest)![1]" :value="w.restByKindS?.[kindRest] ?? null" :default-label="`Same as between sets (${sec2(w.restBetweenSetsS)})`" @close="kindRest = null" @pick="pickKindRest" />
  </div>
</template>

<style scoped>
/* the computer's section list: small group names over plain rows, the open one filled */
.snav { position: sticky; top: 24px; padding: calc(var(--cpy) / 2); display: flex; flex-direction: column; gap: 1px; }
.sng { font-size: var(--fs-xs); font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--tx2); padding: 12px 12px 4px; }
.sng:first-child { padding-top: 4px; }
.sni { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border: 0; background: none; border-radius: var(--r-sm); color: var(--tx); font: inherit; font-size: 14px; text-align: start; cursor: pointer; }
.sni:hover { background: var(--s2); }
.sni.on { background: var(--accc); color: var(--onc); font-weight: 600; }
.sni .ico { color: var(--tx2); }
.sni.on .ico { color: inherit; }
</style>
