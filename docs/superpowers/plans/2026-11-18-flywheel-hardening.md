# ADR-002 飞轮硬化（本地召回可证 + 可选 propose/commit）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「聪明搜」可本地度量、让「聪明记」可选强审计（propose→commit），并收掉 Bootstrap M3 留下的 CLI mark DRY 缺口——仍禁止云端埋点与自动灌正文。

**Architecture:** 在已有 `audit/search-queries/` JSONL 上增加只读汇总契约与 CLI/MCP；另开可选两阶段写入（proposal 落 `audit/proposals/`，commit 复用既有 capture 闸门）；CLI capture 的 bootstrap mark 改调 `markBootstrapProgressTask`。不改 Vault 三层真相模型，不引入联邦。

**Tech Stack:** TypeScript · Zod · Vitest · 既有 `@kmind/core` observability / compiler / MCP

**Spec:** [docs/adr/002-intelligence-flywheel.md](../../adr/002-intelligence-flywheel.md) §2（验收心跳「后做」本地化）、§6（propose/commit 后做）+ 本计划 Global Constraints。独立子系统 **M4b 联邦 / Ultra / 云端召回埋点** 另开计划，不在此列。

## Global Constraints

- **禁止**云端 LLM / 云端召回埋点成为硬依赖（ADR-002）
- **禁止**自动生成知识正文入库；propose 也不生成正文，只暂存人/Agent 已确认拟写入字段
- 默认路径：`kmind_capture` / `kmind capture` **行为不变**（两阶段默认关）
- 外部输入 Zod；路径 `path.join`；core 禁止 `console.log`
- 公开函数 JSDoc + vitest given-when-then
- 不整理本仓业务知识卡（fixture 除外）
- 门禁：任务内相关单测；最终 `pnpm test && pnpm typecheck`
- Conventional commits：`feat:` / `fix:` / `docs:` / `test:`

## Review Focus

- 空 `audit/search-queries/` 或损坏行时，`recall-stats` 返回 `status=empty|partial`，**不抛**中断 CLI/MCP
- `kmind_capture` 在未启用两阶段且未传 `proposalId` 时与现网完全一致
- `commit` 对未知 / 已消费 `proposalId` 返回明确错误，不二次写入
- `recall feedback` 只追加 audit JSONL，永不改 knowledge Markdown
- CLI `--bootstrap-task` 在 mark 失败时仍返回 capture 成功（best-effort，与 MCP 对齐）

---

## File Structure

| 文件 | 职责 |
|:---|:---|
| `packages/shared/.../recall-stats.schema.ts` | `RecallStatsReport` Zod |
| `packages/shared/.../capture-proposal.schema.ts` | `CaptureProposal` Zod |
| `packages/core/src/observability/recall-stats.ts` | 读 JSONL → 汇总 |
| `packages/core/src/observability/recall-feedback.ts` | 可选有用性反馈 append |
| `packages/core/src/compiler/capture-propose.ts` | propose / commit / load |
| `packages/cli/src/commands/recall-stats.ts` | CLI |
| `packages/cli/src/commands/capture.ts` | DRY mark + 可选 `--proposal` |
| `packages/mcp-server/src/tools.ts` / `handlers.ts` | MCP 表面 |
| `docs/adr/002-…` / `MCP_TOOLS.md` / Skills / `README.md` | 文档 |

---

### Task 1: `RecallStatsReport` + `summarizeSearchQueryLogs`

**Files:**
- Create: `packages/shared/src/schemas/recall-stats.schema.ts`
- Modify: `packages/shared/src/index.ts`（导出）
- Create: `packages/core/src/observability/recall-stats.ts`
- Modify: `packages/core/src/index.ts`（导出）
- Test: `packages/core/src/observability/recall-stats.test.ts`

