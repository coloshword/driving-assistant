import type { AgentTool, ToolExecutionLog } from 'da-types';
import { deleteSecret, loadSecret, saveSecret } from '../storage';
import { connectViaServer } from './serverOAuth';
import { fail, ok, type ConnectionInfo, type Integration } from './types';

/**
 * Slack runs on-device with a *user* token (xoxp) obtained through the server's
 * OAuth broker, so messages are posted as the user, not as a bot.
 */

type SlackToken = {
  accessToken: string;
  userId: string;
  teamId: string | null;
  teamName: string | null;
  scope: string | null;
};

type Target = { targetId: string; targetName: string; kind: 'user' | 'channel' };

const SECRET_ID = 'slack';
const API = 'https://slack.com/api';
const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 5; // ~1000 users / channels

async function getToken(): Promise<SlackToken | null> {
  return loadSecret<SlackToken>(SECRET_ID);
}

/** Every Slack Web API method accepts form-encoded POST, so we use that for all calls. */
async function api(method: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<any> {
  const token = await getToken();
  if (!token) throw new Error('Slack is not connected');
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.append(k, String(v));
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json: any = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!json.ok) throw new Error(slackError(json.error));
  return json;
}

function slackError(code: string | undefined): string {
  switch (code) {
    case 'invalid_auth':
    case 'token_revoked':
    case 'token_expired':
    case 'account_inactive':
      return 'Slack sign-in has expired. Please reconnect Slack in Settings.';
    case 'missing_scope':
      return 'Slack did not grant permission for that. Please reconnect Slack in Settings.';
    case 'not_in_channel':
      return 'You are not a member of that channel.';
    case 'channel_not_found':
      return 'That Slack channel could not be found.';
    case 'ratelimited':
      return 'Slack is rate limiting us; try again in a moment.';
    default:
      return code ? `Slack error: ${code}` : 'Slack error';
  }
}

// ---------------------------------------------------------------------------
// Directory (users + channels), cached in memory for a few minutes
// ---------------------------------------------------------------------------

type SlackUser = { id: string; names: string[]; primary: string };
type SlackChannel = { id: string; name: string };

let userCache: { at: number; users: SlackUser[] } | null = null;
let channelCache: { at: number; channels: SlackChannel[] } | null = null;
const userNameById = new Map<string, string>();

async function paginate(method: string, params: Record<string, string>, pick: (json: any) => any[]): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await api(method, { ...params, limit: PAGE_LIMIT, cursor });
    out.push(...pick(json));
    cursor = json.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

async function listUsers(): Promise<SlackUser[]> {
  if (userCache && Date.now() - userCache.at < CACHE_TTL_MS) return userCache.users;
  const raw = await paginate('users.list', {}, (j) => j.members ?? []);
  const users: SlackUser[] = [];
  for (const m of raw) {
    if (m.deleted || m.is_bot || m.id === 'USLACKBOT') continue;
    const names = [m.real_name, m.profile?.real_name, m.profile?.display_name, m.name].filter(
      (n: unknown): n is string => typeof n === 'string' && n.trim().length > 0,
    );
    if (names.length === 0) continue;
    const primary = m.real_name || m.profile?.real_name || m.profile?.display_name || m.name;
    users.push({ id: m.id, names: Array.from(new Set(names)), primary });
    userNameById.set(m.id, primary);
  }
  userCache = { at: Date.now(), users };
  return users;
}

async function listChannels(): Promise<SlackChannel[]> {
  if (channelCache && Date.now() - channelCache.at < CACHE_TTL_MS) return channelCache.channels;
  const raw = await paginate(
    'conversations.list',
    { types: 'public_channel,private_channel', exclude_archived: 'true' },
    (j) => j.channels ?? [],
  );
  const channels = raw.filter((c) => c.name).map((c) => ({ id: c.id, name: c.name as string }));
  channelCache = { at: Date.now(), channels };
  return channels;
}

