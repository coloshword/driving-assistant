import RNFS from 'react-native-fs';
import NativeWhisper from 'da-whisper/src/NativeWhisper';
import NativeKokoro from 'da-kokoro/src/NativeKokoro';
import { PREF_KEYS, getPref } from './storage';

export type WhisperModelChoice = 'tiny' | 'base';

const WHISPER_FILES: Record<WhisperModelChoice, string> = {
  tiny: 'ggml-tiny.en-q5_1.bin',
  base: 'ggml-base.en-q5_1.bin',
};
const VAD_FILENAME = 'ggml-silero-v6.2.0.bin';
export type KokoroModelChoice = 'int8' | 'fp32';
const KOKORO_DIRS: Record<KokoroModelChoice, string> = {
  int8: 'sherpa-onnx-kokoro-int8-en-v0_19',
  fp32: 'sherpa-onnx-kokoro-en-v0_19',
};

export const bundlePath = (name: string) => `${RNFS.MainBundlePath}/${name}`;

export type ModelLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

let loaded = false;
let loadedWhisper: WhisperModelChoice | null = null;
let loadedKokoro: KokoroModelChoice | null = null;

export async function availableKokoroModels(): Promise<KokoroModelChoice[]> {
  const out: KokoroModelChoice[] = [];
  for (const choice of Object.keys(KOKORO_DIRS) as KokoroModelChoice[]) {
    if (await RNFS.exists(bundlePath(KOKORO_DIRS[choice]))) out.push(choice);
  }
  return out;
}

export async function availableWhisperModels(): Promise<WhisperModelChoice[]> {
  const out: WhisperModelChoice[] = [];
  for (const choice of Object.keys(WHISPER_FILES) as WhisperModelChoice[]) {
    if (await RNFS.exists(bundlePath(WHISPER_FILES[choice]))) out.push(choice);
  }
  return out;
}

/** Load whisper + VAD + Kokoro once. Safe to call repeatedly. */
export async function loadModels(onProgress?: (msg: string) => void): Promise<void> {
  const pref = ((await getPref(PREF_KEYS.whisperModel)) as WhisperModelChoice | null) ?? 'tiny';
  const available = await availableWhisperModels();
  const choice: WhisperModelChoice = available.includes(pref) ? pref : available[0] ?? 'tiny';

  const kokoroPref = ((await getPref(PREF_KEYS.kokoroModel)) as KokoroModelChoice | null) ?? 'fp32';
  const kokoroAvailable = await availableKokoroModels();
  const kokoroChoice: KokoroModelChoice = kokoroAvailable.includes(kokoroPref) ? kokoroPref : kokoroAvailable[0] ?? 'fp32';

  if (loaded && loadedWhisper === choice && loadedKokoro === kokoroChoice) return;

  if (loadedWhisper !== choice) {
    onProgress?.(`Loading speech model (${choice})`);
    await NativeWhisper.loadModel(bundlePath(WHISPER_FILES[choice]));
    loadedWhisper = choice;
  }

  if (loadedKokoro !== kokoroChoice) {
    onProgress?.(`Loading voice (${kokoroChoice})`);
    await NativeKokoro.loadModel(bundlePath(KOKORO_DIRS[kokoroChoice]));
    loadedKokoro = kokoroChoice;
  }

  if (!loaded) {
    onProgress?.('Loading voice activity model');
    await NativeWhisper.initVad(bundlePath(VAD_FILENAME));
    await NativeKokoro.configureAudioSession({
      category: 'playAndRecord',
      duckOthers: true,
      mixWithOthers: true,
      defaultToSpeaker: true,
      allowBluetooth: true,
    });
  }
  loaded = true;
}

export function modelsLoaded(): boolean {
  return loaded;
}
