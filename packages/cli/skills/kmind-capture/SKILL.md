---
name: kmind-capture
description: >-
  Capture high-quality knowledge into the local KMind vault via MCP or CLI.
  Use when the user asks to 沉淀 / 记到 KMind / capture knowledge / 写入知识库 /
  整理到kmind / 把某系统写入知识库, or after a confirmed decision, pitfall,
  architecture choice, or reusable practice. Also use proactively after closed
  decisions — depth is default, user need not say「写详细」.
  Before implementing modules/tables/architecture in a team repo: kmind_pack first.
---

# KMind 高质量写入

只沉淀可复利结论；整段会话留在 raw，不直接升知识。

**默认就要写完整、写详细——用户不必每次说明「要明细」。** 系统闸门会拒写目录空文与未挂图的增量卡。

## 团队共享 vault（强制）

- 优先仓库内 **`.kmind-knowledge/`**（`kmind init --project`）；否则 `~/.kmind`。
- **功能树**：项目 vault 根目录始终维护 **`FEATURE_TREE.md`**（init/adapters `--project` 会 ensure）。整理前对照表盘点；capture 后把行标为 `done` + 资产 id。可用 `kmind feature-tree ensure`。
- **写代码前查库**：改模块 / 建表 / 定方案 / 疑似踩坑 → 先 `kmind_pack`（或 `kmind_search`），禁止盲写导致重复造轮子。
- **定案后沉淀**：决策闭合、踩坑、可复用实践 → `kmind_capture_suggest` → `kmind_capture`；用户不必说「记一下」。
- 知识随 git 流动；禁止把 `raw/`、`index.db`、密钥提交进共享仓。
- 禁止把 Skills / 工具安装说明写入业务知识卡。
- 遵守仓库 `AGENTS.md` 中的 `<!-- kmind:agent-protocol -->` 区块。

**硬要求（系统拒写）：**

1. **明细化** — 禁止总结式空话 / 目录标题冒充知识  
2. **一卡一事** — 可独立提问的单元单独成卡（阶段/模块/坑，不要整条 S0–S10 一卡）  
3. **真实 `project`** — 禁止缺省/`global`  
4. **Session 永不自动升知识** — 只走 `kmind_capture`  
5. **架构/流程类必须代码锚点** — 先 Codegraph/读码再写  
6. **禁止「目录完工」冒充「知识完工」** — search 命中总览 ≠ 已完整  
7. **禁止默认 `architecture_design`** — 说不清类型时先查 `kmind_asset_types` + `kmind_capture_suggest`，禁止手抄示例枚举  

## 类型意图表（选 type 必查）

| 盘点项 / 用户说法 | type | 禁止 |
|---|---|---|
| 架构取舍、模块边界、数据流、存储分层 | `architecture_design` | 把踩坑/CLI/未解问题塞进架构卡 |
| 踩坑、回归、误用、长驻进程坑 | `pitfall` | 套「实现方式三件套」冒充架构 |
| 工具安装/配置/命令技巧 | `tool_usage` | 写成系统总览子模块 |
| 未解症状 / 待排查 | `problem` | 把方案写进 problem |
| 针对 problem 的可执行方案 | `problem_solution` | 无 `links.solves` |
| 验证证据 / 上线结果 | `outcome` | 无 `links.verifies` |
| 可复用约定（非单次架构） | `best_practice` | 空话「建议做好」 |
| 可复用代码块 | `code_snippet` | 无锚点整文件粘贴 |
| 团队流程 / checklist | `process_spec` | 与架构卡混写 |

**禁止：** 说不清就用 `architecture_design`；系统整理时只产出一堆架构明细而无其它类型（coverage 会报 `type_mono`）。

## 意图分流（必做）

