import { Linking } from 'react-native';
import Contacts, { type Contact } from 'react-native-contacts';
import type { AgentTool, ToolExecutionLog } from 'da-types';
import { PREF_KEYS, getPref, setPref } from '../storage';
import { fail, ok, type ConnectionInfo, type Integration } from './types';

/**
 * Messages (iMessage/SMS) plus the contacts.* lookups. iOS offers no API for
 * sending a text programmatically, so we either open Messages with the text
 * pre-filled ("draft", the user taps send) or hand the message to a user-made
 * Shortcut that sends it ("shortcut").
 */

const PREF_ENABLED = 'pref.imessageEnabled';
const SHORTCUT_NAME = 'DA Send Message';
const NAMES_CACHE_TTL_MS = 5 * 60 * 1000;

type Permission = Awaited<ReturnType<typeof Contacts.checkPermission>>;

let permissionCache: Permission | null = null;

function granted(p: Permission): boolean {
  return p === 'authorized' || p === 'limited';
}

async function hasPermission(): Promise<boolean> {
  // Once granted, iOS only revokes the permission through Settings (which
  // relaunches the app), so a positive answer can be cached for the process.
  if (permissionCache && granted(permissionCache)) return true;
  try {
    permissionCache = await Contacts.checkPermission();
  } catch {
    permissionCache = 'undefined';
  }
  return granted(permissionCache);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Digits only, keeping a leading '+'. */
function normalizePhone(raw: string): string {
  const plus = raw.trim().startsWith('+') ? '+' : '';
  return plus + raw.replace(/\D/g, '');
}

const LABEL_RANK = ['mobile', 'iphone', 'main', 'home', 'work'];

function pickPhone(c: Contact): { phone: string; label: string } | null {
  const phones = (c.phoneNumbers ?? [])
    .map((p) => ({ phone: normalizePhone(p.number ?? ''), label: (p.label ?? '').toLowerCase() }))
    .filter((p) => p.phone.replace('+', '').length >= 3);
  if (phones.length === 0) return null;
  const rank = (l: string) => {
    const i = LABEL_RANK.findIndex((k) => l.includes(k));
    return i === -1 ? LABEL_RANK.length : i;
  };
  phones.sort((a, b) => rank(a.label) - rank(b.label));
  return phones[0];
}

function fullName(c: Contact): string {
  return [c.givenName, c.middleName, c.familyName].filter((n) => n && n.trim()).join(' ').trim();
}

function displayName(c: Contact): string {
  return (c.displayName && c.displayName.trim()) || fullName(c) || c.company || 'Unknown';
}

function scoreContact(query: string, c: Contact): number {
  const q = norm(query);
  if (!q) return 0;
  const full = norm(fullName(c));
  const display = norm(c.displayName ?? '');
  const first = norm(c.givenName ?? '');
  const last = norm(c.familyName ?? '');
  const firstLast = norm(`${c.givenName ?? ''} ${c.familyName ?? ''}`);
  if (q === full || q === display || q === firstLast) return 100;
  if (q === first) return 80;
  const qw = q.split(' ');
  const words = new Set(`${full} ${display}`.split(' ').filter(Boolean));
  if (qw.every((w) => words.has(w))) return 75;
  if (first.startsWith(q) || last === q) return 60;
  if (full.includes(q) || display.includes(q)) return 50;
  // iOS matched this contact on something we do not score (nickname, phonetic name).
  return 10;
}

async function resolveContact(name: string): Promise<Record<string, any>> {
  if (!(await hasPermission())) throw new Error('Contacts permission is needed to text people by name');
  const query = name.trim();
  if (!query) return { status: 'no_match' };
  const found = await Contacts.getContactsMatchingString(query);
  const scored = found
    .map((c) => {
      const picked = pickPhone(c);
      return picked ? { name: displayName(c), phone: picked.phone, label: picked.label || 'phone', score: scoreContact(query, c) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { status: 'no_match' };
  const [top, second] = scored;
  if (!second || top.score > second.score) {
    return { status: 'resolved', name: top.name, phone: top.phone, label: top.label };
  }
  return { status: 'ambiguous', candidates: scored.slice(0, 4).map(({ name: n, phone, label }) => ({ name: n, phone, label })) };
}

let namesCache: { at: number; names: string[] } | null = null;

/** First/last names of contacts for the speech recognizer's vocabulary. Empty without permission. */
export async function contactNamesForVocabulary(limit = 40): Promise<string[]> {
  if (!(await hasPermission())) return [];
  if (namesCache && Date.now() - namesCache.at < NAMES_CACHE_TTL_MS) return namesCache.names.slice(0, limit);
  try {
    const all = await Contacts.getAllWithoutPhotos();
    const names: string[] = [];
    const seen = new Set<string>();
    // Starred contacts and those with a phone number are the likeliest to be spoken.
    const ordered = all
      .filter((c) => (c.phoneNumbers ?? []).length > 0)
      .sort((a, b) => Number(!!b.isStarred) - Number(!!a.isStarred));
    for (const c of ordered) {
      for (const n of [c.givenName, c.familyName]) {
        const v = (n ?? '').trim();
        if (!v || seen.has(v.toLowerCase())) continue;
        seen.add(v.toLowerCase());
        names.push(v);
      }
      if (names.length >= limit) break;
    }
    namesCache = { at: Date.now(), names };
    return names.slice(0, limit);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function openFirst(urls: string[]): Promise<void> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not open Messages');
}

async function send(to: string, toName: string | null, text: string): Promise<Record<string, any>> {
  const strategy = (await getPref(PREF_KEYS.imessageStrategy)) ?? 'draft';
  const target = toName ?? to;
  if (strategy === 'shortcut') {
    const q = new URLSearchParams({
      name: SHORTCUT_NAME,
      input: 'text',
      text: JSON.stringify({ to, text }),
    });
    await Linking.openURL(`shortcuts://run-shortcut?${q.toString()}`);
    return { status: 'sent_via_shortcut', to: target, text };
  }
  const body = encodeURIComponent(text);
  // iOS Messages accepts `sms:<number>&body=`; the others are fallbacks seen on some iOS versions.
  await openFirst([`sms:${to}&body=${body}`, `sms:${to};body=${body}`, `sms://${to}?body=${body}`]);
  return { status: 'drafted', to: target, text, note: 'Messages is open with the text filled in; tap send.' };
}

export const imessage: Integration = {
  id: 'imessage',
  label: 'Messages',
  description: 'Text anyone in your contacts by name. Opens Messages with the text filled in so you only tap send.',
  examples: ['Text Mom that I am on my way', 'Send a message to Jake: running ten minutes late', 'Tell Priya I will call her back'],
  urlScheme: null,
  requiresOAuth: false,

  async connect() {
    let result: Permission;
    try {
      result = await Contacts.requestPermission();
    } catch {
      result = 'undefined';
    }
    permissionCache = result;
    if (!granted(result)) throw new Error('Contacts permission is needed to text people by name');
    await setPref(PREF_ENABLED, '1');
  },

  async disconnect() {
    await setPref(PREF_ENABLED, null);
    permissionCache = null;
    namesCache = null;
  },

  async status(): Promise<ConnectionInfo> {
    const connected = await hasPermission();
    return { connected, detail: permissionCache === 'limited' ? 'Limited contacts access' : undefined };
  },

  async execute(tool: AgentTool): Promise<ToolExecutionLog> {
    const p = tool.toolParameters ?? {};
    try {
      switch (tool.tool) {
        case 'contacts.resolve':
          return ok(tool.tool, await resolveContact(String(p.name ?? '')));
        case 'imessage.send':
          return ok(tool.tool, await send(normalizePhone(String(p.to)), p.toName ?? null, String(p.text)));
        default:
          return fail(tool.tool, `Unknown Messages tool ${tool.tool}`);
      }
    } catch (e: any) {
      return fail(tool.tool, e?.message ?? String(e));
    }
  },
};
