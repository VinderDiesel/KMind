import type { SessionRecord, Terminal } from '@kmind/shared';

export interface McpConfigTemplate {
  targetPath: string;
  content: Record<string, unknown>;
}

export interface LifecycleHookConfig {
  event: string;
  command: string;
}

/**
 * Terminal adapter contract. All adapters must implement this interface.
 */
export interface Adapter {
  readonly name: string;
  readonly version: string;

  /** Detect whether the terminal is installed. */
  detect(): Promise<boolean>;

  /** Return session file paths for auto-capture. */
  getSessionPaths(): Promise<string[]>;

  /** Parse a single session file into a SessionRecord. */
  parseSession(path: string): Promise<SessionRecord>;

  /** Return MCP config template for this terminal. */
  getMcpConfig(): McpConfigTemplate;

  /** Optional lifecycle hooks. */
  getLifecycleHooks?(): LifecycleHookConfig[];
}

export type AdapterTerminal = Exclude<Terminal, 'manual'>;