| 用户说法 | 走哪条 | 禁止 |
|---|---|---|
| 记一条 / 把这个也沉淀 | **增量五步** | 只改总览 related |
| 整理某系统 / 写入知识库 / 沉淀问数… | **首次四阶段**（即使库里已有总览） | 检索到总览就收工；只「重挂主总览」 |
| 问「有没有整理完」 | **`kmind_coverage`** | 用 search 条数自我证明 |

已有总览时：**先 `kmind_coverage(project, topic)`**。`complete=false` → 按 `nextActions` 深挖浅卡/补锚点/补非架构类型/合并重复总览，**禁止**再写一张同名总览或只刷新索引。

## 首次 / 系统级整理（四阶段，强制）

触发词：整理到 kmind、把××系统写入、沉淀××架构、知识库化……

1. **盘点**：模块 / 阶段 / 可观测 / 配置 / 迁移 / 已知坑 — **每项标注候选 type**（可暂不 capture）  
2. **深挖**：每项 `codegraph_explore` 或 Read 关键文件 → 路径·符号·失败模式  
3. **入库**：按候选 type 写专项明细；有证据才写 pitfall/tool_usage/problem；**禁止编造**；每张卡前先 `kmind_asset_types` + `kmind_capture_suggest`，回灌 `apply.type`  
4. **成图**：薄总览 + `related`→全部**已深挖**子卡；子卡可 `part_of`→总览  

**收工验收（硬）：**

```
kmind_coverage  project=<project>  topic=<主题>
```

- 仅当 `complete === true`（且 `claimCompleteAllowed === true`）才可回复「已整理完毕」  
- `complete === false` → 展示 `summary` + `nextActions`，继续深挖，**禁止**只重挂总览结束  
- **否决 complete 的新增条件**：评估集内锚点文件不存在（`broken_anchor_path`）、符号在 Codegraph 未命中（`broken_anchor_symbol`）、已过 `expiresAt`（`expired_asset`）；`codegraph.required=true` 且不可用时还有 `codegraph_required_unavailable`  
- 出现 `type_mono` → 从会话/失败路径/配置拆至少 1 张非架构卡；无证据则如实说明未 complete，**禁止编造 pitfall**  
- capture / coverage 回执还含 `protocolViolation` 与 `recentRecall`：  
  - `session_pollution` → 催 `kmind purge-sessions`，**不**否决 complete  
  - `recentRecall.status=miss`（24h 内无 pack/search）→ 警告，先 `kmind_pack`；**不**否决 complete  
  - `recentRecall.status=unknown` → 审计不可读；**不**否决 complete  
  - `codegraph_unavailable` → 跳过符号校验；**不**否决 complete（除非 config `codegraph.required`）  
- capture 成功回执里的 `claimCompleteAllowed` / `coverage.complete` 同理  

**反例（禁止）：** 搜到「××知识总览」→ 宣称库里已完整 → 只把总览挂进主索引 → 交付三级目录树；或四张以上全是 `architecture_design` 就宣称整理完。

## 增量写入（单条结论）— 默认协议

1. **`kmind_asset_types`**（强制）→ 确认 `type` + 读 `guidance` / `scaffold`（勿手抄死枚举）  
2. **召回**：答库内问题优先 **`kmind_pack`**（focus+邻域+锚点）；仅列候选时用 `kmind_search`  
3. **判重**：同主题则更新语义（新卡 + `related`/`supersedes` 点名旧 id）  
4. **深挖（强制）**：涉及代码则 Codegraph/读码  
5. **`kmind_capture_suggest`**（强制）→ 展示 duplicates/type/hub/links；人确认后把 `apply`（尤其 `type`）回灌  
6. **`kmind_capture`**：按该 type 的 guidance/scaffold；挂图  
7. **验收**：`kmind_related` 有边；必要时对主题再跑 `kmind_coverage`  

## 何时写入

- 决策已闭合 / 可复用 / 用户明确要求沉淀  

禁止：未验证猜测、整段 chat、一句话总结、多主题合集、**只有标题表的总览且子卡全浅**、重复同名总览叠床架屋、编造无证据的 pitfall/problem。

