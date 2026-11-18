# Bootstrap M3 闭环与团队开箱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ADR-004 M2 已有的 preview/delegate/mark/CLI capture 钩子补成「Agent 默认路径也能闭环」：MCP capture 可 mark、evolution 可跳转 DigTask、`init --project` 开箱带规则模板，仍禁止自动灌知识正文。

**Architecture:** 在 `@kmind/core` 抽出可复用的 progress mark 服务；MCP `kmind_capture` 与 CLI 共用；扩展 `EvolutionTodo` 结构化字段指向 DigTask；项目 vault 模板增加 `bootstrap-rules.yaml`；DigPacket/delegate 列表补齐「下一组」提示。不引入 Ultra 扫荡、不引入联邦、不自动 capture。

**Tech Stack:** TypeScript · Zod · Vitest · pnpm monorepo · 既有 `@kmind/core` bootstrap / MCP handlers

**Spec:** [docs/adr/004-knowledge-bootstrap-hybrid.md](../../adr/004-knowledge-bootstrap-hybrid.md)（M2 Accepted；本计划实现 **M3 闭环**）+ README「知识初始化 Bootstrap」节。独立子系统（多实例联邦 M4b、propose/commit 两阶段、召回埋点）**不在本计划**。

## Global Constraints

- **禁止**自动生成知识正文入库（ADR-002 / ADR-004）
- Bootstrap / DigPacket / evolution bootstrap todo **≠** `coverage.complete`
- 外部输入一律 Zod；路径用 `path.join`；SQL 参数化（本计划无新 SQL）
- core 禁止 `console.log`；公开函数 JSDoc；公开行为有 vitest（given-when-then）
- 不整理本仓业务知识卡（测试 fixture 除外）
- 每任务结束：相关单测绿；全量门禁在最终任务：`pnpm test && pnpm typecheck`
- Conventional commits：`feat:` / `fix:` / `docs:` / `test:`

## Review Focus

- MCP `kmind_capture` **未传** `bootstrapTask` 时行为与现网一致（不写 progress）
- `bootstrapTask` 指向未知 id 时仍 upsert progress 并返回可诊断字段，不抛未捕获异常中断 capture 成功回执
- `runEvolutionScan` 在 bootstrap plan 构建失败时仍写出 coverage/health 队列（既有 try/catch 保持）
- `kmind init --project` 在 vault 已有 `bootstrap-rules.yaml` 时不覆盖用户规则
- `summarizeDelegateGroups` / DigPacket 在组内任务全 `done` 时返回空 tasks + 明确 `nextGroup` 提示，不伪装 complete

---

## File Structure

| 文件 | 职责 |
|:---|:---|
| `packages/core/src/bootstrap/mark-task.ts` | Vault 级 mark：load → upsert → save；供 CLI/MCP |
| `packages/core/src/bootstrap/progress.ts` | 既有 progress I/O（不变主契约） |
| `packages/core/src/bootstrap/delegate.ts` | 列表摘要增加 `recommendedNext` |
| `packages/core/src/bootstrap/index.ts` | 导出 mark helper |
| `packages/shared/.../evolution-queue.schema.ts` | 可选 `digTaskId` / `groupLabel` |
| `packages/core/src/schedule/evolution-queue.ts` | bootstrap todo 填结构化字段 + nextAction 指向 delegate |
| `packages/mcp-server/src/tools.ts` | `kmind_capture.bootstrapTask` |
| `packages/mcp-server/src/handlers.ts` | capture 成功后 mark |
| `packages/cli/src/commands/bootstrap.ts` | `markBootstrapTaskAfterCapture` 改调 core |
| `templates/project-vault/bootstrap-rules.yaml` | 示例规则（可进 git） |
| `packages/cli/src/commands/init.ts` | `--project` 幂等写入规则模板 |
| `docs/adr/004-…` / `docs/MCP_TOOLS.md` / Skills / `README.md` | M3 文档对齐 |

---

### Task 1: Core `markBootstrapProgressTask`

**Files:**
- Create: `packages/core/src/bootstrap/mark-task.ts`
- Modify: `packages/core/src/bootstrap/index.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`（`markBootstrapTaskAfterCapture` / `cmdBootstrapMark` 内部复用）
- Test: `packages/core/src/bootstrap/mark-task.test.ts`

