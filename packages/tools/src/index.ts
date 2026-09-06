import * as z from 'zod';

/**
 * The tool catalog: the single source of truth shared by the server (planner
 * prompt + validation) and the app (readiness check + executor dispatch).
 *
 * Conventions (inherited from WorkFromCar):
 *  - Every parameter is nullable. The planner sets a parameter to null until the
 *    user has explicitly provided it; a tool is "ready" when its `executable`
 *    schema passes (nullable fields that are required for execution become
 *    non-null there).
 *  - `silent` tools are lookups. The device runs them immediately and feeds the
 *    result back to the planner in the same turn.
 *  - `requiresConfirmation` tools speak the plan back and wait for a yes.
 */

export type IntegrationId = 'spotify' | 'slack' | 'discord' | 'messenger' | 'imessage' | 'phone' | 'maps';

export type ToolSpec = {
  name: string;
  integration: IntegrationId;
  /** Zod schema for what the planner may emit (everything nullable). */
  planned: z.ZodTypeAny;
  /** Zod schema that must pass before the tool can be executed. */
  executable: z.ZodTypeAny;
  silent: boolean;
  requiresConfirmation: boolean;
  /** Planner-facing instructions (rendered into the system prompt). */
  instructions: string;
  /** Short human label for the UI. */
  label: string;
};

const nstr = () => z.string().nullable();
const nnum = () => z.number().nullable();
const nbool = () => z.boolean().nullable();

// ---------------------------------------------------------------------------
// Spotify (executed on-device with the user's PKCE token)
// ---------------------------------------------------------------------------

const spotifyPlayPlanned = z.object({
  query: nstr(),
  type: z.enum(['track', 'artist', 'album', 'playlist']).nullable(),
});
const spotifyPlayExecutable = z.object({
  query: z.string().min(1),
  type: z.enum(['track', 'artist', 'album', 'playlist']).nullable(),
});

const spotifyNoParams = z.object({}).passthrough();

const spotifySetVolumePlanned = z.object({ percent: nnum() });
const spotifySetVolumeExecutable = z.object({ percent: z.number().min(0).max(100) });

const spotifyShufflePlanned = z.object({ on: nbool() });
const spotifyShuffleExecutable = z.object({ on: z.boolean() });

// ---------------------------------------------------------------------------
// Slack (device executes with the user token obtained through the server OAuth flow)
// ---------------------------------------------------------------------------

const slackResolvePlanned = z.object({ name: nstr() });
const slackResolveExecutable = z.object({ name: z.string().min(1) });

const slackSendPlanned = z.object({
  targetId: nstr(),
  targetName: nstr(),
  text: nstr(),
});
const slackSendExecutable = z.object({
  targetId: z.string().min(1),
  targetName: z.string().min(1),
  text: z.string().min(1),
});

const slackReadPlanned = z.object({ targetId: nstr(), targetName: nstr(), limit: nnum() });
const slackReadExecutable = z.object({ targetId: z.string().min(1), targetName: nstr(), limit: nnum() });

const slackStatusPlanned = z.object({ text: nstr(), emoji: nstr() });
const slackStatusExecutable = z.object({ text: z.string(), emoji: nstr() });

// ---------------------------------------------------------------------------
// Discord (proxied through the server's bot token; user identified via OAuth)
// ---------------------------------------------------------------------------

const discordResolvePlanned = z.object({ name: nstr() });
const discordResolveExecutable = z.object({ name: z.string().min(1) });

const discordSendPlanned = z.object({ channelId: nstr(), channelName: nstr(), text: nstr() });
const discordSendExecutable = z.object({
  channelId: z.string().min(1),
  channelName: z.string().min(1),
  text: z.string().min(1),
});

const discordReadPlanned = z.object({ channelId: nstr(), channelName: nstr(), limit: nnum() });
const discordReadExecutable = z.object({ channelId: z.string().min(1), channelName: nstr(), limit: nnum() });

// ---------------------------------------------------------------------------
// Messenger + iMessage + phone ("hack" tier: drafts via deep links)
// ---------------------------------------------------------------------------

const messengerDraftPlanned = z.object({ to: nstr(), text: nstr() });
const messengerDraftExecutable = z.object({ to: nstr(), text: z.string().min(1) });

const contactResolvePlanned = z.object({ name: nstr() });
const contactResolveExecutable = z.object({ name: z.string().min(1) });

