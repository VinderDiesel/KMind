import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  assertValidCron,
  cronMatches,
  createLogger,
  loadScheduleState,
  loadEvolutionQueue,
  markRunFinish,
  markRunStart,
  minuteSlot,
  nextCron,
  runAdapterMaintenance,
  runEvolutionScan,
  saveScheduleState,
  schedulePidPath,
  type AdapterMaintenanceResult,
} from '@kmind/core';
import { KMindError, type KMindConfig } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { success } from '../exit.js';
import { resolveCliEntry } from './adapters.js';

const log = createLogger('schedule');

/**
 * List adapters with cron, next fire, and last run.
 */
export async function cmdScheduleList(ctx: AppContext): Promise<void> {
  const config = await ctx.vault.getConfig();
  const state = await loadScheduleState(ctx.vault);
  const now = new Date();
  const rows = [];
  for (const adapter of ctx.adapters) {
    const entry = config.adapters[adapter.name];
    const cron = entry?.schedule?.trim() || null;
    const enabled = entry?.enabled !== false;
    let next: string | null = null;
    if (cron && enabled) {
      try {
        const n = nextCron(cron, now);
        next = n ? n.toISOString() : null;
      } catch {
        next = null;
      }
    }
    const run = state.runs[adapter.name];
    rows.push({
      name: adapter.name,
      enabled,
      cron,
      next,
      lastSlot: run?.lastSlot ?? null,
      lastFinishedAt: run?.lastFinishedAt ?? null,
      lastOk: run?.lastOk ?? null,
      lastError: run?.lastError ?? null,
    });
  }
  success(
    {
      scheduleEnabled: config.schedule.enabled,
      tickSeconds: config.schedule.tickSeconds,
      adapters: rows,
    },
    ctx.json,
  );
}

/**
 * Set per-adapter cron in config.yaml.
 */
export async function cmdScheduleSet(
  ctx: AppContext,
  adapterName: string,
  cron: string,
): Promise<void> {
  ensureKnownAdapter(ctx, adapterName);
  assertValidCron(cron);
  const config = await ctx.vault.getConfig();
  const prev = config.adapters[adapterName] ?? {
    enabled: true,
    config: {},
  };
  config.adapters[adapterName] = {
    ...prev,
    enabled: prev.enabled !== false,
    schedule: cron.trim(),
    config: prev.config ?? {},
  };
  await ctx.vault.saveConfig(config);
  success(
    { adapter: adapterName, schedule: cron.trim(), saved: true },
    ctx.json,
  );
}

/**
 * Clear per-adapter cron.
 */
export async function cmdScheduleUnset(
  ctx: AppContext,
  adapterName: string,
): Promise<void> {
  ensureKnownAdapter(ctx, adapterName);
  const config = await ctx.vault.getConfig();
  const prev = config.adapters[adapterName];
  if (!prev) {
    success({ adapter: adapterName, schedule: null, saved: true }, ctx.json);
    return;
  }
  config.adapters[adapterName] = {
    enabled: prev.enabled !== false,
    config: prev.config ?? {},
  };
  await ctx.vault.saveConfig(config);
  success({ adapter: adapterName, schedule: null, saved: true }, ctx.json);
}

/**
 * Run maintenance now for one or all scheduled adapters.
 */
export async function cmdScheduleRun(
  ctx: AppContext,
  options: { adapter?: string; force?: boolean },
): Promise<void> {
  const payload = await executeScheduleRun(ctx, options);
  success(payload, ctx.json);
}

/**
 * Start schedule loop. With `daemon: true`, detach a background worker and print pid.
 */
export async function cmdScheduleStart(
  ctx: AppContext,
  options: { daemon?: boolean; vaultOpt?: string } = {},
): Promise<void> {
  if (options.daemon) {
    await startScheduleDaemonDetached(ctx, options.vaultOpt);
    return;
  }
  await runScheduleForegroundLoop(ctx);
}

/**
 * Detach `kmind schedule start` (foreground worker) and print pid.
 */
