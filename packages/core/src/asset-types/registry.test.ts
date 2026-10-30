import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KMindError } from '@kmind/shared';
import { createAssetTypeRegistry } from './registry.js';
import { mergeAssetTypeDef } from './merge.js';
import { loadBuiltinAssetTypes } from './loader.js';

describe('AssetTypeRegistry', () => {
  it('given builtins when load then nine enabled types', async () => {
    const reg = await createAssetTypeRegistry();
    expect(reg.listEnabled()).toHaveLength(9);
    expect(reg.isCapturable('problem')).toBe(true);
  });

  it('given vault overlay enabled false when merge then type not capturable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-at-'));
    await fs.writeFile(
      path.join(dir, 'pitfall.yaml'),
      'enabled: false\n',
      'utf8',
    );
    const reg = await createAssetTypeRegistry(dir);
    expect(reg.isCapturable('pitfall')).toBe(false);
    expect(reg.get('pitfall')?.label).toBe('踩坑记录');
    expect(() => reg.assertCapturable('pitfall')).toThrow(KMindError);
  });

  it('given kernel disable when merge then throws', () => {
    const base = loadBuiltinAssetTypes().get('problem')!;
    expect(() => mergeAssetTypeDef(base, { enabled: false })).toThrow(
      /Cannot disable kernel/,
    );
  });

  it('given custom type yaml when load then capturable with patterns', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-at-'));
    await fs.writeFile(
      path.join(dir, 'runbook.yaml'),
      [
        'id: runbook',
        'label: Runbook',
        'guidance: Write steps.',
        'requiredSections: [步骤]',
        'classifyPatterns: ["runbook", "手册"]',
        'rules:',
        '  - minBodyChars: 80',
        '',
      ].join('\n'),
      'utf8',
    );
    const reg = await createAssetTypeRegistry(dir);
    expect(reg.isCapturable('runbook')).toBe(true);
    const rules = reg.getClassifyRules().filter((r) => r.type === 'runbook');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.patterns.some((p) => p.test('runbook ops'))).toBe(true);
  });
});