**Interfaces:**
- Consumes: `SearchQueryLogEntry` / `searchQueryLogPath` / `SEARCH_QUERY_LOG_DIRNAME`
- Produces:
  ```ts
  // Zod fields (exact names):
  // version: '1'
  // status: 'ok' | 'empty' | 'partial'
  // windowHours: number
  // project?: string
  // totals: { queries, search, pack, empty, cacheHits }
  // emptyRate: number // 0..1
  // bySource: Record<string, number>
  // topFocusIds: Array<{ id: string; count: number }> // pack focusId, top 10
  // generatedAt: string // datetime

  export async function summarizeSearchQueryLogs(options: {
    auditDir: string;
    windowHours: number; // default 24
    project?: string;
    now?: Date;
  }): Promise<RecallStatsReport>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
it('given no jsonl when summarize then status empty and zero totals', async () => {
  const report = await summarizeSearchQueryLogs({ auditDir: emptyAudit, windowHours: 24 });
  expect(report.status).toBe('empty');
  expect(report.totals.queries).toBe(0);
});

it('given search and pack lines when summarize then counts and emptyRate', async () => {
  // write 2 search (1 empty) + 1 pack under audit/search-queries/
  const report = await summarizeSearchQueryLogs({ auditDir, windowHours: 24, project: 'demo' });
  expect(report.status).toBe('ok');
  expect(report.totals.search).toBe(2);
  expect(report.totals.pack).toBe(1);
  expect(report.emptyRate).toBeCloseTo(1 / 3, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/observability/recall-stats.test.ts -v`  
Expected: FAIL（module missing）

- [ ] **Step 3: Implement schema + `summarizeSearchQueryLogs`**

