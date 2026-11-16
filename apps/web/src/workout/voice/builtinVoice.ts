// Motus's built-in voice for Voice cues: Flite's US English "slt" voice compiled to WebAssembly (motus_voice.c,
// build.sh). Used only when the device has no English voice of its own: Linux browsers and the desktop app without
// speech-dispatcher have none, so the cues would otherwise stay silent until the user installs one. Loaded the first
// time it is needed (this module and voice.wasm are their own files), then works offline: the service worker keeps it.
import wasmUrl from "./voice.wasm?url";

interface Flite {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  motus_say(text: number): number;
  motus_samples(): number;
  motus_rate(): number;
  motus_alloc(n: number): number;
  motus_free(p: number): void;
}

let ready: Promise<Flite> | null = null;
/** Loads the voice once; one that failed to load (offline before its first use) is tried again next time. */
function load() {
  ready ??= (async () => {
    const res = await fetch(wasmUrl);
    if (!res.ok) throw new Error(`voice ${res.status}`);
    let mem: WebAssembly.Memory | undefined;
    // Flite is built for WASI but only writes its rare error messages and reads the clock: every other call answers
    // "not supported" (52), as nothing here opens files
    const wasi = new Proxy({}, {
      get: (_, name) => name === "fd_write" ? (_fd: number, iovs: number, n: number, out: number) => {
        const v = new DataView(mem!.buffer); let len = 0;
        for (let k = 0; k < n; k++) len += v.getUint32(iovs + 8 * k + 4, true);
        v.setUint32(out, len, true); return 0;
      } : name === "clock_time_get" ? (_id: number, _prec: bigint, out: number) => {
        new DataView(mem!.buffer).setBigUint64(out, BigInt(Date.now()) * 1000000n, true); return 0;
      } : name === "proc_exit" ? (code: number) => { throw new Error(`voice exit ${code}`); } : () => 52,
    });
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), { wasi_snapshot_preview1: wasi });
    const f = instance.exports as unknown as Flite;
    mem = f.memory; f._initialize?.();
    return f;
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

/** Starts loading the voice ahead of the first cue (a rest with Voice cues starting), so it speaks on time. */
export function warmBuiltinVoice() { void load().catch(() => {}); }

/** `text` spoken by the built-in voice, as an audio buffer for the page's audio context; null if it gave no sound. */
export async function builtinVoice(ac: BaseAudioContext, text: string): Promise<AudioBuffer | null> {
  const f = await load();
  const bytes = new TextEncoder().encode(`${text}\0`), p = f.motus_alloc(bytes.length);
  new Uint8Array(f.memory.buffer).set(bytes, p);
  const at = f.motus_say(p);
  f.motus_free(p);
  const n = f.motus_samples(), rate = f.motus_rate();
  if (!at || !n || !rate) return null;
  const pcm = new Int16Array(f.memory.buffer, at, n), buf = ac.createBuffer(1, n, rate), out = buf.getChannelData(0);
  for (let i = 0; i < n; i++) out[i] = pcm[i]! / 32768;
  return buf;
}
