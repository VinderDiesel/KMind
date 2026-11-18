import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createQueryEngine,
  createVault,
  loadBootstrapProgress,
  SqliteStore,
} from '@kmind/core';
import { handleToolCall, type HandlerContext } from './handlers.js';

/** Same depth body as pipeline.test — passes capture quality gate. */
const QUALITY_BODY = `
## 实现方式
1. 在 \`packages/core/src/compiler/pipeline.ts\` 的 \`createPipeline\` / \`isSessionCompileAllowed\` 增加 session 双闸门。
2. 调用方执行 \`pnpm kmind compile\` 时跳过 \`sessions/\` raw；hook 同样生效。
3. 配置 \`capture.compileSessions: false\`，且仅当环境变量 \`KMIND_COMPILE_SESSIONS=1\` 时才允许升知识。

\`\`\`ts
if (isSessionRaw && !allowSessions) return;
\`\`\`

## 注意事项
- 仅跳过编译，不删除已有 Markdown；清理用 \`kmind purge-sessions\`。
- 旧 vault 的 config.yaml 需显式写 compileSessions: false 与 requireQualityGate: true。
- MCP 写入失败时看 \`quality_gate.reasons\`，按锚点/挂图补齐后重试。

## 红线规避
- **禁止**再把整段 session JSONL 当知识资产编译入库。
- **禁止**用总结性一句话代替实现步骤与配置键名。
- **禁止**增量写入不挂 related/links 形成孤岛。
- 必须先 search 判重再 capture。
`;

function parsePayload(wrapped: {
  content: Array<{ type: string; text: string }>;
}): Record<string, unknown> {
  return JSON.parse(wrapped.content[0]!.text) as Record<string, unknown>;
}

describe('kmind_capture bootstrapTask', () => {
  let dir: string;
  let store: SqliteStore;
  let ctx: HandlerContext;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-mcp-boot-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const engine = createQueryEngine(store, vault);
    ctx = { vault, engine, store, autoApprove: ['kmind_capture'] };
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given capture ok with bootstrapTask when handle then marks progress done', async () => {
    const wrapped = await handleToolCall(
      'kmind_capture',
      {
        content: QUALITY_BODY,
        project: 'demo',
        type: 'best_practice',
        title: 'path.join 禁止手写斜杠',
        bootstrapTask: 'dig-a',
      },
      ctx,
    );
    const out = parsePayload(wrapped);

    expect(out.captured).toBe(true);
    expect(out.bootstrapMarked).toBe('dig-a');
    const progress = await loadBootstrapProgress(ctx.vault, 'demo');
    expect(
      progress?.tasks.some((t) => t.id === 'dig-a' && t.status === 'done'),
    ).toBe(true);
  });

  it('given capture ok without bootstrapTask when handle then leaves progress untouched', async () => {
    const wrapped = await handleToolCall(
      'kmind_capture',
      {
        content: QUALITY_BODY,
        project: 'demo',
        type: 'best_practice',
        title: 'path.join 禁止手写斜杠-2',
      },
      ctx,
    );
    const out = parsePayload(wrapped);

    expect(out.captured).toBe(true);
    expect(out.bootstrapMarked).toBeUndefined();
    const progress = await loadBootstrapProgress(ctx.vault, 'demo');
    expect(progress).toBeNull();
  });
});
