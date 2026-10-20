import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVault, startMcpHttpServer, startMcpServer } from '@kmind/mcp-server';
import { KMindError } from '@kmind/shared';
import { success } from '../exit.js';
import { resolveCliEntry } from './adapters.js';

export interface McpServeOptions {
  vault?: string;
  /** Force stdio even on a TTY (IDE / pipe clients already use stdio). */
  stdio?: boolean;
  /** Listen with Streamable HTTP (foreground unless --daemon). */
  http?: boolean;
  host?: string;
  port?: number;
  /** Detach HTTP MCP into background. */
  daemon?: boolean;
  stop?: boolean;
  status?: boolean;
  json?: boolean;
}

const DEFAULT_HTTP_PORT = 7822;

/**
 * Start MCP server (stdio for IDE, or HTTP / daemon for background use).
 */
export async function cmdMcpServe(options: McpServeOptions = {}): Promise<void> {
  if (options.stop) {
    await stopDaemon(options);
    return;
  }
  if (options.status) {
    await statusDaemon(options);
    return;
  }
  if (options.daemon) {
    await startDaemon(options);
    return;
  }

  const wantHttp = Boolean(options.http);
  const wantStdio = Boolean(options.stdio) || (!wantHttp && !process.stdin.isTTY);

  if (process.stdin.isTTY && !wantHttp && !wantStdio) {
    printTtyHint(options.port ?? DEFAULT_HTTP_PORT);
    return;
  }

  if (wantHttp) {
    const server = await startMcpHttpServer({
      vaultRoot: options.vault,
      host: options.host ?? '127.0.0.1',
      port: options.port ?? DEFAULT_HTTP_PORT,
    });
    process.stdout.write(
      `KMind MCP HTTP listening on ${server.url}\nHealth: http://${server.host}:${server.port}/health\nPress Ctrl+C to stop.\n`,
    );
    await new Promise<void>((resolve) => {
      const shutdown = () => {
        void server.close().finally(() => resolve());
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });
    return;
  }

  await startMcpServer(options.vault);
}

function printTtyHint(port: number): void {
  process.stdout.write(`KMind MCP 通常由 Cursor / Claude Code 等客户端按需拉起（stdio），无需手动前台常驻。

后台运行（HTTP，本机可访问）:
  pnpm kmind mcp-serve --daemon
  pnpm kmind mcp-serve --daemon --port ${port}

管理:
  pnpm kmind mcp-serve --status
  pnpm kmind mcp-serve --stop

前台调试:
  pnpm kmind mcp-serve --http          # HTTP 前台
  pnpm kmind mcp-serve --stdio         # 强制 stdio 前台

适配器安装后重启 IDE 即可使用 stdio MCP。
`);
}

async function startDaemon(options: McpServeOptions): Promise<void> {
  const paths = await daemonPaths(options.vault);
  await fs.mkdir(path.dirname(paths.pidFile), { recursive: true });
  await fs.mkdir(path.dirname(paths.logFile), { recursive: true });

  const existing = await readPid(paths.pidFile);
  if (existing !== null && (await isAlive(existing))) {
    success(
      {
        running: true,
        pid: existing,
        message: 'MCP daemon already running',
        pidFile: paths.pidFile,
        logFile: paths.logFile,
      },
      options.json ?? false,
    );
    return;
  }

  const port = options.port ?? DEFAULT_HTTP_PORT;
  const host = options.host ?? '127.0.0.1';
  const cli = resolveCliEntry();
  const args = [
    cli,
    ...(options.vault ? ['--vault', options.vault] : []),
    'mcp-serve',
    '--http',
    '--host',
    host,
    '--port',
    String(port),
  ];

  const logFd = await fs.open(paths.logFile, 'a');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    env: process.env,
  });
  await logFd.close();

  if (child.pid == null) {
    throw new KMindError('Failed to spawn MCP daemon', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: true,
      suggestion: 'Check node binary and CLI path',
    });
  }

  await fs.writeFile(paths.pidFile, `${child.pid}\n`, 'utf8');
  child.unref();

  // Brief wait so bind failures surface in the log.
  await sleep(400);
  if (!(await isAlive(child.pid))) {
    const tail = await readLogTail(paths.logFile);
    throw new KMindError('MCP daemon exited immediately', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: true,
      suggestion: tail || `Inspect ${paths.logFile}`,
    });
  }

  success(
    {
      started: true,
      pid: child.pid,
      url: `http://${host}:${port}/mcp`,
      health: `http://${host}:${port}/health`,
      pidFile: paths.pidFile,
      logFile: paths.logFile,
      hint: 'Use --stop to shut down; IDE stdio MCP is unchanged.',
    },
    options.json ?? false,
  );
}

async function stopDaemon(options: McpServeOptions): Promise<void> {
  const paths = await daemonPaths(options.vault);
  const pid = await readPid(paths.pidFile);
  if (pid === null) {
    success({ stopped: false, message: 'No pid file' }, options.json ?? false);
    return;
  }
  if (!(await isAlive(pid))) {
    await fs.rm(paths.pidFile, { force: true });
    success(
      { stopped: false, message: 'Process not running; cleaned pid file', pid },
      options.json ?? false,
    );
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 20; i++) {
    if (!(await isAlive(pid))) break;
    await sleep(100);
  }
  if (await isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  await fs.rm(paths.pidFile, { force: true });
  success({ stopped: true, pid }, options.json ?? false);
}

async function statusDaemon(options: McpServeOptions): Promise<void> {
  const paths = await daemonPaths(options.vault);
  const pid = await readPid(paths.pidFile);
  const running = pid !== null && (await isAlive(pid));
  success(
    {
      running,
      pid: running ? pid : null,
      pidFile: paths.pidFile,
      logFile: paths.logFile,
    },
    options.json ?? false,
  );
}

async function daemonPaths(vaultOpt?: string): Promise<{
  pidFile: string;
  logFile: string;
}> {
  const vault = createVault(vaultOpt);
  const root = vault.root;
  return {
    pidFile: path.join(root, 'run', 'mcp-http.pid'),
    logFile: path.join(root, 'logs', 'mcp-http.log'),
  };
}

async function readPid(pidFile: string): Promise<number | null> {
  try {
    const raw = (await fs.readFile(pidFile, 'utf8')).trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLogTail(logFile: string): Promise<string> {
  try {
    const raw = await fs.readFile(logFile, 'utf8');
    return raw.trim().split('\n').slice(-8).join('\n');
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve CLI entry for tests / tooling. */
export function resolveMcpCliEntry(): string {
  try {
    return resolveCliEntry();
  } catch {
    return fileURLToPath(new URL('../index.js', import.meta.url));
  }
}
