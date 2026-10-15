import { describe, expect, it } from 'vitest';
import type { Adapter } from '../../packages/core/src/adapters/types.js';
import { ClaudeCodeAdapter } from '../../packages/adapters/claude-code/src/index.js';
import { CursorAdapter } from '../../packages/adapters/cursor/src/index.js';
import { QoderAdapter } from '../../packages/adapters/qoder/src/index.js';
import { CodexAdapter } from '../../packages/adapters/codex/src/index.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const adapters: Adapter[] = [
  new ClaudeCodeAdapter(),
  new CursorAdapter(),
  new QoderAdapter(),
  new CodexAdapter(),
];

describe('Adapter contract', () => {
  for (const adapter of adapters) {
    describe(adapter.name, () => {
      it('exposes name and version', () => {
        expect(adapter.name).toBeTruthy();
        expect(adapter.version).toMatch(/^\d+\.\d+\.\d+$/);
      });

      it('detect returns boolean', async () => {
        expect(typeof (await adapter.detect())).toBe('boolean');
      });

      it('getSessionPaths returns array', async () => {
        const paths = await adapter.getSessionPaths();
        expect(Array.isArray(paths)).toBe(true);
      });

      it('getMcpConfig returns template', () => {
        const cfg = adapter.getMcpConfig();
        expect(cfg.targetPath).toBeTruthy();
        expect(cfg.content).toBeTypeOf('object');
      });

      it('parseSession parses jsonl', async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'kmind-adapter-'));
        const file = path.join(dir, 'sess.jsonl');
        writeFileSync(
          file,
          `${JSON.stringify({
            role: 'user',
            content: 'hello',
            timestamp: '2026-10-15T12:00:00.000Z',
          })}\n`,
        );
        const session = await adapter.parseSession(file);
        expect(session.terminal).toBe(adapter.name);
        expect(session.messages.length).toBeGreaterThan(0);
        rmSync(dir, { recursive: true, force: true });
      });
    });
  }
});
