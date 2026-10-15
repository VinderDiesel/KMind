import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../../packages/adapters/claude-code/src/index.js';
import { CursorAdapter } from '../../packages/adapters/cursor/src/index.js';
import { QoderAdapter } from '../../packages/adapters/qoder/src/index.js';
import { CodexAdapter } from '../../packages/adapters/codex/src/index.js';

describe('e2e multi-terminal adapters', () => {
  it('given four adapters when list then all present', () => {
    const names = [
      new ClaudeCodeAdapter().name,
      new CursorAdapter().name,
      new QoderAdapter().name,
      new CodexAdapter().name,
    ];
    expect(names).toEqual(['claude-code', 'cursor', 'qoder', 'codex']);
  });
});
