import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createVault,
  SqliteStore,
  OntologyRegistry,
  loadOntology,
  createPipeline,
  createAssetTypeRegistry,
} from '../../packages/core/src/index.js';

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

describe('e2e incremental compile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-inc-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given unchanged raw when recompile then skips', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));
    mkdirSync(path.join(vault.rawDir, 'manual'), { recursive: true });
    writeFileSync(
      path.join(vault.rawDir, 'manual', 'a.jsonl'),
      `${JSON.stringify({
        role: 'user',
        title: 'path.join 禁止手写斜杠',
        type: 'best_practice',
        project: 'kmind',
        content: QUALITY_BODY,
        timestamp: '2026-10-15T12:00:00.000Z',
      })}\n`,
    );

    const assetTypes = await createAssetTypeRegistry(vault.assetTypesDir);
    const pipeline = createPipeline(vault, {
      sqlite: store,
      registry,
      assetTypes,
    });
    const first = await pipeline.run({ incremental: true, force: true });
    expect(first.created).toBeGreaterThan(0);
    const second = await pipeline.run({ incremental: true });
    expect(second.skipped).toBeGreaterThan(0);
    store.close();
  });
});
