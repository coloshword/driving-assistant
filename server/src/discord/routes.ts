/**
 * Discord cannot send messages *as a user* through OAuth (there is no such
 * scope), so the assistant posts through its own bot, attributed to the user.
 * The app authenticates with the user's OAuth access token; the server checks
 * it against Discord, intersects the user's guilds with the bot's guilds, and
 * performs channel lookups / reads / posts with the bot token.
 */
import type { Context } from 'koa';
import * as z from 'zod';
import { config } from '../config.js';

const API = 'https://discord.com/api/v10';

async function discordFetch(path: string, init: RequestInit & { auth: string }): Promise<any> {
  const { auth, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: { ...(rest.headers ?? {}), Authorization: auth, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (!res.ok) {
    const msg = json?.message ?? text ?? res.statusText;
    throw Object.assign(new Error(`Discord ${res.status}: ${msg}`), { status: res.status });
  }
  return json;
}

function bot(): string {
  if (!config.discord.botToken) throw Object.assign(new Error('DISCORD_BOT_TOKEN not configured'), { status: 503 });
  return `Bot ${config.discord.botToken}`;
}

function userAuth(ctx: Context): string {
  const h = ctx.get('x-discord-token');
  if (!h) throw Object.assign(new Error('missing x-discord-token'), { status: 401 });
  return `Bearer ${h}`;
}

type Guild = { id: string; name: string };
type Channel = { id: string; name: string; type: number; guild_id?: string };

const guildCache = new Map<string, { at: number; guilds: Guild[] }>();

async function sharedGuilds(ctx: Context): Promise<Guild[]> {
  const auth = userAuth(ctx);
  const cached = guildCache.get(auth);
  if (cached && Date.now() - cached.at < 60_000) return cached.guilds;
  const [userGuilds, botGuilds] = await Promise.all([
    discordFetch('/users/@me/guilds', { auth }) as Promise<Guild[]>,
    discordFetch('/users/@me/guilds', { auth: bot() }) as Promise<Guild[]>,
  ]);
  const botIds = new Set(botGuilds.map((g) => g.id));
  const guilds = userGuilds.filter((g) => botIds.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
  guildCache.set(auth, { at: Date.now(), guilds });
  return guilds;
}

async function textChannels(guild: Guild): Promise<Array<Channel & { guildName: string }>> {
  const chans = (await discordFetch(`/guilds/${guild.id}/channels`, { auth: bot() })) as Channel[];
  return chans.filter((c) => c.type === 0 || c.type === 5).map((c) => ({ ...c, guildName: guild.name }));
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function score(query: string, channel: string, guild: string): number {
  const q = norm(query);
  const c = norm(channel);
  const g = norm(guild);
  if (q === c) return 100;
  if (q === `${c} ${g}` || q === `${c} in ${g}` || q === `${g} ${c}`) return 95;
  let s = 0;
  if (q.includes(c)) s += 60;
  else if (c.includes(q)) s += 40;
  if (g && q.includes(g)) s += 25;
  const qw = new Set(q.split(' '));
  for (const w of c.split(' ')) if (qw.has(w)) s += 10;
  return s;
}

/** POST /api/discord/resolve { name } */
export async function resolveRoute(ctx: Context) {
  const { name } = z.object({ name: z.string().min(1) }).parse(ctx.request.body);
  const guilds = await sharedGuilds(ctx);
  if (guilds.length === 0) {
    ctx.body = { status: 'no_match', reason: 'The assistant bot is not in any of your servers yet.' };
    return;
  }
  const all = (await Promise.all(guilds.map(textChannels))).flat();
  const ranked = all
    .map((c) => ({ channelId: c.id, channelName: `#${c.name} in ${c.guildName}`, score: score(name, c.name, c.guildName) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    ctx.body = { status: 'no_match', reason: `No channel matching "${name}"` };
  } else if (ranked.length === 1 || ranked[0].score >= 95 || ranked[0].score - ranked[1].score >= 30) {
    ctx.body = { status: 'resolved', channelId: ranked[0].channelId, channelName: ranked[0].channelName };
  } else {
    ctx.body = { status: 'ambiguous', candidates: ranked.slice(0, 4).map(({ channelId, channelName }) => ({ channelId, channelName })) };
  }
}

/** POST /api/discord/send { channelId, text, asName } */
export async function sendRoute(ctx: Context) {
  const { channelId, text, asName } = z
    .object({ channelId: z.string().min(1), text: z.string().min(1).max(1900), asName: z.string().optional() })
    .parse(ctx.request.body);
  // Make sure the caller is a member of the guild owning this channel.
  const guilds = await sharedGuilds(ctx);
  const channel = (await discordFetch(`/channels/${channelId}`, { auth: bot() })) as Channel;
  if (!channel.guild_id || !guilds.some((g) => g.id === channel.guild_id)) {
    ctx.status = 403;
    ctx.body = { error: 'You are not a member of that server (or the bot is not).' };
    return;
  }
  const content = asName ? `**${asName}** (via Driving Assistant): ${text}` : text;
  const msg = await discordFetch(`/channels/${channelId}/messages`, {
    auth: bot(),
    method: 'POST',
    body: JSON.stringify({ content, allowed_mentions: { parse: ['users'] } }),
  });
  ctx.body = { status: 'sent', messageId: msg.id, channelName: `#${channel.name}` };
}

/** POST /api/discord/read { channelId, limit } */
export async function readRoute(ctx: Context) {
  const { channelId, limit } = z
    .object({ channelId: z.string().min(1), limit: z.number().int().min(1).max(20).default(5) })
    .parse(ctx.request.body);
  const guilds = await sharedGuilds(ctx);
  const channel = (await discordFetch(`/channels/${channelId}`, { auth: bot() })) as Channel;
  if (!channel.guild_id || !guilds.some((g) => g.id === channel.guild_id)) {
    ctx.status = 403;
    ctx.body = { error: 'You are not a member of that server (or the bot is not).' };
    return;
  }
  const msgs = (await discordFetch(`/channels/${channelId}/messages?limit=${limit}`, { auth: bot() })) as any[];
  ctx.body = {
    channelName: `#${channel.name}`,
    messages: msgs.map((m) => ({
      from: m.author?.global_name ?? m.author?.username ?? 'unknown',
      text: String(m.content ?? '').slice(0, 300),
      at: m.timestamp,
    })),
  };
}
