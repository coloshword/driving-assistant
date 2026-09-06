import { APP_API_KEY } from '../../config';
import { apiBaseUrl } from '../agent/api';
import { runOAuthInBrowser } from './oauthDeepLink';
import { randomString } from './random';

/**
 * Server-brokered OAuth (Slack, Discord): the server holds the client secret,
 * runs the code exchange, parks the token under our `state`, and bounces the
 * browser back into the app. We then claim the token once over the API.
 */

type ServerProvider = 'slack' | 'discord';

export function serverHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(APP_API_KEY ? { 'x-app-key': APP_API_KEY } : {}),
    ...extra,
  };
}

async function assertConfigured(base: string, provider: ServerProvider, label: string): Promise<void> {
  // The /start redirect happens in Safari, so a 503 there would only be visible
  // to the user as raw JSON. Check first and fail with a readable message.
  let res: Response;
  try {
    res = await fetch(`${base}/oauth/status`, { headers: serverHeaders() });
  } catch {
    throw new Error(`Could not reach the assistant server at ${base}.`);
  }
  if (!res.ok) return; // older server without /oauth/status: let /start decide
  const json: any = await res.json().catch(() => ({}));
  if (json && json[provider] === false) {
    throw new Error(`${label} sign-in is not set up on the server yet (missing client id/secret).`);
  }
}

export async function connectViaServer<T>(provider: ServerProvider, label: string): Promise<T> {
  const base = await apiBaseUrl();
  await assertConfigured(base, provider, label);
  const state = randomString(32);
  const params = await runOAuthInBrowser(provider, `${base}/oauth/${provider}/start?state=${state}`, state);
  if (params.error) throw new Error(`${label} sign-in failed: ${params.error}`);

  const res = await fetch(`${base}/oauth/${provider}/claim`, {
    method: 'POST',
    headers: serverHeaders(),
    body: JSON.stringify({ state }),
  });
  const json: any = await res.json().catch(() => null);
  if (res.status === 503) throw new Error(`${label} sign-in is not set up on the server yet.`);
  if (res.status === 404) throw new Error(`${label} sign-in expired before the app could finish. Please try again.`);
  if (!res.ok || !json?.accessToken) throw new Error(json?.error ?? `${label} sign-in failed (HTTP ${res.status})`);
  return json as T;
}
