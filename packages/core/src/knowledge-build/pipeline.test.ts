import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BootstrapPlan } from '@kmind/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAssetTypeRegistry,
  createVault,
  loadBootstrapProgress,
  OntologyRegistry,
  SqliteStore,
  type Vault,
} from '../index.js';
import type { LlmClient } from '../llm/types.js';
import { runKnowledgeBuild, type KnowledgeBuildDeps } from './pipeline.js';

const ANCHOR_FILE = 'src/index.ts';

function detailContent(topic: string): string {
  return [
    '## 实现方式',
    '',
    `入口在 \`${ANCHOR_FILE}\` 的 \`createDemo\`：先收集证据文件，再按 rank 排序，`,
    `随后调用 ${topic} 对应的处理函数并写入统一错误映射。`,
    '1. 读取 `src/index.ts` 并提取导出符号；',
    '2. 组装请求体后调用 provider 客户端；',
    '3. 失败时统一抛出 KMindError 并带上重试标记。',
    '',
    '## 注意事项',
    '',
    '- 超时与网络失败必须区分：超时用 AbortSignal.timeout，连接失败标记可重试。',
    '- 证据为空时应跳过该任务，而不是生成空泛结论。',
    '',
    '## 红线规避',
    '',
    '- 禁止把密钥写进配置文件；只允许从环境变量读取。',
    '- 禁止绕过质量闸门直接落盘。',
    '',
    '## 代码锚点',
    '',
    `- \`${ANCHOR_FILE}\` · createDemo`,
    '',
    '补充说明：以上步骤在每次任务执行时按顺序发生，任何一步失败都会记录原因并中止当前卡片，',
    '不会影响其它任务的执行；同时所有输出都带 project 字段，避免跨项目污染。',
    '',
    '数据流方向固定为：扫描证据 → 组装 prompt → 调用模型 → 解析 JSON → 质量闸门 → 写入知识库。',
    '每一步只依赖上一步的产物，任何一步返回空结果时都会把原因写入任务报告，',
    '便于后续用 report.stats 与 cards[].reasons 定位问题，而不是静默失败。',
  ].join('\n');
}

function card(topic: string, overrides: Record<string, unknown> = {}) {
  return {
    title: topic,
    type: 'architecture_design',
    content: detailContent(topic),
    anchors: [{ file: ANCHOR_FILE, symbol: 'createDemo' }],
    confidence: 0.9,
    ...overrides,
  };
}

function plan(): BootstrapPlan {
  return {
    version: '1',
    project: 'demo',
    repoRoot: '/tmp/demo',
    groups: [
      {
        label: 'src',
        priority: 10,
        tasks: [
          {
            id: 'dig-src',
            titleHint: 'src 入口',
            candidateType: 'architecture_design',
            paths: ['src'],
            suggestedAnchors: [],
            status: 'todo',
          },
        ],
      },
    ],
    excluded: [],
    stats: {
      modulesScanned: 1,
      modulesSelected: 1,
      modulesExcluded: 0,
      groupCount: 1,
      taskCount: 1,
      tasksAlreadyDone: 0,
    },
    generatedAt: '2026-11-19T00:00:00.000Z',
  };
}

function fakeLlm(payload: unknown): LlmClient {
  return {
    provider: 'ollama',
    model: 'fake-model',
    baseUrl: 'http://fake',
    chat: async () => JSON.stringify(payload),
  };
}

