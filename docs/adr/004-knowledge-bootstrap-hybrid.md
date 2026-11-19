# ADR-004: 知识初始化混合架构（确定性工程 × Agent）

- **状态**：Accepted（MVP + M2 深度升级 + **M3 闭环**：MCP mark 对齐 / evolution 结构化跳转 / delegate recommendedNext / init 规则模板）；正文写入边界由 [ADR-005](005-cli-llm-knowledge-build.md) 显式 opt-in 扩展
- **日期**：2026-11-18
- **决策者**：OCR 启发 + 产品共识（C + MVP → 1+2+3 → M3）
- **关联**：[ADR-002 智能飞轮](002-intelligence-flywheel.md)、[ADR-003 双图边界](003-dual-graph-boundary.md)

## 背景

「整理某系统 / 全项目知识初始化」若仅靠通用 Agent 自由发挥，会出现与 OCR 同类问题：覆盖不全、类型偏斜、目录空文冒充完工。KMind 已有 capture 闸门与 coverage，但缺少**确定性的盘点 → 分组 → 任务清单**入口，Agent 仍容易跳过模块或只写总览。

OCR（alibaba/open-code-review）的混合架构表明：文件筛选、分组、规则匹配应由工程硬约束；模型只做动态深挖与结构化提交。

## 决策

### 1. 确定性 × Agent，禁止全自动灌库

| 负责方 | 做什么 | 不做 |
|---|---|---|
| **core bootstrap** | 扫仓选模块、启发式分组、路径→候选 type、产出 `BootstrapPlan`；可选写入 FEATURE_TREE `todo` | 不生成知识正文；不调用 LLM 写卡 |
| **Agent（Skill）** | 按 `DigGroup` 深挖（Codegraph + pack）、`capture_suggest` → 人确认 → `capture`、跑 `coverage` | 不以 bootstrap 输出宣称 complete |
| **既有闸门** | `assessCaptureQuality`、`kmind_coverage`、`type_mono` | 不变 |

对齐 ADR-002：半自动诊断与催促；人/Agent 补写。

### 2. 契约表面

Zod：`BootstrapModule` / `DigTask` / `DigGroup` / `BootstrapPlan` / `BootstrapDigPacket` / progress（`packages/shared`）。  
CLI：`kmind bootstrap run|preview|apply-tree|sync-tree|status|mark|delegate`。
`run` = 幂等一键（vault 文件补齐 → reindex → plan → FEATURE_TREE → coverage 摘要），仍不写正文。  
MCP：`kmind_bootstrap_preview|status|mark|delegate`；`kmind_capture.bootstrapTask`。

### 3. MVP → M2 范围

- 默认：确定性启发式 + vault `bootstrap-rules.yaml` overlay（first-match）
- 可选：`bootstrap.llmGrouping` / `llmPlan`（本地 Ollama 风格，默认关；失败回退启发式）
- progress：`audit/bootstrap-progress.json` + `mark` / capture `--bootstrap-task`
- evolution：`source=bootstrap` 开放 DigTask；FEATURE_TREE `apply-tree` / `sync-tree`
- DigPacket：`kmind bootstrap delegate` / `kmind_bootstrap_delegate`
- pitfall 等仅 notes「需证据」；**永不**自动灌知识正文

### 4. M3 闭环（本阶段）

- MCP `kmind_capture` 支持 `bootstrapTask`，成功后与 CLI 共用 `markBootstrapProgressTask`
- evolution bootstrap todo 带 `digTaskId` / `groupLabel`；`nextAction` 指向 delegate + `bootstrapTask=`
- delegate 列表返回 `recommendedNext` + `stats`（全 done 组 DigPacket 可空 tasks，仍禁止宣称 complete）
- `kmind init --project` 幂等写入 `bootstrap-rules.yaml` 模板（已有则不覆盖）

### 5. 与双图

`suggestedAnchors` 优先导出符号，并可用 Codegraph `findSymbol` 校验；不持久化 callers（ADR-003）。

## 后果

- 「首次整理」：bootstrap preview → 按组 delegate → dig/capture（`bootstrapTask`）→ mark → coverage。
- evolution 同时催「没挖」与「挖得浅」；bootstrap 输出仍 ≠ complete。
- 假完工路径减少：无任务清单 / DigPacket 不得宣称系统已盘点。

## 明确不做（仍有效）

> **更新（ADR-005）**：本条「自动 kmind_capture 填正文」在 **显式 opt-in** 的 `kmind bootstrap run --write` / `--dry-run` 下定向放开：逐卡过同一质量闸门、低置信/失败卡片跳过并报告，默认路径（不带 `--write`）行为不变。见 [ADR-005](005-cli-llm-knowledge-build.md)。

- 默认路径自动 `kmind_capture` 填正文（仅 `bootstrap run --write` 例外，见上）
- Ultra / 高召回扫荡
- 多实例联邦（M4b）
- OCR 规则库整包迁入 vault
