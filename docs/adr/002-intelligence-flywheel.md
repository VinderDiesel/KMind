# ADR-002: 智能飞轮（聪明记 · 聪明搜 · 聪明进化）

- **状态**：Accepted
- **日期**：2026-10-30
- **决策者**：grill-me 会话共识
- **关联**：[ADR-001 资产类型 Registry](001-asset-type-registry.md)

## 背景

KMind 若只做本地 Markdown / SQLite 存储，与「文件夹 + 数据库」无本质差异。产品目标不是单纯记忆，而是：

- **聪明地记** — 有判断的写入（拒浅、挂图、类型规范、去重建议）
- **聪明地搜** — 有结构的召回（给 Agent 可直接用的上下文包）
- **聪明地进化** — 可度量缺口、可推进补全，且架构本身可插拔演进

现状已有半套能力：capture 质量闸门、hybrid 搜索、ego/related、coverage、health/lint、schedule、本体 Evolver、ADR-001 类型策略。缺的是**统一主张、验收心跳、稳定契约与落地顺序**，否则功能点散落，对外讲不清「聪明在哪」。

## 决策

### 1. 产品主张：飞轮，而非网盘

三条能力**同等构成飞轮**（记 → 搜 → 进化 → 再记）。  
对外叙事钩子优先打 **「搜得准 / Agent 一跳可用」**；对内架构按闭环建设。

### 2. 验收心跳（可观测的「聪明」）

默认复合指标：

| 维度 | 来源 | 作用 |
|------|------|------|
| **Coverage** | `kmind_coverage` / `complete` / `nextActions` | 深度 vs 目录空文；驱动补写 |
| **图健康** | health/lint（孤岛、浅卡、problem 未闭环、缺锚点等） | 结构是否可检索、可闭环 |

**后做**：召回成功率埋点 / 人工打分（本地无云端反馈回路，成本高）。

没有心跳，「进化」只是口号。

### 3. 进化如何执行

| 做 | 不做 |
|----|------|
| **半自动诊断**：schedule/daemon 定期跑 coverage + lint，产出待办队列 | **全自动灌库**（系统自己生成正文填缺口） |
| **Agent 契约**：整理某系统必须 coverage → 按 `nextActions` 循环；`complete≠true` 禁止宣称完工（Skill / MCP 回执已接近） | 把会话 raw 自动升知识（既有双闸门继续） |

人与 Agent 负责补写；系统负责**发现与催促**。

### 4. 聪明搜的交付物

| 表面 | 交付 |
|------|------|
| CLI / UI | 保留 hybrid **命中列表** |
| MCP / Agent | **Context Pack**：主卡 + ego 邻域 + 代码锚点 + 相关 problem 状态等，一跳可塞进上下文 |

**禁止**本地/云端 LLM 把多卡「总结成答案」当真相（幻觉、不可核对）。卡是 source of truth；Pack 是结构化组装。

实现上新增（或收敛）只读工具，工作名：`kmind_pack`（最终名以 MCP 契约为准）。

### 5. 架构切分：稳定核 + 可插拔策略

```
┌─────────────────────────────────────────┐
│  Intelligence strategies (versioned)    │
│  闸门 / 建议 / Pack 组装 / 诊断规则 / …  │
│  （可替换；可选本地 LLM 增强，默关）      │
├─────────────────────────────────────────┤
│  Contracts (Zod, semver-ish)            │
│  Asset · Relation · Coverage · Pack ·   │
│  CaptureSuggestion · …                  │
├─────────────────────────────────────────┤
│  Vault 三层（稳定）                      │
│  Raw → Knowledge → Index                │
└─────────────────────────────────────────┘
```

- **存储核**：Vault 三层不因「更聪明」而推翻。
- **契约核**：Asset / Relation / Coverage / Pack / 写入建议等 Zod 契约版本化演进。
- **策略层**：新聪明能力 = 新策略模块（与 ADR-001 asset-types 同一哲学）。

### 6. 聪明记：闸门之上的建议，人确认后入库

在现有硬闸门（深度、一卡一事、挂图、类型规则）之上增加 **写入助理建议**：

- 疑似重复卡
- 建议 `type`（对照 registry）
- 建议 `related` / hub / typed `links`
- 缺锚点等提示

**确认模型（先做）：**

1. 工具返回结构化 `suggestions[]`
2. Agent 在对话中展示给人
3. 人确认后，Agent 再次 `capture` 时**回灌**已接受的建议字段（视为确认）

**后做（强审计）：** `propose` / `commit` 两阶段 API。

**禁止**：系统静默改写用户正文再入库。

### 7. LLM 政策

| 层级 | 政策 |
|------|------|
| **默认核** | 确定性：规则、图、FTS、向量、契约组装 |
| **增强** | 可选本地 LLM（如 Ollama）插件；默关；无模型则降级 |
| **禁止** | 云端 LLM 成为写入/召回/进化的硬依赖 |

「比文件夹聪明」首先来自**结构与判断**，不是再包一层聊天。

### 8. 落地顺序

1. **本文 ADR-002**（钉契约与边界）
2. **`kmind_pack`（Context Pack）** — 对外立刻可感的聪明搜
3. **写入建议（回灌确认）** — 聪明记
4. **Schedule coverage/lint 待办队列** — 进化节奏（`kmind evolution scan` / `audit/evolution-queue.json`；daemon 随维护或 `healthCheck.schedule` 刷新）

## 后果

### 正面

- 产品叙事与架构同构：飞轮可讲、可测、可演进
- Agent 路径差异化清晰：Pack ≠ 文件搜索；建议 ≠ 静默改写
- 与本地优先、ADR-001 策略插件方向一致
- 避免用全自动生成污染知识真相

### 负面 / 风险

- Pack / Suggestion 契约设计不当会导致 MCP 工具膨胀
- 「对话确认」依赖 Skill/Agent 遵守回灌协议，需文档与回执约束
- Coverage + 图健康需持续产品化（UI/队列），否则心跳留在 CLI

### 非目标

- 云端托管记忆 / 云端模型闭环
- 自动把 raw session 升知识
- 用 LLM 合成答案替代知识卡
- 第一期做召回成功率云埋点

## 备选方案（已拒）

| 方案 | 拒因 |
|------|------|
| 只做存储 + 全文搜 | 无差异化 |
| 全自动补写填缺口 | 脏库、不可信 |
| Pack = LLM 总结答案 | 幻觉；卡不再是真相 |
| 聪明能力绑死云端模型 | 违背零云端依赖 |
| 大重构不保 Vault 核 | 进化成本爆炸 |

## 实施要点（非本 ADR 细节）

1. Zod：`ContextPackSchema`、`CaptureSuggestionSchema`（版本字段）
2. core：`buildContextPack(query|id)` 组装 search + ego + anchors + problem_status
3. MCP：`kmind_pack`；Skill 更新为「先 pack 再答」
4. capture 路径：可选返回 / 接受 `suggestions`；文档化回灌确认
5. schedule：coverage + lint → 待办队列持久化（路径/格式另定）
6. 更新 `docs/ARCHITECTURE.md`、`docs/MCP_TOOLS.md`、README 主张句

## 一句话

**KMind 不是本地网盘，而是带判断的知识飞轮：严写入、结构召回、可度量进化；策略可插拔，模型可选且非核。**
