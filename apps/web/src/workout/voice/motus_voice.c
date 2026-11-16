/* Motus's built-in voice: Flite (CMU, BSD-style licence in public/licenses/flite.txt) with its "slt" US English voice, built
 * to WebAssembly by build.sh. Used for Voice cues when the device has no English voice (a Linux browser or the
 * desktop app without speech-dispatcher, a phone without an English voice), so the cues work with nothing installed.
 * This file is Motus's own, not part of Flite: the small entry points the page calls (builtinVoice.ts). */
#include <stdlib.h>
#include "flite.h"

cst_voice *register_cmu_us_slt(const char *voxdir);

static cst_voice *voice;
static cst_wave *last;

/* Speaks `text` into a wave and returns its 16-bit samples (motus_samples() of them, at motus_rate() Hz), kept until
 * the next call. NULL when nothing came out. */
__attribute__((export_name("motus_say"))) short *motus_say(const char *text) {
  if (!voice) { flite_init(); voice = register_cmu_us_slt(NULL); }
  if (last) { delete_wave(last); last = NULL; }
  last = flite_text_to_wave(text, voice);
  return last ? last->samples : NULL;
}
__attribute__((export_name("motus_samples"))) int motus_samples(void) { return last ? last->num_samples : 0; }
__attribute__((export_name("motus_rate"))) int motus_rate(void) { return last ? last->sample_rate : 0; }
/* the page writes the text into memory it asks for here */
__attribute__((export_name("motus_alloc"))) void *motus_alloc(int n) { return malloc(n); }
__attribute__((export_name("motus_free"))) void motus_free(void *p) { free(p); }
