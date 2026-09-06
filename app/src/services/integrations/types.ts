import type { AgentTool, ToolExecutionLog } from 'da-types';
import type { IntegrationId } from 'da-tools';

export type { IntegrationId };

export type ConnectionInfo = {
  connected: boolean;
  /** Short human detail shown in Settings, e.g. account or workspace name. */
  detail?: string;
};

export interface Integration {
  id: IntegrationId;
  label: string;
  /** One-line onboarding pitch: what voice commands this unlocks. */
  description: string;
  /** Example utterances shown during onboarding. */
  examples: string[];
  /** URL scheme used to detect the app on the phone; null = always available (built into iOS). */
  urlScheme: string | null;
  /** Whether connect() opens an OAuth flow (vs. just asking for an iOS permission). */
  requiresOAuth: boolean;
  /** Run the connect flow. Resolves when connected, throws with a user-readable message otherwise. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  status(): Promise<ConnectionInfo>;
  /** Execute one of this integration's tools on the device. Never throws; errors go in the log. */
  execute(tool: AgentTool): Promise<ToolExecutionLog>;
}

export function ok(tool: string, result: Record<string, any>): ToolExecutionLog {
  return { tool, status: 'success', result };
}

export function fail(tool: string, message: string, extra: Record<string, any> = {}): ToolExecutionLog {
  return { tool, status: 'error', result: { message, ...extra } };
}

export class IntegrationError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'IntegrationError';
  }
}
