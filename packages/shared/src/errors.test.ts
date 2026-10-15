import { describe, expect, it } from 'vitest';
import { ExitCode, exitCodeForError, KMindError } from './errors.js';

describe('KMindError', () => {
  it('given error when formatUserMessage then includes three elements', () => {
    const err = new KMindError('Vault missing', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: 'Run kmind init first',
    });
    const msg = err.formatUserMessage();
    expect(msg).toContain('失败:');
    expect(msg).toContain('原因:');
    expect(msg).toContain('下一步:');
  });

  it('given CONFIG_ERROR when exitCodeForError then returns 3', () => {
    const err = new KMindError('bad config', {
      category: 'CONFIG_ERROR',
      severity: 'high',
      retryable: false,
      suggestion: 'fix config.yaml',
    });
    expect(exitCodeForError(err)).toBe(ExitCode.CONFIG);
  });
});
