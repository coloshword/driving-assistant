import type { IntegrationId } from 'da-tools';
import type { Integration } from './types';
import { spotify } from './spotify';
import { slack } from './slack';
import { discord } from './discord';
import { messenger } from './messenger';
import { imessage } from './imessage';
import { phone } from './phone';

/** Onboarding order: most-used first. */
export const INTEGRATIONS: Integration[] = [spotify, imessage, phone, slack, discord, messenger];

export const INTEGRATION_BY_ID: Record<IntegrationId, Integration> = Object.fromEntries(
  INTEGRATIONS.map((i) => [i.id, i]),
) as Record<IntegrationId, Integration>;

export function integrationForTool(toolName: string): Integration | undefined {
  const prefix = toolName.split('.')[0];
  // contacts.* belongs to the Messages integration
  const id = (prefix === 'contacts' ? 'imessage' : prefix) as IntegrationId;
  return INTEGRATION_BY_ID[id];
}

export async function connectedIntegrationIds(): Promise<IntegrationId[]> {
  const statuses = await Promise.all(INTEGRATIONS.map(async (i) => [i.id, (await i.status()).connected] as const));
  return statuses.filter(([, c]) => c).map(([id]) => id);
}
