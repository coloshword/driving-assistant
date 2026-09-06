import Koa from 'koa';
import Router from '@koa/router';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
import { ZodError } from 'zod';
import { config } from './config.js';
import { planRoute, executePermissionRoute, summarizeRoute } from './agent/routes.js';
import { startRoute, callbackRoute, claimRoute, statusRoute } from './oauth/routes.js';
import { resolveRoute, sendRoute, readRoute } from './discord/routes.js';

export function createApp(): Koa {
  const app = new Koa();
  app.use(cors());
  app.use(bodyParser({ jsonLimit: '2mb' }));

  // Error envelope
  app.use(async (ctx, next) => {
    const t0 = Date.now();
    try {
      await next();
    } catch (err: any) {
      const status = err instanceof ZodError ? 400 : err?.status ?? 500;
      ctx.status = status;
      ctx.body = {
        error: err instanceof ZodError ? 'invalid request' : err?.message ?? 'internal error',
        ...(err instanceof ZodError ? { issues: err.issues.slice(0, 10) } : {}),
      };
      if (status >= 500) console.error(`[${ctx.method} ${ctx.path}]`, err);
    } finally {
      console.log(`${ctx.method} ${ctx.path} -> ${ctx.status} ${Date.now() - t0}ms`);
    }
  });

  // Shared-secret auth for the app-facing API (OAuth browser routes stay open).
  app.use(async (ctx, next) => {
    if (config.appApiKey && ctx.path.startsWith('/api/')) {
      if (ctx.get('x-app-key') !== config.appApiKey) {
        ctx.status = 401;
        ctx.body = { error: 'unauthorized' };
        return;
      }
    }
    await next();
  });

  const router = new Router();
  router.get('/health', (ctx) => {
    ctx.body = { ok: true, model: config.plannerModel, reasoning: config.plannerReasoningEffort };
  });

  // Dev-only remote console for the app (see app/src/services/devConsole.ts).
  router.post('/api/dev/log', (ctx) => {
    const lines = ((ctx.request.body as any)?.lines ?? []) as Array<{ level: string; msg: string; at: number }>;
    for (const l of lines) {
      const t = new Date(l.at).toLocaleTimeString('en-US', { hour12: false });
      console.log(`[app:${l.level}] ${t} ${l.msg}`);
    }
    ctx.body = { ok: true };
  });

  router.post('/api/agent/plan', planRoute);
  router.post('/api/agent/executePermission', executePermissionRoute);
  router.post('/api/agent/summarize', summarizeRoute);

  router.get('/oauth/status', statusRoute);
  router.get('/oauth/:provider/start', startRoute);
  router.get('/oauth/:provider/callback', callbackRoute);
  router.post('/oauth/:provider/claim', claimRoute);

  router.post('/api/discord/resolve', resolveRoute);
  router.post('/api/discord/send', sendRoute);
  router.post('/api/discord/read', readRoute);

  app.use(router.routes()).use(router.allowedMethods());
  return app;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`driving-assistant server on :${config.port} (planner=${config.plannerModel}, effort=${config.plannerReasoningEffort})`);
  });
}
