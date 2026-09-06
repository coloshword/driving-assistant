import { Linking } from 'react-native';
import type { AgentTool, ToolExecutionLog } from 'da-types';
import { getPref, setPref } from '../storage';
import { isAppInstalled } from './appScan';
import { fail, ok, type ConnectionInfo, type Integration } from './types';

/**
 * Navigation via deep links. Google Maps when installed
 * (comgooglemaps://?daddr=…&directionsmode=driving), Apple Maps otherwise
 * (maps://?daddr=…). Both start turn-by-turn directions from the current
 * location and take a free-text destination ("home", "nearest gas station",
 * an address). No account needed, so "connecting" just enables the tool.
 */

const PREF_ENABLED = 'pref.mapsEnabled';

const GOOGLE_MODES: Record<string, string> = { driving: 'driving', walking: 'walking', transit: 'transit' };
const APPLE_MODES: Record<string, string> = { driving: 'd', walking: 'w', transit: 'r' };

async function openDirections(destination: string, mode: string | null): Promise<{ app: string; url: string }> {
  const m = mode ?? 'driving';
  const dest = encodeURIComponent(destination);
  if (await isAppInstalled('comgooglemaps')) {
    const url = `comgooglemaps://?daddr=${dest}&directionsmode=${GOOGLE_MODES[m] ?? 'driving'}`;
    await Linking.openURL(url);
    return { app: 'Google Maps', url };
  }
  const url = `maps://?daddr=${dest}&dirflg=${APPLE_MODES[m] ?? 'd'}`;
  await Linking.openURL(url);
  return { app: 'Apple Maps', url };
}

export const maps: Integration = {
  id: 'maps',
  label: 'Maps',
  description: 'Start directions by voice. Uses Google Maps when it is on your phone, Apple Maps otherwise.',
  examples: ['Navigate to the nearest gas station', 'Take me home', 'Directions to SFO'],
  urlScheme: null, // Apple Maps is always there; Google Maps is preferred when present
  requiresOAuth: false,

  async connect() {
    await setPref(PREF_ENABLED, '1');
  },

  async disconnect() {
    await setPref(PREF_ENABLED, null);
  },

  async status(): Promise<ConnectionInfo> {
    const enabled = (await getPref(PREF_ENABLED)) === '1';
    if (!enabled) return { connected: false };
    const google = await isAppInstalled('comgooglemaps');
    return { connected: true, detail: google ? 'Google Maps' : 'Apple Maps' };
  },

  async execute(tool: AgentTool): Promise<ToolExecutionLog> {
    const p = tool.toolParameters ?? {};
    try {
      switch (tool.tool) {
        case 'maps.navigate': {
          const r = await openDirections(String(p.destination), (p.mode as string | null) ?? null);
          return ok(tool.tool, { status: 'navigating', destination: p.destination, app: r.app });
        }
        default:
          return fail(tool.tool, `Unknown Maps tool ${tool.tool}`);
      }
    } catch (e: any) {
      return fail(tool.tool, e?.message ?? String(e));
    }
  },
};
