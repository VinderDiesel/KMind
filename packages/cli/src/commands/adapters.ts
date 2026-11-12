import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_VAULT_DIRNAME, projectVaultPath } from '@kmind/core';
import { KMindError } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { success, fail } from '../exit.js';
import { ensureProjectFeatureTree } from './feature-tree.js';
import { findGitRoot } from './find-git-root.js';
import { installProjectAgentContext } from './project-context.js';
import { installSkillsForAdapter } from './skills.js';

/**
 * Absolute path to this CLI entry (`packages/cli/dist/index.js`).
 */
export function resolveCliEntry(): string {
  return path.resolve(fileURLToPath(new URL('../index.js', import.meta.url)));
}

export interface ResolveMcpLaunchOptions {
  cliEntry?: string;
  /** Absolute vault root; injects `--vault <path>` before `mcp-serve`. */
  vault?: string;
}

/**
 * Rewrite kmind MCP server entries to `node <cli> [--vault <path>] mcp-serve`.
 * Templates may still use `command: "kmind"` as a placeholder.
 */
export function withResolvedMcpLaunch(
  content: Record<string, unknown>,
  options: ResolveMcpLaunchOptions | string = {},
): Record<string, unknown> {
  const opts: ResolveMcpLaunchOptions =
    typeof options === 'string' ? { cliEntry: options } : options;
  const cliEntry = opts.cliEntry ?? resolveCliEntry();
  const args =
    opts.vault && opts.vault.length > 0
      ? [cliEntry, '--vault', path.resolve(opts.vault), 'mcp-serve']
      : [cliEntry, 'mcp-serve'];
  const launch = { command: 'node', args };
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

export interface AdaptersInstallOptions {
  skipSkills?: boolean;
  /**
   * Pin MCP to repo `.kmind-knowledge/` and write project-local config when possible
   * (Cursor: `<repo>/.cursor/mcp.json`).
   */
  project?: boolean;
  cwd?: string;
}

/**
 * Install MCP config (+ bundled Agent Skills) for a named adapter.
 */
export async function cmdAdaptersInstall(
  ctx: AppContext,
  name: string,
  options: AdaptersInstallOptions = {},
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

  const cwd = options.cwd ?? process.cwd();
  let vaultForMcp: string | undefined;
  let targetPath = adapter.getMcpConfig().targetPath;
  let repoRoot: string | undefined;

  if (options.project) {
    repoRoot = (await findGitRoot(cwd)) ?? undefined;
    if (!repoRoot) {
      fail(
        new KMindError('adapters install --project requires a git repository', {
          category: 'CONFIG_ERROR',
          severity: 'high',
          retryable: false,
          suggestion: 'cd into the business repo, run `kmind init --project`, then retry',
        }),
        ctx.json,
      );
    }
    vaultForMcp = projectVaultPath(repoRoot);
    try {
      await fs.access(path.join(vaultForMcp, 'config.yaml'));
    } catch {
      fail(
        new KMindError(`Project vault missing: ${vaultForMcp}`, {
          category: 'CONFIG_ERROR',
          severity: 'high',
          retryable: false,
          suggestion: 'Run `kmind init --project` in the repo root first',
        }),
        ctx.json,
      );
    }
    if (name === 'cursor') {
      targetPath = path.join(repoRoot, '.cursor', 'mcp.json');
    }
  }

  const tpl = adapter.getMcpConfig();
  const content = withResolvedMcpLaunch(tpl.content, {
    vault: vaultForMcp,
  });
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await fs.readFile(targetPath, 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    existing = {};
  }
  const merged = deepMerge(existing, content);
  await fs.writeFile(targetPath, JSON.stringify(merged, null, 2), 'utf8');

  let skills: Awaited<ReturnType<typeof installSkillsForAdapter>> = [];
  if (!options.skipSkills) {
    try {
      skills = await installSkillsForAdapter(name, {
        project: options.project,
        cwd: repoRoot ?? cwd,
      });
    } catch {
      skills = [];
    }
  }

  let agentContext;
  let featureTree;
  if (options.project && repoRoot && vaultForMcp) {
    try {
      featureTree = await ensureProjectFeatureTree(vaultForMcp);
    } catch {
      featureTree = undefined;
    }
    try {
      agentContext = await installProjectAgentContext(repoRoot);
    } catch {
      agentContext = undefined;
    }
  }

  success(
    {
      installed: true,
      targetPath,
      vault: vaultForMcp ?? null,
      vaultDirname: options.project ? PROJECT_VAULT_DIRNAME : null,
      featureTree,
      content: merged,
      skills,
      agentContext,
      hint: options.project
        ? `MCP pinned to ${vaultForMcp}. Keep FEATURE_TREE.md updated when capturing. Reload Cursor / new Agent chat; kmind_status must show this vaultPath.`
        : skills.length > 0
          ? 'MCP + skills installed. Restart the terminal (or /reload-skills). Without --project, MCP uses cwd discovery → often ~/.kmind.'
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
