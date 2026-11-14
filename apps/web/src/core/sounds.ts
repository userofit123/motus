// The sounds both timers offer, in one list with one order and one name each: the rest timer's choices (Settings →
// Workout defaults → Workout sounds) and each part of the interval timer. The ids saved differ between the two (rest
// timer: WORKOUT_SOUNDS, interval timer: INTERVAL_SOUNDS in @motus/shared) and stay as they are; `cue` and `iv` are the
// same sound's id in each. The countdown sound offers only the ones with a single note (TICK_SOUNDS): a tune can't be
// a 3-2-1.
import { TICK_SOUNDS, type IntervalSound, type TickSound, type WorkoutSound } from "@motus/shared";

interface Sound { name: string; cue: WorkoutSound; iv: Exclude<IntervalSound, "none"> }
// short ones first, then the tunes, the soft alarms, and the ones that ring out
export const SOUNDS: Sound[] = [
  { name: "Bright", cue: "beep", iv: "bright" },
  { name: "Bell", cue: "bell", iv: "beep" },
  { name: "Round", cue: "soft", iv: "low" },
  { name: "Digital", cue: "digital", iv: "digital" },
  { name: "Marimba", cue: "wood", iv: "marimba" },
  { name: "Click", cue: "click", iv: "click" },
  { name: "Double bell", cue: "double", iv: "double" },
  { name: "Three bells", cue: "triple", iv: "triple" },
  { name: "High", cue: "high", iv: "high" },
  { name: "Rising", cue: "rising", iv: "rising" },
  { name: "Chime", cue: "chime", iv: "chime" },
  { name: "Pulse", cue: "pulse", iv: "pulse" },
  { name: "Soft alarm", cue: "softAlarm", iv: "softAlarm" },
  { name: "Wake", cue: "wake", iv: "wake" },
  { name: "Small gong", cue: "smallGong", iv: "gong" },
  { name: "Hand bell", cue: "handBell", iv: "handBell" },
  { name: "Ship's bell", cue: "shipBell", iv: "shipBell" },
  { name: "Tubular bell", cue: "tubular", iv: "tubular" },
  { name: "Temple bell", cue: "temple", iv: "temple" },
  { name: "Singing bowl", cue: "bowl", iv: "bowl" },
  { name: "Deep gong", cue: "gong", iv: "deepGong" },
];
const isTick = (id: string): id is TickSound => (TICK_SOUNDS as readonly string[]).includes(id);
/** The rest over sound's choices */
export const CUE_SOUND_OPTIONS = SOUNDS.map((s) => ({ value: s.cue as string, label: s.name }));
/** The countdown sound's choices: the same list without the tunes */
export const TICK_SOUND_OPTIONS = CUE_SOUND_OPTIONS.filter((o) => isTick(o.value));
/** An interval part's choices: the same list, and None for a part that starts in silence */
export const INTERVAL_SOUND_OPTIONS: { value: IntervalSound; label: string }[] = [...SOUNDS.map((s) => ({ value: s.iv, label: s.name })), { value: "none", label: "None" }];
export const intervalSoundName = (id: IntervalSound) => INTERVAL_SOUND_OPTIONS.find((o) => o.value === id)?.label ?? "";
/** The rest timer's id of an interval sound (none for "none") */
export const cueOfInterval = (id: IntervalSound) => SOUNDS.find((s) => s.iv === id)?.cue;