## 范围：一卡一事

| 卡类型 | 写什么 | 禁止 |
|---|---|---|
| **明细卡** | 单模块/单阶段/单坑；按 type scaffold | ≥4 组件同卡；S0–S10 一整卡 |
| **总览卡** | 薄导航 + 红线；`related`→**非浅**子卡 | 总览里写各组件实现；子卡全浅时仍写总览 |

## 明细模板（按 type；以下为 feature 类默认）

架构 / 实践 / 工具 / 流程 / 片段常用：

```markdown
## 实现方式
1. …
2. 文件：`path/to/File.ts` · 符号 `foo`

## 注意事项
- …；失败时：…

## 红线规避
- 禁止：…；必须：…

## 代码锚点
- `path/to/File.ts` · `foo` · function
```

踩坑用 `## 现象` / `## 根因` / `## 正确做法`；问题用 `## 症状` / `## 复现` / `## 验收标准`。以 `kmind_asset_types` 的 scaffold 为准。

## 问题闭环

- `problem` → `links.solves` → `outcome` `links.verifies`  
- 查询：`kmind_problem_status`

## 调用注意（示例轮换；勿默认 architecture）

踩坑：

```json
{
  "title": "MCP长驻未重启导致旧二进制",
  "type": "pitfall",
  "project": "kmind",
  "related": ["k-2026-10-20-054"],
  "content": "## 现象\n…\n## 根因\n…\n## 正确做法\n…"
}
```

工具：

```json
{
  "title": "kmind coverage 验收命令",
  "type": "tool_usage",
  "project": "kmind",
  "anchors": [{ "file": "packages/cli/src/commands/coverage.ts", "symbol": "coverageCommand" }],
  "content": "## 实现方式\n…\n## 注意事项\n…\n## 红线规避\n…\n## 代码锚点\n…"
}
```

未解问题：

```json
{
  "title": "JOIN 路径丢失待排查",
  "type": "problem",
  "project": "meta-brain",
  "content": "## 症状\n…\n## 复现\n…\n## 验收标准\n…"
}
```

架构决策（仅当确实是架构取舍）：

```json
{
  "title": "Vault 三层存储取舍",
  "type": "architecture_design",
  "project": "kmind",
  "related": ["k-2026-10-20-054"],
  "anchors": [{ "file": "packages/core/src/storage/vault.ts", "symbol": "createVault" }],
  "content": "## 实现方式\n…\n## 注意事项\n…\n## 红线规避\n…\n## 代码锚点\n…"
}
```

覆盖率：

```json
{ "project": "meta-brain", "topic": "问数" }
```

`quality_gate` → 按 `reasons` 补锚点/挂图/拆卡/深挖浅卡后重写，**不要**改成更短的总结。  
`coverage.complete=false`（含 `type_mono` / `broken_anchor_path` / `expired_asset`）→ **禁止**宣称完整。

## 质量边界（系统）

- 明细 + 一卡一事 + 架构锚点 + 增量必须挂图  
- 总览 related 子卡过半/全浅 → 拒写  
- 明细≥4 且几乎全是 architecture、零非架构 → `type_mono`（阻塞 complete）  
- 锚点文件不存在 → `broken_anchor_path`；`expiresAt` 已过 → `expired_asset`（均阻塞 complete）  
- 过期卡闭环：`kmind expiry deprecate|supersede|refresh` 或 MCP `kmind_retire_expired`（先 `dryRun`）；deprecate 后不再计入 coverage  
- Session 双闸门：`compileSessions` + `KMIND_COMPILE_SESSIONS=1`；脏 session 走 `protocolViolation`，不阻塞 complete  
- lint：`coverage_*`（浅卡 / 重复总览 / 空总览 / 断锚点 / 过期）  
- 与 **kmind-code-bridge** 配合取符号，禁止整文件入库  
