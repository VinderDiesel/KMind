# KMind

**你的 AI 编程工具会忘记一切，KMind 不会。**

Local-first, AI-native knowledge compounding system.  
Unify Claude Code, Cursor, Qoder, Codex & Kiro sessions into a queryable knowledge graph via MCP.

[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple)](https://modelcontextprotocol.io)
[![GitHub Stars](https://img.shields.io/github/stars/VinderDiesel/KMind?style=social)](https://github.com/VinderDiesel/KMind)

---

## 问题：AI 编程工具正在制造「知识黑洞」

你花了两小时在 Claude Code 里解决了一个 PostgreSQL advisory lock 死锁问题。三周后，在 Cursor 中再次遇到类似场景，一切从零开始。

- **知识随会话消亡** — 每次 AI 编程会话都在产生知识，但绝大多数被丢弃。
- **知识孤岛** — Claude Code 的架构决策，Cursor 不知道；Codex 的踩坑记录，Qoder 无法访问。
- **数据主权缺失** — 多数方案将知识锁在云端，无法导出、无法审计。

**KMind 的答案：本地优先、多终端统一、AI 原生的知识复利系统。**

---

## 核心特性

| 特性 | 说明 |
|:---|:---|
| **多终端插件式接入** | Adapter 模式接入 Claude Code、Cursor、Qoder、Codex、Kiro，新增终端通常少于 200 行 |
| **会话自动捕获** | 从 AI 编程会话中提取知识候选，无需手动整理 |
| **七类知识资产** | 问题解决方案、最佳实践、架构设计、工具使用、踩坑记录、代码片段、流程规范 |
| **知识图谱 + 本体** | 实体 / 概念 / 关系自动提取，本体 Schema 可扩展、可演化 |
| **混合检索** | 全文 + 结构化 + 图谱遍历 + 语义向量，四路融合排序 |
| **数据本地化** | Markdown + SQLite，零云端依赖，可用 Git 做版本管理 |
| **快速迁移** | 一键导出 / 导入 `tar.gz` |
| **MCP 原生** | 作为 MCP Server 运行，支持 MCP 的 AI 工具即插即用 |

---

## 快速开始

### 环境要求

- Node.js **20+**
- [pnpm](https://pnpm.io) **9+**（本仓库使用 pnpm workspace）

### 从源码安装（当前推荐）

```bash
git clone https://github.com/VinderDiesel/KMind.git
cd KMind
pnpm install
pnpm build

# 初始化本地知识库（默认 ~/.kmind）
pnpm kmind init
```

后续可用 `pnpm kmind <command>`，或把 CLI 链入 PATH：

```bash
pnpm --filter @kmind/cli exec kmind --help
# 或：node packages/cli/dist/index.js --help
```

### 接入 AI 编程工具（MCP + Skills 一键装）

```bash
pnpm kmind adapters list

# 写入该终端的 MCP，并把 kmind-capture 等 Skills 装到 ~/.…/skills（全局，任意项目可用）
pnpm kmind adapters install cursor
pnpm kmind adapters install claude-code
pnpm kmind adapters install qoder
pnpm kmind adapters install codex
pnpm kmind adapters install kiro

# 或一次装到所有已支持终端
pnpm kmind skills install --all

# 仅装到当前仓库（便于团队 git 共享）
pnpm kmind skills install cursor --project
```

装完后**重启对应 AI 终端**（Claude Code 可用 `/reload-skills`）。规范 Skills 源在仓库 `skills/`；也可用社区工具 `npx skills add <repo>` 发现同目录。

### 启动 MCP Server

```bash
pnpm kmind mcp-serve
```

在 AI 工具的 MCP 配置中添加（按本机路径调整）：

```json
{
  "mcpServers": {
    "kmind": {
      "command": "node",
      "args": ["/absolute/path/to/KMind/packages/cli/dist/index.js", "mcp-serve"]
    }
  }
}
```

`adapters install` 会把当前 CLI 的绝对路径写入对应终端的 MCP 配置（`node …/packages/cli/dist/index.js mcp-serve`）；也可按上面手动配置。

### 开始使用

在 Claude Code / Cursor 等工具中直接对话，例如：

> 「搜索我之前关于 PostgreSQL 死锁的踩坑记录」  
> 「把这次架构决策沉淀到 KMind」  
> 「查找与 Redis 持久化相关的所有知识」

写入约定：先 `search` 判重，再 `capture`（带 `title` + `type` + 结构化正文）。Adapter 扫到的低置信会话只会留在 `raw/`（compile 显示 `gated`），不会自动升成知识资产。Skills 见 `skills/kmind-capture/`（`adapters install` / `skills install` 会复制到各终端）。

或用 CLI：

```bash
pnpm kmind capture "PostgreSQL advisory lock 死锁，改用 Redis 解决" --type pitfall --title "advisory lock 死锁"
pnpm kmind search "PostgreSQL 死锁"
pnpm kmind lint
```

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                   AI 编程终端层                              │
│  Claude Code │ Cursor │ Qoder │ Codex │ Kiro │ ...          │
└──────────────────────┬──────────────────────────────────────┘
                       │ MCP Protocol
┌──────────────────────┼──────────────────────────────────────┐
│                 KMind Core Engine                            │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │           MCP Server Layer (统一接口)               │     │
│  │  search │ capture │ related │ graph_query │ status  │     │
│  └────────────────────────┬───────────────────────────┘     │
│                           │                                  │
│  ┌────────────────────────┼───────────────────────────┐     │
│  │         Adapter Registry (插件式接入)               │     │
│  │  Claude │ Cursor │ Qoder │ Codex │ Kiro │ Custom   │     │
│  └────────────────────────┬───────────────────────────┘     │
│                           │                                  │
│  ┌────────────────────────┼───────────────────────────┐     │
│  │          知识编译管线 (Knowledge Compiler)          │     │
│  │  Capture → Classify → Ontology Map → Graph Build   │     │
│  └────────────────────────┬───────────────────────────┘     │
│                           │                                  │
│  ┌────────────────────────┼───────────────────────────┐     │
│  │             存储层 (Storage Layer)                  │     │
│  │  Markdown (Git-friendly) │ SQLite (rebuildable)    │     │
│  │  Ontology YAML (extensible)                        │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### 三层数据模型

| 层 | 职责 | 可变性 |
|:---|:---|:---|
| **Raw** | 原始会话记录、技术文章、PDF、代码快照 | 不可变事实基准 |
| **Knowledge** | AI 编译产物：知识资产页 + 实体/概念页 + 双向链接 | 可审核、可演化 |
| **Index** | SQLite FTS + 向量 + 图谱索引 | 可经 `kmind reindex` 重建 |

包结构：`cli` / `mcp-server` → `@kmind/core` → Vault（`~/.kmind`）；adapters 仅依赖公开接口。

更多说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## CLI 命令

全局选项：`--vault <path>`、`--json`。

| 命令 | 说明 |
|:---|:---|
| `kmind init` | 初始化 Vault |
| `kmind compile` | 将 raw 会话编译为知识资产 |
| `kmind search <query>` | 混合检索 |
| `kmind capture <content>` | 手动捕获知识 |
| `kmind lint` | 健康检查 |
| `kmind export --output <path>` | 导出 Vault（`tar.gz` / `git`） |
| `kmind import --input <path>` | 从归档导入 |
| `kmind reindex` | 从 Markdown 重建 SQLite 索引 |
| `kmind mcp-serve` | 启动 MCP Server（stdio） |
| `kmind ui` | 打开本地只读知识 UI（`127.0.0.1:7821`） |
| `kmind adapters list` | 列出适配器 |
| `kmind adapters install <name>` | 为指定终端写入 MCP 配置 |
| `kmind hook <event>` | 生命周期 Hook 入口 |

### 本地知识 UI（M5）

```bash
pnpm build
pnpm kmind ui
# 或指定焦点：pnpm kmind ui --focus k-2026-01-01-001
```

浏览器打开后先搜索资产，进入 **3D ego 邻域**（默认 hop=2，节点上限 150）；右侧 HUD 展示与焦点相关的健康告警。仅绑定 `127.0.0.1`，API 只读。

---

## 七类知识资产

| 资产类型 | 触发沉淀的时机 | 示例 |
|:---|:---|:---|
| **问题解决方案** | 解决棘手问题后 | PostgreSQL advisory lock 死锁，改用 Redis |
| **最佳实践** | 形成可复用约定后 | 异步任务必须设置超时与重试上限 |
| **架构设计** | 完成架构决策后 | 选择事件驱动而非请求-响应的理由 |
| **工具使用** | 工具配置/技巧沉淀后 | `.cursorrules` 中显式声明测试命令 |
| **踩坑记录** | 重复踩坑后 | MCP 工具在 Windows 下路径解析异常 |
| **代码片段** | 可复用实现出现后 | 带指数退避的重试装饰器 |
| **流程规范** | 团队流程固化后 | 提交前必须 lint + typecheck + 单测 |

每条资产可包含完整决策轨迹：问题 → 备选方案 → 决策 → 理由 → 权衡 → 结果。

---

## MCP 工具

| 工具 | 效果级别 | 说明 |
|:---|:---|:---|
| `kmind_search` | read | 混合检索知识库 |
| `kmind_related` | read | 按图谱查找关联知识 |
| `kmind_status` | read | Vault 健康状态 |
| `kmind_ontology_describe` | read | 描述本体结构 |
| `kmind_capture` | write | 手动捕获知识 |
| `kmind_graph_query` | sensitive | 类 Cypher 图谱查询 |
| `kmind_export` | sensitive | 导出知识库 |

详见 [docs/MCP_TOOLS.md](docs/MCP_TOOLS.md)。

---

## 数据存储

默认路径 `~/.kmind/`，完全本地、Git 友好：

```
~/.kmind/
├── knowledge/          # 知识资产（Markdown，源真相）
│   ├── projects/
│   └── global/
├── raw/                # 原始会话（不可变）
├── ontology/
│   └── ontology.yaml
├── index/              # SQLite 索引（可重建）
└── config.yaml
```

迁移：

```bash
pnpm kmind export --output backup.tar.gz
pnpm kmind import --input backup.tar.gz
```

---

## Monorepo 包

| 包 | 说明 |
|:---|:---|
| `@kmind/cli` | 命令行入口 |
| `@kmind/core` | 存储 / 本体 / 编译 / 检索 / 健康检查 |
| `@kmind/mcp-server` | MCP Server |
| `@kmind/shared` | 共享类型与工具 |
| `@kmind/adapter-*` | Claude Code / Cursor / Qoder / Codex / Kiro |
| `@kmind/ui` | 本地只读 Web UI（图谱 + 健康） |

---

## 适配器开发

实现 `Adapter` 接口即可接入新终端：

```typescript
export class MyAdapter implements Adapter {
  name = 'my-terminal';
  version = '1.0.0';

  async detect(): Promise<boolean> { /* ... */ }
  async getSessionPaths(): Promise<string[]> { /* ... */ }
  async parseSession(path: string): Promise<SessionRecord> { /* ... */ }
  getMcpConfig(): McpConfigTemplate { /* ... */ }
}
```

详见 [docs/ADAPTER_GUIDE.md](docs/ADAPTER_GUIDE.md)。

---

## 开发

```bash
git clone https://github.com/VinderDiesel/KMind.git
cd KMind
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

技术栈：TypeScript · Node.js 20+ · pnpm monorepo · SQLite（`node:sqlite`）· MCP SDK · Zod · Vitest

相关文档：

- [架构说明](docs/ARCHITECTURE.md)
- [数据契约](docs/DATA_CONTRACTS.md)
- [适配器指南](docs/ADAPTER_GUIDE.md)
- [MCP 工具](docs/MCP_TOOLS.md)
- [贡献指南](CONTRIBUTING.md)

---

## Roadmap

- [x] M1：核心引擎（存储 + 本体 + 图谱 + MCP Server）
- [x] M2：首个适配器（Claude Code）+ 自动捕获 + 七类分类
- [x] M3：多终端适配器（Cursor / Qoder / Codex / Kiro）+ Registry
- [ ] M4：导出/导入增强 + Git 集成 + 多实例联邦
- [ ] M5：知识健康可视化 + 图谱可视化 + v1.0 发布（进行中：`kmind ui` 本地 3D ego + 健康 HUD）

---

## 贡献

欢迎 Issue、Discussion 与 PR。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并确保 `pnpm test && pnpm typecheck` 通过。

- Bug：[Issues](https://github.com/VinderDiesel/KMind/issues)
- 讨论：[Discussions](https://github.com/VinderDiesel/KMind/discussions)

---

## 许可证

[Apache-2.0](LICENSE)

---

如果 KMind 对你有帮助，欢迎点一个 Star，让更多开发者告别知识黑洞。
