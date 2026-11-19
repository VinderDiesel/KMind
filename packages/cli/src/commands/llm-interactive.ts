import {
  describeLlmConfig,
  listLlmModels,
  resolveLlmConfigOptional,
  type LlmConfigStatus,
  type LlmModelListParams,
  type LlmModelListResult,
} from '@kmind/core';
import { KMindError, type LlmProvider } from '@kmind/shared';
import type { AppContext } from '../context.js';
import { fail } from '../exit.js';
import {
  isInteractive,
  promptConfirm,
  promptSelect,
  promptText,
  type SelectChoice,
} from '../prompt/interactive.js';
import {
  persistLlmSettings,
  type LlmSetOptions,
} from './llm-settings.js';

interface ProviderMeta {
  value: LlmProvider;
  label: string;
  hint: string;
  /** Provider default when it has one ('' → must be asked). */
  defaultBaseUrl: string;
  requiresBaseUrl: boolean;
  requiresKey: boolean;
  keyEnv: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    value: 'ollama',
    label: 'ollama',
    hint: '本地 Ollama（免 key）',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    requiresBaseUrl: false,
    requiresKey: false,
    keyEnv: '',
  },
  {
    value: 'openai',
    label: 'openai',
    hint: 'OpenAI 官方 api.openai.com',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresBaseUrl: false,
    requiresKey: true,
    keyEnv: 'OPENAI_API_KEY',
  },
  {
    value: 'openai-compatible',
    label: 'openai-compatible',
    hint: '任意 OpenAI 格式网关（DeepSeek/Qwen/vLLM/LiteLLM/LM Studio…）',
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    requiresKey: false,
    keyEnv: 'KMIND_LLM_API_KEY',
  },
  {
    value: 'anthropic',
    label: 'anthropic',
    hint: 'Anthropic Claude API',
    defaultBaseUrl: 'https://api.anthropic.com',
    requiresBaseUrl: false,
    requiresKey: true,
    keyEnv: 'ANTHROPIC_API_KEY',
  },
  {
    value: 'azure-openai',
    label: 'azure-openai',
    hint: 'Azure OpenAI（需 deployment）',
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    requiresKey: true,
    keyEnv: 'AZURE_OPENAI_API_KEY',
  },
];

/** Injectable prompt layer so wizards are testable without a TTY. */
export interface LlmPrompter {
  select<T>(
    message: string,
    choices: SelectChoice<T>[],
    options?: { initialIndex?: number },
  ): Promise<T | null>;
  text(
    message: string,
    options?: {
      defaultValue?: string;
      placeholder?: string;
      validate?: (value: string) => string | null;
    },
  ): Promise<string | null>;
  confirm(message: string, options?: { defaultValue?: boolean }): Promise<boolean>;
}

/** Real TTY prompter (arrow keys + readline). */
export const defaultLlmPrompter: LlmPrompter = {
  select: (message, choices, options) => promptSelect(message, choices, options),
  text: (message, options) => promptText(message, options),
  confirm: (message, options) => promptConfirm(message, options),
};

const MANUAL_MODEL = '__manual__';

/**
 * `kmind llm provider` — guided provider setup (mirrors `ocr config provider`).
 */
export async function cmdLlmProviderInteractive(
  ctx: AppContext,
  prompter: LlmPrompter = defaultLlmPrompter,
): Promise<void> {
  try {
    assertInteractive(ctx, prompter);
    await runProviderStep(ctx, prompter, { askModel: true });
  } catch (err) {
    fail(err, ctx.json);
  }
}

/**
 * `kmind llm model` — guided model picker with live listing
 * (mirrors `ocr config model`).
 */
export async function cmdLlmModelInteractive(
  ctx: AppContext,
  prompter: LlmPrompter = defaultLlmPrompter,
  listModels: (
    params: LlmModelListParams,
  ) => Promise<LlmModelListResult> = listLlmModels,
): Promise<void> {
  try {
    assertInteractive(ctx, prompter);
    await runModelStep(ctx, prompter, listModels);
  } catch (err) {
    fail(err, ctx.json);
  }
}

/**
 * `kmind llm set` with no flags on a TTY — provider then model.
 */
export async function cmdLlmSetupInteractive(
  ctx: AppContext,
  prompter: LlmPrompter = defaultLlmPrompter,
): Promise<void> {
  await runProviderStep(ctx, prompter, { askModel: true });
}

