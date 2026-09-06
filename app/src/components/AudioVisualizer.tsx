import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { VoiceProcessor } from '@picovoice/react-native-voice-processor';
import type { VoiceListenerState } from './VoiceListener';

interface Props {
  mode?: VoiceListenerState;
  speaking?: boolean;
}

const NUM_BARS = 5;
const MIN_HEIGHT = 8;
const MAX_HEIGHT = 72;
const BAR_OFFSETS = [0, 90, 170, 250, 340];
const SMOOTHING = 0.25;

function computeRms(frame: number[]): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] / 32768.0;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

/** Five bars that follow the mic level while the user talks, pulse while the assistant talks. */
export default function AudioVisualizer({ mode = 'disabled', speaking = false }: Props) {
  const heights = useRef(Array.from({ length: NUM_BARS }, () => new Animated.Value(MIN_HEIGHT))).current;
  const smoothed = useRef(0);
  const modeRef = useRef(mode);
  const speakingRef = useRef(speaking);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { speakingRef.current = speaking; }, [speaking]);

  useEffect(() => {
    const listener = (frame: number[]) => {
      const rms = computeRms(frame);
      smoothed.current = SMOOTHING * rms + (1 - SMOOTHING) * smoothed.current;
      const userSpeaking = modeRef.current === 'speaking';
      heights.forEach((anim, i) => {
        const target = userSpeaking
          ? MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * Math.min(smoothed.current * 12, 1) * (0.5 + 0.5 * Math.sin(Date.now() / 80 + BAR_OFFSETS[i] * 0.01))
          : MIN_HEIGHT;
        Animated.spring(anim, { toValue: target, useNativeDriver: false, damping: 12, stiffness: 180 }).start();
      });
    };
    VoiceProcessor.instance.addFrameListener(listener);
    return () => VoiceProcessor.instance.removeFrameListener(listener);
  }, [heights]);

  // Assistant speaking: gentle synthetic pulse (mic is off while TTS plays).
  useEffect(() => {
    if (!speaking) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      heights.forEach((anim, i) => {
        const target = MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * 0.5 * (0.55 + 0.45 * Math.sin(Date.now() / 140 + BAR_OFFSETS[i] * 0.02));
        Animated.spring(anim, { toValue: target, useNativeDriver: false, damping: 10, stiffness: 120 }).start();
      });
      setTimeout(tick, 90);
    };
    tick();
    return () => { alive = false; };
  }, [speaking, heights]);

  return (
    <View style={styles.root}>
      <View style={styles.wave}>
        {heights.map((anim, i) => (
          <Animated.View key={i} style={[styles.bar, speaking && styles.barSpeaking, { height: anim }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: 150, width: '100%', alignItems: 'center', justifyContent: 'center' },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 8, height: MAX_HEIGHT + 4 },
  bar: { width: 8, borderRadius: 999, backgroundColor: '#e8fff6', opacity: 0.8 },
  barSpeaking: { backgroundColor: '#22c55e' },
});
