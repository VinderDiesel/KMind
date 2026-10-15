import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { success, fail } from '../exit.js';
import { KMindError } from '@kmind/shared';

/**
 * List adapters with detect status.
 */
export async function cmdAdaptersList(ctx: AppContext): Promise<void> {
  const rows = [];
  for (const a of ctx.adapters) {
    rows.push({
      name: a.name,
      version: a.version,
      detected: await a.detect(),
    });
  }
  success(rows, ctx.json);
}

/**
 * Install MCP config for a named adapter.
 */
export async function cmdAdaptersInstall(
  ctx: AppContext,
  name: string,
): Promise<void> {
  const adapter = ctx.adapters.find((a) => a.name === name);
  if (!adapter) {
    fail(
      new KMindError(`Unknown adapter: ${name}`, {
        category: 'ADAPTER_ERROR',
        severity: 'medium',
        retryable: false,
        suggestion: 'Run `kmind adapters list` to see available adapters',
      }),
      ctx.json,
    );
  }
  const tpl = adapter.getMcpConfig();
  await fs.mkdir(path.dirname(tpl.targetPath), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(tpl.targetPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    existing = {};
  }
  const merged = deepMerge(existing, tpl.content);
  await fs.writeFile(tpl.targetPath, JSON.stringify(merged, null, 2), 'utf8');
  success({ installed: true, targetPath: tpl.targetPath }, ctx.json);
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof out[k] === 'object' &&
      out[k] !== null
    ) {
      out[k] = deepMerge(
        out[k] as Record<string, unknown>,
        v as Record<string, unknown>,
      );
    } else {
      out[k] = v;
    }
  }
  return out;
}
