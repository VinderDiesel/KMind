/**
 * ADR-003 Codegraph adapter surface — structure truth stays outside KMind.
 */

export interface CodegraphCaller {
  name: string;
  filePath: string;
  kind?: string;
  startLine?: number;
}

export interface CodegraphSymbolMatch {
  name: string;
  filePath: string;
  kind?: string;
  qualifiedName?: string;
  startLine?: number;
}

export interface CodegraphClient {
  /** True when CLI works and project index is initialized. */
  isAvailable(projectPath: string): Promise<boolean>;
  /**
   * Resolve whether `symbol` exists (optionally narrowed by file path suffix).
   */
  findSymbol(opts: {
    projectPath: string;
    symbol: string;
    file?: string;
  }): Promise<{ found: boolean; matches: CodegraphSymbolMatch[] }>;
  /** Direct callers of a symbol (capped). */
  listCallers(opts: {
    projectPath: string;
    symbol: string;
    file?: string;
    limit?: number;
  }): Promise<CodegraphCaller[]>;
}
