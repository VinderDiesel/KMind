import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectModuleEvidence,
  extractExportSymbols,
} from './scanner.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeRepo(layout: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kmind-scan-'));
  tmpDirs.push(root);
  for (const [rel, body] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body, 'utf8');
  }
  return root;
}

describe('collectModuleEvidence', () => {
  it('given module dir when scan then ranks entrypoints first and skips tests/vendor', async () => {
    const root = await makeRepo({
      'packages/core/src/llm/index.ts':
        "export * from './client.js';\nexport const createLlmClient = 1;\n",
      'packages/core/src/llm/client.ts':
        'export function createLlmClient() {}\n',
      'packages/core/src/llm/client.test.ts': 'export const ignored = 1;\n',
      'packages/core/src/llm/README.md': '# LLM\n\n## 概览\n\n说明。\n',
      'packages/core/node_modules/dep/index.js': 'ignored\n',
      'packages/core/src/llm/dist/bundle.js': 'ignored\n',
    });

    const evidence = await collectModuleEvidence({
      repoRoot: root,
      paths: ['packages/core/src/llm'],
    });

    const files = evidence.files.map((file) => file.path);
    expect(files[0]).toBe('packages/core/src/llm/index.ts');
    expect(files).toContain('packages/core/src/llm/client.ts');
    expect(files).toContain('packages/core/src/llm/README.md');
    expect(files.some((file) => file.includes('client.test.ts'))).toBe(false);
    expect(files.some((file) => file.includes('node_modules'))).toBe(false);
    expect(files.some((file) => file.includes('dist/'))).toBe(false);
    expect(evidence.exports).toContainEqual({
      file: 'packages/core/src/llm/client.ts',
      symbols: ['createLlmClient'],
    });
    expect(evidence.headings).toContainEqual({
      file: 'packages/core/src/llm/README.md',
      heading: '概览',
    });
  });

  it('given missing path when scan then records it in skippedPaths', async () => {
    const root = await makeRepo({ 'README.md': '# Demo\n' });
    const evidence = await collectModuleEvidence({
      repoRoot: root,
      paths: ['does/not/exist'],
    });

    expect(evidence.files).toEqual([]);
    expect(evidence.skippedPaths).toContain('does/not/exist');
  });

  it('given tight char budget when scan then truncates and stays within budget', async () => {
    const root = await makeRepo({
      'src/index.ts': `export const big = '${'x'.repeat(5_000)}';\n`,
      'src/extra.ts': `export const extra = '${'y'.repeat(5_000)}';\n`,
    });

    const evidence = await collectModuleEvidence({
      repoRoot: root,
      paths: ['src'],
      maxChars: 2_000,
      maxFiles: 4,
    });

    expect(evidence.totalChars).toBeLessThanOrEqual(2_000);
    expect(evidence.files[0]?.truncated).toBe(true);
  });

  it('given single file path when scan then returns only that file', async () => {
    const root = await makeRepo({
      'a.ts': 'export const a = 1;\n',
      'b.ts': 'export const b = 2;\n',
    });

    const evidence = await collectModuleEvidence({
      repoRoot: root,
      paths: ['b.ts'],
    });

    expect(evidence.files.map((file) => file.path)).toEqual(['b.ts']);
  });
});

describe('extractExportSymbols', () => {
  it('given ts named/grouped exports when extract then lists symbols', () => {
    const symbols = extractExportSymbols(
      [
        'export const a = 1;',
        'export async function b() {}',
        'export class C {}',
        'export { d, e as f };',
      ].join('\n'),
    );

    expect(symbols).toEqual(['a', 'b', 'C', 'd', 'e']);
  });

  it('given python definitions when extract then lists public names', () => {
    const symbols = extractExportSymbols(
      ['def public_fn():', '    pass', 'class Service:', 'def _private():'].join(
        '\n',
      ),
    );

    expect(symbols).toContain('public_fn');
    expect(symbols).toContain('Service');
    expect(symbols).not.toContain('_private');
  });
});
