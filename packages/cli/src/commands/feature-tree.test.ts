import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ensureProjectFeatureTree,
  FEATURE_TREE_FILENAME,
  FEATURE_TREE_GUIDE_START,
  upsertGuideSection,
} from './feature-tree.js';

describe('ensureProjectFeatureTree', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kmind-feature-tree-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('given empty vault when ensure then creates FEATURE_TREE.md', async () => {
    const result = await ensureProjectFeatureTree(dir);
    expect(result.action).toBe('created');
    expect(existsSync(path.join(dir, FEATURE_TREE_FILENAME))).toBe(true);
    const body = readFileSync(result.path, 'utf8');
    expect(body).toContain(FEATURE_TREE_GUIDE_START);
    expect(body).toContain('项目功能树');
  });

  it('given custom tables when ensure then keeps tables and refreshes guide', async () => {
    writeFileSync(
      path.join(dir, FEATURE_TREE_FILENAME),
      `# 自定义\n\n${FEATURE_TREE_GUIDE_START}\nold guide\n<!-- kmind:feature-tree-guide:end -->\n\n## A. 问数\n| 功能点 | 状态 |\n| Ask路由 | done |\n`,
      'utf8',
    );
    const result = await ensureProjectFeatureTree(dir);
    expect(result.action).toBe('guide_updated');
    const body = readFileSync(result.path, 'utf8');
    expect(body).toContain('## A. 问数');
    expect(body).toContain('Ask路由');
    expect(body).toContain('维护约定');
    expect(body).not.toContain('old guide');
  });
});

describe('upsertGuideSection', () => {
  it('given no markers when upsert then appends guide', () => {
    const { next, action } = upsertGuideSection(
      '# team tree\n',
      `${FEATURE_TREE_GUIDE_START}\nguide\n<!-- kmind:feature-tree-guide:end -->`,
    );
    expect(action).toBe('guide_appended');
    expect(next).toContain('# team tree');
    expect(next).toContain(FEATURE_TREE_GUIDE_START);
  });
});
