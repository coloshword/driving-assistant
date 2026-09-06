import type { IntegrationId } from 'da-tools';
import type { Integration } from './types';
import { spotify } from './spotify';
import { slack } from './slack';
import { discord } from './discord';
import { messenger } from './messenger';
import { imessage } from './imessage';
import { phone } from './phone';
import { maps } from './maps';

/** Onboarding order: most-used first. */
export const INTEGRATIONS: Integration[] = [spotify, maps, imessage, phone, slack, discord, messenger];

export const INTEGRATION_BY_ID: Record<IntegrationId, Integration> = Object.fromEntries(
  INTEGRATIONS.map((i) => [i.id, i]),
) as Record<IntegrationId, Integration>;

export function integrationForTool(toolName: string): Integration | undefined {
  const prefix = toolName.split('.')[0];
  // contacts.* belongs to the Messages integration
  const id = (prefix === 'contacts' ? 'imessage' : prefix) as IntegrationId;
  return INTEGRATION_BY_ID[id];
}

const STATUS_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} status() timed out`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function connectedIntegrationIds(): Promise<IntegrationId[]> {
  const statuses = await Promise.all(
    INTEGRATIONS.map(async (i) => {
      try {
        return [i.id, (await withTimeout(i.status(), STATUS_TIMEOUT_MS, i.id)).connected] as const;
      } catch (e) {
        console.log(`[registry] status() failed for ${i.id}`, e);
        return [i.id, false] as const;
      }
    }),
  );
  return statuses.filter(([, c]) => c).map(([id]) => id);
}
