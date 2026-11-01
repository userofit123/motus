<script setup lang="ts">
// Settings (requirement 15), in sections: a list on the left on a computer, one screen per section on a phone.
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { READY_FEATURES, type Settings } from "@motus/shared";
import { useMe, useSettings, saveSettings } from "../api/queries";
import { api } from "../api/client";
import { session, signOut } from "../core/session";
import { isPhone, layoutChoice, setLayout } from "../core/device";
import { appearanceOpen } from "../core/ui";
import { confirm, prompt } from "../core/ask";
import { toast, toastError } from "../core/toast";
import { askNotificationPermission } from "../workout/native";
import Icon from "../components/Icon.vue";
import BackupSection from "../components/settings/BackupSection.vue";
import DataSection from "../components/settings/DataSection.vue";
import AdminSection from "../components/settings/AdminSection.vue";
import UpdatesSection from "../components/settings/UpdatesSection.vue";
import AccountsSection from "../components/settings/AccountsSection.vue";
import IntegrationsSection from "../components/settings/IntegrationsSection.vue";
import { native } from "../core/device";

const route = useRoute(), router = useRouter();
const me = useMe();
const s = useSettings();
const sec = computed(() => String(route.params.section ?? (isPhone.value ? "" : "account")));
const SECTIONS = computed(() => [
  ["account", "Account", "user"], ...((globalThis as any).motusNative?.accounts ? [["accounts", "Accounts on this device", "layers"]] : []), ["units", "Units & formats", "scale"], ["workout", "Workout", "dumbbell"], ["features", "Features", "sparkle"],
  ["appearance", "Appearance", "palette"], ["notifications", "Notifications", "bell"], ["backup", "Backup & restore", "download"], ["data", "Export & import", "upload"],
  ["updates", "Updates", "refresh"], ...(s.value.features.apiTokens || s.value.features.mcp ? [["integrations", "Integrations", "link"]] : []), ...(session.user?.role === "admin" ? [["admin", "Server admin", "server"]] : []), ["about", "About", "info"],
] as [string, string, string][]);
const go = (k: string) => router.push(`/settings/${k}`);
const set = (patch: Record<string, unknown>) => saveSettings(patch);
const w = computed(() => s.value.workout);

