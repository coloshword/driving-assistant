import type {
  AgentPlanResponse,
  AgentTool,
  ExecutePermissionRouteResponseBody,
  Message,
  SummarizeRouteResponseBody,
  ToolExecutionLog,
} from 'da-types';
import type { IntegrationId } from 'da-tools';
import { APP_API_KEY, DEFAULT_API_BASE_URL } from '../../config';
import { PREF_KEYS, getPref } from '../storage';

export async function apiBaseUrl(): Promise<string> {
  const override = await getPref(PREF_KEYS.serverUrl);
  return (override || DEFAULT_API_BASE_URL).replace(/\/$/, '');
}

async function post<T>(path: string, body: unknown, timeoutMs = 20_000): Promise<T> {
  const base = await apiBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(APP_API_KEY ? { 'x-app-key': APP_API_KEY } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function planTurn(
  messages: Message[],
  connectedIntegrations: IntegrationId[],
  contextTool?: AgentTool | null,
): Promise<AgentPlanResponse> {
  return post<AgentPlanResponse>('/api/agent/plan', {
    messages,
    connectedIntegrations,
    ...(contextTool ? { contextTool } : {}),
  });
}

export async function checkPermission(messages: Message[], tool: AgentTool): Promise<AgentPlanResponse> {
  const r = await post<ExecutePermissionRouteResponseBody>('/api/agent/executePermission', { messages, tool });
  return {
    message: { role: 'assistant', content: r.assistant },
    tool: r.tool,
    executePermissionGranted: r.executePermissionGranted,
    executeDecision: r.decision,
  };
}

export async function summarize(messages: Message[], toolLog: ToolExecutionLog): Promise<SummarizeRouteResponseBody> {
  return post<SummarizeRouteResponseBody>('/api/agent/summarize', { messages, toolLog });
}

export async function serverHealth(): Promise<{ ok: boolean; model?: string }> {
  const base = await apiBaseUrl();
  try {
    console.log('DIAG serverHealth GET', `${base}/health`);
    const res = await fetch(`${base}/health`);
    console.log('DIAG serverHealth status', res.status);
    return res.ok ? await res.json() : { ok: false };
  } catch (e: any) {
    console.log('DIAG serverHealth error', String(e?.message ?? e));
    return { ok: false };
  }
}