async function userName(id: string): Promise<string> {
  const cached = userNameById.get(id);
  if (cached) return cached;
  try {
    const j = await api('users.info', { user: id });
    const name = j.user?.real_name || j.user?.profile?.display_name || j.user?.name || id;
    userNameById.set(id, name);
    return name;
  } catch {
    return id;
  }
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreName(query: string, candidate: string): number {
  const q = norm(query);
  const c = norm(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  const cw = c.split(' ');
  const qw = q.split(' ');
  if (qw.every((w) => cw.includes(w))) return 85; // "john smith" vs "John A. Smith"
  if (cw[0] === q) return 80; // first name only
  if (c.startsWith(q)) return 70;
  if (cw.some((w) => w.startsWith(q))) return 60;
  if (c.includes(q)) return 50;
  return 0;
}

async function resolveTarget(rawName: string): Promise<Record<string, any>> {
  let name = rawName.trim();
  const channelOnly = name.startsWith('#') || /\bchannel$/i.test(name);
  const userOnly = /^(dm|direct message)\s+/i.test(name);
  name = name
    .replace(/^#/, '')
    .replace(/^(the|dm|direct message)\s+/i, '')
    .replace(/\s+channel$/i, '')
    .trim();
  if (!name) return { status: 'no_match' };

  const scored: Array<Target & { score: number }> = [];
  const [users, channels] = await Promise.all([
    userOnly || !channelOnly ? listUsers() : Promise.resolve([] as SlackUser[]),
    channelOnly || !userOnly ? listChannels() : Promise.resolve([] as SlackChannel[]),
  ]);
  for (const u of users) {
    const score = Math.max(...u.names.map((n) => scoreName(name, n)));
    if (score > 0) scored.push({ targetId: u.id, targetName: u.primary, kind: 'user', score });
  }
  for (const c of channels) {
    // Channel names are slug-like ("dev-team"); norm() turns both sides into words.
    const score = scoreName(name, c.name);
    if (score > 0) scored.push({ targetId: c.id, targetName: `#${c.name}`, kind: 'channel', score });
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { status: 'no_match' };

  const [top, second] = scored;
  const clear = !second || (top.score >= 100 && second.score < 100) || top.score - second.score >= 20;
  if (clear) return { status: 'resolved', targetId: top.targetId, targetName: top.targetName, kind: top.kind };
  return {
    status: 'ambiguous',
    candidates: scored.slice(0, 4).map(({ targetId, targetName, kind }) => ({ targetId, targetName, kind })),
  };
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

const dmChannelByUser = new Map<string, string>();

/** User ids (U…/W…) need a DM channel opened first; channel ids are used as-is. */
async function conversationId(targetId: string): Promise<string> {
  if (!/^[UW]/.test(targetId)) return targetId;
  const cached = dmChannelByUser.get(targetId);
  if (cached) return cached;
  const j = await api('conversations.open', { users: targetId });
  const id = j.channel?.id;
  if (!id) throw new Error('Could not open a direct message with that person.');
  dmChannelByUser.set(targetId, id);
  return id;
}

async function sendMessage(targetId: string, targetName: string, text: string): Promise<Record<string, any>> {
  const channel = await conversationId(targetId);
  // A user token posts as the user by itself; `as_user` is legacy and rejected by newer apps.
  await api('chat.postMessage', { channel, text });
  return { status: 'sent', to: targetName, text };
}

async function readMessages(targetId: string, targetName: string | null, limit: number | null): Promise<Record<string, any>> {
  const channel = await conversationId(targetId);
  const n = Math.max(1, Math.min(20, Math.round(limit ?? 5)));
  const j = await api('conversations.history', { channel, limit: n });
  // Keep real posts (no subtype) and bot posts; skip joins, pins, edits and the like.
  const raw: any[] = (j.messages ?? []).filter((m: any) => m.type === 'message' && (!m.subtype || m.subtype === 'bot_message'));
  const messages = await Promise.all(
    raw.map(async (m) => ({
      from: m.user ? await userName(m.user) : m.username ?? 'bot',
      text: String(m.text ?? '').slice(0, 300),
      at: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : undefined,
    })),
  );
  // conversations.history already returns newest first.
  return { channel: targetName ?? channel, messages };
}

async function setStatus(text: string, emoji: string | null): Promise<Record<string, any>> {
  const statusEmoji = emoji ?? (text ? ':car:' : '');
  await api('users.profile.set', {
    profile: JSON.stringify({ status_text: text, status_emoji: statusEmoji, status_expiration: 0 }),
  });
  return { status: 'set', text, emoji: statusEmoji };
}

export const slack: Integration = {
  id: 'slack',
  label: 'Slack',
  description: 'Send and read Slack messages and set your status, all by voice, posted as you.',
  examples: [
    'Tell Sarah on Slack I am running ten minutes late',
    'Post in the dev team channel that the build is green',
    'What is new in general?',
    'Set my Slack status to driving',
  ],
  urlScheme: 'slack',
  requiresOAuth: true,

  async connect() {
    const token = await connectViaServer<SlackToken>('slack', 'Slack');
    await saveSecret(SECRET_ID, token);
    userCache = null;
    channelCache = null;
    dmChannelByUser.clear();
  },

  async disconnect() {
    await deleteSecret(SECRET_ID);
    userCache = null;
    channelCache = null;
    dmChannelByUser.clear();
  },

  async status(): Promise<ConnectionInfo> {
    const t = await getToken();
    return { connected: !!t, detail: t?.teamName ?? undefined };
  },

  async execute(tool: AgentTool): Promise<ToolExecutionLog> {
    const p = tool.toolParameters ?? {};
    try {
      switch (tool.tool) {
        case 'slack.resolveTarget':
          return ok(tool.tool, await resolveTarget(String(p.name ?? '')));
        case 'slack.sendMessage':
          return ok(tool.tool, await sendMessage(String(p.targetId), String(p.targetName ?? p.targetId), String(p.text)));
        case 'slack.readMessages':
          return ok(tool.tool, await readMessages(String(p.targetId), p.targetName ?? null, p.limit == null ? null : Number(p.limit)));
        case 'slack.setStatus':
          return ok(tool.tool, await setStatus(String(p.text ?? ''), p.emoji ?? null));
        default:
          return fail(tool.tool, `Unknown Slack tool ${tool.tool}`);
      }
    } catch (e: any) {
      return fail(tool.tool, e?.message ?? String(e));
    }
  },
};