// account
const sessions = useQuery({ queryKey: ["settings", "sessions"], queryFn: () => api.get("/auth/sessions"), enabled: computed(() => sec.value === "account") });
async function editName() { const n = await prompt("Your name", { value: me.data.value?.user.displayName }); if (n != null) { await api.put("/me", { displayName: n, email: me.data.value?.user.email }); me.refetch(); } }
async function changePassword() {
  const current = await prompt("Current password"); if (!current) return;
  const next = await prompt("New password", { text: "At least 8 characters." }); if (!next) return;
  try { await api.put("/auth/password", { current, next }); toast("Password changed. Other devices were signed out."); } catch (e) { toastError(e); }
}
async function endSession(id: string) { await api.del(`/auth/sessions/${id}`); sessions.refetch(); }
async function deleteAccount() {
  if (!(await confirm("Delete your account?", { text: "Everything you have in Motus is deleted for good. Download a backup first if you might want it.", ok: "Continue", danger: true }))) return;
  const password = await prompt("Type your password to confirm"); if (!password) return;
  try { await api.del("/auth/account", { password }); await signOut(); } catch (e) { toastError(e); }
}
// units
function system(v: "metric" | "imperial") { set({ units: v === "metric" ? { system: v, weight: "kg", distance: "km", length: "cm" } : { system: v, weight: "lb", distance: "mi", length: "in" } }); }
const sec2 = (v: number) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
async function editRest(k: "restBetweenSetsS" | "restAfterExerciseS") {
  const v = await prompt(k === "restBetweenSetsS" ? "Rest between sets" : "Rest after an exercise", { value: sec2(w.value[k]), placeholder: "m:ss" });
  if (!v) return; const m = /^(\d+):(\d{1,2})$/.exec(v.trim()); const secs = m ? +m[1]! * 60 + +m[2]! : Number(v);
  if (Number.isFinite(secs)) set({ workout: { [k]: secs } });
}
async function editPlates() {
  const k = s.value.units.weight === "kg" ? "platesKg" : "platesLb";
  const v = await prompt("Your plates", { value: (s.value[k] as number[]).join(", "), text: `In ${s.value.units.weight}, separated by commas.` });
  if (v) set({ [k]: v.split(/[ ,]+/).map(Number).filter((x) => x > 0) });
}
const TOGGLES: [keyof Settings["workout"], string, string][] = [
  ["prefillFromLast", "Fill in last time's numbers", "Otherwise each routine's targets"], ["autoRest", "Start the rest timer when a set is ticked", ""], ["autoAdvance", "Go to the next exercise when one is done", ""],
  ["sound", "Sound when the rest ends", ""], ["vibrate", "Vibrate when the rest ends", ""], ["warn10", "Warn 10 seconds before the rest ends", ""], ["countdown", "3-2-1 before timed sets", ""],
  ["keepAwake", "Keep the screen on during a workout", ""], ["lockScreen", "Rest timer on the lock screen", "Android app"], ["showPrevious", "Show last time's numbers", ""],
  ["showReminders", "Show reminders and pinned notes in workouts", ""], ["confirmSkip", "Ask before skipping an exercise", ""],
];
const groups = computed(() => { const m = new Map<string, typeof READY_FEATURES>(); for (const f of READY_FEATURES) m.set(f.group, [...(m.get(f.group) ?? []), f]); return [...m]; });
const NOTIF: [keyof Settings["notifications"], string, string][] = [["scheduled", "Planned workouts", "Before a routine's scheduled time"], ["goals", "Goals reached", ""], ["updates", "New versions", ""], ["inactivity", "A nudge after a long break", "Off by default"]];
const notifPerm = ref(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
async function allowNotifications() { await askNotificationPermission(); notifPerm.value = typeof Notification !== "undefined" ? Notification.permission : notifPerm.value; }
</script>

<template>
  <div class="page">
    <div class="ph"><div><button v-if="isPhone && sec" class="back" @click="router.push('/settings')"><Icon name="left" :size="16" />Settings</button><h1>{{ isPhone && sec ? SECTIONS.find((x) => x[0] === sec)?.[1] : "Settings" }}</h1></div></div>
    <div :class="isPhone ? '' : 'grid'" :style="isPhone ? undefined : { gridTemplateColumns: '220px minmax(0,1fr)', alignItems: 'start' }">
      <div v-if="!isPhone || !sec" class="card" style="padding:8px" :style="!isPhone ? { position: 'sticky', top: '24px' } : undefined">
        <div v-for="[k, l, ic] in SECTIONS" :key="k" class="li click" :class="{ cur: sec === k }" :style="sec === k && !isPhone ? { background: 'var(--accc)', color: 'var(--onc)', borderRadius: 'var(--r-sm)' } : { borderBottom: isPhone ? undefined : 0 }" style="padding:10px 12px;min-height:0" @click="go(k)">
          <Icon :name="ic" :size="18" /><span class="grow">{{ l }}</span><Icon v-if="isPhone" name="right" :size="16" class="muted" /></div>
        <div v-if="isPhone" class="li click" style="padding:10px 12px" @click="signOut()"><Icon name="logout" :size="18" /><span class="grow">Sign out</span></div>
      </div>

      <div v-if="sec" class="col" style="gap:var(--spg)">
        <template v-if="sec === 'account'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">{{ me.data.value?.user.displayName || me.data.value?.user.username }}</div><div class="s">@{{ me.data.value?.user.username }} · {{ me.data.value?.user.role === "admin" ? "admin" : "member" }}</div></div><button class="qb acc" @click="editName">Edit</button></div>
            <div class="li"><div class="grow"><div class="t">Password</div></div><button class="qb acc" @click="changePassword">Change</button></div>
            <div class="li"><div class="grow"><div class="t">Sign out</div><div class="s">From this device</div></div><button class="qb acc" @click="signOut()">Sign out</button></div>
          </div>
          <div class="sh first"><h2>Signed-in devices</h2><button class="lnk" @click="api.post('/auth/logout-others').then(() => sessions.refetch())">Sign out the others</button></div>
          <div class="card"><div v-for="x in sessions.data.value ?? []" :key="x.id" class="li"><Icon :name="x.platform === 'android' ? 'device' : 'server'" :size="18" class="muted" /><div class="grow"><div class="t">{{ x.deviceName || x.platform }}{{ x.current ? " · this device" : "" }}</div><div class="s">Last used {{ new Date(x.lastSeenAt).toLocaleString() }}</div></div><button v-if="!x.current" class="qb" @click="endSession(x.id)">Sign out</button></div></div>
          <div class="card"><div class="li"><div class="grow"><div class="t">Your body</div><div class="s">Used for strength standards and calories (optional)</div></div></div>
            <div class="frow"><div class="fld"><label>Height (cm)</label><input type="number" :value="s.profile.heightCm ?? ''" @change="set({ profile: { heightCm: Number(($event.target as HTMLInputElement).value) || null } })" /></div>
              <div class="fld"><label>Year of birth</label><input type="number" :value="s.profile.birthYear ?? ''" @change="set({ profile: { birthYear: Number(($event.target as HTMLInputElement).value) || null } })" /></div>
              <div class="fld"><label>Sex</label><select :value="s.profile.sex" @change="set({ profile: { sex: ($event.target as HTMLSelectElement).value } })"><option value="">Not set</option><option value="male">Male</option><option value="female">Female</option></select></div></div></div>
          <div class="card"><div class="li"><div class="grow"><div class="t" style="color:var(--neg)">Delete account</div><div class="s">Deletes everything you have in Motus</div></div><button class="qb danger" @click="deleteAccount">Delete</button></div></div>
        </template>

        <template v-else-if="sec === 'units'">
          <div class="card">
            <div class="fld"><label>Measurement system</label><div class="seg block"><button :class="{ on: s.units.system === 'metric' }" @click="system('metric')">Metric</button><button :class="{ on: s.units.system === 'imperial' }" @click="system('imperial')">Imperial</button></div></div>
            <div class="frow">
              <div class="fld"><label>Weight</label><select :value="s.units.weight" @change="set({ units: { weight: ($event.target as HTMLSelectElement).value } })"><option value="kg">kg</option><option value="lb">lb</option></select></div>
              <div class="fld"><label>Distance</label><select :value="s.units.distance" @change="set({ units: { distance: ($event.target as HTMLSelectElement).value } })"><option value="km">km</option><option value="mi">miles</option></select></div>
              <div class="fld"><label>Body measurements</label><select :value="s.units.length" @change="set({ units: { length: ($event.target as HTMLSelectElement).value } })"><option value="cm">cm</option><option value="in">inches</option></select></div>
            </div>
            <p class="tiny">Your data is stored in kg and metres, so switching never changes what you logged.</p>
          </div>
          <div class="card">
            <div class="frow">
              <div class="fld"><label>First day of the week</label><select :value="s.firstDay" @change="set({ firstDay: Number(($event.target as HTMLSelectElement).value) })"><option :value="0">Sunday</option><option :value="1">Monday</option></select></div>
              <div class="fld"><label>Dates</label><select :value="s.dateFormat" @change="set({ dateFormat: ($event.target as HTMLSelectElement).value })"><option value="dmy">31 Dec 2026</option><option value="mdy">Dec 31, 2026</option><option value="ymd">2026-12-31</option></select></div>
              <div class="fld"><label>Clock</label><select :value="s.clock" @change="set({ clock: ($event.target as HTMLSelectElement).value })"><option value="24">24-hour</option><option value="12">12-hour</option></select></div>
            </div>
          </div>
        </template>

        <template v-else-if="sec === 'workout'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Rest between sets</div><div class="s">When an exercise has no rest of its own</div></div><button class="qb acc" @click="editRest('restBetweenSetsS')">{{ sec2(w.restBetweenSetsS) }}</button></div>
            <div class="li"><div class="grow"><div class="t">Rest after an exercise</div><div class="s">The longer break before the next exercise</div></div><button class="qb acc" @click="editRest('restAfterExerciseS')">{{ sec2(w.restAfterExerciseS) }}</button></div>
            <div class="li"><div class="grow"><div class="t">Weekly goal</div><div class="s">Workouts a week, for your streak</div></div><input type="number" min="1" max="14" :value="s.weeklyGoal" style="width:80px" @change="set({ weeklyGoal: Number(($event.target as HTMLInputElement).value) || 3 })" /></div>
            <div class="li"><div class="grow"><div class="t">Last time's numbers come from</div></div><select :value="w.prefillScope" style="width:auto" @change="set({ workout: { prefillScope: ($event.target as HTMLSelectElement).value } })"><option value="any">The last time, in any routine</option><option value="routine">The last time in the same routine</option></select></div>
            <div class="li"><div class="grow"><div class="t">After a workout, update its routine</div></div><select :value="w.updateRoutine" style="width:auto" @change="set({ workout: { updateRoutine: ($event.target as HTMLSelectElement).value } })"><option value="ask">Ask</option><option value="always">Always</option><option value="never">Never</option></select></div>
          </div>
          <div class="card"><label v-for="[k, l, d] in TOGGLES" :key="k" class="tgl"><div class="grow"><div class="t">{{ l }}</div><div v-if="d" class="s">{{ d }}</div></div><span class="tg"><input type="checkbox" :checked="w[k] as boolean" @change="set({ workout: { [k]: ($event.target as HTMLInputElement).checked } })" /></span></label></div>
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Weight steps</div><div class="s">Used by reminders and progression</div></div><input type="number" step="0.25" :value="s.units.weight === 'kg' ? s.increments.kg : s.increments.lb" style="width:90px" @change="set({ increments: { [s.units.weight]: Number(($event.target as HTMLInputElement).value) || 2.5 } })" /><span class="tiny">{{ s.units.weight }}</span></div>
            <div v-if="s.features.plates || s.features.warmupCalc" class="li"><div class="grow"><div class="t">Bar weight</div></div><input type="number" step="0.5" :value="s.barKg" style="width:90px" @change="set({ barKg: Number(($event.target as HTMLInputElement).value) || 20 })" /><span class="tiny">kg</span></div>
            <div v-if="s.features.plates" class="li"><div class="grow"><div class="t">Your plates</div><div class="s">{{ (s.units.weight === "kg" ? s.platesKg : s.platesLb).join(", ") }} {{ s.units.weight }}</div></div><button class="qb acc" @click="editPlates">Edit</button></div>
            <div class="li"><div class="grow"><div class="t">One-rep max estimate</div></div><select :value="s.e1rm" style="width:auto" @change="set({ e1rm: ($event.target as HTMLSelectElement).value })"><option value="epley">Epley</option><option value="brzycki">Brzycki</option></select></div>
            <div v-if="s.features.steps" class="li"><div class="grow"><div class="t">Daily step goal</div></div><input type="number" step="500" :value="s.stepGoal" style="width:100px" @change="set({ stepGoal: Number(($event.target as HTMLInputElement).value) || 8000 })" /></div>
          </div>
        </template>

        <template v-else-if="sec === 'features'">
          <p class="muted" style="margin:0">Motus shows only what you use. Switch on what you want; switched off, a feature is gone from every screen.</p>
          <div v-for="[g, fs] in groups" :key="g"><div class="sh first" style="margin-top:6px"><h2>{{ g }}</h2></div>
            <div class="card"><label v-for="f in fs" :key="f.id" class="tgl"><div class="grow"><div class="t">{{ f.name }}</div><div class="s">{{ f.desc }}</div></div><span class="tg"><input type="checkbox" :checked="!!s.features[f.id]" @change="set({ features: { [f.id]: ($event.target as HTMLInputElement).checked } })" /></span></label></div></div>
        </template>

        <template v-else-if="sec === 'appearance'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Colours, background, style and layout</div><div class="s">The Appearance panel</div></div><button class="btn s" data-theme-open @click.stop="appearanceOpen = true">Open</button></div>
            <div class="li"><div class="grow"><div class="t">Layout</div><div class="s">Phone or computer layout, or choose by screen size</div></div>
              <select :value="layoutChoice" style="width:auto" @change="setLayout(($event.target as HTMLSelectElement).value as any)"><option value="auto">Automatic</option><option value="desktop">Computer</option><option value="phone">Phone</option></select></div>
          </div>
        </template>

        <template v-else-if="sec === 'notifications'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Notifications on this device</div><div class="s">{{ notifPerm === "granted" ? "Allowed" : notifPerm === "denied" ? "Blocked in your browser settings" : notifPerm === "unsupported" ? "Not available here" : "Not allowed yet" }}</div></div><button v-if="notifPerm === 'default'" class="btn s" @click="allowNotifications">Allow</button></div>
            <label v-for="[k, l, d] in NOTIF" :key="k" class="tgl"><div class="grow"><div class="t">{{ l }}</div><div v-if="d" class="s">{{ d }}</div></div><span class="tg"><input type="checkbox" :checked="s.notifications[k]" @change="set({ notifications: { [k]: ($event.target as HTMLInputElement).checked } })" /></span></label>
          </div>
          <p class="tiny">The rest timer's alerts are under Workout.</p>
        </template>

        <BackupSection v-else-if="sec === 'backup'" />
        <DataSection v-else-if="sec === 'data'" />
        <UpdatesSection v-else-if="sec === 'updates'" />
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
      </div>
    </div>
  </div>
</template>
