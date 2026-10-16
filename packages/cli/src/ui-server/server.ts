import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleUiApi, type UiApiContext } from './api.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/**
 * Resolve built UI static directory (`@kmind/ui/dist`).
 */
export function resolveUiStaticDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/cli/dist/ui-server → packages/ui/dist
  return path.resolve(here, '../../../ui/dist');
}

/**
 * Start read-only localhost UI server. Resolves when listening.
 */
export async function startUiServer(options: {
  ctx: UiApiContext;
  host?: string;
  port?: number;
  staticDir?: string;
}): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 7821;
  const staticDir = options.staticDir ?? resolveUiStaticDir();

  const server = createServer((req, res) => {
    void handleRequest(req, res, options.ctx, staticDir);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  return {
    host,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: UiApiContext,
  staticDir: string,
): Promise<void> {
  try {
    const host = req.headers.host ?? '127.0.0.1';
    const url = new URL(req.url ?? '/', `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      const result = await handleUiApi(
        ctx,
        req.method ?? 'GET',
        url.pathname,
        url.searchParams,
      );
      sendJson(res, result.status, result.body);
      return;
    }
    await serveStatic(res, staticDir, url.pathname);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function serveStatic(
  res: ServerResponse,
  staticDir: string,
  pathname: string,
): Promise<void> {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const rel = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(staticDir, rel);
  if (!filePath.startsWith(staticDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback
    try {
      const index = await fs.readFile(path.join(staticDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(index);
    } catch {
      sendJson(res, 404, {
        error: 'UI assets not built. Run: pnpm --filter @kmind/ui build',
      });
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}
