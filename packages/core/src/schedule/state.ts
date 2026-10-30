import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Vault } from '../storage/vault.js';

const AdapterRunSchema = z.object({
  lastSlot: z.string().optional(),
  lastStartedAt: z.string().optional(),
  lastFinishedAt: z.string().optional(),
  lastOk: z.boolean().optional(),
  lastError: z.string().optional(),
});

export const ScheduleStateSchema = z.object({
  runs: z.record(AdapterRunSchema).default({}),
  daemonStartedAt: z.string().optional(),
});

export type AdapterRunState = z.infer<typeof AdapterRunSchema>;
export type ScheduleState = z.infer<typeof ScheduleStateSchema>;

/**
 * Absolute path for schedule state JSON under vault audit/.
 */
export function scheduleStatePath(vault: Vault): string {
  return path.join(vault.auditDir, 'schedule-state.json');
}

/**
 * Absolute path for schedule daemon PID file.
 */
export function schedulePidPath(vault: Vault): string {
  return path.join(vault.auditDir, 'schedule.pid');
}

/**
 * Load schedule state (empty default if missing/corrupt).
 */
export async function loadScheduleState(vault: Vault): Promise<ScheduleState> {
  const file = scheduleStatePath(vault);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = ScheduleStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* missing or invalid */
  }
  return { runs: {} };
}

/**
 * Persist schedule state atomically-ish (write then rename via temp).
 */
export async function saveScheduleState(
  vault: Vault,
  state: ScheduleState,
): Promise<void> {
  await fs.mkdir(vault.auditDir, { recursive: true });
  const file = scheduleStatePath(vault);
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(ScheduleStateSchema.parse(state), null, 2)}\n`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, file);
}

/**
 * Record start of an adapter maintenance run.
 */
export async function markRunStart(
  vault: Vault,
  adapter: string,
  slot: string,
): Promise<ScheduleState> {
  const state = await loadScheduleState(vault);
  state.runs[adapter] = {
    ...(state.runs[adapter] ?? {}),
    lastSlot: slot,
    lastStartedAt: new Date().toISOString(),
    lastOk: undefined,
    lastError: undefined,
  };
  await saveScheduleState(vault, state);
  return state;
}

/**
 * Record finish of an adapter maintenance run.
 */
export async function markRunFinish(
  vault: Vault,
  adapter: string,
  ok: boolean,
  error?: string,
): Promise<ScheduleState> {
  const state = await loadScheduleState(vault);
  state.runs[adapter] = {
    ...(state.runs[adapter] ?? {}),
    lastFinishedAt: new Date().toISOString(),
    lastOk: ok,
    lastError: ok ? undefined : error ?? 'unknown error',
  };
  await saveScheduleState(vault, state);
  return state;
}
