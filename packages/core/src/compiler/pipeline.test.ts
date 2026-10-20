import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { OntologyRegistry } from '../ontology/ontology-registry.js';
import { loadOntology } from '../ontology/ontology-loader.js';
import { createPipeline } from './pipeline.js';

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

describe('compile pipeline root gates', () => {
  let dir: string;
  const prevEnv = process.env.KMIND_COMPILE_SESSIONS;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-gate-'));
    delete process.env.KMIND_COMPILE_SESSIONS;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.KMIND_COMPILE_SESSIONS;
    else process.env.KMIND_COMPILE_SESSIONS = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  it('given low-confidence adapter raw when compile then gates without creating asset', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const adapterDir = path.join(vault.rawDir, 'cursor');
    mkdirSync(adapterDir, { recursive: true });
    writeFileSync(
      path.join(adapterDir, 'noise.jsonl'),
      `${JSON.stringify({
        role: 'user',
        content: 'hello world casually chatting about weather today',
        timestamp: '2026-10-16T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({
      incremental: false,
      force: true,
      minConfidence: 0.6,
    });

    expect(result.gated).toBe(1);
    expect(result.created).toBe(0);
    const assets = await store.queryAssets({ limit: 10 });
    expect(assets).toHaveLength(0);
    const raw = await store.getRawHash(path.join('cursor', 'noise.jsonl'));
    expect(raw?.status).toBe('pending');
    store.close();
  });

  it('given quality manual when compile then creates asset with sanitized title', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const manualDir = path.join(vault.rawDir, 'manual');
    mkdirSync(manualDir, { recursive: true });
    writeFileSync(
      path.join(manualDir, 'note.jsonl'),
      `${JSON.stringify({
        role: 'user',
        title: '# path.join 禁止手写斜杠',
        type: 'best_practice',
        project: 'kmind',
        content: QUALITY_BODY,
        timestamp: '2026-10-16T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({
      incremental: false,
      force: true,
      minConfidence: 0.99,
    });

    expect(result.gated).toBe(0);
    expect(result.created).toBe(1);
    const assets = await store.queryAssets({ limit: 10 });
    expect(assets[0]?.title).toBe('path.join 禁止手写斜杠');
    expect(assets[0]?.title.includes('#')).toBe(false);
    store.close();
  });

  it('given short manual when quality gate on then does not create asset', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const manualDir = path.join(vault.rawDir, 'manual');
    mkdirSync(manualDir, { recursive: true });
    writeFileSync(
      path.join(manualDir, 'short.jsonl'),
      `${JSON.stringify({
        role: 'user',
        title: '太短',
        type: 'best_practice',
        project: 'kmind',
        content: '简单来说就是用 path.join。',
        timestamp: '2026-10-16T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({ incremental: false, force: true });
    expect(result.gated).toBe(1);
    expect(result.created).toBe(0);
    store.close();
  });

  it('given global project when requireProject then gates', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const manualDir = path.join(vault.rawDir, 'manual');
    mkdirSync(manualDir, { recursive: true });
    writeFileSync(
      path.join(manualDir, 'global.jsonl'),
      `${JSON.stringify({
        role: 'user',
        title: '缺项目',
        type: 'best_practice',
        project: 'global',
        content: QUALITY_BODY,
        timestamp: '2026-10-16T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({
      incremental: false,
      force: true,
      project: 'global',
    });
    expect(result.gated).toBe(1);
    expect(result.created).toBe(0);
    store.close();
  });

  it('given sessions raw when compileSessions true but env unset then still skips', async () => {
    const vault = createVault(dir);
    await vault.init();
    const cfg = await vault.getConfig();
    cfg.capture.compileSessions = true;
    cfg.capture.autoCapture = false;
    await vault.saveConfig(cfg);

    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const sessionsDir = path.join(vault.rawDir, 'sessions', 'cursor');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      path.join(sessionsDir, 'dump.jsonl'),
      `${JSON.stringify({
        role: 'user',
        title: 'CODE_MAP noise',
        content: 'Large session dump that must not become knowledge.',
        timestamp: '2026-10-19T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    const result = await pipeline.run({
      incremental: false,
      force: true,
      minConfidence: 0.1,
    });

    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.created).toBe(0);
    store.close();
  });

  it('given same raw path recompiled when force then keeps stable asset id', async () => {
    const vault = createVault(dir);
    await vault.init();
    const store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    registry.load(await loadOntology(vault.ontologyDir));

    const manualDir = path.join(vault.rawDir, 'manual');
    mkdirSync(manualDir, { recursive: true });
    const rawFile = path.join(manualDir, 'stable.jsonl');
    writeFileSync(
      rawFile,
      `${JSON.stringify({
        role: 'user',
        title: 'Stable id v1',
        type: 'best_practice',
        project: 'kmind',
        content: QUALITY_BODY,
        timestamp: '2026-10-19T12:00:00.000Z',
      })}\n`,
    );

    const pipeline = createPipeline(vault, { sqlite: store, registry });
    await pipeline.run({ incremental: false, force: true });
    const first = (await store.queryAssets({ limit: 10 }))[0];
    expect(first).toBeDefined();

    // After first asset exists, incremental gate requires related/links attach.
    writeFileSync(
      rawFile,
      `${JSON.stringify({
        role: 'user',
        title: 'Stable id v2',
        type: 'best_practice',
        project: 'kmind',
        related: [first!.id],
        content: QUALITY_BODY.replace('session 双闸门', 'stable id 更新'),
        timestamp: '2026-10-19T12:01:00.000Z',
      })}\n`,
    );
    await pipeline.run({ incremental: false, force: true });
    const all = await store.queryAssets({ limit: 10 });
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(first!.id);
    expect(all[0]?.title).toBe('Stable id v2');
    store.close();
  });
});