async function startScheduleDaemonDetached(
  ctx: AppContext,
  vaultOpt?: string,
): Promise<void> {
  const pidFile = schedulePidPath(ctx.vault);
  const logFile = path.join(ctx.vault.auditDir, 'schedule.log');
  await fs.mkdir(ctx.vault.auditDir, { recursive: true });

  const existingPid = await readPidFile(pidFile);
  if (existingPid !== null && isPidAlive(existingPid)) {
    success(
      {
        started: false,
        running: true,
        pid: existingPid,
        message: 'Schedule daemon already running',
        pidFile,
        logFile,
      },
      ctx.json,
    );
    return;
  }

  const cli = resolveCliEntry();
  const args = [
    cli,
    ...(vaultOpt ? ['--vault', vaultOpt] : []),
    'schedule',
    'start',
  ];
  const logFd = await fs.open(logFile, 'a');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd.fd, logFd.fd],
    env: process.env,
  });
  await logFd.close();

  if (child.pid == null) {
    throw new KMindError('Failed to spawn schedule daemon', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: true,
      suggestion: 'Check node binary and CLI path',
    });
  }

  await fs.writeFile(pidFile, `${child.pid}\n`, 'utf8');
  child.unref();

  await sleep(400);
  if (!isPidAlive(child.pid)) {
    const tail = await readLogTail(logFile);
    throw new KMindError('Schedule daemon exited immediately', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: true,
      suggestion: tail || `Inspect ${logFile}`,
    });
  }

  // Plain pid line for scripts; structured payload with --json.
  if (ctx.json) {
    success(
      {
        started: true,
        pid: child.pid,
        pidFile,
        logFile,
        hint: 'Use `kmind schedule stop` to shut down',
      },
      true,
    );
  } else {
    process.stdout.write(`${child.pid}\n`);
  }
}

/**
 * Foreground loop: poll cron and run due adapters (used by start and daemon worker).
 */
