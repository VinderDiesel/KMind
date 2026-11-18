import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVault } from '../storage/vault.js';
import {
  commitCaptureProposal,
  createCaptureProposal,
} from './capture-propose.js';

const QUALITY_BODY = `
## 实现方式
1. step one with enough detail for the quality gate length budget.
2. step two continues the implementation narrative with concrete paths.
3. step three references packages/core/src/compiler/pipeline.ts explicitly.

\`\`\`ts
export function createPipeline() {}
\`\`\`

## 注意事项
- note a with enough characters to pass minimum body length checks in tests.
- note b about config keys and retry behavior when MCP write fails.

## 红线规避
- **禁止** shallow one-liners.
- **禁止** missing project scope.
- **禁止** silent session promotion.
- always search before capture.
`;

describe('capture propose/commit', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('given propose when create then open proposal on disk', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-prop-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    const p = await createCaptureProposal(vault, {
      content: QUALITY_BODY,
      title: 't',
      type: 'best_practice',
      project: 'demo',
    });
    expect(p.status).toBe('open');
    expect(p.id).toMatch(/^prop-/);
  });

  it('given commit when open proposal then status committed and second commit errors', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-prop2-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    const p = await createCaptureProposal(vault, {
      content: QUALITY_BODY,
      title: 't2',
      type: 'best_practice',
      project: 'demo',
    });
    const once = await commitCaptureProposal(vault, p.id, {
      async execute() {
        return { assetId: 'k-2026-11-18-001-abcd' };
      },
    });
    expect(once.proposal.status).toBe('committed');
    expect(once.assetId).toBe('k-2026-11-18-001-abcd');
    await expect(
      commitCaptureProposal(vault, p.id, {
        async execute() {
          return { assetId: 'k-should-not' };
        },
      }),
    ).rejects.toThrow(/already|committed|consumed/i);
  });
});
