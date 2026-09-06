import NativeKokoro from 'da-kokoro/src/NativeKokoro';
import { PREF_KEYS, getPref } from './storage';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Kokoro v0.19 voices (index into voices.bin). */
export const KOKORO_VOICES = [
  { id: 0, name: 'af', label: 'Default (American, female)' },
  { id: 1, name: 'af_bella', label: 'Bella' },
  { id: 2, name: 'af_nicole', label: 'Nicole' },
  { id: 3, name: 'af_sarah', label: 'Sarah' },
  { id: 4, name: 'af_sky', label: 'Sky' },
  { id: 5, name: 'am_adam', label: 'Adam (American, male)' },
  { id: 6, name: 'am_michael', label: 'Michael' },
  { id: 7, name: 'bf_emma', label: 'Emma (British, female)' },
  { id: 8, name: 'bf_isabella', label: 'Isabella' },
  { id: 9, name: 'bm_george', label: 'George (British, male)' },
  { id: 10, name: 'bm_lewis', label: 'Lewis' },
];

let ttsGeneration = 0;

export type SpeakOptions = {
  speed?: number;
  /** Called right before audio starts (mic must already be paused). */
  onStart?: () => void;
};

/**
 * Speak `text`, resolving when playback has finished. Callers pause the mic
 * first (VoiceListener state 'disabled') so the assistant does not hear itself.
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  const gen = ++ttsGeneration;
  const speed = opts.speed ?? Number((await getPref(PREF_KEYS.ttsSpeed)) ?? '1.05');
  const voice = Number((await getPref(PREF_KEYS.ttsVoice)) ?? '0');
  try {
    await NativeKokoro.stop();
    await sleep(60); // let the mic session settle
    if (gen !== ttsGeneration) return;
    opts.onStart?.();
    await NativeKokoro.speak(clean, speed, voice);
  } catch (e: any) {
    console.log('[tts] speak error:', e?.message ?? e);
  }
}

export async function stopSpeaking(): Promise<void> {
  ttsGeneration++;
  try {
    await NativeKokoro.stop();
  } catch {
    /* ignore */
  }
}
