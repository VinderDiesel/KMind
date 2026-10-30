---
name: kmind-capture
description: >-
  Capture high-quality knowledge into the local KMind vault via MCP or CLI.
  Use when the user asks to 沉淀 / 记到 KMind / capture knowledge / 写入知识库 /
  整理到kmind / 把某系统写入知识库, or after a confirmed decision, pitfall,
  architecture choice, or reusable practice. Also use proactively after closed
  decisions — depth is default, user need not say「写详细」.
---

# KMind 高质量写入

只沉淀可复利结论；整段会话留在 raw，不直接升知识。

**默认就要写完整、写详细——用户不必每次说明「要明细」。** 系统闸门会拒写目录空文与未挂图的增量卡。

**硬要求（系统拒写）：**

1. **明细化** — 禁止总结式空话 / 目录标题冒充知识  
2. **一卡一事** — 可独立提问的单元单独成卡（阶段/模块/坑，不要整条 S0–S10 一卡）  
3. **真实 `project`** — 禁止缺省/`global`  
4. **Session 永不自动升知识** — 只走 `kmind_capture`  
5. **架构/流程类必须代码锚点** — 先 Codegraph/读码再写  
6. **禁止「目录完工」冒充「知识完工」** — search 命中总览 ≠ 已完整  

## 意图分流（必做）

| 用户说法 | 走哪条 | 禁止 |
|---|---|---|
| 记一条 / 把这个也沉淀 | **增量五步** | 只改总览 related |
| 整理某系统 / 写入知识库 / 沉淀问数… | **首次四阶段**（即使库里已有总览） | 检索到总览就收工；只「重挂主总览」 |
| 问「有没有整理完」 | **`kmind_coverage`** | 用 search 条数自我证明 |

已有总览时：**先 `kmind_coverage(project, topic)`**。`complete=false` → 按 `nextActions` 深挖浅卡/补锚点/合并重复总览，**禁止**再写一张同名总览或只刷新索引。

## 首次 / 系统级整理（四阶段，强制）

触发词：整理到 kmind、把××系统写入、沉淀××架构、知识库化……

1. **盘点**：模块 / 阶段 / 可观测 / 配置 / 迁移 / 已知坑（先列清单，可暂不 capture）  
2. **深挖**：每项 `codegraph_explore` 或 Read 关键文件 → 路径·符号·失败模式  
3. **入库**：专项明细卡（一卡一事；实现+注意+红线+`## 代码锚点`）  
4. **成图**：薄总览 + `related`→全部**已深挖**子卡；子卡可 `part_of`→总览  

**收工验收（硬）：**

```
kmind_coverage  project=<project>  topic=<主题>
```

- 仅当 `complete === true` 才可回复「已整理完毕」  
- `complete === false` → 展示 `summary` + `nextActions`，继续深挖，**禁止**只重挂总览结束  
- capture 成功回执里的 `claimCompleteAllowed` / `coverage.complete` 同理  

**反例（禁止）：** 搜到「××知识总览」→ 宣称库里已完整 → 只把总览挂进主索引 → 交付三级目录树。

## 增量写入（单条结论）— 默认协议

1. **`kmind_asset_types`**（可选但推荐）→ 确认 `type` + 读 `guidance` / `scaffold`（勿手抄死枚举）  
2. **召回**：答库内问题优先 **`kmind_pack`**（focus+邻域+锚点）；仅列候选时用 `kmind_search`  
3. **判重**：同主题则更新语义（新卡 + `related`/`supersedes` 点名旧 id）  
4. **深挖（强制）**：涉及代码则 Codegraph/读码  
5. **`kmind_capture_suggest`**（推荐）→ 展示 duplicates/type/hub/links；人确认后把 `apply` 回灌  
6. **`kmind_capture`**：按 guidance + 已确认字段；实现+注意+红线+锚点；挂图  
7. **验收**：`kmind_related` 有边；必要时对主题再跑 `kmind_coverage`  

## 何时写入

- 决策已闭合 / 可复用 / 用户明确要求沉淀  

禁止：未验证猜测、整段 chat、一句话总结、多主题合集、**只有标题表的总览且子卡全浅**、重复同名总览叠床架屋。

## 范围：一卡一事

| 卡类型 | 写什么 | 禁止 |
|---|---|---|
| **明细卡** | 单模块/单阶段/单坑；实现+注意+红线+锚点 | ≥4 组件同卡；S0–S10 一整卡 |
| **总览卡** | 薄导航 + 红线；`related`→**非浅**子卡 | 总览里写各组件实现；子卡全浅时仍写总览 |

## 明细模板

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

## 问题闭环

- `problem` → `links.solves` → `outcome` `links.verifies`  
- 查询：`kmind_problem_status`

## 调用注意

```json
{
  "title": "短标题",
  "type": "architecture_design",
  "project": "meta-brain",
  "related": ["k-2026-10-19-050"],
  "anchors": [{ "file": "src/Foo.ts", "symbol": "bar" }],
  "content": "## 实现方式\n…\n## 注意事项\n…\n## 红线规避\n…\n## 代码锚点\n…"
}
```

覆盖率：

```json
{ "project": "meta-brain", "topic": "问数" }
```

`quality_gate` → 按 `reasons` 补锚点/挂图/拆卡/深挖浅卡后重写，**不要**改成更短的总结。  
`coverage.complete=false` → **禁止**宣称完整。

## 质量边界（系统）

- 明细 + 一卡一事 + 架构锚点 + 增量必须挂图  
- 总览 related 子卡过半/全浅 → 拒写  
- Session 双闸门：`compileSessions` + `KMIND_COMPILE_SESSIONS=1`  
- lint：`coverage_*`（浅卡 / 重复总览 / 空总览）  
- 与 **kmind-code-bridge** 配合取符号，禁止整文件入库  
