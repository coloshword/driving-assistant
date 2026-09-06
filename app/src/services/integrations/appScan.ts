import { Linking } from 'react-native';
import type { Integration } from './types';

/**
 * iOS lets an app ask "can you open <scheme>://" for schemes listed under
 * LSApplicationQueriesSchemes in Info.plist. That is how we discover which of
 * the supported apps are installed during onboarding.
 */
export async function isAppInstalled(urlScheme: string): Promise<boolean> {
  try {
    return await Linking.canOpenURL(`${urlScheme}://`);
  } catch {
    return false;
  }
}

export type ScanResult = { integration: Integration; installed: boolean };

export async function scanInstalledApps(integrations: Integration[]): Promise<ScanResult[]> {
  return Promise.all(
    integrations.map(async (integration) => ({
      integration,
      installed: integration.urlScheme ? await isAppInstalled(integration.urlScheme) : true,
    })),
  );
}
