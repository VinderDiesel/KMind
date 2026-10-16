---
name: kmind-capture
description: >-
  Capture high-quality knowledge into the local KMind vault via MCP or CLI.
  Use when the user asks to 沉淀 / 记到 KMind / capture knowledge / 写入知识库,
  or after a confirmed decision, pitfall, architecture choice, or reusable practice.
---

# KMind 高质量写入

只沉淀可复利结论；整段会话留在 raw，不直接升知识。

## 何时写入

满足任一才调用 `kmind_capture` / `kmind capture`：

- 决策已闭合（问题 → 方案 → 取舍/结果）
- 可复用（换终端仍有用）
- 用户明确要求沉淀

禁止：未验证猜测、一次性调试输出、整段 chat 原文。

## 流程（必须按序）

1. **检索判重**：`kmind_search`（必要时再 `kmind_related`）
   - 已有同主题 → 说明差异；更新语义用新条目并在正文点名旧标题/id（后续可挂 `supersedes`）
   - 无冲突 → 继续
2. **定类型**（七选一）：
   - `architecture_design` · `pitfall` · `best_practice` · `tool_usage`
   - `problem_solution` · `code_snippet` · `process_spec`
3. **写结构化正文**后调用 capture，必带 `title`、`type`、`project`

## 正文模板

```markdown
## 问题
…

## 决策 / 方案
…

## 取舍
…

## 结果 / 验证
…

## 适用边界
…
```

## 调用示例

MCP：

```json
{
  "title": "advisory lock 死锁改用 Redis",
  "type": "pitfall",
  "project": "kmind",
  "content": "## 问题\n…\n## 决策 / 方案\n…\n## 取舍\n…\n## 结果 / 验证\n…\n## 适用边界\n…"
}
```

CLI：

```bash
pnpm kmind capture "…" --title "…" --type pitfall --project kmind
```

## 质量边界（系统侧）

- 带 `type` 的 manual capture 会绕过 compile 置信度闸门
- Adapter 扫到的低置信 raw **不会**自动成资产（`gated`，保持 pending）
- 写入后可用 `kmind_status` / `kmind lint` / UI Focus health 抽查
