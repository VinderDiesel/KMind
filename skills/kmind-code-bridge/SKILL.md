---
name: kmind-code-bridge
description: >-
  Routes between KMind (decisions/pitfalls) and Codegraph (code structure).
  Use when the user asks how code works, who calls what, blast radius / impact,
  past decisions or 踩坑, or when capturing architecture/code knowledge that
  should cite symbols. Triggers: codegraph, 调用链, 影响面, 怎么实现, 以前怎么定,
  kmind + 代码, 符号锚点.
---

# KMind ↔ Codegraph 桥接

两套本地图，**不要混用**：

| 问法 | 用 | 工具 |
|:---|:---|:---|
| 怎么实现 / 谁调用 / 改了会炸哪 / 某符号在哪 | **Codegraph** | `codegraph_explore` |
| 以前怎么定 / 有没有坑 / 最佳实践 / 搜知识 | **KMind** | `kmind_search`（必要时 `kmind_related`） |
| 沉淀决策且涉及代码 | 先 KMind 判重，可选 Codegraph 取锚点，再 capture | 见下方 |

无 `.codegraph/` 时：结构问题改用 Read/Grep；KMind 照常可用。不要替用户跑 `codegraph init`，可提示一句。

## 结构问题（Codegraph）

1. 调用 `codegraph_explore`：`query` 用符号/文件名或短问句；**必须**传 `projectPath`（仓库绝对路径）。
2. 返回的带行号源码视为已 Read，**不要**再对同一文件整页 Read。
3. 需要影响面时，explore 结果里的 blast-radius 已够用；勿为同一问题再开一串 grep。

## 经验问题（KMind）

1. `kmind_search`（可加 `type` / `project`）。
2. 命中后需要邻域 → `kmind_related`。
3. 不要把会话全文当答案；优先引用资产结论。

## 沉淀（双图协作）

在 `kmind-capture` 流程上增加可选锚点：

1. `kmind_search` 判重（同 kmind-capture）。
2. 若决策绑定具体实现：对相关符号跑一次 `codegraph_explore`（有索引才做）。
3. `kmind_capture` 正文在模板末尾追加 **代码锚点**（勿粘贴大段源码）：

```markdown
## 代码锚点
- `packages/core/src/compiler/pipeline.ts` · `createPipeline` · function
- `packages/cli/src/commands/capture.ts` · `cmdCapture` · function
```

4. 仍必带 `title`、`type`、`project`；叙事规则见 **kmind-capture**。

## 并行

用户同时问「现在代码怎样 + 以前怎么定」时：可并行 `codegraph_explore` + `kmind_search`，回答里分「实现」与「决策/坑」两块。
