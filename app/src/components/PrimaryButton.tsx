import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

type Props = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  /** Smaller inline size (Settings rows). Default is the big car-friendly size. */
  compact?: boolean;
  style?: ViewStyle;
  testID?: string;
};

/**
 * Big rounded pill button. Sized for glance-and-tap use in a car.
 */
export default function PrimaryButton({ title, onPress, variant = 'primary', disabled, loading, compact, style, testID }: Props) {
  const isDisabled = disabled || loading;
  const textColor =
    variant === 'destructive' ? colors.destructive : variant === 'ghost' ? colors.muted : variant === 'secondary' ? colors.text : colors.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      hitSlop={compact ? 6 : 0}
      style={({ pressed }) => [
        styles.base,
        compact ? styles.compact : styles.big,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.text, compact ? styles.textCompact : styles.textBig, { color: textColor }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  big: {
    minHeight: 60,
    paddingHorizontal: 32,
    paddingVertical: 16,
    alignSelf: 'stretch',
  },
  compact: {
    minHeight: 44,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  primary: {
    backgroundColor: colors.accentBg,
    borderColor: colors.accentBorder,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  destructive: {
    backgroundColor: colors.destructiveBg,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    fontWeight: '700',
  },
  textBig: {
    fontSize: 19,
  },
  textCompact: {
    fontSize: 15,
  },
});
