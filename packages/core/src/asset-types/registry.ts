import {
  isKernelAssetType,
  type AssetTypeDef,
  type KnowledgeType,
  KMindError,
  typeIdToOntologyClass,
} from '@kmind/shared';
import { loadAssetTypes } from './loader.js';

export interface AssetTypeListItem {
  id: string;
  enabled: boolean;
  kernel: boolean;
  label?: string;
  scaffold: string;
  guidance: string;
  requiredSections: string[];
  rules: AssetTypeDef['rules'];
  classifyPatterns: string[];
  ontologyClass: string;
  legacyProfile?: AssetTypeDef['legacyProfile'];
}

/**
 * In-memory registry of asset types (builtin ∪ vault). ADR-001.
 */
export class AssetTypeRegistry {
  private types = new Map<string, AssetTypeDef>();

  /**
   * Replace registry contents from a preloaded map.
   */
  load(map: Map<string, AssetTypeDef>): void {
    this.types = new Map(map);
  }

  /**
   * Load builtins and optional vault overlays.
   */
  async loadFromDisk(assetTypesDir?: string): Promise<void> {
    this.types = await loadAssetTypes(assetTypesDir);
  }

  /**
   * Get type def by id (including disabled).
   */
  get(id: string): AssetTypeDef | undefined {
    return this.types.get(id);
  }

  /**
   * All types (enabled and disabled).
   */
  getAll(): AssetTypeDef[] {
    return [...this.types.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Enabled types only (for capture / MCP list).
   */
  listEnabled(): AssetTypeDef[] {
    return this.getAll().filter((t) => t.enabled);
  }

  /**
   * MCP-friendly projection of enabled types.
   */
  describeEnabled(): AssetTypeListItem[] {
    return this.listEnabled().map((t) => this.toListItem(t));
  }

  /**
   * MCP-friendly projection of all types (incl. disabled).
   */
  describeAll(): AssetTypeListItem[] {
    return this.getAll().map((t) => this.toListItem(t));
  }

  /**
   * Whether id is known (enabled or not).
   */
  has(id: string): boolean {
    return this.types.has(id);
  }

  /**
   * True if type may be used for new capture.
   */
  isCapturable(id: string): boolean {
    const def = this.types.get(id);
    return Boolean(def?.enabled);
  }

  /**
   * Validate type for capture; throws CONFIG_ERROR / VALIDATION style errors.
   */
  assertCapturable(id: string): AssetTypeDef {
    const idTrim = id.trim();
    const def = this.types.get(idTrim);
    if (!def) {
      throw new KMindError(`Unknown asset type: ${idTrim}`, {
        category: 'CAPTURE_ERROR',
        severity: 'high',
        retryable: false,
        suggestion:
          'Call kmind_asset_types for enabled ids, or add vault/asset-types/*.yaml',
      });
    }
    if (!def.enabled) {
      throw new KMindError(`Asset type disabled: ${idTrim}`, {
        category: 'CAPTURE_ERROR',
        severity: 'high',
        retryable: false,
        suggestion:
          'Re-enable in vault/asset-types or pick another type; existing cards remain readable',
      });
    }
    return def;
  }

  /**
   * Resolve ontology class for a type id (ADR-001: ontologyClass ≈ type mapping).
   */
  ontologyClassFor(type: KnowledgeType): string {
    const def = this.types.get(type);
    return def?.ontologyClass ?? typeIdToOntologyClass(type);
  }

  /**
   * Classify rules for HeuristicClassifier (enabled types with patterns).
   */
  getClassifyRules(): Array<{
    type: KnowledgeType;
    patterns: RegExp[];
    tags: string[];
  }> {
    const rules: Array<{
      type: KnowledgeType;
      patterns: RegExp[];
      tags: string[];
    }> = [];
    for (const def of this.listEnabled()) {
      if (def.classifyPatterns.length === 0) continue;
      const patterns: RegExp[] = [];
      for (const p of def.classifyPatterns) {
        try {
          patterns.push(new RegExp(p, 'i'));
        } catch {
          // skip invalid user regex
        }
      }
      if (patterns.length === 0) continue;
      rules.push({
        type: def.id,
        patterns,
        tags: [def.id],
      });
    }
    return rules;
  }

  private toListItem(t: AssetTypeDef): AssetTypeListItem {
    return {
      id: t.id,
      enabled: t.enabled,
      kernel: Boolean(t.kernel) || isKernelAssetType(t.id),
      label: t.label,
      scaffold: t.scaffold,
      guidance: t.guidance,
      requiredSections: t.requiredSections,
      rules: t.rules,
      classifyPatterns: t.classifyPatterns,
      ontologyClass: t.ontologyClass ?? typeIdToOntologyClass(t.id),
      legacyProfile: t.legacyProfile,
    };
  }
}

/**
 * Create and load an AssetTypeRegistry from vault path (optional).
 */
export async function createAssetTypeRegistry(
  assetTypesDir?: string,
): Promise<AssetTypeRegistry> {
  const registry = new AssetTypeRegistry();
  await registry.loadFromDisk(assetTypesDir);
  return registry;
}