async function runProviderStep(
  ctx: AppContext,
  prompter: LlmPrompter,
  options: { askModel: boolean },
): Promise<void> {
  const config = await ctx.vault.getConfig();
  const status = describeLlmConfig(config);
  say('');
  say(`[kmind] 当前：provider=${status.provider} model=${status.model || '(unset)'}`);
  say(
    `[kmind] baseUrl=${status.baseUrl || '(unset)'} apiKeyEnv=${status.apiKeyEnv} present=${status.apiKeyPresent}`,
  );

  const initialIndex = Math.max(
    0,
    PROVIDERS.findIndex((item) => item.value === status.provider),
  );
  const provider = await prompter.select<LlmProvider>(
    '选择 LLM provider',
    PROVIDERS.map((item) => ({
      value: item.value,
      label: item.label,
      hint: item.hint,
    })),
    { initialIndex },
  );
  if (!provider) return cancelled('provider 配置已取消');

  const meta = PROVIDERS.find((item) => item.value === provider);
  if (!meta) return cancelled('provider 配置已取消');
  const switching = provider !== status.provider;
  const next: LlmSetOptions = { provider };

  // 1) Endpoint
  if (meta.requiresBaseUrl) {
    const current =
      !switching && status.baseUrl ? status.baseUrl : meta.defaultBaseUrl;
    const answer = await prompter.text(
      provider === 'azure-openai'
        ? 'Azure 资源地址（https://<resource>.openai.azure.com）'
        : '网关 base URL（可含 /v1，或完整 …/chat/completions）',
      {
        defaultValue: current,
        placeholder: 'https://gateway.example.com/v1',
        validate: validateUrl,
      },
    );
    if (answer === null) return cancelled('provider 配置已取消');
    next.baseUrl = answer;
  } else {
    // Reset so a stale custom endpoint never leaks into the new provider.
    next.baseUrl = '';
  }

  // 2) API key env (never the key itself)
  if (meta.requiresKey) {
    const answer = await prompter.text('API Key 所在环境变量名（密钥不会写入配置）', {
      defaultValue:
        !switching && status.apiKeyEnv ? status.apiKeyEnv : meta.keyEnv,
      validate: validateEnvName,
    });
    if (answer === null) return cancelled('provider 配置已取消');
    next.apiKeyEnv = answer;
  } else if (provider === 'openai-compatible') {
    const needsKey = await prompter.confirm(
      '该网关需要 API Key 吗？（本地 vLLM / LM Studio 通常不需要）',
      { defaultValue: status.apiKeyPresent },
    );
    if (needsKey) {
      const answer = await prompter.text('API Key 所在环境变量名', {
        defaultValue: meta.keyEnv,
        validate: validateEnvName,
      });
      if (answer === null) return cancelled('provider 配置已取消');
      next.apiKeyEnv = answer;
    }
  }

  // 3) Azure deployment
  if (provider === 'azure-openai') {
    const deployment = await prompter.text(
      'Azure deployment 名（留空 = 与 model 相同）',
      { defaultValue: !switching ? status.azureDeployment ?? '' : '' },
    );
    if (deployment === null) return cancelled('provider 配置已取消');
    next.azureDeployment = deployment;
  }

  // 4) JSON mode for custom gateways
  if (provider === 'openai-compatible') {
    const jsonMode = await prompter.confirm(
      '网关支持 response_format=json_object 吗？（不支持时选 n）',
      { defaultValue: true },
    );
    next.jsonMode = jsonMode ? 'true' : 'false';
  }

  const result = await persistLlmSettings(ctx, next);
  say('');
  say(`[kmind] provider 已保存 → ${result.path}`);
  say(
    `[kmind] provider=${result.status.provider} baseUrl=${result.status.baseUrl || '(default)'} ` +
      `apiKeyEnv=${result.status.apiKeyEnv} present=${result.status.apiKeyPresent}`,
  );
  if (!result.status.apiKeyPresent && meta.requiresKey) {
    say(
      `[kmind] 下一步：export ${result.status.apiKeyEnv}=<key> 后再跑 kmind llm model / test`,
    );
  }

  if (options.askModel) {
    const wantModel = await prompter.confirm('现在选择 model？', {
      defaultValue: true,
    });
    if (wantModel) {
      await runModelStep(ctx, prompter);
      return;
    }
    say('[kmind] 稍后可运行：kmind llm model');
  }
}

