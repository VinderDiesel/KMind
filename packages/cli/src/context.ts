import {
  createVault,
  SqliteStore,
  OntologyRegistry,
  OntologyEvolver,
  loadOntology,
  createAssetTypeRegistry,
  type AssetTypeRegistry,
  type Vault,
  type Adapter,
} from '@kmind/core';
import { ClaudeCodeAdapter } from '@kmind/adapter-claude-code';
import { CursorAdapter } from '@kmind/adapter-cursor';
import { QoderAdapter } from '@kmind/adapter-qoder';
import { CodexAdapter } from '@kmind/adapter-codex';
import { KiroAdapter } from '@kmind/adapter-kiro';
import { KMindError } from '@kmind/shared';

export interface AppContext {
  vault: Vault;
  store: SqliteStore;
  registry: OntologyRegistry;
  evolver: OntologyEvolver;
  assetTypes: AssetTypeRegistry;
  adapters: Adapter[];
  json: boolean;
}

/**
 * Resolve vault and open sqlite; throws CONFIG_ERROR if missing unless allowMissing.
 */
export async function resolveContext(options: {
  vault?: string;
  json?: boolean;
  allowMissing?: boolean;
}): Promise<AppContext> {
  const vault = createVault(options.vault);
  const exists = await vault.exists();
  if (!exists && !options.allowMissing) {
    throw new KMindError('Vault not initialized', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: 'Run `kmind init` to create the vault first',
    });
  }
  if (!exists && options.allowMissing) {
    await vault.init();
  }
  const store = new SqliteStore(vault.indexPath);
  await store.migrate();
  const registry = new OntologyRegistry();
  registry.load(await loadOntology(vault.ontologyDir));
  const evolver = new OntologyEvolver(vault.ontologyDir, registry);
  const assetTypes = await createAssetTypeRegistry(vault.assetTypesDir);
  const adapters: Adapter[] = [
    new ClaudeCodeAdapter(),
    new CursorAdapter(),
    new QoderAdapter(),
    new CodexAdapter(),
    new KiroAdapter(),
  ];
  return {
    vault,
    store,
    registry,
    evolver,
    assetTypes,
    adapters,
    json: options.json ?? false,
  };
}
