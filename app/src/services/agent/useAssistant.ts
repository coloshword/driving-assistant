import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentPlanResponse, AgentTool, Message } from 'da-types';
import type { IntegrationId } from 'da-tools';
import { isToolExecutable } from 'da-tools';
import type { VoiceListenerState } from '../../components/VoiceListener';
import { checkPermission, planTurn, summarize } from './api';
import { executeTool } from '../tools/executor';
import { speak, stopSpeaking } from '../tts';
import { PREF_KEYS, getPref } from '../storage';

/**
 * The conversation loop (ported from WorkFromCar's VoiceDashboard2 and
 * generalised for tools that do not need confirmation):
 *
 *   transcript -> plan
 *     tool.silent            -> execute now, feed result back, re-plan (max N hops)
 *     tool complete, no confirmation needed -> execute now, summarize, speak
 *     tool complete, requiresConfirmation   -> speak the question, hold as pendingTool
 *     otherwise (missing params / chit-chat) -> speak
 *   next transcript while pendingTool -> executePermission
 *     execute -> run tool, summarize, speak
 *     revise  -> re-plan with contextTool
 *     cancel  -> speak, drop
 */

const MAX_SILENT_HOPS = 5;
const MAX_HISTORY = 24;
const CONTEXT_PREFIX = 'Current local time:';
/** Whisper hallucinates these on near-silence; drop them. */
const HALLUCINATIONS = /^(thank you\.?|thanks\.?|you\.?|bye\.?|\.|\[blank_audio\]|\(.*\)|\[.*\])$/i;

