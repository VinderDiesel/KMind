import { KMindError } from '@kmind/shared';

export interface CronField {
  /** All values in range that match. */
  values: ReadonlySet<number>;
}

export interface CronExpr {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  raw: string;
}

const RANGES = {
  minute: [0, 59] as const,
  hour: [0, 23] as const,
  dayOfMonth: [1, 31] as const,
  month: [1, 12] as const,
  dayOfWeek: [0, 6] as const,
};

/**
 * Parse a standard 5-field cron expression (min hour dom month dow).
 * Supports star, N, N-M, star/N, lists, and N-M/S steps.
 */
export function parseCron(expr: string): CronExpr {
  const raw = expr.trim();
  if (!raw) {
    throw cronError('Cron expression is empty', expr);
  }
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) {
    throw cronError(
      `Cron must have 5 fields (got ${parts.length}): min hour dom month dow`,
      expr,
    );
  }
  const [min, hour, dom, month, dow] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    raw,
    minute: parseField(min, RANGES.minute, 'minute'),
    hour: parseField(hour, RANGES.hour, 'hour'),
    dayOfMonth: parseField(dom, RANGES.dayOfMonth, 'dayOfMonth'),
    month: parseField(month, RANGES.month, 'month'),
    dayOfWeek: parseField(dow, RANGES.dayOfWeek, 'dayOfWeek'),
  };
}

/**
 * Whether `date` (local time) matches the cron expression.
 */
export function cronMatches(expr: string | CronExpr, date: Date): boolean {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  return (
    c.minute.values.has(date.getMinutes()) &&
    c.hour.values.has(date.getHours()) &&
    c.dayOfMonth.values.has(date.getDate()) &&
    c.month.values.has(date.getMonth() + 1) &&
    c.dayOfWeek.values.has(date.getDay())
  );
}

/**
 * Next local Date (inclusive of `from` if it matches) within `maxMinutes`.
 * Returns null if none found (should not happen for valid crons within a year).
 */
export function nextCron(
  expr: string | CronExpr,
  from: Date,
  maxMinutes = 366 * 24 * 60,
): Date | null {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  for (let i = 0; i < maxMinutes; i += 1) {
    if (cronMatches(c, cursor)) return new Date(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}

/**
 * Minute slot key in local time: `YYYY-MM-DDTHH:mm`.
 */
export function minuteSlot(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

/**
 * Validate cron or throw KMindError.
 */
export function assertValidCron(expr: string): CronExpr {
  return parseCron(expr);
}

function parseField(
  raw: string,
  range: readonly [number, number],
  name: string,
): CronField {
  const [lo, hi] = range;
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) {
      throw cronError(`Empty token in ${name} field`, raw);
    }
    const stepMatch = /^(.+)\/(\d+)$/.exec(token);
    const body = stepMatch ? stepMatch[1]! : token;
    const step = stepMatch ? Number(stepMatch[2]) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw cronError(`Invalid step in ${name}: ${token}`, raw);
    }
    let start: number;
    let end: number;
    if (body === '*') {
      start = lo;
      end = hi;
    } else if (body.includes('-')) {
      const [a, b] = body.split('-');
      start = Number(a);
      end = Number(b);
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw cronError(`Invalid range in ${name}: ${token}`, raw);
      }
    } else {
      start = Number(body);
      end = start;
      if (!Number.isInteger(start)) {
        throw cronError(`Invalid value in ${name}: ${token}`, raw);
      }
    }
    if (start < lo || end > hi || start > end) {
      throw cronError(
        `${name} out of range [${lo},${hi}]: ${token}`,
        raw,
      );
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return { values };
}

function cronError(message: string, expr: string): KMindError {
  return new KMindError(message, {
    category: 'CONFIG_ERROR',
    severity: 'medium',
    retryable: true,
    suggestion: `Use 5-field cron e.g. "0 */6 * * *" (got "${expr}")`,
  });
}
