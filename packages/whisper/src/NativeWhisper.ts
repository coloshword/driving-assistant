import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type VadResult = { isSpeech: boolean; prob: number };

export interface Spec extends TurboModule {
  /** Load a ggml whisper model (e.g. ggml-tiny.en-q5_1.bin). Replaces any loaded model. */
  loadModel: (modelPath: string) => Promise<boolean>;

  /**
   * Transcribe 16 kHz mono int16 PCM samples. Returns the transcript text.
   * Samples are expected as raw int16 values (-32768..32767), as delivered by
   * @picovoice/react-native-voice-processor.
   */
  pcmBufferToText(pcmBuffer: number[]): Promise<string>;

  /**
   * Bias the decoder towards domain vocabulary (app names, artists, contacts).
   * Passed as whisper's initial_prompt on every decode.
   */
  setVocabulary(prompt: string): Promise<void>;

  /** Load the Silero VAD model (ggml-silero-v6.2.0.bin). */
  initVad: (vadPath: string) => Promise<boolean>;

  /** Run VAD on one frame of 16 kHz int16 PCM. */
  vadProcessBuffer(pcmBuffer: number[]): Promise<VadResult>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DAWhisper');
