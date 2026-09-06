/**
 * Short-lived, in-memory store for OAuth handoffs.
 *
 * Flow (same for every provider):
 *   app  -> GET  /oauth/:p/start?state=S        (opens in Safari)
 *   web  -> provider auth page -> GET /oauth/:p/callback?code&state=S
 *   srv  -> exchanges code, stores token under S, 302 -> <scheme>://oauth/:p?state=S
 *   app  -> POST /oauth/:p/claim {state:S}      -> token JSON (one-shot, then deleted)
 *
 * Tokens never live here for more than CLAIM_TTL_MS and are handed out once.
 * The server keeps no long-term user state; the app stores tokens in the Keychain.
 */

export type StoredToken = Record<string, unknown> & { provider: string };

const CLAIM_TTL_MS = 10 * 60 * 1000;

type Entry = { value: StoredToken; expiresAt: number };
const pending = new Map<string, Entry>();
const started = new Map<string, number>();

export function rememberState(state: string): void {
  started.set(state, Date.now() + CLAIM_TTL_MS);
}

export function isKnownState(state: string): boolean {
  const exp = started.get(state);
  if (!exp) return false;
  if (exp < Date.now()) {
    started.delete(state);
    return false;
  }
  return true;
}

export function storeToken(state: string, value: StoredToken): void {
  started.delete(state);
  pending.set(state, { value, expiresAt: Date.now() + CLAIM_TTL_MS });
}

export function claimToken(state: string): StoredToken | null {
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return entry.value;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expiresAt < now) pending.delete(k);
  for (const [k, v] of started) if (v < now) started.delete(k);
}, 60_000).unref();
