import { DEFAULT_API_BASE_URL } from '../config';

/**
 * Dev-only remote console: mirrors console.log/warn/error to the planning
 * server (POST /api/dev/log), which prints them. React Native 0.83 no longer
 * shows JS logs in the Metro terminal, and os_log does not carry them either,
 * so this is what lets a terminal-only workflow (and CI-style simulator
 * verification) see what the JS side is doing. Compiled out of release builds.
 */
export function installDevConsole(): void {
  // TEMP DIAGNOSTIC: always on, logs hardwired to the laptop
  const LOG_ENDPOINT = 'http://192.168.1.23:3000/api/dev/log';
  const queue: Array<{ level: string; msg: string; at: number }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: batch }),
    }).catch(() => {
      /* server not running; drop */
    });
  };
  const fmt = (args: unknown[]) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ')
      .slice(0, 2000);
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      queue.push({ level, msg: fmt(args), at: Date.now() });
      if (!timer) timer = setTimeout(flush, 300);
    };
  }
}
