import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  AssetTypeDefSchema,
  KnowledgeTypeIdSchema,
  type AssetTypeDef,
  KMindError,
} from '@kmind/shared';
import { BUILTIN_ASSET_TYPES } from './builtins.js';
import { mergeAssetTypeMaps } from './merge.js';

/**
 * Load builtin asset types as an id → def map.
 */
export function loadBuiltinAssetTypes(): Map<string, AssetTypeDef> {
  const map = new Map<string, AssetTypeDef>();
  for (const def of BUILTIN_ASSET_TYPES) {
    map.set(def.id, AssetTypeDefSchema.parse(def));
  }
  return map;
}

/**
 * Read vault overlay YAML/JSON files from asset-types directory.
 * Each file may be a single def (`id` required) or `{ types: [...] }`.
 */
export async function loadVaultAssetTypeOverlays(
  assetTypesDir: string,
): Promise<Map<string, Partial<AssetTypeDef>>> {
  const overlays = new Map<string, Partial<AssetTypeDef>>();
  let entries: string[];
  try {
    entries = await fs.readdir(assetTypesDir);
  } catch {
    return overlays;
  }

  for (const name of entries) {
    if (!/\.(ya?ml|json)$/i.test(name)) continue;
    const filePath = path.join(assetTypesDir, name);
    let rawText: string;
    try {
      rawText = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    let data: unknown;
    try {
      data = /\.json$/i.test(name) ? JSON.parse(rawText) : YAML.parse(rawText);
    } catch (cause) {
      throw new KMindError(`Invalid asset type file: ${name}`, {
        category: 'CONFIG_ERROR',
        severity: 'high',
        retryable: false,
        suggestion: 'Fix YAML/JSON syntax in vault asset-types/',
        cause,
      });
    }

    const items = normalizeOverlayFile(data, name);
    for (const item of items) {
      const idParse = KnowledgeTypeIdSchema.safeParse(item.id);
      if (!idParse.success) {
        throw new KMindError(`Invalid asset type id in ${name}`, {
          category: 'CONFIG_ERROR',
          severity: 'high',
          retryable: false,
          suggestion: 'id must be snake_case (e.g. my_custom_type)',
        });
      }
      const id = idParse.data;
      const prev = overlays.get(id) ?? {};
      overlays.set(id, { ...prev, ...item, id });
    }
  }

  return overlays;
}

/**
 * Load builtin ∪ vault deep-merged asset type map.
 */
export async function loadAssetTypes(
  assetTypesDir?: string,
): Promise<Map<string, AssetTypeDef>> {
  const builtins = loadBuiltinAssetTypes();
  if (!assetTypesDir) return builtins;
  const overlays = await loadVaultAssetTypeOverlays(assetTypesDir);
  return mergeAssetTypeMaps(builtins, overlays);
}

function normalizeOverlayFile(
  data: unknown,
  fileName: string,
): Array<Partial<AssetTypeDef> & { id: string }> {
  if (!data || typeof data !== 'object') {
    throw new KMindError(`Empty asset type file: ${fileName}`, {
      category: 'CONFIG_ERROR',
      severity: 'medium',
      retryable: false,
      suggestion: 'Provide a YAML object with id or types[]',
    });
  }
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.types)) {
    return obj.types.map((t, i) => {
      if (!t || typeof t !== 'object' || !('id' in t)) {
        throw new KMindError(`types[${i}] missing id in ${fileName}`, {
          category: 'CONFIG_ERROR',
          severity: 'high',
          retryable: false,
          suggestion: 'Each types[] entry needs id',
        });
      }
      return t as Partial<AssetTypeDef> & { id: string };
    });
  }
  if (typeof obj.id === 'string') {
    return [obj as Partial<AssetTypeDef> & { id: string }];
  }
  // Filename stem as id when body is overlay fields only (e.g. enabled: false)
  const stem = fileName.replace(/\.(ya?ml|json)$/i, '');
  const idParse = KnowledgeTypeIdSchema.safeParse(stem);
  if (idParse.success) {
    return [{ ...(obj as Partial<AssetTypeDef>), id: idParse.data }];
  }
  throw new KMindError(`Cannot infer asset type id from ${fileName}`, {
    category: 'CONFIG_ERROR',
    severity: 'high',
    retryable: false,
    suggestion: 'Set id field or name file like pitfall.yaml',
  });
}
