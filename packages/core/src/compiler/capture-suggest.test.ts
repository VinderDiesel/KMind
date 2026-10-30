import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createKnowledgeAsset, resetFactoryCounters } from '@kmind/shared';
import { createVault } from '../storage/vault.js';
import { SqliteStore } from '../storage/sqlite-store.js';
import { createAssetTypeRegistry } from '../asset-types/registry.js';
import { buildCaptureSuggestions } from './capture-suggest.js';

describe('buildCaptureSuggestions', () => {
  let dir: string;
  let store: SqliteStore;

  beforeEach(async () => {
    resetFactoryCounters();
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-sug-'));
    const vault = createVault(path.join(dir, 'vault'));
    await vault.init();
    store = new SqliteStore(vault.indexPath);
    await store.migrate();
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('given project with overview when suggest without related then hub suggestion', async () => {
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-10-30-100',
        title: '问数知识总览',
        type: 'architecture_design',
        project: 'demo',
        body: '## 导航\nhub\n## 红线规避\n- 禁止空总览\n',
      }),
    );
    const assetTypes = await createAssetTypeRegistry();
    const report = await buildCaptureSuggestions(
      {
        title: '投影策略',
        project: 'demo',
        type: 'architecture_design',
        content: 'short',
      },
      { store, assetTypes },
    );
    expect(report.version).toBe('1');
    expect(report.suggestions.some((s) => s.kind === 'related_hub')).toBe(true);
    expect(report.proposedCapture?.related).toContain('k-2026-10-30-100');
  });

  it('given outcome without verifies when suggest then link suggestion', async () => {
    await store.upsertAsset(
      createKnowledgeAsset({
        id: 'k-2026-10-30-101',
        title: 'JOIN 丢失',
        type: 'problem',
        project: 'demo',
        body: '## 症状\nx\n## 复现\n1\n## 验收\nok\n',
      }),
    );
    const report = await buildCaptureSuggestions(
      {
        title: '验证通过',
        project: 'demo',
        type: 'outcome',
        content: '## 结果\n通过\n## 证据\nlog\n',
      },
      { store },
    );
    const link = report.suggestions.find((s) => s.kind === 'link');
    expect(link?.apply.links?.[0]?.relation).toBe('verifies');
    expect(link?.apply.links?.[0]?.id).toBe('k-2026-10-30-101');
  });

  it('given architecture without anchors when suggest then anchors hint', async () => {
    const report = await buildCaptureSuggestions(
      {
        title: '事件驱动',
        project: 'solo',
        type: 'architecture_design',
        content: '## 实现方式\n只用文字没有路径\n## 注意事项\na\n## 红线规避\nb\n',
      },
      { store },
    );
    expect(report.suggestions.some((s) => s.kind === 'anchors')).toBe(true);
  });
});
