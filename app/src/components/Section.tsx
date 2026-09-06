import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

type Props = {
  title: string;
  /** Optional explanatory line under the title. */
  hint?: string;
  children: React.ReactNode;
};

/** Settings section: uppercase green label + a bordered card containing the rows. */
export default function Section({ title, hint, children }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/** A single row inside a Section. Rows are separated by a hairline. */
export function Row({ children, last, column }: { children: React.ReactNode; last?: boolean; column?: boolean }) {
  return <View style={[styles.row, column && styles.rowColumn, last && styles.rowLast]}>{children}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 28,
  },
  title: {
    color: 'rgba(34,197,94,0.75)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  hint: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowColumn: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
});
