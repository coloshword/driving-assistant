import { useEffect, useRef } from 'react';
import NativeWhisper from 'da-whisper/src/NativeWhisper';
import { startVadStreaming, stopVadStreaming } from '../services/audio/voiceProcessor';

/**
 * VAD-gated speech capture (ported from WorkFromCar's VoiceListener).
 *
 * The mic streams 32 ms frames. Each frame goes through Silero VAD; when speech
 * starts we keep a short pre-roll (ring buffer) so the first syllable is not
 * clipped, accumulate frames while speech continues, and after
 * SILENCE_FRAMES of quiet we hand the utterance to whisper.
 *
 * States: 'listening' (waiting for speech) -> 'speaking' (capturing) ->
 * 'transcribing' -> back to 'listening'. 'disabled' pauses the mic entirely
 * (used while the assistant talks or is thinking).
 */
export type VoiceListenerState = 'listening' | 'speaking' | 'transcribing' | 'disabled';

const SILENCE_FRAMES = 28;            // ~0.9 s of silence ends an utterance
const MIN_SPEECH_FRAMES = 8;          // ignore blips shorter than ~0.25 s
const MAX_SPEECH_SAMPLES = 16000 * 25; // hard cap: 25 s
const RING_BUFFER_SIZE = 10;          // ~0.3 s pre-roll
const SPEECH_PROB = 0.45;

interface Props {
  state: VoiceListenerState;
  onStateChange: (state: VoiceListenerState) => void;
  onTranscript: (text: string) => void;
  onVadProb?: (prob: number) => void;
}

export default function VoiceListener({ state, onStateChange, onTranscript, onVadProb }: Props) {
  const stateRef = useRef<VoiceListenerState>(state);
  const onStateChangeRef = useRef(onStateChange);
  const onTranscriptRef = useRef(onTranscript);
  const onVadProbRef = useRef(onVadProb);

  const isActive = state !== 'disabled';

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onVadProbRef.current = onVadProb; }, [onVadProb]);

  useEffect(() => {
    if (!isActive) return;

    let isMounted = true;
    let vadBusy = false;
    let lastVadIsSpeech = false;
    let silenceFrameCount = 0;
    let speechFrameCount = 0;
    const speechBuffer: number[] = [];
    const ringBuffer: number[][] = [];
    let ringBufferIndex = 0;

    const setState = (s: VoiceListenerState) => {
      stateRef.current = s;
      onStateChangeRef.current(s);
    };

    const getRingBufferContents = (): number[] => {
      const result: number[] = [];
      const count = Math.min(ringBufferIndex, RING_BUFFER_SIZE);
      const start = ringBufferIndex - count;
      for (let i = start; i < ringBufferIndex; i++) {
        const f = ringBuffer[i % RING_BUFFER_SIZE];
        for (let j = 0; j < f.length; j++) result.push(f[j]);
      }
      return result;
    };

    const reset = () => {
      speechBuffer.length = 0;
      silenceFrameCount = 0;
      speechFrameCount = 0;
      lastVadIsSpeech = false;
    };

    const triggerTranscription = () => {
      if (speechBuffer.length === 0 || speechFrameCount < MIN_SPEECH_FRAMES) {
        reset();
        setState('listening');
        return;
      }
      setState('transcribing');
      const buffer = speechBuffer.slice();
      reset();

      NativeWhisper.pcmBufferToText(buffer)
        .then((text) => {
          if (!isMounted) return;
          onTranscriptRef.current(text);
        })
        .catch((err) => {
          console.log('[VoiceListener] transcription error:', err);
          if (!isMounted) return;
          setState('listening');
        });
    };

    const onFrame = (frame: number[]) => {
      ringBuffer[ringBufferIndex % RING_BUFFER_SIZE] = frame;
      ringBufferIndex++;

      const current = stateRef.current;
      if (current === 'disabled' || current === 'transcribing') return;

      if (current === 'speaking') {
        for (let j = 0; j < frame.length; j++) speechBuffer.push(frame[j]);
      }

      if (lastVadIsSpeech) {
        silenceFrameCount = 0;
        speechFrameCount++;
        if (current === 'listening') {
          const pre = getRingBufferContents();
          for (let j = 0; j < pre.length; j++) speechBuffer.push(pre[j]);
          setState('speaking');
        }
      } else if (current === 'speaking') {
        silenceFrameCount++;
        if (silenceFrameCount >= SILENCE_FRAMES || speechBuffer.length >= MAX_SPEECH_SAMPLES) {
          triggerTranscription();
          return;
        }
      }

      if (!vadBusy) {
        vadBusy = true;
        NativeWhisper.vadProcessBuffer(frame)
          .then(({ prob }) => {
            lastVadIsSpeech = prob > SPEECH_PROB;
            onVadProbRef.current?.(prob);
            vadBusy = false;
          })
          .catch(() => { vadBusy = false; });
      }
    };

    startVadStreaming(onFrame).catch((e) => console.log('[VoiceListener] mic start failed', e));

    return () => {
      isMounted = false;
      stopVadStreaming();
    };
  }, [isActive]);

  return null;
}
