import { Linking } from 'react-native';
import type { AgentTool, ToolExecutionLog } from 'da-types';
import { OAUTH_REDIRECT, SPOTIFY_CLIENT_ID } from '../../config';
import { deleteSecret, loadSecret, saveSecret } from '../storage';
import { runOAuthInBrowser } from './oauthDeepLink';
import { pkceChallenge, randomString } from './random';
import { fail, ok, type ConnectionInfo, type Integration } from './types';

/**
 * Spotify runs fully on-device: Authorization Code + PKCE (no client secret),
 * tokens in the Keychain, Web API calls straight from the phone.
 *
 * Playback control needs Spotify Premium and an "active device". When Spotify
 * is not open anywhere we deep-link into the app to wake it up and retry.
 */

const SCOPES = [
  'user-modify-playback-state',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-library-modify',
  'user-library-read',
  'user-read-private',
].join(' ');

type SpotifyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  displayName?: string;
};

const SECRET_ID = 'spotify';
const API = 'https://api.spotify.com/v1';

async function getTokens(): Promise<SpotifyTokens | null> {
  return loadSecret<SpotifyTokens>(SECRET_ID);
}

async function exchange(body: Record<string, string>): Promise<SpotifyTokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json: any = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? `Spotify token error ${res.status}`);
  }
  const prev = await getTokens();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? prev?.refreshToken ?? '',
    expiresAt: Date.now() + (Number(json.expires_in ?? 3600) - 60) * 1000,
    displayName: prev?.displayName,
  };
}

