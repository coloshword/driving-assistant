import type { Context } from 'koa';
import * as z from 'zod';
import { config } from '../config.js';
import { claimToken, isKnownState, rememberState, storeToken } from './store.js';

const providers = ['slack', 'discord'] as const;
type Provider = (typeof providers)[number];

function redirectUri(p: Provider): string {
  return `${config.publicBaseUrl}/oauth/${p}/callback`;
}

function appRedirect(p: Provider, params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `${config.appUrlScheme}://oauth/${p}?${q}`;
}

function assertProvider(p: string): Provider {
  if (!(providers as readonly string[]).includes(p)) throw Object.assign(new Error(`Unknown provider ${p}`), { status: 404 });
  return p as Provider;
}

export function providerConfigured(p: Provider): boolean {
  if (p === 'slack') return !!(config.slack.clientId && config.slack.clientSecret);
  if (p === 'discord') return !!(config.discord.clientId && config.discord.clientSecret);
  return false;
}

/** GET /oauth/:provider/start?state=... */
export async function startRoute(ctx: Context) {
  const p = assertProvider(ctx.params.provider);
  const state = z.string().min(16).max(128).parse(ctx.query.state);
  if (!providerConfigured(p)) {
    ctx.status = 503;
    ctx.body = { error: `${p} OAuth is not configured on the server (missing client id/secret)` };
    return;
  }
  rememberState(state);
  let url: string;
  if (p === 'slack') {
    const q = new URLSearchParams({
      client_id: config.slack.clientId,
      user_scope: config.slack.userScopes,
      redirect_uri: redirectUri(p),
      state,
    });
    url = `https://slack.com/oauth/v2/authorize?${q}`;
  } else {
    const q = new URLSearchParams({
      client_id: config.discord.clientId,
      response_type: 'code',
      scope: 'identify guilds',
      redirect_uri: redirectUri(p),
      state,
      prompt: 'consent',
    });
    url = `https://discord.com/oauth2/authorize?${q}`;
  }
  ctx.redirect(url);
}

/** GET /oauth/:provider/callback?code=&state= */
export async function callbackRoute(ctx: Context) {
  const p = assertProvider(ctx.params.provider);
  const state = String(ctx.query.state ?? '');
  const code = String(ctx.query.code ?? '');
  const err = String(ctx.query.error ?? '');
  if (!state || !isKnownState(state)) {
    ctx.status = 400;
    ctx.body = 'Unknown or expired OAuth state. Go back to the app and try connecting again.';
    return;
  }
  if (err || !code) {
    ctx.redirect(appRedirect(p, { state, error: err || 'no_code' }));
    return;
  }
  try {
    if (p === 'slack') {
      const res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.slack.clientId,
          client_secret: config.slack.clientSecret,
          code,
          redirect_uri: redirectUri(p),
        }),
      });
      const json: any = await res.json();
      if (!json.ok || !json.authed_user?.access_token) throw new Error(json.error ?? 'slack_exchange_failed');
      storeToken(state, {
        provider: 'slack',
        accessToken: json.authed_user.access_token,
        userId: json.authed_user.id,
        teamId: json.team?.id ?? null,
        teamName: json.team?.name ?? null,
        scope: json.authed_user.scope ?? null,
      });
    } else {
      const res = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.discord.clientId,
          client_secret: config.discord.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri(p),
        }),
      });
      const json: any = await res.json();
      if (!json.access_token) throw new Error(json.error_description ?? json.error ?? 'discord_exchange_failed');
      // Identify the user so posts can be attributed and guilds filtered.
      const meRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${json.access_token}` },
      });
      const me: any = await meRes.json();
      storeToken(state, {
        provider: 'discord',
        accessToken: json.access_token,
        refreshToken: json.refresh_token ?? null,
        expiresIn: json.expires_in ?? null,
        userId: me.id,
        username: me.global_name ?? me.username,
      });
    }
    ctx.redirect(appRedirect(p, { state, ok: '1' }));
  } catch (e: any) {
    console.error(`[oauth:${p}] exchange failed`, e?.message ?? e);
    ctx.redirect(appRedirect(p, { state, error: String(e?.message ?? 'exchange_failed').slice(0, 100) }));
  }
}

/** POST /oauth/:provider/claim { state } -> token (one shot) */
export async function claimRoute(ctx: Context) {
  const p = assertProvider(ctx.params.provider);
  const { state } = z.object({ state: z.string().min(16) }).parse(ctx.request.body);
  const token = claimToken(state);
  if (!token || token.provider !== p) {
    ctx.status = 404;
    ctx.body = { error: 'nothing to claim' };
    return;
  }
  ctx.body = token;
}

/** GET /oauth/status -> which providers this server can broker */
export async function statusRoute(ctx: Context) {
  ctx.body = {
    slack: providerConfigured('slack'),
    discord: providerConfigured('discord') && !!config.discord.botToken,
  };
}
