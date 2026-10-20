import { describe, expect, it } from 'vitest';
import { sanitizeTitle } from './title.js';

describe('sanitizeTitle', () => {
  it('given nested markdown headings when sanitize then keeps first heading text', () => {
    const raw = `# 优化：统一口径

# ADR 001 — 复合口径 DSL`;
    expect(sanitizeTitle(raw)).toBe('优化：统一口径');
  });

  it('given leading hashes and newlines when sanitize then collapses to one line', () => {
    expect(sanitizeTitle('##  五道防线\n\n正文')).toBe('五道防线');
  });

  it('given session-id shaped title when sanitize then returns placeholder', () => {
    expect(sanitizeTitle('kiro-sess_379f676f-abcd')).toBe('untitled session');
  });

  it('given separator-only title when sanitize then returns untitled', () => {
    expect(sanitizeTitle('--------')).toBe('untitled');
  });

  it('given long title when sanitize then truncates', () => {
    const long = `# ${'a'.repeat(200)}`;
    expect(sanitizeTitle(long).length).toBe(120);
  });
});
