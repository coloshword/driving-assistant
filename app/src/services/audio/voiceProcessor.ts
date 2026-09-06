import { VoiceProcessor, VoiceProcessorFrameListener } from '@picovoice/react-native-voice-processor';

/**
 * Thin wrapper over Picovoice's VoiceProcessor (mic capture -> int16 PCM frames).
 * 16 kHz mono, 512-sample frames (32 ms) which is what Silero VAD expects.
 */
export const FREQUENCY_HZ = 16000;
export const FRAME_LENGTH = 512;

let vadFrameListener: VoiceProcessorFrameListener | null = null;

export async function startVadStreaming(onFrame: (frame: number[]) => void): Promise<void> {
  if (vadFrameListener) VoiceProcessor.instance.removeFrameListener(vadFrameListener);
  vadFrameListener = (frame: number[]) => onFrame(frame);
  VoiceProcessor.instance.addFrameListener(vadFrameListener);
  await VoiceProcessor.instance.start(FRAME_LENGTH, FREQUENCY_HZ);
}

export async function stopVadStreaming(): Promise<void> {
  if (vadFrameListener) {
    VoiceProcessor.instance.removeFrameListener(vadFrameListener);
    vadFrameListener = null;
  }
  try {
    await VoiceProcessor.instance.stop();
  } catch (e) {
    console.log('[audio] stop failed', e);
  }
}

/** Trigger the iOS microphone permission prompt early (onboarding). */
export async function requestMicPermission(): Promise<boolean> {
  try {
    return await VoiceProcessor.instance.hasRecordAudioPermission();
  } catch {
    try {
      await VoiceProcessor.instance.start(FRAME_LENGTH, FREQUENCY_HZ);
      await VoiceProcessor.instance.stop();
      return true;
    } catch {
      return false;
    }
  }
}
