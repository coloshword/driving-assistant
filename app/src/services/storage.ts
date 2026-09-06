import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

/**
 * Secrets (OAuth tokens) live in the iOS Keychain, one entry per service.
 * Non-secret preferences live in AsyncStorage.
 */

const service = (id: string) => `app.drivingassistant.${id}`;

export async function saveSecret(id: string, value: unknown): Promise<void> {
  await Keychain.setGenericPassword(id, JSON.stringify(value), {
    service: service(id),
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  });
}

export async function loadSecret<T = unknown>(id: string): Promise<T | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: service(id) });
    if (!creds) return null;
    return JSON.parse(creds.password) as T;
  } catch (e) {
    console.warn(`[storage] failed to load secret ${id}`, e);
    return null;
  }
}

export async function deleteSecret(id: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: service(id) });
  } catch (e) {
    console.warn(`[storage] failed to delete secret ${id}`, e);
  }
}

export const PREF_KEYS = {
  onboardingComplete: 'pref.onboardingComplete',
  serverUrl: 'pref.serverUrl',
  whisperModel: 'pref.whisperModel', // 'tiny' | 'base'
  ttsSpeed: 'pref.ttsSpeed',
  ttsVoice: 'pref.ttsVoice',
  wakeWord: 'pref.wakeWord', // '' = always listening
  skippedIntegrations: 'pref.skippedIntegrations', // JSON string[]
  imessageStrategy: 'pref.imessageStrategy', // 'draft' | 'shortcut'
} as const;

export async function getPref(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setPref(key: string, value: string | null): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[storage] failed to set pref ${key}`, e);
  }
}

export async function getJsonPref<T>(key: string, fallback: T): Promise<T> {
  const raw = await getPref(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
