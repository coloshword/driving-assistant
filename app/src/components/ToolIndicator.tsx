import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import type { AgentTool } from 'da-types';
import { getToolSpec } from 'da-tools';

interface Props {
  tool: AgentTool | null;
  lastTranscript?: string | null;
  lastReply?: string | null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '…';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Glass card showing what the user said, what the assistant is doing, and the tool being filled in. */
export default function ToolIndicator({ tool, lastTranscript, lastReply }: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const key = tool ? `${tool.tool}:${JSON.stringify(tool.toolParameters)}` : `${lastTranscript}|${lastReply}`;
  const prevKey = useRef<string | null>(null);

  useEffect(() => {
    if (key !== prevKey.current) {
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      prevKey.current = key;
    }
  }, [key, fade]);

  const spec = tool ? getToolSpec(tool.tool) : undefined;
  const params = tool?.toolParameters ?? null;
  const hasContent = !!(tool?.tool || lastTranscript || lastReply);
  if (!hasContent) return null;

  return (
    <View style={styles.glass}>
      <LinearGradient
        colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.08)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[styles.content, { opacity: fade }]}>
        {lastTranscript ? (
          <Text style={styles.transcript} numberOfLines={2}>“{lastTranscript}”</Text>
        ) : null}
        {lastReply ? (
          <Text style={styles.reply} numberOfLines={3}>{lastReply}</Text>
        ) : null}
        {tool?.tool ? (
          <View style={styles.toolBlock}>
            <View style={styles.header}>
              <Text style={styles.headerLabel}>{spec?.label ?? tool.tool}</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{tool.tool}</Text>
              </View>
            </View>
            {params && Object.keys(params).length > 0 ? (
              <View style={styles.params}>
                {Object.entries(params).map(([k, v]) => (
                  <View key={k} style={styles.row}>
                    <Text style={styles.label}>{k}</Text>
                    <Text style={[styles.value, (v === null || v === undefined) && styles.valueNull]} numberOfLines={2}>
                      {fmt(v)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  glass: { alignSelf: 'center', width: '90%', borderRadius: 16, padding: 14, marginTop: 20, overflow: 'hidden' },
  content: { gap: 10 },
  transcript: { color: 'rgba(232,255,246,0.7)', fontSize: 15, fontStyle: 'italic' },
  reply: { color: '#e8fff6', fontSize: 17, fontWeight: '600', lineHeight: 23 },
  toolBlock: { gap: 8, marginTop: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLabel: { color: 'rgba(232,255,246,0.9)', fontSize: 14, fontWeight: '700' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  badgeText: { color: 'rgba(154,164,178,0.9)', fontSize: 11 },
  params: { gap: 6 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  label: { color: 'rgba(154,164,178,0.7)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, width: 90, paddingTop: 2 },
  value: { color: '#e5e7eb', fontSize: 13, flex: 1 },
  valueNull: { color: 'rgba(229,231,235,0.4)', fontStyle: 'italic' },
});
