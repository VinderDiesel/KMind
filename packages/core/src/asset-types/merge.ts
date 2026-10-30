import {
  AssetTypeDefSchema,
  isKernelAssetType,
  type AssetTypeDef,
  KMindError,
} from '@kmind/shared';

/**
 * Deep-merge vault overlay onto builtin def (ADR-001: field-level merge by id).
 */
export function mergeAssetTypeDef(
  base: AssetTypeDef,
  overlay: Partial<AssetTypeDef>,
): AssetTypeDef {
  const merged: AssetTypeDef = {
    ...base,
    ...overlay,
    id: base.id,
    requiredSections:
      overlay.requiredSections !== undefined
        ? overlay.requiredSections
        : base.requiredSections,
    rules: overlay.rules !== undefined ? overlay.rules : base.rules,
    classifyPatterns:
      overlay.classifyPatterns !== undefined
        ? overlay.classifyPatterns
        : base.classifyPatterns,
    scaffold: overlay.scaffold !== undefined ? overlay.scaffold : base.scaffold,
    guidance: overlay.guidance !== undefined ? overlay.guidance : base.guidance,
  };

  if (
    (isKernelAssetType(merged.id) || merged.kernel === true) &&
    merged.enabled === false
  ) {
    throw new KMindError(`Cannot disable kernel asset type: ${merged.id}`, {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion:
        'problem / problem_solution / outcome are locked for closure semantics',
    });
  }

  return AssetTypeDefSchema.parse(merged);
}

/**
 * Merge builtin map with vault overlays (by id). New vault-only ids are allowed.
 */
export function mergeAssetTypeMaps(
  builtins: Map<string, AssetTypeDef>,
  overlays: Map<string, Partial<AssetTypeDef>>,
): Map<string, AssetTypeDef> {
  const out = new Map<string, AssetTypeDef>();

  for (const [id, base] of builtins) {
    const overlay = overlays.get(id);
    out.set(id, overlay ? mergeAssetTypeDef(base, overlay) : base);
  }

  for (const [id, overlay] of overlays) {
    if (out.has(id)) continue;
    const parsed = AssetTypeDefSchema.parse({
      enabled: true,
      scaffold: '',
      guidance: '',
      requiredSections: [],
      rules: [],
      classifyPatterns: [],
      ...overlay,
      id,
    });
    if (isKernelAssetType(parsed.id) && parsed.enabled === false) {
      throw new KMindError(`Cannot disable kernel asset type: ${parsed.id}`, {
        category: 'CONFIG_ERROR',
        severity: 'high',
        retryable: false,
        suggestion:
          'problem / problem_solution / outcome are locked for closure semantics',
      });
    }
    out.set(id, parsed);
  }

  return out;
}
