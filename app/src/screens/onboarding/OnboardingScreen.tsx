import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import AppLogo from '../../components/AppLogo';
import PrimaryButton from '../../components/PrimaryButton';
import { colors } from '../../components/theme';
import { INTEGRATIONS } from '../../services/integrations/registry';
import { scanInstalledApps } from '../../services/integrations/appScan';
import type { Integration, IntegrationId } from '../../services/integrations/types';
import { requestMicPermission } from '../../services/audio/voiceProcessor';
import { PREF_KEYS, setPref } from '../../services/storage';

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Step = { kind: 'welcome' } | { kind: 'mic' } | { kind: 'scan' } | { kind: 'connect'; integration: Integration } | { kind: 'done' };

type ConnectState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'connected'; detail?: string; already?: boolean }
  | { status: 'error'; message: string; notConfigured: boolean };

const WELCOME_EXAMPLES = ['"Play some chill jazz"', '"Text Sam I\'m 10 minutes late"', '"Call Mom"'];
const MIN_SCAN_MS = 800;
const AUTO_ADVANCE_MS = 600;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function looksNotConfigured(message: string): boolean {
  return /not configured|missing .*client|client.?id|\.env/i.test(message);
}

export default function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [index, setIndex] = useState(0);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);
  const [micBusy, setMicBusy] = useState(false);
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null);
  const [connect, setConnect] = useState<Partial<Record<IntegrationId, ConnectState>>>({});
  const [skipped, setSkipped] = useState<IntegrationId[]>([]);
  const [finishing, setFinishing] = useState(false);

  /** Until the scan has run we assume every app is installed so "step x of y" has a sensible upper bound. */
  const steps = useMemo<Step[]>(() => {
    const connectSteps = INTEGRATIONS.filter((i) => (installed ? installed[i.id] : true)).map<Step>((integration) => ({
      kind: 'connect',
      integration,
    }));
    return [{ kind: 'welcome' }, { kind: 'mic' }, { kind: 'scan' }, ...connectSteps, { kind: 'done' }];
  }, [installed]);

  const step = steps[Math.min(index, steps.length - 1)];

  const setConnectState = useCallback((id: IntegrationId, state: ConnectState) => {
    if (!mounted.current) return;
    setConnect((prev) => ({ ...prev, [id]: state }));
  }, []);

  const goNext = useCallback(() => {
    if (!mounted.current) return;
    setIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [steps.length]);

  const goBack = useCallback(() => {
    setIndex((i) => {
      let target = Math.max(i - 1, 0);
      // Never land on the scan step again; it already ran.
      if (steps[target]?.kind === 'scan') target = Math.max(target - 1, 0);
      return target;
    });
  }, [steps]);

  // --- Microphone ---------------------------------------------------------
  const onAllowMic = useCallback(async () => {
    setMicBusy(true);
    const granted = await requestMicPermission();
    if (!mounted.current) return;
    setMicBusy(false);
    setMicGranted(granted);
    if (granted) {
      await sleep(AUTO_ADVANCE_MS);
      goNext();
    }
  }, [goNext]);

  // --- Scan ---------------------------------------------------------------
  useEffect(() => {
    if (step.kind !== 'scan') return;
    if (installed) {
      goNext();
      return;
    }
    let cancelled = false;
    (async () => {
      const [results] = await Promise.all([scanInstalledApps(INTEGRATIONS), sleep(MIN_SCAN_MS)]);
      if (cancelled || !mounted.current) return;
      const map: Record<string, boolean> = {};
      for (const r of results) map[r.integration.id] = r.installed;
      setInstalled(map);
      setIndex((i) => i + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [step.kind, installed, goNext]);

  // --- Connect: check existing status when a connect step is shown ----------
  useEffect(() => {
    if (step.kind !== 'connect') return;
    const { integration } = step;
    if (connect[integration.id]) return;
    let cancelled = false;
    integration
      .status()
      .then((s) => {
        if (cancelled || !mounted.current) return;
        if (s.connected) setConnectState(integration.id, { status: 'connected', detail: s.detail, already: true });
      })
      .catch(() => {
        /* status is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [step, connect, setConnectState]);

  const onConnect = useCallback(
    async (integration: Integration) => {
      setConnectState(integration.id, { status: 'pending' });
      try {
        await integration.connect(); // may take minutes (Safari OAuth round trip); no timeout on purpose
        let detail: string | undefined;
        try {
          detail = (await integration.status()).detail;
        } catch {
          /* cosmetic */
        }
        if (!mounted.current) return;
        setConnectState(integration.id, { status: 'connected', detail });
        setSkipped((prev) => prev.filter((id) => id !== integration.id));
        await sleep(AUTO_ADVANCE_MS);
        goNext();
      } catch (e: any) {
        const message = String(e?.message ?? e ?? 'Something went wrong');
        setConnectState(integration.id, { status: 'error', message, notConfigured: looksNotConfigured(message) });
      }
    },
    [goNext, setConnectState],
  );

  const onSkip = useCallback(
    (integration: Integration) => {
      setSkipped((prev) => (prev.includes(integration.id) ? prev : [...prev, integration.id]));
      setConnectState(integration.id, { status: 'idle' });
      goNext();
    },
    [goNext, setConnectState],
  );

  // --- Done ---------------------------------------------------------------
  const onFinish = useCallback(async () => {
    setFinishing(true);
    const skippedIds = INTEGRATIONS.filter((i) => installed?.[i.id] !== false && connect[i.id]?.status !== 'connected').map((i) => i.id);
    await setPref(PREF_KEYS.skippedIntegrations, JSON.stringify(Array.from(new Set([...skipped, ...skippedIds]))));
    await setPref(PREF_KEYS.onboardingComplete, '1');
    navigation.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
  }, [connect, installed, navigation, skipped]);

  // Persist skipped list as it changes so a killed app mid-onboarding still remembers.
  useEffect(() => {
    if (skipped.length) setPref(PREF_KEYS.skippedIntegrations, JSON.stringify(skipped));
  }, [skipped]);

  const canGoBack = index > 0 && step.kind !== 'scan' && step.kind !== 'done';

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.topBar}>
        {canGoBack ? (
          <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>
        ) : (
          <View style={styles.backBtn} />
        )}
        <Text style={styles.stepIndicator}>
          Step {index + 1} of {steps.length}
        </Text>
      </View>

      {step.kind === 'welcome' && <WelcomeStep onNext={goNext} />}
      {step.kind === 'mic' && <MicStep granted={micGranted} busy={micBusy} onAllow={onAllowMic} onNext={goNext} />}
      {step.kind === 'scan' && <ScanStep />}
      {step.kind === 'connect' && (
        <ConnectStep
          key={step.integration.id}
          integration={step.integration}
          state={connect[step.integration.id] ?? { status: 'idle' }}
          onConnect={() => onConnect(step.integration)}
          onSkip={() => onSkip(step.integration)}
          onNext={goNext}
        />
      )}
      {step.kind === 'done' && <DoneStep installed={installed ?? {}} connect={connect} finishing={finishing} onFinish={onFinish} />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <Text style={styles.appName}>Driving Assistant</Text>
        <Text style={styles.pitch}>Say it, and it's done. Hands-free music, messages and calls while you drive.</Text>
        <Text style={styles.sectionLabel}>Try saying</Text>
        <View style={styles.examples}>
          {WELCOME_EXAMPLES.map((line) => (
            <Text key={line} style={styles.exampleText}>
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton title="Get started" onPress={onNext} />
      </View>
    </>
  );
}

function MicStep({ granted, busy, onAllow, onNext }: { granted: boolean | null; busy: boolean; onAllow: () => void; onNext: () => void }) {
  return (
    <>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <Text style={styles.title}>Microphone</Text>
        <Text style={styles.body}>
          The assistant listens continuously while the app is open, and keeps listening in the background once you allow audio access. Nothing is
          recorded unless you speak to it.
        </Text>
        {granted === true && (
          <View style={styles.statusBox}>
            <Text style={styles.check}>✓</Text>
            <Text style={styles.statusText}>Microphone enabled</Text>
          </View>
        )}
        {granted === false && (
          <View style={[styles.statusBox, styles.statusBoxWarn]}>
            <Text style={styles.warnText}>
              Microphone access is off. You can turn it on later in iOS Settings › Privacy & Security › Microphone › Driving Assistant. Voice
              commands won't work until then.
            </Text>
          </View>
        )}
      </ScrollView>
      <View style={styles.footer}>
        {granted === true ? (
          <PrimaryButton title="Continue" onPress={onNext} />
        ) : (
          <>
            <PrimaryButton title="Allow microphone" onPress={onAllow} loading={busy} />
            {granted === false && <PrimaryButton title="Continue anyway" variant="ghost" onPress={onNext} />}
          </>
        )}
      </View>
    </>
  );
}

function ScanStep() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.scanText}>Looking for apps you use…</Text>
    </View>
  );
}

function ConnectStep({
  integration,
  state,
  onConnect,
  onSkip,
  onNext,
}: {
  integration: Integration;
  state: ConnectState;
  onConnect: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  const pending = state.status === 'pending';
  const connected = state.status === 'connected';
  const error = state.status === 'error' ? state : null;
  const verb = integration.requiresOAuth ? 'Sign in to' : 'Allow';

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.logoRow}>
          <AppLogo id={integration.id} size={64} />
          <Text style={styles.title}>{integration.label}</Text>
        </View>
        <Text style={styles.body}>{integration.description}</Text>
        <Text style={styles.sectionLabel}>Try saying</Text>
        <View style={styles.examples}>
          {integration.examples.map((line) => (
            <Text key={line} style={styles.exampleText}>
              "{line}"
            </Text>
          ))}
        </View>

        {pending && (
          <View style={styles.statusBox}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.statusText}>
              {integration.requiresOAuth ? `Waiting for ${integration.label} sign-in… Come back here when you're done.` : 'Waiting for permission…'}
            </Text>
          </View>
        )}
        {connected && (
          <View style={styles.statusBox}>
            <Text style={styles.check}>✓</Text>
            <Text style={styles.statusText}>
              {state.already ? 'Already connected' : 'Connected'}
              {state.detail ? ` · ${state.detail}` : ''}
            </Text>
          </View>
        )}
        {error && (
          <View style={[styles.statusBox, error.notConfigured ? styles.statusBoxWarn : styles.statusBoxError]}>
            <Text style={error.notConfigured ? styles.warnText : styles.errorText}>{error.message}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {connected ? (
          <PrimaryButton title="Continue" onPress={onNext} />
        ) : error?.notConfigured ? (
          <>
            <PrimaryButton title="Skip for now" onPress={onSkip} />
            <PrimaryButton title="Try again" variant="ghost" onPress={onConnect} />
          </>
        ) : (
          <>
            <PrimaryButton title={error ? `Retry ${integration.label}` : `Connect ${integration.label}`} onPress={onConnect} loading={pending} />
            <PrimaryButton title="Skip for now" variant="ghost" onPress={onSkip} disabled={pending} />
          </>
        )}
        {!connected && !error && !pending && <Text style={styles.footerHint}>{verb} {integration.label} to enable these commands.</Text>}
      </View>
    </>
  );
}

function DoneStep({
  installed,
  connect,
  finishing,
  onFinish,
}: {
  installed: Record<string, boolean>;
  connect: Partial<Record<IntegrationId, ConnectState>>;
  finishing: boolean;
  onFinish: () => void;
}) {
  type Line = { integration: Integration; status: 'connected' | 'skipped' | 'missing'; detail?: string };
  const lines: Line[] = INTEGRATIONS.map((integration) => {
    const st = connect[integration.id];
    if (st?.status === 'connected') return { integration, status: 'connected', detail: st.detail };
    if (installed[integration.id] === false) return { integration, status: 'missing' };
    return { integration, status: 'skipped' };
  });
  const order: Record<Line['status'], number> = { connected: 0, skipped: 1, missing: 2 };
  lines.sort((a, b) => order[a.status] - order[b.status]);
  const connectedCount = lines.filter((l) => l.status === 'connected').length;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <Text style={styles.title}>{connectedCount ? "You're all set" : 'Ready when you are'}</Text>
        <Text style={styles.body}>
          {connectedCount
            ? `${connectedCount} ${connectedCount === 1 ? 'app is' : 'apps are'} connected. You can connect more apps anytime in Settings.`
            : 'No apps connected yet. You can connect apps anytime in Settings.'}
        </Text>
        <View style={styles.summary}>
          {lines.map(({ integration, status, detail }) => (
            <View key={integration.id} style={styles.summaryRow}>
              <AppLogo id={integration.id} size={40} />
              <View style={styles.summaryTextWrap}>
                <Text style={styles.summaryLabel}>{integration.label}</Text>
                <Text style={[styles.summaryDetail, status === 'connected' && styles.summaryDetailOk]}>
                  {status === 'connected' ? `Connected${detail ? ` · ${detail}` : ''}` : status === 'skipped' ? 'Skipped' : 'Not on this phone'}
                </Text>
              </View>
              {status === 'connected' && <Text style={styles.check}>✓</Text>}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton title="Start driving" onPress={onFinish} loading={finishing} />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    height: 48,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    minWidth: 80,
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    color: colors.muted,
    fontSize: 17,
    fontWeight: '600',
  },
  stepIndicator: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 24,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  appName: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pitch: {
    color: colors.muted,
    fontSize: 19,
    lineHeight: 27,
    marginTop: 10,
    marginBottom: 40,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  body: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 26,
    marginTop: 12,
    marginBottom: 28,
  },
  sectionLabel: {
    color: 'rgba(34,197,94,0.75)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  examples: {
    gap: 12,
    marginBottom: 28,
  },
  exampleText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '500',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scanText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '600',
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.accentBg,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  statusBoxWarn: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.35)',
  },
  statusBoxError: {
    backgroundColor: colors.destructiveBg,
    borderColor: 'rgba(239,68,68,0.35)',
  },
  statusText: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 24,
    flex: 1,
  },
  warnText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
    flex: 1,
  },
  errorText: {
    color: colors.destructive,
    fontSize: 16,
    lineHeight: 23,
    flex: 1,
  },
  check: {
    color: colors.accent,
    fontSize: 24,
    fontWeight: '800',
  },
  footer: {
    paddingHorizontal: 28,
    paddingTop: 12,
    gap: 10,
  },
  footerHint: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  summary: {
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryTextWrap: {
    flex: 1,
  },
  summaryLabel: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  summaryDetail: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  summaryDetailOk: {
    color: colors.accent,
  },
});
