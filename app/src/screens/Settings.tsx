import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import AppLogo from '../components/AppLogo';
import PillGroup from '../components/PillGroup';
import PrimaryButton from '../components/PrimaryButton';
import Section, { Row } from '../components/Section';
import { colors } from '../components/theme';
import { INTEGRATIONS } from '../services/integrations/registry';
import { scanInstalledApps } from '../services/integrations/appScan';
import type { ConnectionInfo, Integration, IntegrationId } from '../services/integrations/types';
import { apiBaseUrl, serverHealth } from '../services/agent/api';
import { availableWhisperModels, type WhisperModelChoice } from '../services/models';
import { KOKORO_VOICES, speak } from '../services/tts';
import { PREF_KEYS, getPref, setPref } from '../services/storage';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const APP_VERSION = '0.1.0';
const TTS_SPEEDS = [0.9, 1.0, 1.1, 1.25];
const WHISPER_LABELS: Record<WhisperModelChoice, string> = { tiny: 'Fast', base: 'Accurate' };
type ImessageStrategy = 'draft' | 'shortcut';

type AppRowState = {
  status: ConnectionInfo | null;
  installed: boolean;
  busy: boolean;
  error: string | null;
};

export default function Settings() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // --- Apps ---------------------------------------------------------------
  const [apps, setApps] = useState<Partial<Record<IntegrationId, AppRowState>>>({});

  const patchApp = useCallback((id: IntegrationId, patch: Partial<AppRowState>) => {
    if (!mounted.current) return;
    setApps((prev) => ({
      ...prev,
      [id]: { status: null, installed: true, busy: false, error: null, ...(prev[id] ?? {}), ...patch },
    }));
  }, []);

  const refreshStatuses = useCallback(async () => {
    await Promise.all(
      INTEGRATIONS.map(async (i) => {
        try {
          const status = await i.status();
          patchApp(i.id, { status });
        } catch (e: any) {
          patchApp(i.id, { status: { connected: false }, error: String(e?.message ?? e) });
        }
      }),
    );
  }, [patchApp]);

  useEffect(() => {
    refreshStatuses();
    scanInstalledApps(INTEGRATIONS).then((results) => {
      for (const r of results) patchApp(r.integration.id, { installed: r.installed });
    });
  }, [refreshStatuses, patchApp]);

  const onConnect = useCallback(
    async (integration: Integration) => {
      patchApp(integration.id, { busy: true, error: null });
      try {
        await integration.connect();
      } catch (e: any) {
        patchApp(integration.id, { error: String(e?.message ?? e ?? 'Could not connect') });
      } finally {
        patchApp(integration.id, { busy: false });
        await refreshStatuses();
      }
    },
    [patchApp, refreshStatuses],
  );

  const onDisconnect = useCallback(
    (integration: Integration) => {
      Alert.alert(`Disconnect ${integration.label}?`, `Voice commands for ${integration.label} will stop working until you connect again.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            patchApp(integration.id, { busy: true, error: null });
            try {
              await integration.disconnect();
            } catch (e: any) {
              patchApp(integration.id, { error: String(e?.message ?? e ?? 'Could not disconnect') });
            } finally {
              patchApp(integration.id, { busy: false });
              await refreshStatuses();
            }
          },
        },
      ]);
    },
    [patchApp, refreshStatuses],
  );

  // --- Server -------------------------------------------------------------
  const [serverUrl, setServerUrl] = useState('');
  const [serverTest, setServerTest] = useState<{ busy: boolean; result: string | null; ok: boolean }>({ busy: false, result: null, ok: false });

  useEffect(() => {
    apiBaseUrl().then((url) => mounted.current && setServerUrl(url));
  }, []);

  const saveServerUrl = useCallback(async () => {
    const trimmed = serverUrl.trim().replace(/\/$/, '');
    await setPref(PREF_KEYS.serverUrl, trimmed || null);
    const effective = await apiBaseUrl();
    if (mounted.current) setServerUrl(effective);
  }, [serverUrl]);

  const testServer = useCallback(async () => {
    await saveServerUrl();
    setServerTest({ busy: true, result: null, ok: false });
    const health = await serverHealth();
    if (!mounted.current) return;
    setServerTest({
      busy: false,
      ok: health.ok,
      result: health.ok ? `Connected${health.model ? ` · ${health.model}` : ''}` : 'Could not reach the server. Check the URL and that the server is running.',
    });
  }, [saveServerUrl]);

  // --- Voice --------------------------------------------------------------
  const [whisperOptions, setWhisperOptions] = useState<WhisperModelChoice[]>([]);
  const [whisperModel, setWhisperModel] = useState<WhisperModelChoice>('tiny');
  const [ttsVoice, setTtsVoice] = useState<number>(0);
  const [ttsSpeed, setTtsSpeed] = useState<number>(1.0);
  const [wakeWord, setWakeWord] = useState('');
  const [imessageStrategy, setImessageStrategy] = useState<ImessageStrategy>('draft');

  useEffect(() => {
    (async () => {
      const [models, model, voice, speed, wake, strategy] = await Promise.all([
        availableWhisperModels(),
        getPref(PREF_KEYS.whisperModel),
        getPref(PREF_KEYS.ttsVoice),
        getPref(PREF_KEYS.ttsSpeed),
        getPref(PREF_KEYS.wakeWord),
        getPref(PREF_KEYS.imessageStrategy),
      ]);
      if (!mounted.current) return;
      setWhisperOptions(models);
      const preferred = (model as WhisperModelChoice | null) ?? 'tiny';
      setWhisperModel(models.includes(preferred) ? preferred : models[0] ?? 'tiny');
      if (voice !== null && !Number.isNaN(Number(voice))) setTtsVoice(Number(voice));
      if (speed !== null && !Number.isNaN(Number(speed))) setTtsSpeed(Number(speed));
      setWakeWord(wake ?? '');
      if (strategy === 'draft' || strategy === 'shortcut') setImessageStrategy(strategy);
    })();
  }, []);

  const onWhisperModel = useCallback((m: WhisperModelChoice) => {
    setWhisperModel(m);
    setPref(PREF_KEYS.whisperModel, m);
  }, []);

  const onTtsVoice = useCallback(
    (id: number) => {
      setTtsVoice(id);
      setPref(PREF_KEYS.ttsVoice, String(id)).then(() => speak("Hi, I'm your driving assistant", { speed: ttsSpeed }));
    },
    [ttsSpeed],
  );

  const onTtsSpeed = useCallback((s: number) => {
    setTtsSpeed(s);
    setPref(PREF_KEYS.ttsSpeed, String(s));
  }, []);

  const saveWakeWord = useCallback(() => {
    const clean = wakeWord.trim().toLowerCase();
    setWakeWord(clean);
    setPref(PREF_KEYS.wakeWord, clean);
  }, [wakeWord]);

  const onImessageStrategy = useCallback((s: ImessageStrategy) => {
    setImessageStrategy(s);
    setPref(PREF_KEYS.imessageStrategy, s);
  }, []);

  // --- About --------------------------------------------------------------
  const replayOnboarding = useCallback(async () => {
    await setPref(PREF_KEYS.onboardingComplete, null);
    navigation.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
  }, [navigation]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] }))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.headerBtn}
        >
          <Text style={styles.headerBtnText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Section title="Apps" hint="Connect the apps you want to control by voice.">
          {INTEGRATIONS.map((integration, idx) => (
            <AppRow
              key={integration.id}
              integration={integration}
              state={apps[integration.id]}
              last={idx === INTEGRATIONS.length - 1}
              onConnect={() => onConnect(integration)}
              onDisconnect={() => onDisconnect(integration)}
            />
          ))}
        </Section>

        <Section title="Server" hint="The assistant's brain runs on a server. Point the app at yours.">
          <Row column>
            <Text style={styles.fieldLabel}>Server URL</Text>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              onBlur={saveServerUrl}
              onSubmitEditing={saveServerUrl}
              placeholder="http://192.168.1.10:3000"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              style={styles.input}
            />
          </Row>
          <Row column last>
            <PrimaryButton title="Test connection" variant="secondary" onPress={testServer} loading={serverTest.busy} />
            {serverTest.result && (
              <Text style={[styles.resultText, serverTest.ok ? styles.resultOk : styles.resultError]}>
                {serverTest.ok ? '✓ ' : ''}
                {serverTest.result}
              </Text>
            )}
          </Row>
        </Section>

        <Section title="Voice">
          <Row column>
            <Text style={styles.fieldLabel}>Speech recognition</Text>
            {whisperOptions.length ? (
              <PillGroup
                segmented
                options={whisperOptions.map((m) => ({ value: m, label: WHISPER_LABELS[m] }))}
                value={whisperModel}
                onChange={onWhisperModel}
              />
            ) : (
              <Text style={styles.fieldHint}>No speech models found in the app bundle.</Text>
            )}
            <Text style={styles.fieldHint}>Fast answers quicker; Accurate understands more. Takes effect the next time the app starts listening.</Text>
          </Row>
          <Row column>
            <Text style={styles.fieldLabel}>Assistant voice</Text>
            <PillGroup scroll options={KOKORO_VOICES.map((v) => ({ value: v.id, label: v.label }))} value={ttsVoice} onChange={onTtsVoice} />
            <Text style={styles.fieldHint}>Tap a voice to hear it.</Text>
          </Row>
          <Row column>
            <Text style={styles.fieldLabel}>Speaking speed</Text>
            <PillGroup segmented options={TTS_SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} value={ttsSpeed} onChange={onTtsSpeed} />
          </Row>
          <Row column>
            <Text style={styles.fieldLabel}>Wake word</Text>
            <TextInput
              value={wakeWord}
              onChangeText={setWakeWord}
              onBlur={saveWakeWord}
              onSubmitEditing={saveWakeWord}
              placeholder="e.g. hey car"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              style={styles.input}
            />
            <Text style={styles.fieldHint}>Leave empty to always listen. With a wake word, say it before each command.</Text>
          </Row>
          <Row column last>
            <Text style={styles.fieldLabel}>Sending iMessages</Text>
            <PillGroup
              segmented
              options={[
                { value: 'draft' as ImessageStrategy, label: 'Draft in Messages' },
                { value: 'shortcut' as ImessageStrategy, label: 'Shortcut' },
              ]}
              value={imessageStrategy}
              onChange={onImessageStrategy}
            />
            <Text style={styles.fieldHint}>
              {imessageStrategy === 'draft'
                ? 'Opens Messages with the text filled in; you tap Send. No setup needed.'
                : 'Sends silently through a Shortcut you install once. Fully hands-free.'}
            </Text>
          </Row>
        </Section>

        <Section title="About">
          <Row>
            <Text style={styles.rowText}>Version</Text>
            <Text style={styles.rowValue}>{APP_VERSION}</Text>
          </Row>
          <Row last>
            <Text style={styles.rowText}>Replay onboarding</Text>
            <PrimaryButton title="Replay" variant="secondary" compact onPress={replayOnboarding} />
          </Row>
        </Section>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------

function AppRow({
  integration,
  state,
  last,
  onConnect,
  onDisconnect,
}: {
  integration: Integration;
  state: AppRowState | undefined;
  last: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const loading = !state || state.status === null;
  const connected = !!state?.status?.connected;
  const missing = integration.urlScheme !== null && state?.installed === false;
  const detail = connected
    ? `Connected${state?.status?.detail ? ` · ${state.status.detail}` : ''}`
    : missing
    ? 'Not installed'
    : 'Not connected';

  return (
    <Row last={last}>
      <AppLogo id={integration.id} size={44} />
      <View style={styles.appTextWrap}>
        <Text style={styles.rowText}>{integration.label}</Text>
        {loading ? (
          <ActivityIndicator size="small" color={colors.muted} style={styles.appSpinner} />
        ) : (
          <Text style={[styles.appDetail, connected && styles.appDetailOk]} numberOfLines={1}>
            {detail}
          </Text>
        )}
        {state?.error ? <Text style={styles.appError}>{state.error}</Text> : null}
      </View>
      {!loading &&
        (connected ? (
          <PrimaryButton title="Disconnect" variant="destructive" compact onPress={onDisconnect} loading={state?.busy} />
        ) : (
          <PrimaryButton title="Connect" compact onPress={onConnect} loading={state?.busy} disabled={missing} />
        ))}
    </Row>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    height: 56,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.header,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBtn: {
    minWidth: 80,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerBtnText: {
    color: colors.muted,
    fontSize: 17,
    fontWeight: '600',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  rowText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  rowValue: {
    color: colors.muted,
    fontSize: 17,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  fieldHint: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(0,0,0,0.25)',
    color: colors.text,
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  resultText: {
    fontSize: 15,
    lineHeight: 21,
  },
  resultOk: {
    color: colors.accent,
  },
  resultError: {
    color: colors.destructive,
  },
  appTextWrap: {
    flex: 1,
    gap: 2,
  },
  appDetail: {
    color: colors.muted,
    fontSize: 14,
  },
  appDetailOk: {
    color: colors.accent,
  },
  appError: {
    color: colors.destructive,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  appSpinner: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
});
