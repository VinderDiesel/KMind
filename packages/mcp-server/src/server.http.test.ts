import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMcpHttpServer, type McpHttpServer } from './server.js';

describe('startMcpHttpServer', () => {
  let dir: string;
  let server: McpHttpServer | undefined;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('given http when GET /health then ok', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-mcp-http-'));
    server = await startMcpHttpServer({
      vaultRoot: dir,
      host: '127.0.0.1',
      port: 0,
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; transport: string };
    expect(body.ok).toBe(true);
    expect(body.transport).toBe('http');
  });
});