const imessageSendPlanned = z.object({ to: nstr(), toName: nstr(), text: nstr() });
const imessageSendExecutable = z.object({ to: z.string().min(3), toName: nstr(), text: z.string().min(1) });

const phoneCallPlanned = z.object({ to: nstr(), toName: nstr() });
const phoneCallExecutable = z.object({ to: z.string().min(3), toName: nstr() });

// ---------------------------------------------------------------------------
// Maps (deep links into Google Maps, Apple Maps fallback)
// ---------------------------------------------------------------------------

const mapsNavigatePlanned = z.object({
  destination: nstr(),
  mode: z.enum(['driving', 'walking', 'transit']).nullable(),
});
const mapsNavigateExecutable = z.object({
  destination: z.string().min(1),
  mode: z.enum(['driving', 'walking', 'transit']).nullable(),
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const TOOL_SPECS: ToolSpec[] = [
  // ---- Spotify ----
  {
    name: 'spotify.play',
    integration: 'spotify',
    label: 'Spotify',
    planned: spotifyPlayPlanned,
    executable: spotifyPlayExecutable,
    silent: false,
    requiresConfirmation: false,
    instructions: `"spotify.play" — search Spotify and start playing the best match. Use for "play X", "switch the song to X", "put on X", "play some X".
  toolParameters:
    - query: string | null  (what to search: song and/or artist, album, playlist, or a genre/mood like "chill jazz")
    - type: "track" | "artist" | "album" | "playlist" | null  (null = let the executor decide; use "artist" for "play some Beatles", "playlist" for a named playlist)
  Execute as soon as query is non-null. Never ask for confirmation.`,
  },
  {
    name: 'spotify.pause', integration: 'spotify', label: 'Spotify',
    planned: spotifyNoParams, executable: spotifyNoParams, silent: false, requiresConfirmation: false,
    instructions: `"spotify.pause" — pause playback. No parameters (use {}).`,
  },
  {
    name: 'spotify.resume', integration: 'spotify', label: 'Spotify',
    planned: spotifyNoParams, executable: spotifyNoParams, silent: false, requiresConfirmation: false,
    instructions: `"spotify.resume" — resume playback ("play", "unpause", "keep going"). No parameters (use {}).`,
  },
  {
    name: 'spotify.next', integration: 'spotify', label: 'Spotify',
    planned: spotifyNoParams, executable: spotifyNoParams, silent: false, requiresConfirmation: false,
    instructions: `"spotify.next" — skip to the next track. No parameters (use {}).`,
  },
  {
    name: 'spotify.previous', integration: 'spotify', label: 'Spotify',
    planned: spotifyNoParams, executable: spotifyNoParams, silent: false, requiresConfirmation: false,
    instructions: `"spotify.previous" — go back to the previous track. No parameters (use {}).`,
  },
  {
    name: 'spotify.nowPlaying', integration: 'spotify', label: 'Spotify',
    planned: spotifyNoParams, executable: spotifyNoParams, silent: true, requiresConfirmation: false,
    instructions: `"spotify.nowPlaying" — SILENT lookup of the current track/artist. Use for "what song is this", "who sings this". No parameters (use {}).`,
  },
  {
    name: 'spotify.setVolume', integration: 'spotify', label: 'Spotify',
    planned: spotifySetVolumePlanned, executable: spotifySetVolumeExecutable, silent: false, requiresConfirmation: false,
    instructions: `"spotify.setVolume" — set playback volume. toolParameters: { percent: number 0-100 | null }. "Turn it up/down" = current ± 20 (use spotify.nowPlaying first to learn the current volume if unknown).`,
  },
  {
    name: 'spotify.shuffle', integration: 'spotify', label: 'Spotify',
    planned: spotifyShufflePlanned, executable: spotifyShuffleExecutable, silent: false, requiresConfirmation: false,
    instructions: `"spotify.shuffle" — toggle shuffle. toolParameters: { on: boolean | null }.`,
  },
  {
    name: 'spotify.like', integration: 'spotify', label: 'Spotify',
    planned: spotifyNoParams, executable: spotifyNoParams, silent: false, requiresConfirmation: false,
    instructions: `"spotify.like" — save the current track to the user's library ("like this song", "save this"). No parameters (use {}).`,
  },

  // ---- Slack ----
  {
    name: 'slack.resolveTarget', integration: 'slack', label: 'Slack',
    planned: slackResolvePlanned, executable: slackResolveExecutable, silent: true, requiresConfirmation: false,
    instructions: `"slack.resolveTarget" — SILENT lookup that turns a person or channel name into a Slack id. toolParameters: { name: string | null }.
  Result: { status: "resolved", targetId, targetName, kind: "user"|"channel" } or { status: "ambiguous", candidates: [{targetId, targetName, kind}] } or { status: "no_match" }.
  Always call this before slack.sendMessage / slack.readMessages when you only have a name. If ambiguous, ask the user which one.`,
  },
  {
    name: 'slack.sendMessage', integration: 'slack', label: 'Slack',
    planned: slackSendPlanned, executable: slackSendExecutable, silent: false, requiresConfirmation: true,
    instructions: `"slack.sendMessage" — send a Slack message as the user. toolParameters: { targetId: string | null, targetName: string | null, text: string | null }.
  targetId/targetName come from slack.resolveTarget. text is the message body exactly as the user dictated (clean up filler words, keep meaning). Requires confirmation: once all parameters are set, read the message back and ask "should I send it?".`,
  },
  {
    name: 'slack.readMessages', integration: 'slack', label: 'Slack',
    planned: slackReadPlanned, executable: slackReadExecutable, silent: true, requiresConfirmation: false,
    instructions: `"slack.readMessages" — SILENT: fetch recent messages from a channel or DM. toolParameters: { targetId: string | null, targetName: string | null, limit: number | null (default 5) }. Use slack.resolveTarget first when only a name is known.`,
  },
  {
    name: 'slack.setStatus', integration: 'slack', label: 'Slack',
    planned: slackStatusPlanned, executable: slackStatusExecutable, silent: false, requiresConfirmation: false,
    instructions: `"slack.setStatus" — set the user's Slack status. toolParameters: { text: string | null, emoji: string | null (e.g. ":car:") }. "Clear my status" = { text: "", emoji: null }.`,
  },

  // ---- Discord ----
  {
    name: 'discord.resolveTarget', integration: 'discord', label: 'Discord',
    planned: discordResolvePlanned, executable: discordResolveExecutable, silent: true, requiresConfirmation: false,
    instructions: `"discord.resolveTarget" — SILENT lookup of a Discord channel by name (server name optional, e.g. "general in the climbing server"). toolParameters: { name: string | null }.
  Result: { status: "resolved", channelId, channelName } | { status: "ambiguous", candidates } | { status: "no_match" }.`,
  },
  {
    name: 'discord.sendMessage', integration: 'discord', label: 'Discord',
    planned: discordSendPlanned, executable: discordSendExecutable, silent: false, requiresConfirmation: true,
    instructions: `"discord.sendMessage" — post a message to a Discord channel on the user's behalf (delivered by the assistant's bot, attributed to the user). toolParameters: { channelId: string | null, channelName: string | null, text: string | null }. Use discord.resolveTarget first. Requires confirmation.`,
  },
  {
    name: 'discord.readMessages', integration: 'discord', label: 'Discord',
    planned: discordReadPlanned, executable: discordReadExecutable, silent: true, requiresConfirmation: false,
    instructions: `"discord.readMessages" — SILENT: fetch recent messages from a Discord channel. toolParameters: { channelId: string | null, channelName: string | null, limit: number | null (default 5) }.`,
  },

  // ---- Messenger (draft hack) ----
  {
    name: 'messenger.draft', integration: 'messenger', label: 'Messenger',
    planned: messengerDraftPlanned, executable: messengerDraftExecutable, silent: false, requiresConfirmation: true,
    instructions: `"messenger.draft" — Facebook Messenger has no API for sending as a person, so this copies the message to the clipboard and opens Messenger to the conversation. toolParameters: { to: string | null (person name, may stay null), text: string | null }. Requires confirmation. Tell the user they will need to tap send.`,
  },

  // ---- Maps ----
  {
    name: 'maps.navigate', integration: 'maps', label: 'Maps',
    planned: mapsNavigatePlanned, executable: mapsNavigateExecutable, silent: false, requiresConfirmation: false,
    instructions: `"maps.navigate" — start turn-by-turn directions in Google Maps (or Apple Maps). Use for "navigate to X", "take me to X", "directions to X", "go home", "find the nearest gas station / coffee".
  toolParameters:
    - destination: string | null  (a place name, address, or a search like "nearest gas station"; "home" / "work" pass through as-is)
    - mode: "driving" | "walking" | "transit" | null  (null = driving)
  Execute immediately when destination is non-null; say "Starting directions to X".`,
  },

  // ---- iMessage (draft hack) + phone ----
  {
    name: 'contacts.resolve', integration: 'imessage', label: 'Contacts',
    planned: contactResolvePlanned, executable: contactResolveExecutable, silent: true, requiresConfirmation: false,
    instructions: `"contacts.resolve" — SILENT lookup of a phone number from the user's contacts. toolParameters: { name: string | null }.
  Result: { status: "resolved", phone, name } | { status: "ambiguous", candidates: [{name, phone, label}] } | { status: "no_match" }. Required before imessage.send and phone.call when only a name is known.`,
  },
  {
    name: 'imessage.send', integration: 'imessage', label: 'Messages',
    planned: imessageSendPlanned, executable: imessageSendExecutable, silent: false, requiresConfirmation: true,
    instructions: `"imessage.send" — send a text via the Messages app. toolParameters: { to: string | null (phone number from contacts.resolve or dictated digits), toName: string | null, text: string | null }. Requires confirmation. The device opens Messages with the text pre-filled; depending on the user's setup they may need to tap send.`,
  },
  {
    name: 'phone.call', integration: 'phone', label: 'Phone',
    planned: phoneCallPlanned, executable: phoneCallExecutable, silent: false, requiresConfirmation: true,
    instructions: `"phone.call" — place a phone call. toolParameters: { to: string | null (phone number), toName: string | null }. Use contacts.resolve first for names. Requires confirmation.`,
  },
];

export const TOOL_BY_NAME: Record<string, ToolSpec> = Object.fromEntries(TOOL_SPECS.map((t) => [t.name, t]));

export function getToolSpec(name: string | null | undefined): ToolSpec | undefined {
  return name ? TOOL_BY_NAME[name] : undefined;
}

export function isSilentTool(name: string | null | undefined): boolean {
  return !!getToolSpec(name)?.silent;
}

export function requiresConfirmation(name: string | null | undefined): boolean {
  return !!getToolSpec(name)?.requiresConfirmation;
}

/** Validate planner output for a tool (all fields nullable). Throws ZodError. */
export function parsePlannedParameters(name: string, params: unknown): Record<string, any> {
  const spec = getToolSpec(name);
  if (!spec) throw new Error(`Unknown tool: ${name}`);
  return spec.planned.parse(params ?? {});
}

/** True when the tool has every parameter it needs to run. */
export function isToolExecutable(name: string | null | undefined, params: unknown): boolean {
  const spec = getToolSpec(name);
  if (!spec) return false;
  return spec.executable.safeParse(params ?? {}).success;
}

/** Tools available given the integrations the device has connected. */
export function toolsForIntegrations(connected: IntegrationId[]): ToolSpec[] {
  const set = new Set<IntegrationId>(connected);
  return TOOL_SPECS.filter((t) => set.has(t.integration));
}

export const INTEGRATION_LABELS: Record<IntegrationId, string> = {
  spotify: 'Spotify',
  slack: 'Slack',
  discord: 'Discord',
  messenger: 'Messenger',
  imessage: 'Messages',
  phone: 'Phone',
  maps: 'Maps',
};

/** Render planner instructions for the connected integrations only. */
export function renderToolInstructions(connected: IntegrationId[]): string {
  const tools = toolsForIntegrations(connected);
  if (tools.length === 0) {
    return 'No integrations are connected yet. You cannot call any tools; tell the user to connect an app in Settings.';
  }
  const byIntegration = new Map<IntegrationId, ToolSpec[]>();
  for (const t of tools) {
    if (!byIntegration.has(t.integration)) byIntegration.set(t.integration, []);
    byIntegration.get(t.integration)!.push(t);
  }
  let out = '';
  let i = 1;
  for (const [integration, specs] of byIntegration) {
    out += `\n## ${INTEGRATION_LABELS[integration]}\n`;
    for (const s of specs) {
      out += `${i++}. ${s.instructions.trim()}\n`;
    }
  }
  return out;
}
