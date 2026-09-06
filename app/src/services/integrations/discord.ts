import type { AgentTool, ToolExecutionLog } from 'da-types';
import { apiBaseUrl } from '../agent/api';
import { deleteSecret, loadSecret, saveSecret } from '../storage';
import { connectViaServer, serverHeaders } from './serverOAuth';
import { fail, ok, type ConnectionInfo, type Integration } from './types';

/**
 * Discord has no OAuth scope for sending as a user, so every call is proxied
 * through the server, which posts with its bot token and attributes the
 * message to the user. The user's OAuth token only proves who they are.
 */

type DiscordToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  userId: string;
  username: string;
};

const SECRET_ID = 'discord';

async function getToken(): Promise<DiscordToken | null> {
  return loadSecret<DiscordToken>(SECRET_ID);
}

async function serverCall(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const token = await getToken();
  if (!token) throw new Error('Discord is not connected');
  const base = await apiBaseUrl();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: serverHeaders({ 'x-discord-token': token.accessToken }),
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Discord sign-in has expired. Please reconnect Discord in Settings.');
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json ?? {};
}

export const discord: Integration = {
  id: 'discord',
  label: 'Discord',
  description: 'Post to and catch up on Discord channels in servers the assistant bot has joined.',
  examples: [
    'Post in general on Discord that I will be late',
    'What did people say in the climbing server?',
    'Read the last few messages in announcements',
  ],
  urlScheme: 'discord',
  requiresOAuth: true,

  async connect() {
    const token = await connectViaServer<DiscordToken>('discord', 'Discord');
    await saveSecret(SECRET_ID, token);
  },

  async disconnect() {
    await deleteSecret(SECRET_ID);
  },

  async status(): Promise<ConnectionInfo> {
    const t = await getToken();
    return { connected: !!t, detail: t?.username };
  },

  async execute(tool: AgentTool): Promise<ToolExecutionLog> {
    const p = tool.toolParameters ?? {};
    try {
      switch (tool.tool) {
        case 'discord.resolveTarget':
          return ok(tool.tool, await serverCall('/api/discord/resolve', { name: String(p.name ?? '') }));
        case 'discord.sendMessage': {
          const token = await getToken();
          const result = await serverCall('/api/discord/send', {
            channelId: String(p.channelId),
            text: String(p.text),
            asName: token?.username,
          });
          return ok(tool.tool, { ...result, text: p.text });
        }
        case 'discord.readMessages': {
          const limit = p.limit == null ? 5 : Math.max(1, Math.min(20, Math.round(Number(p.limit))));
          return ok(tool.tool, await serverCall('/api/discord/read', { channelId: String(p.channelId), limit }));
        }
        default:
          return fail(tool.tool, `Unknown Discord tool ${tool.tool}`);
      }
    } catch (e: any) {
      return fail(tool.tool, e?.message ?? String(e));
    }
  },
};
