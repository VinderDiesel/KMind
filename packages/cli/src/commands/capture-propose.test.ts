import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createAssetTypeRegistry,
  createVault,
  loadCaptureProposal,
  OntologyEvolver,
  OntologyRegistry,
  SqliteStore,
} from '@kmind/core';
import type { AppContext } from '../context.js';
import { cmdCapture, parseAnchorsOption, parseRelatedOption } from './capture.js';
import { cmdCaptureCommit, cmdCapturePropose } from './capture-propose.js';

const QUALITY_BODY = `
## 实现方式
1. step one with enough detail for the quality gate length budget and concrete paths.
2. step two continues the implementation narrative with packages/cli/src/commands/capture-propose.ts.
3. step three references cmdCaptureCommit field passthrough for anchors and related.

\`\`\`ts
export async function cmdCaptureCommit() {}
\`\`\`

## 注意事项
- note a with enough characters to pass minimum body length checks in tests.
- note b about incremental related hang-graph when project already has assets.
- note c: propose stages fields; commit must write them into raw JSONL.

## 红线规避
- **禁止** dropping anchors/related on CLI capture-commit.
- **禁止** missing project scope.
- **禁止** silent session promotion.
- always pass --related when incremental writing the same project.
`;

describe('CLI capture-propose field passthrough', () => {
  let dir: string;
  let store: SqliteStore;
  let ctx: AppContext;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-cli-propose-'));
    const vault = createVault(path.join(dir, 'vault'));
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
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given related and anchors when propose then proposal fields persist', async () => {
    const chunks: Buffer[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    let proposalId = '';
    try {
      await cmdCapturePropose(ctx, QUALITY_BODY, {
        project: 'demo',
        type: 'best_practice',
        title: 'propose fields',
        related: 'k-2026-11-18-001-abcd',
        anchors: JSON.stringify([
          {
            file: 'packages/cli/src/commands/capture-propose.ts',
            symbol: 'cmdCaptureCommit',
            confidence: 1,
          },
        ]),
      });
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        proposalId: string;
        related: string[];
        anchors: Array<{ file: string }>;
      };
      proposalId = payload.proposalId;
      expect(payload.related).toEqual(['k-2026-11-18-001-abcd']);
      expect(payload.anchors[0]?.file).toContain('capture-propose.ts');
    } finally {
      process.stdout.write = origWrite;
    }
    const loaded = await loadCaptureProposal(ctx.vault, proposalId);
    expect(loaded?.fields.related).toEqual(['k-2026-11-18-001-abcd']);
    expect(loaded?.fields.anchors?.[0]?.symbol).toBe('cmdCaptureCommit');
  });

  it('given incremental project when commit with related then creates asset', async () => {
    const seedChunks: Buffer[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      seedChunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdCapture(ctx, QUALITY_BODY, {
        project: 'demo',
        type: 'best_practice',
        title: 'hub seed card',
        anchors: JSON.stringify([
          {
            file: 'packages/cli/src/commands/capture.ts',
            symbol: 'cmdCapture',
            confidence: 1,
          },
        ]),
      });
    } finally {
      process.stdout.write = origWrite;
    }
    const peers = await store.queryAssets({ project: 'demo', limit: 10 });
    expect(peers.length).toBeGreaterThanOrEqual(1);
    const hubId = peers[0]!.id;

    const proposeChunks: Buffer[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      proposeChunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    let proposalId = '';
    try {
      await cmdCapturePropose(ctx, QUALITY_BODY, {
        project: 'demo',
        type: 'best_practice',
        title: 'incremental child',
        related: hubId,
        anchors: JSON.stringify([
          {
            file: 'packages/cli/src/commands/capture-propose.ts',
            symbol: 'cmdCapturePropose',
            confidence: 1,
          },
        ]),
      });
      proposalId = (
        JSON.parse(Buffer.concat(proposeChunks).toString('utf8')) as {
          proposalId: string;
        }
      ).proposalId;
    } finally {
      process.stdout.write = origWrite;
    }

    const commitChunks: Buffer[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      commitChunks.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await cmdCaptureCommit(ctx, proposalId);
    } finally {
      process.stdout.write = origWrite;
    }
    const committed = JSON.parse(
      Buffer.concat(commitChunks).toString('utf8'),
    ) as { committed: boolean; assetId?: string };
    expect(committed.committed).toBe(true);
    expect(committed.assetId).toMatch(/^k-/);

    const child = await store.getAsset(committed.assetId!);
    expect(child?.related).toContain(hubId);
    expect(child?.metadata?.codeAnchors?.[0]?.file).toContain(
      'capture-propose.ts',
    );

    const rawFiles = await fs.readdir(path.join(ctx.vault.rawDir, 'manual'));
    const latest = rawFiles.sort().at(-1)!;
    const rawLine = JSON.parse(
      (
        await fs.readFile(
          path.join(ctx.vault.rawDir, 'manual', latest),
          'utf8',
        )
      )
        .trim()
        .split('\n')
        .at(-1)!,
    ) as { related?: string[]; anchors?: unknown[] };
    expect(rawLine.related).toContain(hubId);
    expect(Array.isArray(rawLine.anchors)).toBe(true);
  });

  it('given parse helpers when related/anchors then validates shape', () => {
    expect(parseRelatedOption('k-2026-11-18-001-abcd, bad')).toEqual([
      'k-2026-11-18-001-abcd',
    ]);
    expect(
      parseAnchorsOption(
        '[{"file":"a.ts","symbol":"foo","confidence":1}]',
      )?.[0]?.file,
    ).toBe('a.ts');
  });
});