async function runScheduleForegroundLoop(ctx: AppContext): Promise<void> {
  const pidFile = schedulePidPath(ctx.vault);
  await fs.mkdir(ctx.vault.auditDir, { recursive: true });
  const existingPid = await readPidFile(pidFile);
  if (
    existingPid !== null &&
    existingPid !== process.pid &&
    isPidAlive(existingPid)
  ) {
    throw new KMindError('Schedule daemon already running', {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: false,
      suggestion: 'Run `kmind schedule stop` or `kmind schedule status`',
    });
  }
  await fs.writeFile(pidFile, `${process.pid}\n`, 'utf8');
  const state = await loadScheduleState(ctx.vault);
  state.daemonStartedAt = new Date().toISOString();
  await saveScheduleState(ctx.vault, state);

  let busy = false;
  let stopped = false;
  let tickSeconds = (await ctx.vault.getConfig()).schedule.tickSeconds;

  const shutdown = async (signal: string) => {
    if (stopped) return;
    stopped = true;
    log.info('stopping', { signal });
    try {
      const current = await readPidFile(pidFile);
      if (current === process.pid) await fs.unlink(pidFile);
    } catch {
      /* ignore */
    }
    ctx.store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info('daemon started', { pid: process.pid, pidFile, tickSeconds });
  if (!ctx.json) {
    process.stdout.write(
      `kmind schedule daemon running (pid ${process.pid}). Ctrl+C to stop.\n` +
        `Does not bypass Session dual-gate.\n`,
    );
  }

  const tick = async () => {
    if (stopped || busy) return;
    const config = await ctx.vault.getConfig();
    tickSeconds = config.schedule.tickSeconds;
    if (!config.schedule.enabled) {
      log.debug('schedule.enabled=false, skip tick');
      return;
    }
    busy = true;
    try {
      const payload = await executeScheduleRun(ctx, { force: false });
      if (payload.ran.length > 0) {
        log.info('tick ran', {
          adapters: payload.ran.map((r) => r.adapter),
        });
      }
      // Standalone evolution scan on healthCheck.schedule when no adapter ran.
      if (
        config.schedule.evolutionScan !== false &&
        !payload.evolution?.scanned
      ) {
        const cron = config.healthCheck.schedule?.trim();
        if (cron) {
          try {
            assertValidCron(cron);
            const now = new Date();
            const slot = minuteSlot(now);
            const state = await loadScheduleState(ctx.vault);
            const evoSlot = state.runs['__evolution__']?.lastSlot;
            if (cronMatches(cron, now) && evoSlot !== slot) {
              await markRunStart(ctx.vault, '__evolution__', slot);
              try {
                const scan = await runEvolutionScan(ctx.vault, ctx.store);
                await markRunFinish(ctx.vault, '__evolution__', true);
                log.info('evolution cron scan ok', {
                  open: scan.queue.summary.open,
                });
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                await markRunFinish(ctx.vault, '__evolution__', false, message);
                log.error('evolution cron scan failed', { error: message });
              }
            }
          } catch {
            /* invalid cron — skip */
          }
        }
      }
    } catch (err) {
      log.error('tick failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busy = false;
    }
  };

  await tick();

  await new Promise<void>((resolve) => {
    const loop = () => {
      if (stopped) {
        resolve();
        return;
      }
      setTimeout(() => {
        void tick().finally(() => loop());
      }, tickSeconds * 1000);
    };
    loop();
  });
}

/**
 * Stop daemon via PID file.
 */
export async function cmdScheduleStop(ctx: AppContext): Promise<void> {
  const pidFile = schedulePidPath(ctx.vault);
  let pid: number | null = null;
  try {
    pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
  } catch {
    success({ stopped: false, reason: 'no pid file' }, ctx.json);
    return;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    await fs.unlink(pidFile).catch(() => undefined);
    success({ stopped: false, reason: 'invalid pid file' }, ctx.json);
    return;
  }
  try {
    process.kill(pid, 0);
  } catch {
    await fs.unlink(pidFile).catch(() => undefined);
    success({ stopped: false, reason: 'process not running', pid }, ctx.json);
    return;
  }
  process.kill(pid, 'SIGTERM');
  success({ stopped: true, pid }, ctx.json);
}

/**
 * Daemon + schedule status snapshot.
 */
export async function cmdScheduleStatus(ctx: AppContext): Promise<void> {
  const config = await ctx.vault.getConfig();
  const state = await loadScheduleState(ctx.vault);
  const pidFile = schedulePidPath(ctx.vault);
  let pid: number | null = null;
  let alive = false;
  try {
    pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
    alive = isPidAlive(pid);
  } catch {
    pid = null;
  }
  const now = new Date();
  const nextDue = [];
  for (const adapter of ctx.adapters) {
    const cron = config.adapters[adapter.name]?.schedule?.trim();
    if (!cron || config.adapters[adapter.name]?.enabled === false) continue;
    try {
      const n = nextCron(cron, now);
      nextDue.push({
        adapter: adapter.name,
        cron,
        next: n?.toISOString() ?? null,
      });
    } catch {
      nextDue.push({
        adapter: adapter.name,
        cron,
        next: null,
        invalid: true,
      });
    }
  }
  const evo = await loadEvolutionQueue(ctx.vault);
  success(
    {
      daemon: { pid, alive, startedAt: state.daemonStartedAt ?? null },
      schedule: config.schedule,
      nextDue,
      runs: state.runs,
      evolution: {
        scannedAt: evo.scannedAt,
        summary: evo.summary,
        openPreview: evo.items
          .filter((i) => i.status === 'open')
          .slice(0, 10)
          .map((i) => ({
            id: i.id,
            severity: i.severity,
            source: i.source,
            code: i.code,
            message: i.message,
            project: i.project,
            assetId: i.assetId,
          })),
      },
    },
    ctx.json,
  );
}

interface RunPayload {
  slot: string;
  force: boolean;
  ran: Array<{
    adapter: string;
    ok: boolean;
    error?: string;
    result?: AdapterMaintenanceResult;
  }>;
  evolution?: {
    scanned: boolean;
    open: number;
    high: number;
    path?: string;
    error?: string;
  };
  note: string;
}

/**
 * Shared runner for CLI `run` and daemon ticks.
 */
export async function executeScheduleRun(
  ctx: AppContext,
  options: { adapter?: string; force?: boolean },
): Promise<RunPayload> {
  const config = await ctx.vault.getConfig();
  const state = await loadScheduleState(ctx.vault);
  const now = new Date();
  const slot = minuteSlot(now);
  const targets = resolveTargets(ctx, config, state, options, now, slot);

  const results: RunPayload['ran'] = [];
  for (const name of targets) {
    await markRunStart(ctx.vault, name, slot);
    try {
      const result = await runAdapterMaintenance(
        ctx.vault,
        {
          sqlite: ctx.store,
          registry: ctx.registry,
          evolver: ctx.evolver,
          adapters: ctx.adapters,
        },
        name,
      );
      await markRunFinish(ctx.vault, name, true);
      results.push({ adapter: name, ok: true, result });
      log.info('maintenance ok', {
        adapter: name,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markRunFinish(ctx.vault, name, false, message);
      results.push({ adapter: name, ok: false, error: message });
      log.error('maintenance failed', { adapter: name, error: message });
    }
  }

  let evolution: RunPayload['evolution'];
  const shouldScan =
    config.schedule.evolutionScan !== false &&
    (results.some((r) => r.ok) || Boolean(options.force));
  if (shouldScan) {
    try {
      const scan = await runEvolutionScan(ctx.vault, ctx.store);
      evolution = {
        scanned: true,
        open: scan.queue.summary.open,
        high: scan.queue.summary.high,
        path: scan.path,
      };
      log.info('evolution scan ok', {
        open: scan.queue.summary.open,
        high: scan.queue.summary.high,
      });
    } catch (err) {
      evolution = {
        scanned: false,
        open: 0,
        high: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      log.error('evolution scan failed', { error: evolution.error });
    }
  }

  return {
    slot,
    force: Boolean(options.force),
    ran: results,
    evolution,
    note: 'Session dual-gate unchanged: sessions/ do not become knowledge unless compileSessions+env. Evolution queue is diagnosis-only (no auto-capture).',
  };
}

function ensureKnownAdapter(ctx: AppContext, name: string): void {
  if (!ctx.adapters.some((a) => a.name === name)) {
    throw new KMindError(`Unknown adapter: ${name}`, {
      category: 'ADAPTER_ERROR',
      severity: 'medium',
      retryable: false,
      suggestion: 'Run `kmind adapters list` to see available adapters',
    });
  }
}

function resolveTargets(
  ctx: AppContext,
  config: KMindConfig,
  state: Awaited<ReturnType<typeof loadScheduleState>>,
  options: { adapter?: string; force?: boolean },
  now: Date,
  slot: string,
): string[] {
  const names = options.adapter
    ? [options.adapter]
    : ctx.adapters.map((a) => a.name);

  const out: string[] = [];
  for (const name of names) {
    ensureKnownAdapter(ctx, name);
    const entry = config.adapters[name];
    if (entry?.enabled === false) continue;
    const cron = entry?.schedule?.trim();

    if (options.force) {
      if (options.adapter) {
        out.push(name);
        continue;
      }
      if (!cron) continue;
      assertValidCron(cron);
      out.push(name);
      continue;
    }

    if (!cron) continue;
    assertValidCron(cron);
    if (!cronMatches(cron, now)) continue;
    if (state.runs[name]?.lastSlot === slot) continue;
    out.push(name);
  }
  return out;
}

async function readPidFile(pidFile: string): Promise<number | null> {
  try {
    const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLogTail(logFile: string, max = 800): Promise<string> {
  try {
    const raw = await fs.readFile(logFile, 'utf8');
    return raw.slice(-max).trim();
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