Approach: 按日文件扫描 `windowHours` 内条目；跳过坏行并在有坏行时 `status=partial`；`project` 过滤（缺 project 字段的行在过滤开启时计入 partial 跳过）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/observability/recall-stats.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/recall-stats.schema.ts packages/shared/src/index.ts packages/core/src/observability/recall-stats.ts packages/core/src/observability/recall-stats.test.ts packages/core/src/index.ts
git commit -m "feat: summarize local search-query recall stats"
```

---

### Task 2: CLI `kmind recall-stats` + MCP `kmind_recall_stats`

**Files:**
- Create: `packages/cli/src/commands/recall-stats.ts`
- Modify: `packages/cli/src/index.ts`（注册命令）
- Modify: `packages/mcp-server/src/tools.ts` / `handlers.ts`
- Test: `packages/cli/src/commands/recall-stats.test.ts`（或 mcp 侧轻测）

**Interfaces:**
- Consumes: `summarizeSearchQueryLogs`（Task 1）
- Produces:
  - CLI: `kmind recall-stats [--project <p>] [--window-hours <n>]`（默认 24，上限 168）
  - MCP read: `kmind_recall_stats` args `{ project?, windowHours? }` → `RecallStatsReport`

- [ ] **Step 1: Write the failing test**

```ts
it('given vault with pack log when recall-stats json then status ok', async () => {
  // seed one pack log line; run cmdRecallStats with json=true
  expect(payload.status).toBe('ok');
  expect(payload.totals.pack).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/cli/src/commands/recall-stats.test.ts -v`  
Expected: FAIL

- [ ] **Step 3: 实现 CLI + MCP；windowHours Zod clamp 1..168**

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/cli/src/commands/recall-stats.test.ts packages/core/src/observability/recall-stats.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/recall-stats.ts packages/cli/src/commands/recall-stats.test.ts packages/cli/src/index.ts packages/mcp-server/src/tools.ts packages/mcp-server/src/handlers.ts
git commit -m "feat: expose kmind recall-stats CLI and MCP"
```

---

### Task 3: 本地召回反馈（可选、仅 audit）

**Files:**
- Create: `packages/shared/src/schemas/recall-feedback.schema.ts`
- Create: `packages/core/src/observability/recall-feedback.ts`
- Modify: `packages/mcp-server/src/tools.ts` / `handlers.ts`（`kmind_recall_feedback` write）
- Modify: `packages/cli/src/index.ts`（`kmind recall-feedback`）
- Test: `packages/core/src/observability/recall-feedback.test.ts`

**Interfaces:**
- Consumes: vault `auditDir`
- Produces:
  ```ts
  // RecallFeedbackEntry: { version:'1', focusId?: string, query?: string, useful: boolean, note?: string, source?: string, timestamp }
  export async function appendRecallFeedback(
    auditDir: string,
    entry: Omit<RecallFeedbackEntry, 'timestamp'|'version'> & { timestamp?: string },
  ): Promise<string>; // path written
  ```
  文件：`audit/recall-feedback/YYYY-MM-DD.jsonl`（勿进 git，已在 vault `.gitignore` audit/）

- [ ] **Step 1: Write the failing test**

```ts
it('given useful feedback when append then jsonl line exists', async () => {
  const file = await appendRecallFeedback(auditDir, { useful: true, focusId: 'k-2026-11-18-001-abcd', query: 'lock' });
  expect(file).toContain('recall-feedback');
  const body = await fs.readFile(file, 'utf8');
  expect(body).toContain('"useful":true');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/observability/recall-feedback.test.ts -v`  
Expected: FAIL

- [ ] **Step 3: Implement append + CLI/MCP write 工具（需确认 / autoApprove，对齐其他 write）**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/observability/recall-feedback.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/recall-feedback.schema.ts packages/core/src/observability/recall-feedback.ts packages/core/src/observability/recall-feedback.test.ts packages/mcp-server/src/tools.ts packages/mcp-server/src/handlers.ts packages/cli/src/index.ts packages/shared/src/index.ts packages/core/src/index.ts
git commit -m "feat: local recall usefulness feedback audit log"
```

---

### Task 4: Capture propose / commit（默认关）

**Files:**
- Create: `packages/shared/src/schemas/capture-proposal.schema.ts`
- Modify: `packages/shared/src/schemas/config.schema.ts`（`capture.twoPhase: boolean` default `false`）
- Create: `packages/core/src/compiler/capture-propose.ts`
- Modify: `packages/mcp-server/src/tools.ts` / `handlers.ts`
- Modify: `packages/cli/src/commands/capture.ts` + `index.ts`（`capture propose` / `capture commit` 或 flag）
- Test: `packages/core/src/compiler/capture-propose.test.ts`

**Interfaces:**
- Consumes: 既有 `assessCaptureQuality` / pipeline capture 路径（commit 时调用与 `kmind_capture` 相同的写入核心，禁止复制粘贴两套闸门——抽 `runManualCapture(ctx, fields)` 若尚无则本任务最小抽出）
- Produces:
  ```ts
  // CaptureProposal: version '1', id: `prop-…`, status: 'open'|'committed'|'cancelled',
  // fields: { content, title, type, project, anchors?, related?, links?, bootstrapTask? },
  // suggestionsDigest?: string, createdAt, committedAt?, assetId?

  export async function createCaptureProposal(vault: Vault, fields: CaptureProposal['fields']): Promise<CaptureProposal>;
  export async function commitCaptureProposal(vault: Vault, store: SqliteStore, proposalId: string, deps: ManualCaptureDeps): Promise<{ assetId?: string; proposal: CaptureProposal }>;
  export async function loadCaptureProposal(vault: Vault, proposalId: string): Promise<CaptureProposal | null>;
  ```
  - MCP: `kmind_capture_propose` (write)、`kmind_capture_commit` (write, `{ proposalId }`)
  - 当 `config.capture.twoPhase===true` 时：Skill/文档要求 Agent 先 propose；**运行时不强制拦截**裸 `kmind_capture`（避免破坏现网），仅文档+回执 hint

- [ ] **Step 1: Write the failing test**

```ts
it('given propose when create then open proposal on disk', async () => {
  const p = await createCaptureProposal(vault, { content: QUALITY_BODY, title: 't', type: 'best_practice', project: 'demo' });
  expect(p.status).toBe('open');
  expect(p.id).toMatch(/^prop-/);
});

it('given commit when open proposal then status committed and second commit errors', async () => {
  const once = await commitCaptureProposal(vault, store, p.id, deps);
  expect(once.proposal.status).toBe('committed');
  await expect(commitCaptureProposal(vault, store, p.id, deps)).rejects.toThrow(/already|committed|consumed/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/compiler/capture-propose.test.ts -v`  
Expected: FAIL

- [ ] **Step 3: Implement schema + create/load/commit；MCP/CLI 接线；未知 id → 明确错误对象/抛 KMindError**

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/core/src/compiler/capture-propose.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/capture-proposal.schema.ts packages/shared/src/schemas/config.schema.ts packages/core/src/compiler/capture-propose.ts packages/core/src/compiler/capture-propose.test.ts packages/mcp-server/src/tools.ts packages/mcp-server/src/handlers.ts packages/cli/src/commands/capture.ts packages/cli/src/index.ts packages/shared/src/index.ts packages/core/src/index.ts
git commit -m "feat: optional capture propose/commit two-phase write"
```

---

### Task 5: CLI capture bootstrap mark DRY

**Files:**
- Modify: `packages/cli/src/commands/capture.ts`（改用 `markBootstrapProgressTask`）
- Test: 扩展既有 capture/bootstrap 测试或 `packages/cli/src/commands/capture.bootstrap.test.ts`

**Interfaces:**
- Consumes: `markBootstrapProgressTask`（已有）
- Produces: 与现网相同的 `bootstrapMarked` 回执字段

- [ ] **Step 1: Write the failing test**（若已有等价测试则改为断言仍走 core helper：mark 后 progress 文件存在）

```ts
it('given capture with bootstrap-task when success then progress marked done', async () => {
  // … assert loadBootstrapProgress has task done
});
```

- [ ] **Step 2: Run test — 若已绿则先改实现造成红再恢复；否则 FAIL 后实现**

- [ ] **Step 3: 删除 capture.ts 内手写 upsert/save；调用 `markBootstrapProgressTask`；catch 后不抛**

- [ ] **Step 4: Run related tests**

Run: `pnpm exec vitest run packages/cli/src/commands/capture.bootstrap.test.ts packages/core/src/bootstrap/mark-task.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/capture.ts packages/cli/src/commands/capture.bootstrap.test.ts
git commit -m "refactor: CLI capture uses markBootstrapProgressTask"
```

---

### Task 6: 文档 + README Roadmap + 全量门禁

**Files:**
- Modify: `docs/adr/002-intelligence-flywheel.md`（新增 §「M6 飞轮硬化」：本地 recall-stats/feedback；可选 propose/commit；明确不做云埋点/联邦）
- Modify: `docs/MCP_TOOLS.md`、`README.md` Roadmap（勾选本阶段；划掉过时「锚点 M2 未做」若仍错误）
- Modify: `skills/kmind-capture/SKILL.md` + `packages/cli/skills/…` + `.cursor/skills/…`（两阶段可选；召回可证命令）

**Interfaces:**
- Consumes: Tasks 1–5 对外名
- Produces: 文档与实现一致

- [ ] **Step 1: 更新 ADR-002 / MCP_TOOLS / Skill×3 / README**

- [ ] **Step 2: Run full gate**

Run: `pnpm test && pnpm typecheck`  
Expected: 全部 PASS（若 shared/core dist 陈旧则先 `pnpm --filter @kmind/shared build && pnpm --filter @kmind/core build`）

- [ ] **Step 3: Commit**

```bash
git add docs/adr/002-intelligence-flywheel.md docs/MCP_TOOLS.md README.md skills/kmind-capture/SKILL.md packages/cli/skills/kmind-capture/SKILL.md .cursor/skills/kmind-capture/SKILL.md
git commit -m "docs: document flywheel hardening recall-stats and propose/commit"
```

---

## Self-Review

1. **Spec coverage:** ADR-002 §2 本地化召回可观测 → Tasks 1–3；§6 propose/commit → Task 4；M3 DRY 尾巴 → Task 5；文档 → Task 6。未纳入：联邦、Ultra、云埋点、强制拦截裸 capture。
2. **Step scan:** 测名/签名/命令齐全；无「适当处理」空话。
3. **Type consistency:** `RecallStatsReport`、`appendRecallFeedback`、`createCaptureProposal` / `commitCaptureProposal` 前后一致。
4. **Review Focus:** 五条分别由 Task1 partial/empty、Task4 默认路径、Task4 二次 commit、Task3 仅 audit、Task5 best-effort 覆盖。
5. **Proportion:** 计划钉接口与验收，不写函数体。

## 明确不做（本阶段）

- 多实例联邦（M4b）
- Ultra / 高召回扫荡
- 云端召回成功率埋点
- 强制关闭单次 `kmind_capture`（两阶段仅可选）
- 用 LLM 把 pack 总结成「答案」
