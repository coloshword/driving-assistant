/**
 * End-to-end smoke test against the real planner model. Runs a few driving
 * utterances through /plan, the silent-tool loop (with fake tool results),
 * confirmation, and summarize, and prints latency for each call.
 *
 *   npm run smoke            # against http://localhost:3000
 *   BASE=https://... npm run smoke
 */
const BASE = process.env.BASE ?? 'http://localhost:3000';
const KEY = process.env.APP_API_KEY ?? '';

type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

async function post(path: string, body: unknown) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(KEY ? { 'x-app-key': KEY } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { json, ms: Date.now() - t0, status: res.status };
}

const connected = ['spotify', 'slack', 'discord', 'messenger', 'imessage', 'phone'];

async function turn(label: string, messages: Msg[], contextTool?: unknown) {
  const { json, ms, status } = await post('/api/agent/plan', { messages, connectedIntegrations: connected, contextTool });
  console.log(`\n[${label}] ${status} ${ms}ms`);
  console.log('  say :', json.message?.content);
  console.log('  tool:', json.tool?.tool || '-', JSON.stringify(json.tool?.toolParameters ?? null), json.tool?.silent ? '(silent)' : '', json.tool?.requiresConfirmation ? '(confirm)' : '');
  return json;
}

async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log('health:', health);

  // 1. Spotify: should execute immediately
  const m1: Msg[] = [{ role: 'user', content: 'switch the song to purple haze by jimi hendrix' }];
  const r1 = await turn('spotify.play', m1);
  if (r1.tool?.tool === 'spotify.play') {
    const s = await post('/api/agent/summarize', {
      messages: [...m1, r1.message],
      toolLog: { tool: 'spotify.play', status: 'success', result: { playing: 'Purple Haze', artist: 'Jimi Hendrix', device: 'iPhone' } },
    });
    console.log(`  summary (${s.ms}ms):`, s.json.assistant);
  }

  // 2. Slack DM: resolve (silent) -> send (confirm) -> yes -> execute
  const m2: Msg[] = [{ role: 'user', content: 'tell sam on slack that I am running ten minutes late' }];
  const r2 = await turn('slack step 1', m2);
  let msgs = [...m2, r2.message as Msg];
  if (r2.tool?.silent) {
    msgs.push({ role: 'system', content: JSON.stringify({ tool: r2.tool.tool, status: 'success', result: { status: 'resolved', targetId: 'U0123', targetName: 'Sam Rivera', kind: 'user' } }) });
    const r2b = await turn('slack step 2 (after resolve)', msgs);
    msgs.push(r2b.message as Msg);
    if (r2b.tool?.requiresConfirmation) {
      msgs.push({ role: 'user', content: 'yeah send it' });
      const p = await post('/api/agent/executePermission', { messages: msgs, tool: r2b.tool });
      console.log(`  permission (${p.ms}ms):`, p.json.decision, '-', p.json.assistant);
      msgs.push({ role: 'user', content: 'actually say fifteen minutes' });
      const rev = await turn('slack revise', msgs, r2b.tool);
      void rev;
    }
  }

  // 3. Unsupported ask
  await turn('unsupported', [{ role: 'user', content: 'order me a pizza' }]);

  // 4. Chit-chat
  await turn('chat', [{ role: 'user', content: 'thanks that was great' }]);

  // 5. iMessage
  const m5: Msg[] = [{ role: 'user', content: 'text mom I will be home by seven' }];
  const r5 = await turn('imessage step 1', m5);
  if (r5.tool?.silent) {
    const msgs5 = [...m5, r5.message as Msg, { role: 'system', content: JSON.stringify({ tool: r5.tool.tool, status: 'success', result: { status: 'resolved', name: 'Mom', phone: '+15551234567' } }) } as Msg];
    await turn('imessage step 2', msgs5);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