**Interfaces:**
- Consumes: `loadBootstrapProgress`, `saveBootstrapProgress`, `upsertProgressTask`, `emptyBootstrapProgress`, `hashBootstrapPlan`（optional）, `Vault`
- Produces:
  ```ts
  export interface MarkBootstrapProgressTaskInput {
    vault: Vault;
    project: string;
    repoRoot: string;
    taskId: string;
    status: DigTaskStatus;
    assetId?: string;
    planHash?: string;
  }
  export interface MarkBootstrapProgressTaskResult {
    progress: BootstrapProgress;
    path: string;
  }
  /** Upsert one DigTask mark under audit/bootstrap-progress.json. */
  export async function markBootstrapProgressTask(
    input: MarkBootstrapProgressTaskInput,
  ): Promise<MarkBootstrapProgressTaskResult>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
it('given empty audit when mark done then persists task status and assetId', async () => {
  // memfs / temp vault
  const result = await markBootstrapProgressTask({
    vault, project: 'demo', repoRoot: '/repo',
    taskId: 'dig-a', status: 'done', assetId: 'k-2026-11-18-001-abcd',
  });
  expect(result.progress.tasks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'dig-a', status: 'done', assetId: 'k-2026-11-18-001-abcd' }),
    ]),
  );
  const again = await loadBootstrapProgress(vault, 'demo');
  expect(again?.tasks[0]?.status).toBe('done');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/bootstrap/mark-task.test.ts -v`  
Expected: FAIL（module / function not found）

- [ ] **Step 3: Implement `markBootstrapProgressTask` in `mark-task.ts`；从 `index.ts` 导出；CLI mark 路径改调此函数**

Approach: 若无 progress 或 project 不匹配 → `emptyBootstrapProgress`；再 `upsertProgressTask` + `saveBootstrapProgress`。CLI `cmdBootstrapMark` 与 `markBootstrapTaskAfterCapture` 不再手写 upsert。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/bootstrap/mark-task.test.ts packages/core/src/bootstrap/upgrade.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bootstrap/mark-task.ts packages/core/src/bootstrap/mark-task.test.ts packages/core/src/bootstrap/index.ts packages/cli/src/commands/bootstrap.ts
git commit -m "$(cat <<'EOF'
feat: extract markBootstrapProgressTask for CLI/MCP share

EOF
)"
```

---

### Task 2: MCP `kmind_capture.bootstrapTask` 对齐 CLI

**Files:**
- Modify: `packages/mcp-server/src/tools.ts`（`kmind_capture` inputSchema）
- Modify: `packages/mcp-server/src/handlers.ts`（`case 'kmind_capture'` 成功分支）
- Test: `packages/mcp-server/src/handlers.bootstrap-task.test.ts`（或既有 handlers 测试文件扩展）

**Interfaces:**
- Consumes: `markBootstrapProgressTask`（Task 1）
- Produces: MCP args `bootstrapTask?: string`；成功回执增加可选 `bootstrapMarked?: string`（与 CLI capture JSON 字段名对齐：`bootstrapMarked`）

- [ ] **Step 1: Write the failing test**

```ts
it('given capture ok with bootstrapTask when handle then marks progress done', async () => {
  // stub store capture success + vault
  const out = await handleTool('kmind_capture', {
    content: '...足够深的正文...',
    project: 'demo',
    type: 'best_practice',
    title: 'x',
    bootstrapTask: 'dig-a',
  }, ctx);
  expect(out.captured).toBe(true);
  expect(out.bootstrapMarked).toBe('dig-a');
  const progress = await loadBootstrapProgress(ctx.vault, 'demo');
  expect(progress?.tasks.some((t) => t.id === 'dig-a' && t.status === 'done')).toBe(true);
});

