import { describe, expect, it } from 'vitest';
import { stripCaptureChrome } from './capture.js';

describe('stripCaptureChrome', () => {
  it('given duplicated heading and type footer when strip then returns body only', () => {
    const raw = `# KMind 定位

本地优先知识系统。

type: architecture_design
project: kmind`;
    const out = stripCaptureChrome(raw, 'KMind 定位');
    expect(out).toBe('本地优先知识系统。');
  });
});
