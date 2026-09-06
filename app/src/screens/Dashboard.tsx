import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IntegrationId } from 'da-tools';
import AudioVisualizer from '../components/AudioVisualizer';
import VoiceListener from '../components/VoiceListener';
import ToolIndicator from '../components/ToolIndicator';
import GearIcon from '../components/icons/GearIcon';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useAssistant } from '../services/agent/useAssistant';
import { connectedIntegrationIds } from '../services/integrations/registry';
import { contactNamesForVocabulary } from '../services/integrations/imessage';
import { loadModels } from '../services/models';
import { primeVocabulary } from '../services/vocabulary';
import { useDevLinks } from '../services/devLinks';

const HEADER_HEIGHT = 48;
/** Set to true to type commands instead of speaking (simulator without a mic, CI). */
const DEV_TEXT_MODE = __DEV__ && false;

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMsg, setStatusMsg] = useState('Loading models…');
  const [connected, setConnected] = useState<IntegrationId[]>([]);
  const [devText, setDevText] = useState('');
  const [appActive, setAppActive] = useState(true);

  const { state, setListenerState, handleTranscript } = useAssistant({
    connectedIntegrations: connected,
    enabled: modelStatus === 'ready' && !DEV_TEXT_MODE,
  });

  useDevLinks({ say: (text) => handleTranscript(text) });

  // Load models once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadModels((m) => !cancelled && setStatusMsg(m));
        if (cancelled) return;
        setModelStatus('ready');
        setStatusMsg('');
      } catch (e: any) {
        if (cancelled) return;
        setModelStatus('error');
        setStatusMsg(`Model error: ${e?.message ?? e}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh connected integrations (and the whisper vocabulary) whenever the screen is focused.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const ids = await connectedIntegrationIds();
        if (cancelled) return;
        setConnected(ids);
        const names = ids.includes('imessage') ? await contactNamesForVocabulary(40).catch(() => []) : [];
        await primeVocabulary(ids, names);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Track foreground/background purely for the status label; the mic keeps running in the background (UIBackgroundModes audio).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const label = (() => {
    if (modelStatus !== 'ready') return statusMsg;
    if (state.phase === 'speaking') return 'Speaking';
    if (state.phase === 'thinking') return 'Thinking';
    if (state.phase === 'executing') return 'Working on it';
    if (state.listenerState === 'speaking') return 'Listening…';
    if (state.listenerState === 'transcribing') return 'Got it';
    if (state.pendingTool) return 'Say yes to confirm';
    return connected.length ? 'Ready' : 'Connect an app in Settings';
  })();

  const busy = state.phase !== 'idle' || state.listenerState === 'transcribing';

  return (
    <View style={styles.root}>
      <View style={[styles.topbar, { paddingTop: insets.top, height: insets.top + HEADER_HEIGHT }]}>
        <Text style={styles.title}>Driving Assistant</Text>
        <Pressable
          style={styles.gearBtn}
          onPress={() => navigation.navigate('Settings')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <GearIcon size={26} />
        </Pressable>
      </View>

      <View style={styles.center}>
        {modelStatus === 'loading' || (busy && state.phase !== 'speaking') ? (
          <ActivityIndicator size="large" color="#e8fff6" style={{ height: 150 }} />
        ) : (
          <AudioVisualizer mode={state.listenerState} speaking={state.phase === 'speaking'} />
        )}
        <Text style={styles.modeLabel}>{label}</Text>
        {!appActive ? <Text style={styles.bgHint}>Still listening in the background</Text> : null}

        <ToolIndicator tool={state.tool ?? state.pendingTool} lastTranscript={state.lastTranscript} lastReply={state.lastReply} />

        {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
        {modelStatus === 'error' ? <Text style={styles.error}>{statusMsg}</Text> : null}
      </View>

      {DEV_TEXT_MODE ? (
        <View style={[styles.devRow, { paddingBottom: insets.bottom + 12 }]}>
          <TextInput
            style={styles.devInput}
            value={devText}
            onChangeText={setDevText}
            placeholder="Type a command…"
            placeholderTextColor="rgba(232,255,246,0.3)"
            onSubmitEditing={() => {
              const t = devText.trim();
              if (!t) return;
              setDevText('');
              handleTranscript(t);
            }}
            returnKeyType="send"
          />
        </View>
      ) : (
        <Text style={[styles.hint, { paddingBottom: insets.bottom + 16 }]}>
          Try “switch the song to Purple Haze by Jimi Hendrix”
        </Text>
      )}

      <VoiceListener state={state.listenerState} onStateChange={setListenerState} onTranscript={handleTranscript} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f271f' },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#08110e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: { color: '#e8fff6', fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  gearBtn: { padding: 6 },
  center: { flex: 1, alignItems: 'center', paddingTop: 48 },
  modeLabel: { marginTop: 8, color: 'rgba(232,255,246,0.6)', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' },
  bgHint: { marginTop: 4, color: 'rgba(34,197,94,0.8)', fontSize: 12 },
  error: { marginTop: 14, color: '#f87171', fontSize: 13, paddingHorizontal: 24, textAlign: 'center' },
  hint: { color: 'rgba(232,255,246,0.35)', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  devRow: { paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  devInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#e5e7eb',
    fontSize: 15,
  },
});
