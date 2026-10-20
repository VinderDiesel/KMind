import type {
  KnowledgeAsset,
  KnowledgeStatus,
  KnowledgeType,
} from '@kmind/shared';

export interface SearchQuery {
  query: string;
  type?: KnowledgeType;
  project?: string;
  status?: KnowledgeStatus;
  tags?: string[];
  limit?: number;
  minConfidence?: number;
}

export interface SearchResult {
  asset: KnowledgeAsset;
  score: number;
  matchedBy: Array<'fulltext' | 'semantic' | 'graph' | 'structured' | 'id'>;
  highlights?: string[];
}

export interface QueryEngine {
  search(q: SearchQuery): Promise<SearchResult[]>;
  getById(id: string): Promise<KnowledgeAsset | null>;
  related(id: string, depth?: number): Promise<KnowledgeAsset[]>;
  graphQuery(cypherLike: string): Promise<unknown[]>;
  status(): Promise<Record<string, unknown>>;
  /** Resolve open/addressed/verified for a problem id via solves+verifies edges. */
  problemStatus(problemId: string): Promise<unknown>;
  /** Coverage vs catalog-only: complete=false means do not claim「已完整」. */
  coverage(opts: {
    project: string;
    topic?: string;
    hubId?: string;
  }): Promise<unknown>;
}
