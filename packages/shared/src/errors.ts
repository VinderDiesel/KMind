import { z } from 'zod';

export const ErrorCategoryEnum = z.enum([
  'CAPTURE_ERROR',
  'CLASSIFY_ERROR',
  'ONTOLOGY_ERROR',
  'GRAPH_ERROR',
  'INDEX_ERROR',
  'CONFIG_ERROR',
  'ADAPTER_ERROR',
]);
export type ErrorCategory = z.infer<typeof ErrorCategoryEnum>;

export const ErrorSeverityEnum = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);
export type ErrorSeverity = z.infer<typeof ErrorSeverityEnum>;

export const ExitCode = {
  SUCCESS: 0,
  GENERAL: 1,
  VALIDATION: 2,
  CONFIG: 3,
  EXTERNAL: 4,
} as const;
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export interface KMindErrorOptions {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  suggestion: string;
  cause?: unknown;
}

/**
 * Structured KMind error with category, severity, and user-facing suggestion.
 */
export class KMindError extends Error {
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly retryable: boolean;
  readonly suggestion: string;

  constructor(message: string, options: KMindErrorOptions) {
    super(message);
    this.name = 'KMindError';
    this.category = options.category;
    this.severity = options.severity;
    this.retryable = options.retryable;
    this.suggestion = options.suggestion;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  /**
   * Format error using the three-element UX principle: what / why / next action.
   */
  formatUserMessage(): string {
    return [
      `失败: ${this.message}`,
      `原因: [${this.category}] severity=${this.severity}`,
      `下一步: ${this.suggestion}`,
    ].join('\n');
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      suggestion: this.suggestion,
    };
  }
}

/**
 * Map error category to CLI exit code.
 */
export function exitCodeForError(error: KMindError): ExitCodeValue {
  switch (error.category) {
    case 'CONFIG_ERROR':
      return ExitCode.CONFIG;
    case 'CAPTURE_ERROR':
    case 'CLASSIFY_ERROR':
    case 'ONTOLOGY_ERROR':
    case 'GRAPH_ERROR':
    case 'INDEX_ERROR':
      return ExitCode.VALIDATION;
    case 'ADAPTER_ERROR':
      return ExitCode.EXTERNAL;
    default:
      return ExitCode.GENERAL;
  }
}
