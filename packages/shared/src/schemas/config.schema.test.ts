import { describe, expect, it } from 'vitest';
import { KMindConfigSchema } from './config.schema.js';

describe('KMindConfigSchema', () => {
  it('given minimal config when parse then applies defaults', () => {
    const result = KMindConfigSchema.safeParse({
      version: '0.1.0',
      vaultPath: '/tmp/.kmind',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultProject).toBe('global');
      expect(result.data.embedding.dimension).toBe(384);
      expect(result.data.encryption.enabled).toBe(false);
    }
  });

  it('given missing vaultPath when parse then fails', () => {
    const result = KMindConfigSchema.safeParse({ version: '0.1.0' });
    expect(result.success).toBe(false);
  });
});