function contextMessage(): Message {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = now.toLocaleString('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return { role: 'system', content: `${CONTEXT_PREFIX} ${local} (${timeZone}). The user is driving.` };
}

export type AssistantPhase = 'idle' | 'thinking' | 'executing' | 'speaking';

export type AssistantState = {
  listenerState: VoiceListenerState;
  phase: AssistantPhase;
  tool: AgentTool | null;
  pendingTool: AgentTool | null;
  lastTranscript: string | null;
  lastReply: string | null;
  error: string | null;
};

type Options = {
  connectedIntegrations: IntegrationId[];
  /** Voice loop is enabled (models loaded, permission granted). */
  enabled: boolean;
};

export function useAssistant({ connectedIntegrations, enabled }: Options) {
  const [listenerState, setListenerStateRaw] = useState<VoiceListenerState>('disabled');
  const [phase, setPhase] = useState<AssistantPhase>('idle');
  const [tool, setTool] = useState<AgentTool | null>(null);
  const [pendingTool, setPendingTool] = useState<AgentTool | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<Message[]>([]);
  const pendingRef = useRef<AgentTool | null>(null);
  const busyRef = useRef(false);
  const connectedRef = useRef(connectedIntegrations);
  const enabledRef = useRef(enabled);
  useEffect(() => { connectedRef.current = connectedIntegrations; }, [connectedIntegrations]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const setListenerState = useCallback((s: VoiceListenerState) => {
    if (s !== 'disabled' && !enabledRef.current) return;
    setListenerStateRaw(s);
  }, []);

  useEffect(() => {
    if (enabled) setListenerStateRaw('listening');
    else {
      setListenerStateRaw('disabled');
      stopSpeaking();
    }
  }, [enabled]);

  const setPending = (t: AgentTool | null) => {
    pendingRef.current = t;
    setPendingTool(t);
  };

  const pushMessages = (next: Message[]) => {
    messagesRef.current = next.slice(-MAX_HISTORY);
  };

  const say = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setLastReply(clean);
    setPhase('speaking');
    await speak(clean);
    setPhase('idle');
  }, []);

  /** Execute a complete tool, summarize, speak. */
  const runAndNarrate = useCallback(async (t: AgentTool, history: Message[]) => {
    setPhase('executing');
    setTool(t);
    const log = await executeTool(t);
    const withLog = [...history, { role: 'system', content: JSON.stringify(log) } as Message];
    pushMessages(withLog);
    setPhase('thinking');
    const summary = await summarize(withLog, log);
    const done = [...withLog, { role: 'assistant', content: summary.assistant } as Message];
    pushMessages(done);
    await say(summary.assistant);
    return done;
  }, [say]);

  /** Handle a fresh plan: silent hops, immediate execution, or confirmation hold. */
  const handlePlan = useCallback(async (initial: AgentPlanResponse, history: Message[]) => {
    let current = initial;
    let msgs = [...history, current.message];
    pushMessages(msgs);
    if (current.tool?.tool) setTool(current.tool);
    let hops = 0;

    while (current.tool?.silent && hops < MAX_SILENT_HOPS) {
      hops++;
      const status = current.message.content?.trim();
      const speakPromise = status ? speak(status, { speed: 1.15 }) : null;
      if (status) setLastReply(status);
      setPhase('executing');
      const log = await executeTool(current.tool);
      msgs = [...msgs, { role: 'system', content: JSON.stringify(log) }];
      pushMessages(msgs);
      setPhase('thinking');
      current = await planTurn(msgs, connectedRef.current, null);
      msgs = [...msgs, current.message];
      pushMessages(msgs);
      if (speakPromise) await speakPromise;
      if (current.tool?.tool) setTool(current.tool);
    }

    const t = current.tool;
    const complete = !!t?.tool && !t.silent && isToolExecutable(t.tool, t.toolParameters);

    if (complete && !t!.requiresConfirmation) {
      // Immediate action (e.g. spotify.play). Speak the short acknowledgement while executing.
      const ack = current.message.content?.trim();
      const ackPromise = ack ? speak(ack, { speed: 1.1 }) : null;
      if (ack) setLastReply(ack);
      setPhase('executing');
      const log = await executeTool(t!);
      msgs = [...msgs, { role: 'system', content: JSON.stringify(log) }];
      pushMessages(msgs);
      if (ackPromise) await ackPromise;
      if (log.status === 'error') {
        setPhase('thinking');
        const summary = await summarize(msgs, log);
        msgs = [...msgs, { role: 'assistant', content: summary.assistant }];
        pushMessages(msgs);
        await say(summary.assistant);
      }
      setPending(null);
      setTool(null);
      return;
    }

    await say(current.message.content?.trim() || "Sorry, I didn't catch that. Try again.");
    setPending(complete && t!.requiresConfirmation ? t! : null);
  }, [say]);

  const handleTranscript = useCallback(async (raw: string) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text || HALLUCINATIONS.test(text) || text.length < 3) {
      setListenerState('listening');
      return;
    }
    const wake = ((await getPref(PREF_KEYS.wakeWord)) ?? '').trim().toLowerCase();
    let utterance = text;
    if (wake) {
      const lower = text.toLowerCase();
      const idx = lower.indexOf(wake);
      if (idx === -1 || idx > 12) {
        setListenerState('listening');
        return;
      }
      utterance = text.slice(idx + wake.length).replace(/^[,.!?\s]+/, '').trim();
      if (!utterance) {
        await say('Yes?');
        setListenerState('listening');
        return;
      }
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setListenerState('disabled');
    setError(null);
    setLastTranscript(utterance);
    setPhase('thinking');
    try {
      const prior = messagesRef.current.filter((m) => !(m.role === 'system' && m.content.startsWith(CONTEXT_PREFIX)));
      let msgs: Message[] = [contextMessage(), ...prior, { role: 'user', content: utterance }];
      pushMessages(msgs);
      const pending = pendingRef.current;

      if (pending) {
        const result = await checkPermission(msgs, pending);
        if (result.executeDecision === 'revise') {
          setPending(null);
          const revised = await planTurn(msgs, connectedRef.current, pending);
          await handlePlan(revised, msgs);
        } else if (result.executePermissionGranted) {
          msgs = [...msgs, result.message];
          pushMessages(msgs);
          setLastReply(result.message.content);
          setPending(null);
          await runAndNarrate(pending, msgs);
          setTool(null);
        } else {
          msgs = [...msgs, result.message];
          pushMessages(msgs);
          setPending(null);
          setTool(null);
          await say(result.message.content);
        }
      } else {
        const plan = await planTurn(msgs, connectedRef.current, null);
        await handlePlan(plan, msgs);
      }
    } catch (e: any) {
      const msg: string = e?.message ?? 'Something went wrong';
      console.log('[assistant] error:', msg);
      setError(msg);
      const spoken = /network|fetch|abort|HTTP 5|ECONN/i.test(msg)
        ? "I can't reach the server right now. Check the connection and try again."
        : 'Sorry, something went wrong. Please try again.';
      await say(spoken);
    } finally {
      busyRef.current = false;
      setPhase('idle');
      setListenerState('listening');
    }
  }, [handlePlan, runAndNarrate, say, setListenerState]);

  const reset = useCallback(() => {
    messagesRef.current = [];
    setPending(null);
    setTool(null);
    setLastTranscript(null);
    setLastReply(null);
    setError(null);
  }, []);

  return {
    state: { listenerState, phase, tool, pendingTool, lastTranscript, lastReply, error } as AssistantState,
    setListenerState,
    handleTranscript,
    reset,
  };
}
