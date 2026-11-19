import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAssetTypeRegistry,
  createVault,
  OntologyEvolver,
  OntologyRegistry,
  SqliteStore,
} from '@kmind/core';
import type { AppContext } from '../context.js';
import { cmdBootstrapRun } from './bootstrap.js';

interface RunPayload {
  ok: boolean;
  project: string;
  reindex: { reindexed?: boolean; assetCount?: number; skipped?: boolean };
  plan: { taskCount: number; todo: number };
  tree: { path: string; action: string; rowsWritten: number } | null;
  coverage: { claimCompleteAllowed: boolean };
  nextCommands: Array<{ group: string; command: string; todo: number }>;
}

describe('cmdBootstrapRun', () => {
  let dir: string;
  let store: SqliteStore;
  let ctx: AppContext;
  let origWrite: typeof process.stdout.write;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-bootstrap-run-'));
    const javaFile = path.join(
      dir,
      'src/main/java/com/acme/app/service/AskService.java',
    );
    mkdirSync(path.dirname(javaFile), { recursive: true });
    writeFileSync(javaFile, 'class AskService {}\n', 'utf8');

    const vault = createVault(path.join(dir, '.kmind-knowledge'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    const evolver = new OntologyEvolver(vault.ontologyDir, registry);
    const assetTypes = await createAssetTypeRegistry(vault.assetTypesDir);
    ctx = {
      vault,
      store,
      registry,
      evolver,
      assetTypes,
      adapters: [],
      json: true,
    };
    origWrite = process.stdout.write.bind(process.stdout);
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(): Promise<RunPayload> {
    const chunks: Buffer[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdBootstrapRun(ctx, { project: 'demo', repo: dir });
    } finally {
      process.stdout.write = origWrite;
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RunPayload;
  }

  it('given project vault when run then writes tree, reindexes and reports coverage', async () => {
    const payload = await run();

    expect(payload.ok).toBe(true);
    expect(payload.reindex).toEqual({ reindexed: true, assetCount: 0 });
    expect(payload.tree?.action).toBe('created_section');
    expect(payload.plan.taskCount).toBeGreaterThan(0);
    expect(payload.coverage.claimCompleteAllowed).toBe(false);
    expect(payload.nextCommands[0]?.command).toContain('bootstrap delegate');

    const treeFile = path.join(ctx.vault.root, 'FEATURE_TREE.md');
    expect(readFileSync(treeFile, 'utf8')).toContain(
      'kmind:bootstrap-dig-tasks:start',
    );
    // ADR-004: bootstrap never writes knowledge bodies.
    const mdFiles = readdirSync(ctx.vault.knowledgeDir).filter((f) =>
      f.endsWith('.md'),
    );
    expect(mdFiles).toEqual([]);
  });

  it('given already-initialized vault when run twice then is idempotent', async () => {
    await run();
    const second = await run();

    expect(second.tree?.action).toBe('unchanged');
    expect(second.plan.todo).toBe(second.plan.taskCount);
  });

  it('given --no-tree when run then FEATURE_TREE is not rewritten', async () => {
    const chunks: Buffer[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdBootstrapRun(ctx, { project: 'demo', repo: dir, tree: false });
    } finally {
      process.stdout.write = origWrite;
    }
    const payload = JSON.parse(
      Buffer.concat(chunks).toString('utf8'),
    ) as RunPayload;
    expect(payload.tree).toBeNull();
  });

  it('given unsupported provider when run then fails before planning', async () => {
    await expect(
      cmdBootstrapRun(ctx, { project: 'demo', repo: dir, provider: 'gemini' }),
    ).rejects.toThrow(/不支持的 provider/);
  });

  it('given --write without model when run then reports llm CONFIG_ERROR', async () => {
    await expect(
      cmdBootstrapRun(ctx, { project: 'demo', repo: dir, write: true }),
    ).rejects.toThrow(/LLM model 未配置/);
  });

  it('given out-of-range --min-confidence when run then rejects the flag', async () => {
    await expect(
      cmdBootstrapRun(ctx, {
        project: 'demo',
        repo: dir,
        dryRun: true,
        minConfidence: 2,
      }),
    ).rejects.toThrow(/--min-confidence/);
  });
});
