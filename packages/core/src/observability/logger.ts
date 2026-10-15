export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Simple structured logger (no console.log in business code — use this).
 */
export function createLogger(scope = 'kmind'): Logger {
  const write = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      scope,
      level,
      message,
      ...meta,
    });
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else if (process.env.KMIND_LOG !== 'silent') {
      process.stderr.write(`${line}\n`);
    }
  };

  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}
