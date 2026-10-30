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

  it('given adapter schedule when parse then keeps cron string', () => {
    const result = KMindConfigSchema.safeParse({
      version: '0.1.0',
      vaultPath: '/tmp/.kmind',
      adapters: {
        cursor: { enabled: true, schedule: '0 */6 * * *' },
      },
      schedule: { enabled: true, tickSeconds: 30 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.adapters.cursor?.schedule).toBe('0 */6 * * *');
      expect(result.data.schedule.enabled).toBe(true);
      expect(result.data.schedule.tickSeconds).toBe(30);
      expect(result.data.schedule.overlap).toBe('skip');
      expect(result.data.schedule.evolutionScan).toBe(true);
    }
  });
});
