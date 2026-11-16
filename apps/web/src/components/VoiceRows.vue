<script setup lang="ts">
// Under the Voice cues switch in Settings → Workout defaults, only while it's on: what speaks the cues on this device and
// whether it works, from a real check (the phone's engine is started to find out) and the latest cue, so a problem stays
// in view after its message has gone; which voice speaks (the phone's engines and their English voices, or the browser's
// or computer's English voices, or Motus's own), with play buttons as the sound rows have (by each option, to hear it
// before choosing it, and by each choice); on the phone, its speech settings in the ⋮ menu. The choice is kept on this device (workout/voicePrefs.ts).
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { WorkoutPrefs } from "@motus/shared";
import { native as app } from "../core/device";
import { nativeOpenSpeechSettings, nativeVoiceInfo, type NativeVoiceInfo } from "../workout/native";
import { setVoiceChoice, voiceChoice, voiceResult, type VoiceChoice, type VoiceProblem } from "../workout/voicePrefs";
import { pickProblem, previewVoice, voiceProblem } from "../workout/runtime";
import { toast } from "../core/toast";
import AppSelect from "./AppSelect.vue";
import Icon from "./Icon.vue";
import Menu from "./Menu.vue";

const props = defineProps<{ prefs: WorkoutPrefs }>();
const phone = app.android;
const device = phone ? "phone" : app.desktop ? "computer" : "browser";
const OWN = "Motus's own voice";

// the phone: asked again on opening, after each cue, after a new choice and on coming back from the phone's settings
const info = ref<NativeVoiceInfo | null>(null), checking = ref(false);
let asked = 0;
async function check() {
  if (!phone) return;
  const n = ++asked;
  checking.value = true;
  const r = await nativeVoiceInfo();
  if (n !== asked) return;
  info.value = r;
  checking.value = false;
  // the phone answers it works now: a problem kept from an earlier cue is over (fixed in the phone's settings, say)
  if (r?.ready && !r.problem && r.english !== false && voiceResult.value?.problem) voiceResult.value = null;
}
// the browser or computer: its English voices, whose list can fill a moment late
const sysVoices = ref<SpeechSynthesisVoice[]>([]), voicesRead = ref(false);
function readVoices() {
  try { sysVoices.value = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en")); voicesRead.value = speechSynthesis.getVoices().length > 0; }
  catch { voicesRead.value = true; }
}
const onVisible = () => { if (document.visibilityState === "visible") void check(); };
onMounted(() => {
  if (phone) { void check(); document.addEventListener("visibilitychange", onVisible); return; }
  if (typeof speechSynthesis === "undefined") { voicesRead.value = true; return; }
  readVoices();
  speechSynthesis.addEventListener("voiceschanged", readVoices);
  // a browser without any voice never fires voiceschanged: after a second, an empty list is the answer
  setTimeout(() => { voicesRead.value = true; }, 1000);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisible);
  if (typeof speechSynthesis !== "undefined") speechSynthesis.removeEventListener("voiceschanged", readVoices);
});
watch(voiceResult, () => void check());