it('given capture ok without bootstrapTask when handle then leaves progress untouched', async () => {
  // assert no bootstrap-progress.json or tasks unchanged
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/mcp-server/src/handlers.bootstrap-task.test.ts -v`  
Expected: FAIL（字段未声明 / 未 mark）

- [ ] **Step 3: 在 `tools.ts` 增加 `bootstrapTask`；在 handlers 于 `created`/`captured` 成功且 `assetId` 可得后调用 `markBootstrapProgressTask`；失败 mark 写入回执 `bootstrapMarkError` 字符串，不撤销已 capture**

`repoRoot`：优先 MCP ctx / args 已有 repo；否则 `vault.root` 的 parent 或 `process.cwd()`（与现有 bootstrap MCP preview 解析一致，复用同一 helper，禁止新造平行逻辑）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/mcp-server/src/handlers.bootstrap-task.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/tools.ts packages/mcp-server/src/handlers.ts packages/mcp-server/src/handlers.bootstrap-task.test.ts
git commit -m "$(cat <<'EOF'
feat: mark bootstrap DigTask from MCP kmind_capture

EOF
)"
```

---

### Task 3: Evolution bootstrap todo 结构化跳转

**Files:**
- Modify: `packages/shared/src/schemas/evolution-queue.schema.ts`
- Modify: `packages/core/src/schedule/evolution-queue.ts`（bootstrap 循环 upsert）
- Test: `packages/core/src/schedule/evolution-queue.test.ts`（扩展或新建）

**Interfaces:**
- Consumes: `buildBootstrapPlanForVault`（已有）
- Produces: `EvolutionTodo` 新增可选字段：
  ```ts
  digTaskId: z.string().optional(),
  groupLabel: z.string().optional(),
  ```
  `nextAction` 固定模板（精确文案）：
  `Delegate group="<label>" then dig <taskId>; capture with bootstrapTask=<taskId>; kmind_coverage`

- [ ] **Step 1: Write the failing test**

```ts
it('given open DigTask when evolution scan then item has digTaskId and groupLabel', async () => {
  const queue = await runEvolutionScan(/* fixture vault+repo with one todo task */);
  const boot = queue.items.find((i) => i.source === 'bootstrap' && i.code === 'dig_task');
  expect(boot?.digTaskId).toMatch(/^dig-/);
  expect(boot?.groupLabel).toBeTruthy();
  expect(boot?.nextAction).toContain('bootstrapTask=');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/schedule/evolution-queue.test.ts -v`  
Expected: FAIL（字段缺失）

- [ ] **Step 3: 扩展 Zod；upsert 时写入 `digTaskId: task.id`、`groupLabel: group.label`；更新 `nextAction` 文案**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/schedule/evolution-queue.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/evolution-queue.schema.ts packages/core/src/schedule/evolution-queue.ts packages/core/src/schedule/evolution-queue.test.ts
git commit -m "$(cat <<'EOF'
feat: attach digTaskId to bootstrap evolution todos

EOF
)"
```

---

### Task 4: Delegate 列表 `recommendedNext` + DigPacket 空组语义

**Files:**
- Modify: `packages/core/src/bootstrap/delegate.ts`
- Modify: `packages/cli/src/commands/bootstrap.ts`（delegate 无 `--group` 输出）
- Modify: `packages/mcp-server/src/handlers.ts`（`kmind_bootstrap_delegate` 无 groupLabel）
- Test: `packages/core/src/bootstrap/delegate.test.ts`（新建或扩展 `upgrade.test.ts`）

**Interfaces:**
- Consumes: `BootstrapPlan`（progress 已 merge）
- Produces:
  ```ts
  export function pickRecommendedNextGroup(plan: BootstrapPlan): string | undefined;
  // summarizeDelegateGroups 返回项增加：或单独返回
  export function summarizeDelegateGroups(plan: BootstrapPlan): {
    groups: Array<{ label: string; priority: number; todoCount: number; doneCount: number; planNotes?: string }>;
    recommendedNext?: string; // highest priority with todoCount>0
    stats: { groupsOpen: number; tasksOpen: number; tasksDone: number };
  };
  ```
  Breaking note: 若现有调用依赖「纯数组」返回值，改为包装对象并更新 CLI/MCP/测试（本任务唯一允许的小破坏性调整）。

- [ ] **Step 1: Write the failing test**

```ts
it('given two groups with todos when summarize then recommendedNext is higher priority', () => {
  const summary = summarizeDelegateGroups(plan);
  expect(summary.recommendedNext).toBe('packages/core');
  expect(summary.stats.tasksOpen).toBeGreaterThan(0);
});

it('given all done when buildDigPacket skipDone then tasks empty and acceptance still forbids complete', () => {
  const packet = buildDigPacket({ plan: allDonePlan, groupLabel: 'g', skipDone: true });
  expect(packet.tasks).toEqual([]);
  expect(packet.acceptance.completeClaimForbiddenUntil).toMatch(/complete=true/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/bootstrap/delegate.test.ts -v`  
Expected: FAIL

- [ ] **Step 3: 实现 `pickRecommendedNextGroup` + 调整 `summarizeDelegateGroups`；更新 CLI/MCP 消费方**

- [ ] **Step 4: Run related tests**

Run: `pnpm exec vitest run packages/core/src/bootstrap/ -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bootstrap/delegate.ts packages/core/src/bootstrap/delegate.test.ts packages/cli/src/commands/bootstrap.ts packages/mcp-server/src/handlers.ts
git commit -m "$(cat <<'EOF'
feat: recommend next DigGroup in bootstrap delegate list

EOF
)"
```

---

### Task 5: `init --project` 写入 `bootstrap-rules.yaml` 模板

**Files:**
- Create: `templates/project-vault/bootstrap-rules.yaml`
- Modify: `packages/cli/src/commands/init.ts`
- Modify: `packages/cli/src/commands/init.project.test.ts`

**Interfaces:**
- Consumes: 既有 project vault 创建流程
- Produces: 若不存在则复制模板到 `.kmind-knowledge/bootstrap-rules.yaml`；模板含 ≥2 条示例 `pathGlob`（如 `**/test/**` → `exclude: true`；`**/adapters/**` → `candidateType: tool_usage`）+ 注释说明 first-match

- [ ] **Step 1: Write the failing test**

```ts
it('given init --project when vault created then bootstrap-rules.yaml exists', async () => {
  await initProjectVault(/* temp git repo */);
  expect(existsSync(path.join(vaultPath, 'bootstrap-rules.yaml'))).toBe(true);
});

