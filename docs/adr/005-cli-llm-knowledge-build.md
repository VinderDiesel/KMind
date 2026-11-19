# ADR-005: 命令行 LLM 配置与端到端知识构建（`bootstrap run --write`）

- **状态**：Accepted
- **日期**：2026-11-19
- **决策者**：产品需求（CLI 可配置 provider/model + 一键扫描写入）+ 工程共识
- **关联**：[ADR-004 知识初始化混合架构](004-knowledge-bootstrap-hybrid.md)、[ADR-001 资产类型注册表](001-asset-type-registry.md)、[ADR-002 智能飞轮](002-intelligence-flywheel.md)

## 背景

ADR-004 把知识初始化拆成「工程确定性盘点 × Agent 深挖」，并明确 **bootstrap 不生成知识正文、不自动 capture**。原因是避免无证据灌库与假完工。

实际使用中仍有两个高频缺口：

1. 用户只有 CLI 环境（无宿主 Agent / 无 MCP），无法完成「扫描 → 写卡 → 入库」闭环；
2. LLM 只支持本地 Ollama 风格配置（`bootstrap.llm`），无法使用 OpenAI 兼容网关、Anthropic、Azure OpenAI。

因此需要一个**显式 opt-in** 的端到端入口：命令行配置 provider/model，按 DigPlan 逐任务调用 LLM 生成证据卡片，逐卡过既有质量闸门后写入知识库。

## 决策

### 1. 顶层 `llm` 配置（provider + model）

`config.yaml` 新增顶层块（Zod：`LlmConfigSchema`，`packages/shared`）：

```yaml
llm:
  provider: ollama        # ollama | openai | openai-compatible | anthropic | azure-openai
  model: ''               # 空 = 未配置（禁用自动写卡）
  baseUrl: ''             # 空 = provider 默认；openai-compatible / azure-openai 必填
  apiKeyEnv: KMIND_LLM_API_KEY
  azureApiVersion: 2024-10-21
  azureDeployment: ''
  jsonMode: true          # 是否发 response_format=json_object
  temperature: 0.2
  maxTokens: 2048
  timeoutMs: 120000
  maxInputChars: 24000
```

- **Provider 默认 baseUrl**：`ollama=http://127.0.0.1:11434`、`openai=https://api.openai.com/v1`、`anthropic=https://api.anthropic.com`、`openai-compatible` / `azure-openai` 必填。
- **自定义 OpenAI 格式网关**：`provider=openai-compatible` + `--base-url`，endpoint 拼 `<base>/chat/completions`（若 baseUrl 已是完整 `…/chat/completions` 则原样使用），请求/响应体与 `openai` 一致，Authorization 为 Bearer。
- **API Key 只从环境变量读取**：配置只保存变量名 `apiKeyEnv`，密钥永不落盘、永不回显。
- **Key 可选性**：`ollama` 与 `openai-compatible` 允许无 key（本地/内网网关免鉴权）；有 key 时自动带 Bearer。
- **Key 回退链**：`apiKeyEnv` → provider 默认变量（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `AZURE_OPENAI_API_KEY`）。
- **兼容旧配置**：顶层 `llm.model` 为空且 `bootstrap.llm.model` 存在时，回退 legacy（provider=ollama、endpoint/timeout 取旧值），`source=legacy-bootstrap`。
- **JSON 模式开关**：`llm.jsonMode`（默认 true）控制是否发送 `response_format: {type:'json_object'}`；不支持该字段的网关用 `kmind llm set --json-mode false` 关闭，解析层仍能从代码围栏中提取 JSON。
- CLI：`kmind llm status|set|test`；三者均支持 `--provider/--model/--base-url/--api-key-env` 一次性覆盖，`set/test/status` 支持 `--json-mode`。
- **交互式引导**（对齐 `ocr config provider/model`）：`kmind llm provider` 逐项询问 provider → base URL（provider 有默认值则用默认，否则必填）→ key 环境变量名 → （`openai-compatible`）是否需要 key / 是否支持 `response_format` → 是否立即选 model；`kmind llm model` 先按 provider 拉取 `/models` 列表（Ollama 为 `/api/tags`，Azure 无列表接口），失败或为空时回退为手输。`kmind llm set` 无参数 + TTY 时等价于 `llm provider` 引导。
- **交互式边界**：向导只在 stdin/stdout 均为 TTY 时可用；`--json` 或非 TTY 直接报 `CONFIG_ERROR` 并提示改用非交互 flags。向导与非交互 set 共用同一份 `persistLlmSettings` 校验（URL 协议、openai-compatible 缺 baseUrl fail-fast、jsonMode 解析），不存在第二套规则。
- **模型列表最佳努力**：拉取失败绝不阻断，向用户展示 warning 后回退手输，避免自建网关未实现 `/models` 时流程卡死。

