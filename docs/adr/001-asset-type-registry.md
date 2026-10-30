# ADR-001: 数据驱动的知识资产类型 Registry

- **状态**：Accepted
- **日期**：2026-10-29
- **决策者**：grill-me 会话共识

## 背景

知识资产类型目前以 Zod 硬编码枚举固定为 9 类（`KnowledgeTypeEnum`），并散落在：

- `packages/shared` schema / MCP tool enum
- `HeuristicClassifier` 正则规则
- `capture-quality` 按类型闸门
- UI / CLI 过滤

另有一层 `ontologyClass`（PascalCase），经 `TYPE_TO_CLASS` 与 `type` 1:1 映射，用于图查询 `MATCH Class`、本体校验、drift 与 Evolver。日常产品路径（capture / search / 质量闸门 / problem 闭环）几乎只依赖 `type`，双层在实践中冗余。

目标：支持**插件式删减/新增类型**，并为每类提供**核心沉淀规范**（写什么、怎么验收），同时保持本地优先、零云端、不引入代码插件运行时。

## 决策

采用 **纯数据 Asset Type Registry**（YAML/JSON），驱动**模板 + 质量闸门**；不做按类型的自动抽取引擎。

### 1. 插件面（做什么）

| 包含 | 不包含 |
|------|--------|
| 结构模板：`scaffold` + `requiredSections` | 按类型 LLM/代码自动抽取流水线 |
| Agent 指引：`guidance` | 任意 TS `TypePlugin.assess()` |
| 质量闸门：白名单谓词 `rules` | 重做图 relation 语义 |
| 可选分类提示：`classifyPatterns` | 完整规则引擎 / 脚本 |

正文仍由人/Agent 写好后 capture；compile 侧用 registry 做脚手架、指引暴露与质检。

### 2. 加载与覆盖

- **Builtin**：随 `@kmind/core`（或 shared 资源）提供默认 9 类定义
- **Vault 覆盖**：`vault/asset-types/`（或等价路径）按 **类型 id 深合并**
- 仅改 `enabled` / 单字段 guidance 时不必复制整文件

### 3. 内核类型不可禁用

以下三件套锁定（禁止 `enabled: false`），以保护 problem 闭环与相关工具：

- `problem`
- `problem_solution`
- `outcome`

其余类型可增、可禁用。

### 4. 禁用语义

- 禁用 = **禁止新 capture** 该 `type`
- 库内旧卡 **只读保留**，搜索 / get / 图仍可见
- 不默认隐藏；不做强制迁移门禁（迁移工具可后做）

### 5. `type` 与 `ontologyClass`

- **产品真相**：`type`（asset type id）
- **短期兼容**：写入时仍填 `ontologyClass`（由 type 推导，保持现有图 MATCH / validate / drift）
- 逐步淡化「第二套产品概念」；不把卡片类型定义塞进 ontology class 扩展字段

### 6. 闸门表达力

YAML 支持：

- `requiredSections`：必填 `##` 段落
- `rules`：固定谓词白名单（如 `minBodyChars`、`links.solves`、代码锚点、代码块等）
- **禁止**任意表达式/脚本

现有 `assessCaptureQuality` 逻辑迁入「读 registry 解释谓词」。

### 7. 模板用途

同一份 sections 服务三件事：

1. 校验（闸门）
2. CLI/UI 新建时插入 `scaffold`
3. Agent 经 MCP 读取 `guidance` 按规范写卡

### 8. 自定义类型如何入选

- **必须显式**传 `type`（MCP / CLI / capture JSON）
- YAML 可带可选 `classifyPatterns`，供 `HeuristicClassifier` 读取
- 无 pattern 且无 typeHint 时，不自动命中自定义类型

### 9. MCP / 校验

- 新增只读工具 **`kmind_asset_types`**：返回 enabled 类型、sections、guidance、rules、classifyPatterns
- `kmind_capture` / `kmind_search` 的 `type` 改为字符串 + **服务端对照 registry 校验**（enabled）
- Skill 应运行时读 registry，不再手抄死枚举

### 10. 契约示意

```yaml
id: pitfall
enabled: true
label: 踩坑记录
scaffold: |
  ## 现象
  ## 根因
  ## 正确做法
guidance: |
  写可复现的坑与正确做法；避免空泛抱怨。
requiredSections: [现象, 根因, 正确做法]
rules:
  - { minBodyChars: 120 }
classifyPatterns: ["踩坑", "pitfall", "gotcha"]
```

## 后果

### 正面

- 不发版即可增删非内核类型、改写作/质检规范
- Agent 有稳定入口获取「当前 vault 的类型规范」
- 与现有 9 类 capture/search/闭环路径兼容（行为对齐）
- 避免代码插件与任意脚本带来的供应链/安全复杂度

### 负面 / 风险

- `KnowledgeTypeEnum` 与多处硬编码需改为运行时 registry（MCP schema、shared Zod、测试夹具）
- 深合并与内核锁需要明确校验错误信息
- `ontologyClass` 短期双写，文档需写清「以 type 为准」
- 自定义类型无显式 `type` 时不会被自动分类命中（有意为之）

### 非目标（明确不做）

- 每类型独立 LLM extract prompt / 结构化字段抽取器
- 全局 `~/.kmind/asset-types` 与 vault 双层合并（可后续 ADR）
- 禁用时默认隐藏旧卡或强制改 type 才能禁用

## 备选方案（已拒）

| 方案 | 拒因 |
|------|------|
| 代码 `TypePlugin` 动态 import | 过重；B+C 不需要任意逻辑 |
| 闸门 = 仅段落清单 | 装不下现有锚点/`solves`/字数等规则 |
| 全类型可删含闭环三件套 | 打断 `problem_status` / coverage 语义 |
| 类型定义并入 ontology | 改闸门耦合本体版本；与「卡片类型」职责混淆 |
| 扩展 `kmind_ontology_describe` 兼吐类型 | 再次搅混本体与资产类型 |
| 禁用后默认过滤旧卡 | 「知识消失」幻觉 |

## 实施要点（非本 ADR 细节）

1. Zod：`AssetTypeDefSchema` + registry loader（builtin ∪ vault 深合并）
2. `capture-quality` / classifier patterns 读 registry
3. MCP：`kmind_asset_types` + capture/search 运行时校验
4. 更新 `docs/DATA_CONTRACTS.md`、`docs/MCP_TOOLS.md`、capture Skill
5. 单测：合并、内核锁、禁用后拒 capture、旧卡仍可读

## 参考

- 现状分类：`packages/core/src/compiler/classifier.ts`（启发式为主；OllamaClassifier 未真正分类）
- 现状闸门：`packages/core/src/compiler/capture-quality.ts`
- 类型枚举：`packages/shared/src/schemas/knowledge-asset.schema.ts`
- 本体映射：`packages/core/src/ontology/ontology-registry.ts`（`TYPE_TO_CLASS`）
