import { describe, expect, it } from 'vitest';
import {
  assertValidCron,
  cronMatches,
  minuteSlot,
  nextCron,
  parseCron,
} from './cron.js';

describe('parseCron', () => {
  it('given every-6h when parse then hours are 0,6,12,18', () => {
    const c = parseCron('0 */6 * * *');
    expect([...c.hour.values].sort((a, b) => a - b)).toEqual([0, 6, 12, 18]);
    expect(c.minute.values.has(0)).toBe(true);
  });

  it('given empty when parse then throws', () => {
    expect(() => parseCron('')).toThrow(/empty/i);
  });

  it('given 6 fields when parse then throws', () => {
    expect(() => parseCron('0 0 * * * *')).toThrow(/5 fields/i);
  });

  it('given out of range minute when parse then throws', () => {
    expect(() => assertValidCron('60 * * * *')).toThrow(/out of range/i);
  });
});

describe('cronMatches', () => {
  it('given weekday noon when match 0 12 * * 1-5 then true on Tuesday', () => {
    // 2026-10-20 is Tuesday
    const d = new Date(2026, 9, 20, 12, 0, 0, 0);
    expect(cronMatches('0 12 * * 1-5', d)).toBe(true);
  });

  it('given Saturday when match weekday cron then false', () => {
    const d = new Date(2026, 9, 24, 12, 0, 0, 0); // Saturday
    expect(cronMatches('0 12 * * 1-5', d)).toBe(false);
  });
});

describe('nextCron', () => {
  it('given from just after slot when next then finds following hour', () => {
    const from = new Date(2026, 9, 20, 0, 1, 0, 0);
    const n = nextCron('0 * * * *', from);
    expect(n).not.toBeNull();
    expect(n!.getHours()).toBe(1);
    expect(n!.getMinutes()).toBe(0);
  });

  it('given exact match when next then returns same minute', () => {
    const from = new Date(2026, 9, 20, 2, 0, 0, 0);
    const n = nextCron('0 2 * * *', from);
    expect(minuteSlot(n!)).toBe(minuteSlot(from));
  });
});

describe('minuteSlot', () => {
  it('given date when slot then formats local YYYY-MM-DDTHH:mm', () => {
    const d = new Date(2026, 0, 5, 7, 8, 9, 0);
    expect(minuteSlot(d)).toBe('2026-01-05T07:08');
  });
});