async function runModelStep(
  ctx: AppContext,
  prompter: LlmPrompter,
  listModels: (
    params: LlmModelListParams,
  ) => Promise<LlmModelListResult> = listLlmModels,
): Promise<void> {
  let status: LlmConfigStatus;
  try {
    status = await requireUsableProvider(ctx);
  } catch (err) {
    fail(err, ctx.json);
  }

  say('');
  say(
    `[kmind] 正在读取 ${status.provider} 的模型列表：${status.baseUrl}`,
  );
  // `model` is what we are choosing, so probe with a placeholder to resolve the key.
  const probe = resolveLlmConfigOptional(await ctx.vault.getConfig(), {
    model: status.model || 'model-probe',
  });
  const listed = await listModels({
    provider: status.provider,
    baseUrl: status.baseUrl,
    ...(probe?.apiKey ? { apiKey: probe.apiKey } : {}),
    timeoutMs: 8_000,
  });
  if (listed.warning) say(`[kmind] ${listed.warning}`);

  let model: string | null = null;
  if (listed.models.length > 0) {
    const choices: SelectChoice<string>[] = [
      ...listed.models.map((id) => ({ value: id, label: id })),
      { value: MANUAL_MODEL, label: '✎ 手动输入 model…', hint: '列表里没有想要的模型' },
    ];
    const currentIndex = listed.models.indexOf(status.model);
    const picked = await prompter.select('选择 model', choices, {
      initialIndex: currentIndex >= 0 ? currentIndex : 0,
    });
    if (picked === null) return cancelled('model 配置已取消');
    if (picked !== MANUAL_MODEL) model = picked;
  }

  if (model === null) {
    model = await prompter.text('输入 model id', {
      defaultValue: status.model,
      placeholder: 'gpt-4o-mini / deepseek-chat / qwen2.5-coder:14b',
      validate: (value) => (value.trim() ? null : 'model 不能为空'),
    });
    if (model === null) return cancelled('model 配置已取消');
  }

  const result = await persistLlmSettings(ctx, { model });
  say('');
  say(`[kmind] model 已保存 → ${result.path}`);
  say(`[kmind] provider=${result.status.provider} model=${result.status.model}`);
  say('[kmind] 下一步：kmind llm test 验证连通性');
}

/**
 * Ensure provider/baseUrl are configured; otherwise run the provider wizard.
 */
async function requireUsableProvider(ctx: AppContext): Promise<LlmConfigStatus> {
  const config = await ctx.vault.getConfig();
  const status = describeLlmConfig(config);
  if (status.baseUrl) return status;
  throw new KMindError('provider 尚未配置 base URL', {
    category: 'CONFIG_ERROR',
    severity: 'medium',
    retryable: true,
    suggestion: '先运行 `kmind llm provider`（或 kmind llm set --base-url <url>）',
  });
}

function assertNotJson(ctx: AppContext): void {
  if (ctx.json) {
    throw new KMindError('交互式配置不支持 --json', {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: true,
      suggestion:
        '去掉 --json，或使用非交互形式 `kmind llm set --provider <p> --model <m>`',
    });
  }
}

/** Interactive wizards need a TTY; injected prompters (tests) bypass the check. */
function assertInteractive(ctx: AppContext, prompter: LlmPrompter): void {
  assertNotJson(ctx);
  if (prompter !== defaultLlmPrompter || isInteractive()) return;
  throw new KMindError('当前不是交互式终端（stdin/stdout 非 TTY）', {
    category: 'CONFIG_ERROR',
    severity: 'medium',
    retryable: true,
    suggestion:
      '非交互：`kmind llm set --provider <p> --model <m>`；' +
      '或在终端里直接运行 `kmind llm provider` / `kmind llm model`',
  });
}

function validateUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return 'base URL 不能为空';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '只支持 http/https';
    }
    return null;
  } catch {
    return '不是合法 URL（示例：https://gateway.example.com/v1）';
  }
}

function validateEnvName(value: string): string | null {
  const raw = value.trim();
  if (!raw) return '环境变量名不能为空';
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)
    ? null
    : '环境变量名只能包含字母、数字和下划线';
}

function cancelled(message: string): void {
  say(`[kmind] ${message}`);
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}
