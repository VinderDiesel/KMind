import { createLogger } from './logger.js';

const logger = createLogger('trace');

export type LifecyclePhase =
  | 'raw'
  | 'capture'
  | 'classify'
  | 'ontology'
  | 'graph'
  | 'embed'
  | 'index';

/**
 * Record a knowledge asset lifecycle event for local traceability.
 */
export function traceLifecycle(
  assetId: string,
  phase: LifecyclePhase,
  meta?: Record<string, unknown>,
): void {
  logger.info('lifecycle', { assetId, phase, ...meta });
}