it('given existing bootstrap-rules.yaml when re-init then does not overwrite', async () => {
  // write sentinel content, re-run ensure path, expect sentinel
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/cli/src/commands/init.project.test.ts -v`  
Expected: FAIL

- [ ] **Step 3: 添加模板；init 幂等 copy（仅 `!exists`）；确认 `.gitignore` 仍不忽略该 yaml（应可进 git）**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/cli/src/commands/init.project.test.ts -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add templates/project-vault/bootstrap-rules.yaml packages/cli/src/commands/init.ts packages/cli/src/commands/init.project.test.ts
git commit -m "$(cat <<'EOF'
feat: scaffold bootstrap-rules.yaml on project vault init

EOF
)"
```

---

### Task 6: 文档对齐 + 全量门禁

**Files:**
- Modify: `docs/adr/004-knowledge-bootstrap-hybrid.md`（状态行 + M3 小节）
- Modify: `docs/MCP_TOOLS.md`（`kmind_capture.bootstrapTask`；delegate 列表 `recommendedNext`）
- Modify: `skills/kmind-capture/SKILL.md` + `packages/cli/skills/kmind-capture/SKILL.md` + `.cursor/skills/kmind-capture/SKILL.md`（三份同步：capture 回灌 `bootstrapTask`）
- Modify: `README.md`（Bootstrap 节补 MCP 字段与 init 模板一句）

**Interfaces:**
- Consumes: Tasks 1–5 已定对外契约
- Produces: 文档与 Skill 无矛盾；ADR 写明 M3 范围与「仍不做」

- [ ] **Step 1: 更新 ADR-004：状态改为 Accepted（M3 闭环）；新增「M3」列表：MCP mark 对齐、evolution 结构化跳转、delegate recommendedNext、init rules 模板；明确不做 Ultra / 联邦 / 自动正文**

- [ ] **Step 2: 更新 MCP_TOOLS + 三份 Skill + README 对应段落（只改 Bootstrap/capture 相关，不重写全文）**

- [ ] **Step 3: Run full gate**

Run: `pnpm test && pnpm typecheck`  
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add docs/adr/004-knowledge-bootstrap-hybrid.md docs/MCP_TOOLS.md skills/kmind-capture/SKILL.md packages/cli/skills/kmind-capture/SKILL.md .cursor/skills/kmind-capture/SKILL.md README.md
git commit -m "$(cat <<'EOF'
docs: document ADR-004 M3 bootstrap loop surfaces

EOF
)"
```

---

## Self-Review

1. **Spec coverage:** M2 已交付能力不重做；M3 缺口（MCP mark、evolution 跳转、delegate 下一组、init 规则模板、文档）均有任务。未纳入：Ultra、OCR 规则整包、联邦、propose/commit、召回埋点。
2. **Step scan:** 各步为测名/签名/命令；无「处理边界」空话；无整函数正文转录。
3. **Type consistency:** `markBootstrapProgressTask`、`bootstrapMarked`、`digTaskId`/`groupLabel`、`recommendedNext` 前后一致。
4. **Review Focus:** 五条均挂在 Task 1–5 测试中。
5. **Proportion:** 计划短于实现代码体量；接口钉死、实现开放。

## 明确不做（本阶段）

- 自动 `kmind_capture` 填正文
- Ultra / 高召回扫荡模式
- 多实例联邦（M4b — 另开计划）
- ADR-002 propose/commit 两阶段 API、召回成功率云埋点
- 把 OCR 规则库整包迁入 vault
