# AGENTS.md — 本仓库规范

（团队在此维护语言、目录、测试命令等项目特有规则。）

<!-- kmind:agent-protocol:start -->
## KMind 团队知识协议（强制）

所有 AI 编码工具必须遵守。目标：**写代码前先查团队知识；定案后自动沉淀；知识跟 git 走。**

### 强制顺序（每个开发任务）

1. **查知识** — 改模块 / 建表 / 定方案 / 疑似踩坑前，先 `kmind_pack`（或 `kmind_search`）。禁止重复造轮子、重复建相似表。
2. **对照功能树** — 打开 `.kmind-knowledge/FEATURE_TREE.md`；缺行先补盘点，capture 后把状态改为 `done` + 资产 id。
3. **查代码结构** — 有 Codegraph 用 `codegraph_explore`（传 `projectPath`）；否则 Read/Grep。
4. **实现** — 优先复用库内已有结论；要推翻旧结论须新卡并 `supersedes` 旧 id。
5. **沉淀** — 决策闭合、踩坑、可复用实践 → `kmind_asset_types` → `kmind_capture_suggest` → `kmind_capture`。用户不必说「记一下」。
6. **整理某系统** — 必须 `kmind_coverage` + 功能树无关键 `todo`；仅 `complete=true` 且题单可答才可宣称完成。

### Vault

- 共享根目录：仓库内 `.kmind-knowledge/`（`kmind init --project` 创建）
- 进 git：`knowledge/`、`ontology/`、`asset-types/`、`config.yaml`、`FEATURE_TREE.md`
- 禁止进 git：`raw/`、`index.db`、会话、密钥
- 同步：随普通 `git pull` / PR；索引由 hooks 或 `kmind reindex` 重建
- 禁止静默 `git push`

### Capture 红线

- 真实 `project`（禁止缺省 / `global`）
- 禁止默认 `architecture_design`；先 `kmind_asset_types`
- 一卡一事；禁止目录空文
- 架构 / 流程须代码锚点
- Session 永不自动升知识
- search 命中总览 ≠ 知识已完整
- 禁止把 Skills / 工具安装说明写入业务知识库

类型与模板细节：Skill `kmind-capture`。结构 vs 经验分流：Skill `kmind-code-bridge`。
<!-- kmind:agent-protocol:end -->
