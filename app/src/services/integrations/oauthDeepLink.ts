import { Linking } from 'react-native';
import { APP_URL_SCHEME } from '../../config';

export type OAuthRedirect = { provider: string; params: Record<string, string> };

export function parseOAuthUrl(url: string): OAuthRedirect | null {
  const prefix = `${APP_URL_SCHEME}://oauth/`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const [provider, query = ''] = rest.split('?');
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return { provider: provider.replace(/\/$/, ''), params };
}

/**
 * Open `authUrl` in the system browser and wait for the app to be re-opened
 * through drivingassistant://oauth/<provider>?... with a matching `state`.
 */
export async function runOAuthInBrowser(
  provider: string,
  authUrl: string,
  state: string,
  timeoutMs = 5 * 60 * 1000,
): Promise<Record<string, string>> {
  return new Promise<Record<string, string>>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      sub.remove();
      clearTimeout(timer);
      fn();
    };
    const sub = Linking.addEventListener('url', ({ url }) => {
      const parsed = parseOAuthUrl(url);
      if (!parsed || parsed.provider !== provider) return;
      if (parsed.params.state && parsed.params.state !== state) return;
      finish(() => resolve(parsed.params));
    });
    const timer = setTimeout(() => finish(() => reject(new Error('Timed out waiting for sign-in to finish'))), timeoutMs);
    Linking.openURL(authUrl).catch((e) => finish(() => reject(e)));
  });
}
