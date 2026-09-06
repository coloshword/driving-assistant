import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(env('PORT', '3000')),
  openaiApiKey: env('OPENAI_API_KEY'),
  plannerModel: env('PLANNER_MODEL', 'gpt-5.6-luna'),
  plannerReasoningEffort: env('PLANNER_REASONING_EFFORT', 'none') as 'none' | 'low' | 'medium' | 'high',
  appApiKey: env('APP_API_KEY'),
  publicBaseUrl: env('PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/$/, ''),
  appUrlScheme: env('APP_URL_SCHEME', 'drivingassistant'),
  slack: {
    clientId: env('SLACK_CLIENT_ID'),
    clientSecret: env('SLACK_CLIENT_SECRET'),
    userScopes: env(
      'SLACK_USER_SCOPES',
      'chat:write,channels:read,groups:read,im:read,im:write,mpim:read,users:read,channels:history,groups:history,im:history,mpim:history,users.profile:write,search:read',
    ),
  },
  discord: {
    clientId: env('DISCORD_CLIENT_ID'),
    clientSecret: env('DISCORD_CLIENT_SECRET'),
    botToken: env('DISCORD_BOT_TOKEN'),
  },
};

export type Config = typeof config;
