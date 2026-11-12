# AGENTS.md — KMind 仓库 Agent 强制规范

所有 AI 编码工具（Cursor / Claude Code / Codex / Copilot / 其它读 AGENTS 的 Agent）**必须**遵守本文。  
Skills（`kmind-capture` / `kmind-code-bridge`）是细则；本文是**默认全局上下文**，冲突时以更严者为准。

---

## 0. 一句话

**写代码前先查团队知识；定案后沉入仓内 vault；知识跟 git 走，人不手搓同步。**

---

## 1. 仓库与 Vault

| 项 | 规则 |
|---|---|
| 共享知识根 | 优先仓库内 `.kmind-knowledge/`（`kmind init --project`）；否则 `~/.kmind` |
| 进 git | 仅 `knowledge/`、`ontology/`、`asset-types/`、`config.yaml`、`FEATURE_TREE.md`、`.gitignore` |
| 禁止进 git | `raw/`、`index.db`、`audit/`、会话全文、密钥 |
| 索引 | `git pull` / checkout 后由 `.githooks` 自动 `reindex` |
| 资产 id | `k-YYYY-MM-DD-NNN-<4hex>`（`KMIND_AUTHOR` 可固定后缀） |
| 验收 | 见 `docs/TEAM_VAULT_ACCEPTANCE.md` |

---

## 2. 写代码时的强制顺序（每次任务）

1. **查库** — 涉及已有模块 / 表结构 / 踩坑 / 架构取舍时，先 `kmind_pack`（或 `kmind_search`），禁止盲写导致重复造轮子、重复建相似表。
2. **查结构** — 需要符号 / 调用链 / 影响面时用 Codegraph（`codegraph_explore` + `projectPath`）；无索引再用 Read/Grep。
3. **实现** — 遵守下文编码铁律；复用库内已有结论与锚点，不另起一套平行方案 unless 显式 supersede。
4. **沉淀** — 决策闭合、可复用实践、踩坑、架构取舍 → 走 `kmind_capture_suggest` → 人确认（或会话内等价确认）→ `kmind_capture`。用户不必说「记一下」。
5. **验收知识完整性** — 整理某系统时必须 `kmind_coverage`；仅 `complete=true` 可宣称整理完毕。

禁止：

- 用 search 命中总览冒充「知识已完整」
- 默认 `type=architecture_design`
- Session / 聊天全文自动升知识（只走 `kmind_capture`）
- 缺 `project` 或 `project=global` 的 capture

---

## 3. 知识类型与挂图（摘要）

选 type 先 `kmind_asset_types`，细节见 skill `kmind-capture`。

| 场景 | type |
|---|---|
| 架构取舍 / 边界 / 数据流 | `architecture_design` |
| 踩坑 / 误用 | `pitfall` |
| 未解症状 | `problem` |
| 可执行方案 | `problem_solution`（`links.solves`） |
| 验证证据 | `outcome`（`links.verifies`） |
| 工具 / CLI | `tool_usage` |
| 流程 checklist | `process_spec` |
| 可复用约定 | `best_practice` |

架构 / 流程 / 片段类：**必须**代码锚点（路径 + 符号）。一卡一事；禁止目录空文。

---

## 4. 本仓库编码铁律（KMind monorepo）

### 项目性质

- TypeScript monorepo，pnpm workspace
- 本地优先，零云端依赖
- 开发契约铁律 R-01～R-08（见 `packages/core/CONTRACT.md` / CONTRIBUTING）

### 编码

- 外部输入一律 Zod 校验
- SQL 参数化，禁止拼接
- 路径用 `path.join`，禁止手写 `'/'` 拼接
- 异步必须处理错误，禁止裸露 await
- 导出函数必须有 JSDoc

### 架构

- 禁止跨层：cli → core → storage
- core 不依赖任何适配器
- adapters 仅依赖 shared 与 core 公开接口
- 循环依赖视为编译错误

### 测试与提交

- 公开函数有 vitest 单测；given-when-then 命名
- Mock 外部依赖（LLM；文件系统用 memfs）
- 禁止 lodash / moment 等重依赖
- core 禁止 `console.log`（用 logger）
- 禁止提交密钥；禁止跳过测试提交
- Conventional commits：`feat:` / `fix:` / `docs:` / `test:` / `refactor:` / `chore:`
- 提交前：`pnpm test && pnpm typecheck`

### 参考

- `docs/DATA_CONTRACTS.md`
- `docs/ARCHITECTURE.md`
- `docs/ADAPTER_GUIDE.md`
- `docs/MCP_TOOLS.md`
- `docs/adr/002-intelligence-flywheel.md`

---

## 5. 团队无感约定

- **初始化一次**：`kmind init --project`（或团队文档等价步骤）+ MCP/Skills 安装；之后不要求人记 sync 命令。
- **同步**：知识文件随普通 `git pull` / `git push` / PR 流动；Agent 只负责落盘正确路径与写前查库。
- **不静默 `git push`**；可 stage 知识文件，推送跟用户日常推代码一致。

---

## 6. 冲突与优先级

1. 安全 / 合规 / 密钥红线  
2. 本文 + CONTRACT 铁律  
3. `kmind-capture` / `kmind-code-bridge` Skills  
4. 用户当次口头指示（不可覆盖 1–2）
