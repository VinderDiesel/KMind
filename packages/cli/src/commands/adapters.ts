import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppContext } from '../context.js';
import { success, fail } from '../exit.js';
import { KMindError } from '@kmind/shared';
import { installSkillsForAdapter } from './skills.js';

/**
 * Absolute path to this CLI entry (`packages/cli/dist/index.js`).
 */
export function resolveCliEntry(): string {
  return path.resolve(fileURLToPath(new URL('../index.js', import.meta.url)));
}

/**
 * Rewrite kmind MCP server entries to `node <cli> mcp-serve`.
 * Templates may still use `command: "kmind"` as a placeholder.
 */
export function withResolvedMcpLaunch(
  content: Record<string, unknown>,
  cliEntry = resolveCliEntry(),
): Record<string, unknown> {
  const launch = { command: 'node', args: [cliEntry, 'mcp-serve'] };
  const out = structuredClone(content) as Record<string, unknown>;
  for (const key of ['mcpServers', 'mcp_servers'] as const) {
    const servers = out[key];
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
    const map = servers as Record<string, unknown>;
    if (!('kmind' in map)) continue;
    const prev =
      map.kmind && typeof map.kmind === 'object' && !Array.isArray(map.kmind)
        ? (map.kmind as Record<string, unknown>)
        : {};
    map.kmind = { ...prev, ...launch };
  }
  return out;
}

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
 * Install MCP config (+ bundled Agent Skills) for a named adapter.
 */
export async function cmdAdaptersInstall(
  ctx: AppContext,
  name: string,
  options?: { skipSkills?: boolean },
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
  const content = withResolvedMcpLaunch(tpl.content);
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
  const merged = deepMerge(existing, content);
  await fs.writeFile(tpl.targetPath, JSON.stringify(merged, null, 2), 'utf8');

  let skills: Awaited<ReturnType<typeof installSkillsForAdapter>> = [];
  if (!options?.skipSkills) {
    try {
      skills = await installSkillsForAdapter(name);
    } catch {
      skills = [];
    }
  }

  success(
    {
      installed: true,
      targetPath: tpl.targetPath,
      content,
      skills,
      hint:
        skills.length > 0
          ? 'MCP + skills installed. Restart the terminal (or /reload-skills).'
          : 'MCP installed. Run `kmind skills install ' +
            name +
            '` to add Agent Skills.',
    },
    ctx.json,
  );
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
