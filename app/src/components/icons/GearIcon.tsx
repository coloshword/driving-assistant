import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

export default function GearIcon({ size = 24, color = '#e8fff6' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5l1.6 2.3 2.7-.6 1 2.6 2.6 1-.6 2.7 2.3 1.6-2.3 1.6.6 2.7-2.6 1-1 2.6-2.7-.6L12 21.5l-1.6-2.3-2.7.6-1-2.6-2.6-1 .6-2.7L2.5 12l2.3-1.6-.6-2.7 2.6-1 1-2.6 2.7.6L12 2.5z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3.2} stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}
