import { execFile } from 'node:child_process';
import type { AppContext } from '../context.js';
import { startUiServer } from '../ui-server/server.js';
import { KMindError } from '@kmind/shared';

/**
 * Start local read-only knowledge UI on 127.0.0.1.
 */
export async function cmdUi(
  ctx: AppContext,
  options: { port?: number; focus?: string; open?: boolean },
): Promise<void> {
  const port = options.port ?? 7821;
  const openBrowser = options.open !== false;

  let server: Awaited<ReturnType<typeof startUiServer>>;
  try {
    server = await startUiServer({
      ctx: { vault: ctx.vault, store: ctx.store },
      host: '127.0.0.1',
      port,
    });
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code === 'EADDRINUSE') {
      throw new KMindError(`Port ${port} is already in use`, {
        category: 'CONFIG_ERROR',
        severity: 'medium',
        retryable: false,
        suggestion: `Pass --port <other> (default 7821)`,
      });
    }
    throw err;
  }

  const focusQ = options.focus
    ? `?focus=${encodeURIComponent(options.focus)}`
    : '';
  const url = `http://127.0.0.1:${server.port}/${focusQ}`;
  process.stdout.write(`KMind UI listening on ${url}\n`);
  process.stdout.write('Press Ctrl+C to stop.\n');

  if (openBrowser) {
    await openUrl(url);
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      void server.close().finally(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

async function openUrl(url: string): Promise<void> {
  const platform = process.platform;
  try {
    if (platform === 'darwin') {
      await execFileAsync('open', [url]);
    } else if (platform === 'win32') {
      await execFileAsync('cmd', ['/c', 'start', '', url]);
    } else {
      await execFileAsync('xdg-open', [url]);
    }
  } catch {
    process.stderr.write(`Could not open browser; visit ${url}\n`);
  }
}

function execFileAsync(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err ? reject(err) : resolve()));
  });
}