describe('runKnowledgeBuild', () => {
  let dir: string;
  let vault: Vault;
  let store: SqliteStore;
  let deps: KnowledgeBuildDeps;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-build-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'src/index.ts'),
      [
        'export function createDemo(): string {',
        "  return 'demo';",
        '}',
        'export const demoService = createDemo();',
      ].join('\n'),
      'utf8',
    );

    vault = createVault(path.join(dir, '.kmind-knowledge'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
    const registry = new OntologyRegistry();
    const assetTypes = await createAssetTypeRegistry(vault.assetTypesDir);
    deps = { vault, store, registry, assetTypes };
  });

  afterEach(async () => {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('given two valid cards when build then captures both, marks progress and creates hub', async () => {
    const events: string[] = [];
    const report = await runKnowledgeBuild(deps, {
      project: 'demo',
      repoRoot: dir,
      plan: plan(),
      llm: fakeLlm({ cards: [card('入口模块证据收集'), card('错误映射与重试策略')] }),
      llmConfig: { maxInputChars: 24_000 },
      onProgress: (event) => events.push(event.type),
    });

    expect(report.stats.cardsCaptured).toBe(2);
    expect(report.stats.tasksCaptured).toBe(1);
    expect(report.assetIds).toHaveLength(2);
    expect(report.hub?.created).toBe(true);
    expect(report.hub?.title).toBe('demo 项目知识总览');
    expect(events).toContain('hub');

    const assets = await store.queryAssets({ project: 'demo', limit: 100 });
    expect(assets.map((asset) => asset.title)).toEqual(
      expect.arrayContaining(['入口模块证据收集', '错误映射与重试策略', 'demo 项目知识总览']),
    );
    const hub = assets.find((asset) => asset.title === 'demo 项目知识总览');
    expect(hub?.related).toHaveLength(2);

    const progress = await loadBootstrapProgress(vault, 'demo');
    expect(progress?.tasks.some((t) => t.id === 'dig-src' && t.status === 'done')).toBe(
      true,
    );
  });

  it('given dry run when build then captures nothing and writes no markdown', async () => {
    const report = await runKnowledgeBuild(deps, {
      project: 'demo',
      repoRoot: dir,
      plan: plan(),
      llm: fakeLlm({ cards: [card('入口模块证据收集')] }),
      llmConfig: { maxInputChars: 24_000 },
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.stats.cardsCaptured).toBe(0);
    expect(report.tasks[0]?.status).toBe('dry_run');
    expect(report.hub).toBeNull();

    const files = await fs.readdir(vault.knowledgeDir);
    expect(files.filter((file) => file.endsWith('.md'))).toEqual([]);
  });

  it('given low-confidence card when build then skips it without capturing', async () => {
    const report = await runKnowledgeBuild(deps, {
      project: 'demo',
      repoRoot: dir,
      plan: plan(),
      llm: fakeLlm({
        cards: [card('低置信卡片主题', { confidence: 0.1 })],
      }),
      llmConfig: { maxInputChars: 24_000 },
      minConfidence: 0.55,
    });

    expect(report.stats.cardsCaptured).toBe(0);
    expect(report.tasks[0]?.cards[0]?.status).toBe('skipped');
    expect(report.tasks[0]?.cards[0]?.reasons?.[0]).toContain('low_confidence');
  });

  it('given shallow card when build then quality gate rejects and reports reasons', async () => {
    const report = await runKnowledgeBuild(deps, {
      project: 'demo',
      repoRoot: dir,
      plan: plan(),
      llm: fakeLlm({ cards: [card('内容过短卡片', { content: '这是一段没有实现细节的描述。'.repeat(20) })] }),
      llmConfig: { maxInputChars: 24_000 },
      repair: false,
    });

    expect(report.stats.cardsCaptured).toBe(0);
    expect(report.stats.cardsRejected).toBe(1);
    expect(report.tasks[0]?.status).toBe('failed');
    expect(report.tasks[0]?.cards[0]?.status).toBe('quality_rejected');
    expect(report.tasks[0]?.cards[0]?.reasons?.length).toBeGreaterThan(0);
  });

  it('given duplicate title against existing asset when build then skips card', async () => {
    // First run captures a card.
    await runKnowledgeBuild(deps, {
      project: 'demo',
      repoRoot: dir,
      plan: plan(),
      llm: fakeLlm({ cards: [card('入口模块证据收集')] }),
      llmConfig: { maxInputChars: 24_000 },
    });

    const second = await runKnowledgeBuild(deps, {
      project: 'demo',
      repoRoot: dir,
      plan: plan(),
      llm: fakeLlm({ cards: [card('入口模块证据收集')] }),
      llmConfig: { maxInputChars: 24_000 },
      force: true,
    });

    const duplicate = second.tasks[0]?.cards.find(
      (row) => row.reasons?.[0] === 'duplicate_title',
    );
    expect(duplicate).toBeDefined();
  });
});
