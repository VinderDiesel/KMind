import { KnowledgeTypeEnum } from '@kmind/shared';

export type ToolEffect = 'read' | 'write' | 'sensitive';

export interface McpToolDef {
  name: string;
  description: string;
  effect: ToolEffect;
  inputSchema: Record<string, unknown>;
}

const typeEnum = KnowledgeTypeEnum.options;

/**
 * MCP tool registry with effect classification.
 */
export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'kmind_search',
    description:
      'Hybrid search over the local KMind knowledge base. Use for factual recall of past decisions, pitfalls, and practices. Limit: local vault only; does not search the web.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: { type: 'string', enum: typeEnum },
        project: { type: 'string' },
        limit: { type: 'number', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'kmind_related',
    description:
      'Find knowledge assets related via the graph. Scope: existing linked assets only; depth max 5.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        depth: { type: 'number', default: 1, maximum: 5 },
      },
      required: ['id'],
    },
  },
  {
    name: 'kmind_status',
    description:
      'Return vault health stats: asset count, last compile time, compile state. Read-only.',
    effect: 'read',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'kmind_ontology_describe',
    description:
      'Describe ontology structure or a specific class. Read-only; does not mutate ontology.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: { class: { type: 'string' } },
    },
  },
  {
    name: 'kmind_capture',
    description:
      'Manually capture a knowledge entry into the vault (write). Prefer after a confirmed decision.',
    effect: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        type: { type: 'string' },
        project: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['content'],
    },
  },
  {
    name: 'kmind_graph_query',
    description:
      'Run a Cypher-like graph query (sensitive). Supports MATCH/WHERE/RETURN/LIMIT only.',
    effect: 'sensitive',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'kmind_export',
    description:
      'Export the knowledge vault (sensitive). Formats: tar.gz or git directory layout.',
    effect: 'sensitive',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['tar.gz', 'git'] },
        output: { type: 'string' },
      },
    },
  },
];
