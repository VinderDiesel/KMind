import { describe, expect, it } from 'vitest';
import {
  assessCaptureQuality,
  countComponentBlobs,
  listTopicHeadings,
} from './capture-quality.js';

const DETAILED_FEATURE = `
## 实现方式
1. 在 \`packages/core/src/compiler/pipeline.ts\` 的 \`createPipeline\` / \`isSessionCompileAllowed\` 增加 session 双闸门。
2. 调用方执行 \`pnpm kmind compile\` 时跳过 \`sessions/\` raw；hook 同样生效。
3. 仅当 \`compileSessions=true\` 且 \`KMIND_COMPILE_SESSIONS=1\` 时才允许升知识。

\`\`\`ts
if (isSessionRaw && !allowSessions) return;
\`\`\`

## 注意事项
- 仅跳过编译，不删除已有 Markdown；清理用 \`kmind purge-sessions\`。
- 旧 vault 需显式写 compileSessions: false 与 requireQualityGate: true。
- 增量写入必须 related 挂到本 project 总览，避免孤岛。

## 红线规避
- **禁止**再把整段 session JSONL 当知识资产编译入库。
- **禁止**用总结性一句话代替实现步骤与配置键名。
- **禁止**目录级标题冒充架构知识。
- 必须先 search 判重再 capture。

## 代码锚点
- \`packages/core/src/compiler/pipeline.ts\` · \`isSessionCompileAllowed\` · function
`;

const BROAD_LIKE_015 = `
## 六阶段数据管道
FETCH → WRITE 表…

## 核心组件（实现方式）
- OntologyEngine（ontology/engine.py）：组装 registry 与管道。
- PipelineOrchestrator（ontology/pipeline_orchestrator.py）：协调流程。
- ReasoningEngine（ontology/reasoning_engine.py）：一致性检查。
- SubgraphModeler（ontology/subgraph_modeler.py）：映射规则。
- OntologyLibrary（ontology/ontology_library.py）：schema 管理。

## 核心数据结构 Individual
iri、class_iri…

## 本体术语
T-Box / A-Box…

## 注意事项
- 顺序不可改。

## 红线规避
- 禁止全量 upsert 边映射；用 \`--skip-vertices\`。
`;

describe('assessCaptureQuality', () => {
  it('given detailed single-topic body when assess then ok', () => {
    const r = assessCaptureQuality(DETAILED_FEATURE, 'architecture_design');
    expect(r.ok).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('given vague summary when assess feature then rejects', () => {
    const r = assessCaptureQuality(
      '总的来说这个方案更好。简单来说就是用向量库增强检索。主要是提升体验。',
      'architecture_design',
    );
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('given short pitfall without steps when assess then rejects', () => {
    const r = assessCaptureQuality(
      '## 问题\n死锁了\n## 决策\n换 Redis',
      'pitfall',
    );
    expect(r.ok).toBe(false);
  });

  it('given multi-topic dump like 015 when assess then rejects scope', () => {
    const r = assessCaptureQuality(BROAD_LIKE_015, 'architecture_design', {
      title: 'CCDP 六阶段本体管道与核心组件',
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('范围过大'))).toBe(true);
  });

  it('given overview without related when assess then rejects', () => {
    const body = `
## 阶段索引
| 阶段 | 职责 |
| FETCH | 拉数 |

## 红线规避
- 禁止打乱 FETCH→WRITE 顺序。
- 必须用 related 挂子节点。
`;
    const r = assessCaptureQuality(body, 'architecture_design', {
      title: 'CCDP 六阶段管道总览',
      related: [],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('related'))).toBe(true);
  });

  it('given thin overview with related when assess then ok', () => {
    const body = `
管道顺序固定：FETCH → SUBGRAPH_MODELING → INDIVIDUAL_CREATION → REASONING → VALIDATION → WRITE。

| 阶段 | 子节点 |
|------|--------|
| FETCH | 见 related |
| WRITE | 见 related |

## 红线规避
- **禁止**随意调换六阶段顺序。
- 细节在子节点，本卡只做导航。
`;
    const r = assessCaptureQuality(body, 'architecture_design', {
      title: 'CCDP 六阶段管道总览',
      related: ['k-2026-10-19-020', 'k-2026-10-19-021'],
    });
    expect(r.ok).toBe(true);
  });

  it('given incremental detail without related when assess then rejects', () => {
    const r = assessCaptureQuality(DETAILED_FEATURE, 'architecture_design', {
      title: 'AskAgentRouter 路由',
      incremental: true,
      hubIds: ['k-2026-10-19-050'],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes('增量'))).toBe(true);
  });

  it('given incremental detail with related when assess then ok', () => {
    const r = assessCaptureQuality(DETAILED_FEATURE, 'architecture_design', {
      title: 'AskAgentRouter 路由',
      related: ['k-2026-10-19-050'],
      incremental: true,
      hubIds: ['k-2026-10-19-050'],
    });
    expect(r.ok).toBe(true);
  });
});

describe('scope helpers', () => {
  it('given broad body when listTopicHeadings then returns non-structural h2', () => {
    const topics = listTopicHeadings(BROAD_LIKE_015);
    expect(topics.length).toBeGreaterThanOrEqual(3);
    expect(topics.some((t) => t.includes('核心组件'))).toBe(true);
  });

  it('given component list when countComponentBlobs then counts engines', () => {
    expect(countComponentBlobs(BROAD_LIKE_015)).toBeGreaterThanOrEqual(4);
  });
});
