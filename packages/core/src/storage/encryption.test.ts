import { describe, expect, it } from 'vitest';
import { FieldEncryption } from './encryption.js';

describe('FieldEncryption', () => {
  it('given plaintext when encrypt/decrypt then roundtrips', () => {
    const enc = new FieldEncryption('test-secret');
    const cipher = enc.encrypt('sensitive body');
    expect(cipher.startsWith('enc:v1:')).toBe(true);
    expect(enc.decrypt(cipher)).toBe('sensitive body');
  });
});