### 2. 客户端抽象

`packages/core/src/llm/`：

| 文件 | 职责 |
|---|---|
| `types.ts` | `LlmClient` / `ResolvedLlmConfig` / `LlmOverrides` |
| `resolve.ts` | 配置解析、默认值、密钥查找、`describeLlmConfig`（不抛错、不泄密） |
| `client.ts` | 四类协议（Ollama / OpenAI 格式含自定义网关 / Anthropic / Azure）的 endpoint/headers/body/extract 分派；统一 `KMindError(ADAPTER_ERROR)`，429/5xx 可重试 |
| `models.ts` | 模型列表探测：endpoint 推导、响应提取（`data[].id` / `models[].name`）、失败降级为 warning |

bootstrap 规划（分组 / planNotes）改为通过 `ProviderBootstrapLlm` 复用同一客户端；未配置或失败时回退启发式（保持 ADR-004 行为）。

### 3. 端到端构建流水线（ADR-005 唯一入口）

`kmind bootstrap run --write`（`--dry-run` 仅演练不落盘）：

```text
vault 文件补齐 → reindex → BootstrapPlan（DigGroup/DigTask）
  → 逐任务 evidence 扫描（有界字符预算、跳过 tests/dist/node_modules）
  → LLM 生成卡片 JSON（Zod 校验、一卡一事、锚点限定证据文件）
  → 类型启用过滤 / 低置信过滤（默认 <0.55 跳过）/ 重复标题过滤
  → 质量闸门（与 kmind capture 同一 assessCaptureQuality）
      ├─ 失败 → 一次 LLM repair → 再判；仍失败则跳过并记录 reasons
      └─ 通过 → raw JSONL → compile incremental → 资产 id
  → mark DigTask done（audit/bootstrap-progress.json）
  → 收尾生成确定性总览 hub（related = 全部明细，best_practice，薄卡）
  → FEATURE_TREE 同步 → coverage 回执 → build 报告
```

- `packages/core/src/knowledge-build/`：`scanner` / `prompts` / `parse` / `digger` / `capture` / `pipeline`。
- 增量挂图：首卡可无 related；同任务后续卡与后续任务自动 `related` 到已有 hub 或首张卡，满足增量写入门禁。
- 失败隔离：单卡/单任务失败只记入报告（`cards[].reasons`），不中断整批；鉴权类致命错误（不可重试 ADAPTER_ERROR）直接抛出。
- 报告：`stats`（tasks/cards、rejected）+ `assetIds` + `hub` + 逐卡状态，JSON 与人类可读双输出。

### 4. 与 ADR-004 的关系

- **默认行为不变**：不带 `--write` 时 `kmind bootstrap run` 仍只出计划/树/coverage，不写正文。
- ADR-004 的「不自动 capture」红线在 ADR-005 中改为**显式 opt-in + 同一质量闸门 + 可审计报告**，而非静默自动灌库。
- 「DigPlan ≠ complete」不变：`complete` 仍只由 `kmind coverage` 判定；本命令只负责写入明细卡与总览。

## 后果

**正向**

- CLI 单机即可完成「配置 → 扫描 → 写卡 → 总览 → coverage」闭环。
- 质量闸门、类型注册表、增量挂图、coverage 语义全部复用，未新增第二套标准。
- 密钥不落盘；`llm status/test` 可先验连通性再跑全量。
- 任意 OpenAI 格式网关（自建/第三方/本地）只需 `--base-url`，不需要改代码。

**代价与限制**

- LLM 输出仍需人工/后续 coverage 复核；低置信与闸门拒绝卡片会被跳过。
- 大仓库需按 `--group` / `--max-tasks` 分批，避免一次性 token 成本。
- 总览为确定性薄卡（不做 LLM 汇总），细节以明细卡为准。

## 明确不做

- 不再支持任意自定义 provider 协议（只做 Ollama / OpenAI 格式 / Anthropic / Azure 四类协议适配；自定义端点走 `openai-compatible`）。
- 不在 `compile` / MCP 读路径隐式触发 LLM 写卡。
- 不因本命令存在而放宽质量闸门或 coverage `complete` 判定。
- 不把 API Key 写入 `config.yaml`、日志或报告。
