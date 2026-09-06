import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type AudioSessionOptions = {
  /** 'playback' (WorkFromCar default) or 'playAndRecord' (keeps the mic route alive; lets other audio keep playing). */
  category: string;
  /** Lower other apps' audio (e.g. Spotify) while we speak, restore afterwards. */
  duckOthers: boolean;
  /** Mix with other audio instead of interrupting it. */
  mixWithOthers: boolean;
  /** Route to the loudspeaker when no headset/car is connected (playAndRecord only). */
  defaultToSpeaker: boolean;
  /** Allow Bluetooth HFP + A2DP routes (car stereos, headsets). */
  allowBluetooth: boolean;
};

export interface Spec extends TurboModule {
  /** Load the Kokoro model directory (model.onnx, voices.bin, tokens.txt, espeak-ng-data/). */
  loadModel: (modelDir: string) => Promise<boolean>;

  /** Configure how the AVAudioSession is set up before each speak(). */
  configureAudioSession(options: AudioSessionOptions): Promise<void>;

  /**
   * Synthesize and play `text`. Resolves once playback has finished.
   * speakerId selects a Kokoro voice (0 = af, the default American female voice).
   */
  speak(text: string, speed: number, speakerId: number): Promise<void>;

  /** Stop any in-progress speech immediately. */
  stop(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DAKokoro');
