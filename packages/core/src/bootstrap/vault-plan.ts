import type { BootstrapPlan, KnowledgeAsset } from '@kmind/shared';
import type { Vault } from '../storage/vault.js';
import type { SqliteStore } from '../storage/sqlite-store.js';
import { createCliCodegraphClient } from '../codegraph/cli-client.js';
import { inferCodeRootFromVault } from '../query/anchor-fs.js';
import { OllamaBootstrapLlm } from './llm.js';
import { buildBootstrapPlan } from './plan.js';
import { loadBootstrapProgress } from './progress.js';
import { loadBootstrapRules } from './rules.js';

export interface VaultBootstrapPlanOptions {
  project: string;
  repoRoot?: string;
  existingAssets?: KnowledgeAsset[];
}

/**
 * Build BootstrapPlan using vault config + progress + optional Codegraph/LLM.
 */
export async function buildBootstrapPlanForVault(
  vault: Vault,
  store: SqliteStore,
  options: VaultBootstrapPlanOptions,
): Promise<BootstrapPlan> {
  const config = await vault.getConfig();
  const boot = config.bootstrap;
  const repoRoot =
    options.repoRoot?.trim() || inferCodeRootFromVault(vault.root);
  const project = options.project.trim();
  const existingAssets =
    options.existingAssets ??
    (await store.queryAssets({ project, limit: 100_000 }));
  const overlayRules = await loadBootstrapRules(vault.root, boot.rulesPath);
  const progress = await loadBootstrapProgress(vault, project);

  const codegraph = config.codegraph.enabled
    ? createCliCodegraphClient({
        command: config.codegraph.command,
        timeoutMs: config.codegraph.timeoutMs,
      })
    : undefined;

  const llm =
    boot.llmGrouping || boot.llmPlan
      ? new OllamaBootstrapLlm({
          endpoint: boot.llm.endpoint,
          model: boot.llm.model,
          timeoutMs: boot.llm.timeoutMs,
        })
      : undefined;

  return buildBootstrapPlan({
    project,
    repoRoot,
    existingAssets,
    overlayRules,
    progress,
    codegraph,
    llm,
    llmGrouping: boot.llmGrouping,
    llmPlan: boot.llmPlan,
    planPriorityThreshold: boot.planPriorityThreshold,
  });
}
