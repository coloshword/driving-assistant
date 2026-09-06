import 'react-native-get-random-values';
import { sha256 } from 'js-sha256';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // global btoa exists in RN
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** PKCE: S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  const digest = sha256.arrayBuffer(verifier);
  return base64Url(new Uint8Array(digest));
}