// Readable, distinct names for the engine's English voices. A voice the engine has both downloaded and online
// ("en-gb-x-gbd-local", "…-network") is one voice, the downloaded copy used; "Needs the internet" only when it has no
// downloaded copy. The engine's default is plain "British English"; another is named after its speaker when the engine
// gives a real name ("British English · Serena"), else "British English, woman's voice 1" (when the name tells), else
// "British English, voice 2", numbered in a stable order by the engine's name for it.
const langName = (tag: string) => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag; } catch { return tag; } };
const base = (name: string) => name.replace(/[-_#](local|network)$/i, "");
function realName(name: string, lang: string) {
  const rest = base(name).replace(new RegExp(`^${lang.replace(/[-_]/g, "[-_]")}[-_#]?`, "i"), "");
  return /^[A-Z][a-z]{2,}$/.test(rest) ? rest : "";
}
const genderOf = (name: string) => (/SMTf|female/i.test(name) ? "woman's " : /SMTm|(^|[^e])male/i.test(name) ? "man's " : "");
const phoneVoices = computed(() => {
  const groups = new Map<string, { names: string[]; lang: string; network: boolean; missing: boolean; local?: string }>();
  for (const v of info.value?.voices ?? []) {
    const k = base(v.name), g = groups.get(k) ?? { names: [], lang: v.lang, network: true, missing: true };
    g.names.push(v.name);
    if (!v.network) { g.network = false; g.local = v.name; }
    if (!v.missing) g.missing = false;
    groups.set(k, g);
  }
  // named against the engine's own default, not the voice chosen over it
  const dv = info.value?.defaultVoice ?? info.value?.voice, def = dv ? base(dv) : "";
  const list = [...groups].sort(([a, x], [b, y]) => x.lang.localeCompare(y.lang) || a.localeCompare(b));
  const counted = new Map<string, number>();
  return list.map(([k, g]) => {
    const lang = langName(g.lang), real = realName(k, g.lang), gender = genderOf(k);
    let label = lang;
    if (k !== def) {
      if (real) label = `${lang} · ${real}`;
      else { const c = `${g.lang}|${gender}`, n = (counted.get(c) ?? 0) + 1; counted.set(c, n); label = `${lang}, ${gender}voice ${n}`; }
    }
    return { value: g.local ?? g.names[0]!, names: g.names, label, hint: g.network ? "Needs the internet" : g.missing ? "Not downloaded yet" : undefined };
  });
});
const engineLabel = (pkg?: string | null) => (pkg ? info.value?.engines.find((e) => e.name === pkg)?.label ?? pkg : "");

const ownHint = phone ? "Only while Motus is open: with the screen locked, the phone's default speaks" : undefined;
const speakerOptions = computed(() => phone
  ? [{ value: "default", label: "Phone's default", hint: engineLabel(info.value?.defaultEngine) || undefined },
     ...(info.value?.engines ?? []).map((e) => ({ value: e.name, label: e.label })),
     { value: "own", label: OWN, hint: ownHint }]
  : [{ value: "default", label: app.desktop ? "Computer's default" : "Browser's default" },
     ...sysVoices.value.map((v) => ({ value: v.voiceURI, label: v.name, hint: v.localService ? langName(v.lang) : `${langName(v.lang)} · Needs the internet` })),
     { value: "own", label: OWN }]);
// a choice no longer on this device (or not known until the check answers) shows as the default, which is what speaks then
const speaker = computed(() => {
  if (voiceChoice.value.own) return "own";
  const v = phone ? voiceChoice.value.engine : voiceChoice.value.voice;
  return v && speakerOptions.value.some((o) => o.value === v) ? v : "default";
});
const labelOf = (opts: { value: string; label: string }[], v: string) => opts.find((o) => o.value === v)?.label ?? "";
// what each option sounds like, before it is chosen
function pickOf(v: string): VoiceChoice {
  if (v === "own") return { own: true };
  if (phone) return { engine: v === "default" ? null : v };
  return { voice: v === "default" ? null : v };
}
function pickSpeaker(v: string) {
  if (v === "own") setVoiceChoice({ own: true });
  else if (phone) setVoiceChoice({ engine: v === "default" ? null : v });
  else setVoiceChoice({ voice: v === "default" ? null : v });
  void check();
}
// the phone's voice, among the English voices of the engine in use
const voiceOptions = computed(() => [{ value: "", label: "The engine's default" }, ...phoneVoices.value]);
const voicePick = computed(() => {
  const v = voiceChoice.value.voiceEngine === info.value?.engine ? voiceChoice.value.voice : null;
  return (v && phoneVoices.value.find((o) => o.names.includes(v))?.value) || "";
});
const hearVoice = (v: string) => previewVoice(props.prefs, { engine: info.value?.engine ?? null, voice: v || null }, failed(labelOf(voiceOptions.value, v)));
// a voice heard from its play button that couldn't speak: said with its name, as only that one is meant
const failed = (label: string) => (why: VoiceProblem) => toast(`${label} couldn't speak: ${pickProblem(why)}`, { kind: "err", ms: 8000 });
function pickVoice(v: string) {
  setVoiceChoice({ engine: voiceChoice.value.engine ?? null, voice: v || null, voiceEngine: v ? info.value?.engine ?? null : null });
  void check();
}
const showVoices = computed(() => phone && !voiceChoice.value.own && !!info.value?.ready && phoneVoices.value.length > 0);

// the status: what speaks, then whether it works or why not, in the words of the message that said so
const problem = computed<VoiceProblem | null>(() => {
  if (voiceChoice.value.own) return voiceResult.value?.problem ?? null;
  if (voiceResult.value) return voiceResult.value.problem;
  if (phone) return info.value?.problem ?? (info.value?.ready && info.value.english === false ? "language" : null);
  return voicesRead.value && !sysVoices.value.length ? "language" : null;
});
const ownSpeaks = computed(() => voiceChoice.value.own || voiceResult.value?.by === "own" || (!!problem.value && voiceProblem(problem.value).own));
const who = computed(() => {
  if (ownSpeaks.value) return OWN;
  if (phone) {
    const i = info.value;
    // before an answer, or with no engine running, the problem (if any) follows this
    if (!i) return checking.value ? "Checking the phone's speech…" : "The phone's speech engine";
    if (!i.ready) return i.starting || checking.value ? "Starting the phone's speech engine…" : "The phone's speech engine";
    const v = phoneVoices.value.find((x) => x.names.includes(i.voice ?? ""));
    return [engineLabel(i.engine) || "Phone's default", v?.label].filter(Boolean).join(" · ");
  }
  const v = sysVoices.value.find((x) => x.voiceURI === voiceChoice.value.voice) ?? sysVoices.value.find((x) => x.default) ?? sysVoices.value[0];
  return v?.name ?? "-";
});
const state = computed<{ text: string; tone: "pos" | "neg" | "" } | null>(() => {
  if (problem.value) {
    const p = voiceProblem(problem.value);
    // no English voice in a browser or on a computer is no fault: Motus's own voice is there for that
    return { tone: phone || !p.own ? "neg" : "", text: p.short ? `${p.cause}. ${p.short}` : p.cause };
  }
  if (voiceChoice.value.own) return phone ? { tone: "", text: ownHint! } : { tone: "pos", text: "Ready" };
  if (phone && checking.value && !info.value) return null;
  const worked = voiceResult.value?.problem === null || (phone && info.value?.said);
  if (worked) return { tone: "pos", text: "Working" };
  if (phone ? info.value?.ready : sysVoices.value.length) return { tone: "pos", text: "Ready" };
  return null;
});
// the phone's own settings, where engines are chosen and voices downloaded; coming back from there checks again
const menu = [
  { label: "Open the phone's speech settings", icon: "settings", run: () => { nativeOpenSpeechSettings(); } },
  { label: "Check again", icon: "refresh", run: () => { void check(); } },
];
</script>

<template>
  <div class="li"><div class="grow"><div class="t">Voice {{ device === "browser" ? "in" : "on" }} this {{ device }}</div><div class="s">{{ who }}<template v-if="state"> · <span :class="state.tone">{{ state.text }}</span></template></div></div>
    <Menu v-if="phone" label="Voice options" :items="menu" />
  </div>
  <div class="li"><div class="grow"><div class="t">Speaks with</div><div class="s">Chosen for this {{ device }} only</div></div>
    <AppSelect :model-value="speaker" :options="speakerOptions" title="Speaks with" @update:model-value="pickSpeaker">
      <template #end="{ option }">
        <button type="button" class="ib sm plain" :aria-label="`Play ${option.label}`" :title="`Play ${option.label}`" @click.stop="previewVoice(props.prefs, pickOf(option.value), failed(option.label))"><Icon name="play" /></button>
      </template>
    </AppSelect>
    <button type="button" class="ib sm plain" :aria-label="`Play ${labelOf(speakerOptions, speaker)}`" :title="`Play ${labelOf(speakerOptions, speaker)}`" @click="previewVoice(props.prefs)"><Icon name="play" /></button>
  </div>
  <div v-if="showVoices" class="li"><div class="grow"><div class="t">English voice</div><div class="s">From {{ engineLabel(info?.engine) || "the phone's default engine" }}</div></div>
    <AppSelect :model-value="voicePick" :options="voiceOptions" title="English voice" @update:model-value="pickVoice">
      <template #end="{ option }">
        <button type="button" class="ib sm plain" :aria-label="`Play ${option.label}`" :title="`Play ${option.label}`" @click.stop="hearVoice(option.value)"><Icon name="play" /></button>
      </template>
    </AppSelect>
    <button type="button" class="ib sm plain" :aria-label="`Play ${labelOf(voiceOptions, voicePick)}`" :title="`Play ${labelOf(voiceOptions, voicePick)}`" @click="previewVoice(props.prefs)"><Icon name="play" /></button>
  </div>
</template>

