import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

export type PillOption<T extends string | number> = { value: T; label: string };

type Props<T extends string | number> = {
  options: PillOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Horizontal scroll (many options) vs. wrapping row. */
  scroll?: boolean;
  /** Fill the width equally (segmented control look). */
  segmented?: boolean;
};

/** Row of selectable pills. Big enough to tap without looking. */
export default function PillGroup<T extends string | number>({ options, value, onChange, scroll, segmented }: Props<T>) {
  const pills = options.map((o) => {
    const selected = o.value === value;
    return (
      <Pressable
        key={String(o.value)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onChange(o.value)}
        style={({ pressed }) => [styles.pill, segmented && styles.pillSegmented, selected && styles.pillSelected, pressed && styles.pressed]}
      >
        <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
          {o.label}
        </Text>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollRow}>
        {pills}
      </ScrollView>
    );
  }
  return <View style={[styles.wrapRow, segmented && styles.segmentedRow]}>{pills}</View>;
}

const styles = StyleSheet.create({
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  segmentedRow: {
    flexWrap: 'nowrap',
  },
  scrollRow: {
    gap: 10,
    paddingVertical: 2,
  },
  pill: {
    minHeight: 46,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSegmented: {
    flex: 1,
  },
  pillSelected: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accentBorder,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: '600',
  },
  labelSelected: {
    color: colors.accent,
  },
});
