import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { IntegrationId } from '../services/integrations/types';

type Props = { id: IntegrationId; size?: number };

/** Brand-ish colour per integration; glyphs are simple hand-drawn SVG, no assets. */
const BRAND: Record<IntegrationId, { bg: string; fg: string; letter: string }> = {
  spotify: { bg: '#1DB954', fg: '#08110e', letter: 'S' },
  imessage: { bg: '#34C759', fg: '#ffffff', letter: 'M' },
  phone: { bg: '#30D158', fg: '#ffffff', letter: 'P' },
  slack: { bg: '#4A154B', fg: '#ffffff', letter: '#' },
  discord: { bg: '#5865F2', fg: '#ffffff', letter: 'D' },
  messenger: { bg: '#0084FF', fg: '#ffffff', letter: 'm' },
};

function Glyph({ id, fg }: { id: IntegrationId; fg: string }) {
  switch (id) {
    case 'spotify':
      // three curved "sound waves"
      return (
        <>
          <Path d="M7 9.5c4-1.2 8.5-1 12 1" stroke={fg} strokeWidth={2.4} strokeLinecap="round" fill="none" />
          <Path d="M7.5 12.8c3.5-1 7-0.8 10 .9" stroke={fg} strokeWidth={2.1} strokeLinecap="round" fill="none" />
          <Path d="M8 16c2.8-.8 5.5-.6 8 .8" stroke={fg} strokeWidth={1.8} strokeLinecap="round" fill="none" />
        </>
      );
    case 'imessage':
    case 'messenger':
      // speech bubble
      return (
        <Path
          d="M12 5c-4.4 0-8 3-8 6.7 0 2 1 3.7 2.6 4.9L6 20l3.6-1.6c.8.2 1.6.3 2.4.3 4.4 0 8-3 8-6.7S16.4 5 12 5z"
          fill={fg}
        />
      );
    case 'phone':
      return (
        <Path
          d="M7.2 4.5c.5-.5 1.3-.5 1.8 0l2 2.3c.5.5.4 1.3-.1 1.8l-1.2 1.1c.9 2 2.6 3.7 4.6 4.6l1.1-1.2c.5-.5 1.3-.6 1.8-.1l2.3 2c.5.5.5 1.3 0 1.8l-1.3 1.4c-.7.7-1.8 1-2.8.7-4.6-1.4-8.2-5-9.6-9.6-.3-1 0-2.1.7-2.8z"
          fill={fg}
        />
      );
    case 'slack':
      // four pills in a pinwheel
      return (
        <>
          <Rect x="5" y="10" width="8" height="3.2" rx="1.6" fill={fg} />
          <Rect x="11" y="5" width="3.2" height="8" rx="1.6" fill={fg} />
          <Rect x="11" y="10.8" width="8" height="3.2" rx="1.6" fill={fg} />
          <Rect x="9.8" y="11" width="3.2" height="8" rx="1.6" fill={fg} />
        </>
      );
    case 'discord':
      // controller-ish face with two eyes
      return (
        <>
          <Path d="M5 8.5C7 7 9.5 6.5 12 6.5s5 .5 7 2c1 3 1.3 5.5 1 8-1.5 1-3 1.6-4.5 1.9l-.8-1.5c-1.8.4-3.6.4-5.4 0l-.8 1.5C7 18.1 5.5 17.5 4 16.5c-.3-2.5 0-5 1-8z" fill={fg} />
          <Circle cx="9.3" cy="12.5" r="1.4" fill={BRAND.discord.bg} />
          <Circle cx="14.7" cy="12.5" r="1.4" fill={BRAND.discord.bg} />
        </>
      );
    default:
      return null;
  }
}

/** Rounded square badge with a simple glyph, falls back to a letter. */
export default function AppLogo({ id, size = 56 }: Props) {
  const brand = BRAND[id] ?? { bg: '#22c55e', fg: '#08110e', letter: '?' };
  const radius = size * 0.24;
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: radius, backgroundColor: brand.bg }]}>
      {BRAND[id] ? (
        <Svg width={size * 0.7} height={size * 0.7} viewBox="0 0 24 24">
          <Glyph id={id} fg={brand.fg} />
        </Svg>
      ) : (
        <Text style={[styles.letter, { color: brand.fg, fontSize: size * 0.45 }]}>{brand.letter}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontWeight: '800',
  },
});
