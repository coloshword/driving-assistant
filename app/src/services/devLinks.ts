import { useEffect } from 'react';
import { Linking } from 'react-native';
import { APP_URL_SCHEME } from '../config';
import { PREF_KEYS, setPref } from './storage';

/**
 * Debug-only deep links so the app can be driven from a terminal in the
 * simulator (no tap automation needed):
 *
 *   xcrun simctl openurl booted "drivingassistant://dev/say?text=play%20purple%20haze"
 *   xcrun simctl openurl booted "drivingassistant://dev/onboarding-complete"
 *   xcrun simctl openurl booted "drivingassistant://dev/onboarding-reset"
 *
 * Compiled out of release builds.
 */
export type DevLinkHandlers = {
  say?: (text: string) => void;
  onboardingComplete?: () => void;
  onboardingReset?: () => void;
};

function parse(url: string): { action: string; params: Record<string, string> } | null {
  const prefix = `${APP_URL_SCHEME}://dev/`;
  if (!url.startsWith(prefix)) return null;
  const [action, query = ''] = url.slice(prefix.length).split('?');
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return { action: action.replace(/\/$/, ''), params };
}

export function useDevLinks(handlers: DevLinkHandlers): void {
  useEffect(() => {
    if (!__DEV__) return;
    const handle = async (url: string | null) => {
      if (!url) return;
      const parsed = parse(url);
      if (!parsed) return;
      console.log('[devLinks]', parsed.action, parsed.params);
      switch (parsed.action) {
        case 'say':
          handlers.say?.(parsed.params.text ?? '');
          break;
        case 'onboarding-complete':
          await setPref(PREF_KEYS.onboardingComplete, '1');
          handlers.onboardingComplete?.();
          break;
        case 'onboarding-reset':
          await setPref(PREF_KEYS.onboardingComplete, null);
          handlers.onboardingReset?.();
          break;
      }
    };
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    Linking.getInitialURL().then(handle);
    return () => sub.remove();
    // handlers are read at call time; callers pass stable functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