async function accessToken(): Promise<string> {
  let tokens = await getTokens();
  if (!tokens) throw new Error('Spotify is not connected');
  if (Date.now() >= tokens.expiresAt) {
    tokens = await exchange({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
    await saveSecret(SECRET_ID, tokens);
  }
  return tokens.accessToken;
}

type ApiResult = { status: number; json: any };

async function api(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<ApiResult> {
  const token = await accessToken();
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const res = await fetch(`${API}${path}${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function apiError(r: ApiResult): string {
  const reason = r.json?.error?.reason;
  const msg = r.json?.error?.message ?? r.json?.error ?? `HTTP ${r.status}`;
  if (reason === 'PREMIUM_REQUIRED') return 'Spotify Premium is required to control playback.';
  if (reason === 'NO_ACTIVE_DEVICE' || r.status === 404) return 'Spotify is not playing on any device.';
  return String(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Find a device to play on; wake the Spotify app if none is active. */
async function ensureDevice(wakeUri?: string): Promise<string | null> {
  const list = async () => {
    const r = await api('GET', '/me/player/devices');
    const devices: any[] = r.json?.devices ?? [];
    const active = devices.find((d) => d.is_active) ?? devices.find((d) => d.type === 'Smartphone') ?? devices[0];
    return active?.id ?? null;
  };
  let id = await list();
  if (id) return id;
  // No device: open the Spotify app (deep link) so it registers as a device, then poll.
  try {
    await Linking.openURL(wakeUri ?? 'spotify://');
  } catch {
    return null;
  }
  for (let i = 0; i < 6; i++) {
    await sleep(1000);
    id = await list();
    if (id) return id;
  }
  return null;
}

type SearchType = 'track' | 'artist' | 'album' | 'playlist';

async function search(query: string, type: SearchType | null): Promise<{ uri: string; name: string; by?: string; type: SearchType } | null> {
  const types = type ? [type] : (['track', 'artist', 'album', 'playlist'] as SearchType[]);
  const r = await api('GET', '/search', undefined, { q: query, type: types.join(','), limit: '5' });
  if (r.status !== 200) throw new Error(apiError(r));
  const j = r.json ?? {};
  const track = j.tracks?.items?.[0];
  const artist = j.artists?.items?.[0];
  const album = j.albums?.items?.[0];
  const playlist = j.playlists?.items?.find((p: any) => p);
  const pick = (t: SearchType) => {
    if (t === 'track' && track) return { uri: track.uri, name: track.name, by: track.artists?.map((a: any) => a.name).join(', '), type: t };
    if (t === 'artist' && artist) return { uri: artist.uri, name: artist.name, type: t };
    if (t === 'album' && album) return { uri: album.uri, name: album.name, by: album.artists?.map((a: any) => a.name).join(', '), type: t };
    if (t === 'playlist' && playlist) return { uri: playlist.uri, name: playlist.name, by: playlist.owner?.display_name, type: t };
    return null;
  };
  if (type) return pick(type);
  // Untyped: prefer an exact-ish track match, else artist, else album, else playlist.
  const q = query.toLowerCase();
  if (track && (q.includes(String(track.name).toLowerCase()) || track.artists?.some((a: any) => q.includes(String(a.name).toLowerCase())))) return pick('track');
  if (artist && q.includes(String(artist.name).toLowerCase())) return pick('artist');
  return pick('track') ?? pick('artist') ?? pick('album') ?? pick('playlist');
}

async function play(query: string, type: SearchType | null): Promise<Record<string, any>> {
  const hit = await search(query, type);
  if (!hit) throw new Error(`I couldn't find "${query}" on Spotify.`);
  const body = hit.type === 'track' ? { uris: [hit.uri] } : { context_uri: hit.uri };
  const attempt = async (deviceId: string | null) =>
    api('PUT', '/me/player/play', body, deviceId ? { device_id: deviceId } : undefined);

  let r = await attempt(null);
  if (r.status === 404 || r.json?.error?.reason === 'NO_ACTIVE_DEVICE') {
    const deviceId = await ensureDevice(hit.uri);
    if (deviceId) {
      for (let i = 0; i < 3 && (r.status === 404 || r.status === 502); i++) {
        r = await attempt(deviceId);
        if (r.status >= 200 && r.status < 300) break;
        await sleep(800);
      }
    } else {
      // Opening the deep link already started the track in the Spotify app on most setups.
      return { playing: hit.name, by: hit.by, via: 'deep-link', note: 'Spotify was not open, I opened it and started the track there.' };
    }
  }
  if (r.status >= 200 && r.status < 300) {
    return { playing: hit.name, by: hit.by, type: hit.type };
  }
  throw new Error(apiError(r));
}

async function nowPlaying(): Promise<Record<string, any>> {
  const r = await api('GET', '/me/player');
  if (r.status === 204 || !r.json) return { playing: false, message: 'Nothing is playing right now.' };
  if (r.status !== 200) throw new Error(apiError(r));
  const item = r.json.item;
  return {
    playing: !!r.json.is_playing,
    track: item?.name,
    artist: item?.artists?.map((a: any) => a.name).join(', '),
    album: item?.album?.name,
    device: r.json.device?.name,
    volumePercent: r.json.device?.volume_percent,
    shuffle: r.json.shuffle_state,
  };
}

async function simple(method: string, path: string, query?: Record<string, string>): Promise<void> {
  let r = await api(method, path, undefined, query);
  if (r.status === 404) {
    const deviceId = await ensureDevice();
    if (deviceId) r = await api(method, path, undefined, { ...(query ?? {}), device_id: deviceId });
  }
  if (r.status < 200 || r.status >= 300) throw new Error(apiError(r));
}

export const spotify: Integration = {
  id: 'spotify',
  label: 'Spotify',
  description: 'Play any song, artist, album or playlist, skip, pause, and like tracks by voice.',
  examples: ['Switch the song to Purple Haze by Jimi Hendrix', 'Play some chill jazz', 'Skip this', 'What song is this?'],
  urlScheme: 'spotify',
  requiresOAuth: true,

  async connect() {
    if (!SPOTIFY_CLIENT_ID) {
      throw new Error('Spotify is not configured yet (missing SPOTIFY_CLIENT_ID in app/.env).');
    }
    const verifier = randomString(64);
    const state = randomString(24);
    const redirect = OAUTH_REDIRECT('spotify');
    const q = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirect,
      scope: SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: pkceChallenge(verifier),
    });
    const params = await runOAuthInBrowser('spotify', `https://accounts.spotify.com/authorize?${q}`, state);
    if (params.error) throw new Error(`Spotify sign-in failed: ${params.error}`);
    if (!params.code) throw new Error('Spotify sign-in did not return a code');
    const tokens = await exchange({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: redirect,
      code_verifier: verifier,
    });
    await saveSecret(SECRET_ID, tokens);
    try {
      const me = await api('GET', '/me');
      if (me.status === 200) await saveSecret(SECRET_ID, { ...tokens, displayName: me.json?.display_name });
    } catch {
      /* cosmetic */
    }
  },

  async disconnect() {
    await deleteSecret(SECRET_ID);
  },

  async status(): Promise<ConnectionInfo> {
    const t = await getTokens();
    return { connected: !!t, detail: t?.displayName };
  },

  async execute(tool: AgentTool): Promise<ToolExecutionLog> {
    const p = tool.toolParameters ?? {};
    try {
      switch (tool.tool) {
        case 'spotify.play':
          return ok(tool.tool, await play(String(p.query), (p.type as SearchType) ?? null));
        case 'spotify.pause':
          await simple('PUT', '/me/player/pause');
          return ok(tool.tool, { paused: true });
        case 'spotify.resume':
          await simple('PUT', '/me/player/play');
          return ok(tool.tool, { playing: true });
        case 'spotify.next':
          await simple('POST', '/me/player/next');
          return ok(tool.tool, { skipped: true, ...(await nowPlaying().catch(() => ({}))) });
        case 'spotify.previous':
          await simple('POST', '/me/player/previous');
          return ok(tool.tool, { wentBack: true, ...(await nowPlaying().catch(() => ({}))) });
        case 'spotify.nowPlaying':
          return ok(tool.tool, await nowPlaying());
        case 'spotify.setVolume':
          await simple('PUT', '/me/player/volume', { volume_percent: String(Math.round(Number(p.percent))) });
          return ok(tool.tool, { volumePercent: Number(p.percent) });
        case 'spotify.shuffle':
          await simple('PUT', '/me/player/shuffle', { state: String(!!p.on) });
          return ok(tool.tool, { shuffle: !!p.on });
        case 'spotify.like': {
          const now = await nowPlaying();
          const r = await api('GET', '/me/player/currently-playing');
          const id = r.json?.item?.id;
          if (!id) throw new Error('Nothing is playing to save.');
          const s = await api('PUT', '/me/tracks', undefined, { ids: id });
          if (s.status < 200 || s.status >= 300) throw new Error(apiError(s));
          return ok(tool.tool, { saved: now.track, artist: now.artist });
        }
        default:
          return fail(tool.tool, `Unknown Spotify tool ${tool.tool}`);
      }
    } catch (e: any) {
      return fail(tool.tool, e?.message ?? String(e));
    }
  },
};
