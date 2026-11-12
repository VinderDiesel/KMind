# ADR-003: 双图边界（KMind ↔ Codegraph）

- **状态**：Accepted（M1 + M2 已在 core 落地：文件/符号校验、`anchorImpact`、CLI 适配器）
- **日期**：2026-11-12
- **决策者**：grill-me 会话共识（P0/P1 + 弱锚定缺口补充）
- **关联**：[ADR-002 智能飞轮](002-intelligence-flywheel.md)

## 背景

KMind 知识资产通过 `metadata.codeAnchors` / `## 代码锚点` 弱引用代码。UI 可高亮带锚点节点，但 **blast radius / 调用方分析不在 KMind 职责内**（见 `docs/ARCHITECTURE.md`）。

缺口：AI 重构某方法时，KMind 能召回「上次约定」，却不能自动检测当前调用方与隐式行为依赖是否断裂。Skill 层 `kmind-code-bridge` 靠 Agent 手工拼两套工具，没有自动化双向同步。

## 决策

### 1. 两套真相，禁止混库

| 图 | 真相 | 不做 |
|---|---|---|
| **KMind** | 决策 / 踩坑 / 规范 / 过期与完整度 | 不自建 AST/调用图；不持久化 callers 快照为第二真相 |
| **Codegraph**（或同类） | 符号存活、调用链、影响面 | 不存组织知识卡 |

Agent 协议继续分流：经验 → pack/search；结构 → `codegraph_explore`。

### 2. 集成方式：适配器，禁止进程内读 Codegraph SQLite

- 默认：CLI / 本地 API（版本化契约）
- 无索引 / 不可用：降级为 Skill 强制 Agent 再跑 explore（半自动）
- **禁止** core 直接依赖 `.codegraph/` 存储格式

### 3. 分里程碑交付

**里程碑 1（已实现方向）**

- 锚点 **文件存在性**（`broken_anchor_path`）+ 评估集 **`expiresAt`** → 否决 `complete`
- `protocolViolation` / `recentRecall`（24h）；session 污染与无召回 **不**否决 complete
- coverage 保持同步 + 可注入 `exists`

**里程碑 2（已实现）**

- 符号存活：`enrichCoverageSymbols` + CLI `codegraph query -j`；失败 → `broken_anchor_symbol` medium；与 file miss 不叠两条
- pack：`anchorImpact` = callers（`codegraph callers -j`）+ 同 project 锚点逆查（封顶）；**不**写入资产
- 无 Codegraph：`protocolViolation: codegraph_unavailable`；`config.codegraph.required=true` → `codegraph_required_unavailable`

### 4. 明确非目标（两里程碑内）

- KMind 内嵌完整代码图
- callers 快照长期固化与自动 diff 反写知识卡
- 代码变更自动失效/改写资产正文

## 后果

### 正面

- 边界可讲清：被强制的是「锚点是否还指得住」，不是「替代 IDE 影响面」
- 与本地优先、适配器哲学一致
- 为「隐式约定 × 调用方」在 pack 侧留出组合叙事，而不污染 vault 真相

### 负面 / 风险

- 无 Codegraph 的仓在里程碑 2 默认偏软（需 opt-in 强制）
- CLI 契约漂移时 enrichment 失败 → 须稳定 `unknown` / 降级语义

## 备选（已拒）

| 方案 | 拒因 |
|---|---|
| 进程内读 Codegraph DB | 格式锁死、版本耦合 |
| 把 blast radius 收进 KMind 核 | 违背双图分工、成本爆炸 |
| 永久只靠 Skill 手工桥 | 无法自动检符号漂移 |

## 实施要点

1. M1：`assessProjectCoverage` issue codes + `buildProtocolReceipt`；引擎/CLI/MCP/UI API 回执对齐 Skills/AGENTS
2. M2：`codegraph` 适配器接口 + 异步 enrichment；扩展 Context Pack 契约字段 `anchorImpact`
3. 文档：本 ADR；`kmind-code-bridge` 指向本边界
