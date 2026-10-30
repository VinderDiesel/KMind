import { RelationTypeEnum } from '@kmind/shared';

export type ToolEffect = 'read' | 'write' | 'sensitive';

export interface McpToolDef {
  name: string;
  description: string;
  effect: ToolEffect;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP tool registry with effect classification.
 */
export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'kmind_search',
    description:
      'Hybrid search over the local KMind knowledge base. Pass an asset id (k-YYYY-MM-DD-NNN) for exact lookup. Prefer project filter for curated recalls. Limit: local vault only.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        type: {
          type: 'string',
          description:
            'Asset type id (snake_case). Validated against vault registry; disabled types still match existing cards.',
        },
        project: { type: 'string' },
        limit: { type: 'number', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'kmind_asset_types',
    description:
      'List asset type registry (ADR-001): enabled types with scaffold, guidance, requiredSections, rules, classifyPatterns. Call before capture when unsure which type/template to use. Pass includeDisabled=true to see disabled types (old cards remain readable).',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        includeDisabled: {
          type: 'boolean',
          default: false,
          description: 'Include disabled types (not capturable)',
        },
        id: {
          type: 'string',
          description: 'Optional single type id to describe',
        },
      },
    },
  },
  {
    name: 'kmind_pack',
    description:
      'ADR-002 Context Pack: structured recall for Agents (focus card + ego neighborhood + code anchors + problem status). Prefer this over raw search when answering from the vault — returns cards, not LLM-synthesized answers. Pass id (k-…) or query.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Exact asset id (k-YYYY-MM-DD-NNN). Wins over query.',
        },
        query: {
          type: 'string',
          description: 'Hybrid search query when id is omitted',
        },
        project: { type: 'string' },
        type: {
          type: 'string',
          description: 'Optional type filter for search resolution',
        },
        depth: {
          type: 'number',
          default: 1,
          maximum: 3,
          description: 'Ego neighborhood hop depth',
        },
        neighborCap: {
          type: 'number',
          default: 24,
          description: 'Max neighborhood nodes',
        },
      },
    },
  },
  {
    name: 'kmind_get',
    description:
      'Fetch one knowledge asset by exact id (k-YYYY-MM-DD-NNN). Use instead of search when you already know the id.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
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
    name: 'kmind_problem_status',
    description:
      'Check whether a problem asset is open / addressed / verified via inbound solves + verifies edges.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'kmind_coverage',
    description:
      'Assess whether a project/topic is dug deep vs catalog-only. Returns complete=false when hubs are empty, children shallow, duplicate overviews, or missing anchors. REQUIRED before claiming「知识已完整」after 整理某系统; never treat search hits alone as complete.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Required project scope (e.g. meta-brain)',
        },
        topic: {
          type: 'string',
          description: 'Optional topic filter (e.g. 问数)',
        },
        hubId: {
          type: 'string',
          description: 'Optional overview id to score children against',
        },
      },
      required: ['project'],
    },
  },
  {
    name: 'kmind_evolution_queue',
    description:
      'ADR-002 evolution todo queue (read): open coverage + lint items. Diagnosis only — never auto-captures. Use after scan; Agents should work nextActions then ack via CLI. Pass refresh=true to rescan first.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: {
          type: 'boolean',
          default: false,
          description: 'Run coverage+lint scan before returning',
        },
        includeClosed: {
          type: 'boolean',
          default: false,
          description: 'Include done/dismissed items',
        },
        limit: { type: 'number', default: 50 },
        project: {
          type: 'string',
          description: 'Optional project filter',
        },
      },
    },
  },
  {
    name: 'kmind_capture_suggest',
    description:
      'ADR-002 smart-write suggestions (read): duplicates, type, hub related, solves/verifies links, missing anchors, quality preview. Show to human; on confirm merge suggestion.apply into kmind_capture (re-send = accept). Does not write.',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        title: { type: 'string' },
        project: { type: 'string' },
        type: { type: 'string' },
        related: { type: 'array', items: { type: 'string' } },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              relation: { type: 'string', enum: RelationTypeEnum.options },
            },
            required: ['id', 'relation'],
          },
        },
        anchors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              symbol: { type: 'string' },
              kind: { type: 'string' },
              line: { type: 'number' },
            },
            required: ['file'],
          },
        },
      },
      required: ['content', 'project'],
    },
  },
  {
    name: 'kmind_capture',
    description:
      'Capture knowledge (write). Depth is DEFAULT — do not wait for user to ask for detail. Prefer kmind_capture_suggest first; merge accepted apply fields here. One topic per card with 实现方式+注意事项+红线 and code anchors for architecture/process. Incremental (project already has assets): MUST related/links to hub/neighbors. Overview: thin + related[] to non-shallow children. Success returns coverage — do not claim complete unless coverage.complete=true.',
    effect: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'Deep single-topic body (not a TOC line). Prefer 实现方式/注意事项/红线 + ## 代码锚点. Split S0–S10 into per-stage cards.',
        },
        type: {
          type: 'string',
          description:
            'Asset type id (snake_case). Must be enabled in registry — call kmind_asset_types first. Custom types require explicit type.',
        },
        project: { type: 'string' },
        title: {
          type: 'string',
          description: 'Short clean title (one line, no markdown # headings).',
        },
        anchors: {
          type: 'array',
          description:
            'Required for architecture/process/tool when body lacks path+symbol: [{ file, symbol?, kind?, line?, projectPath? }]. Dig via Codegraph first.',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string' },
              symbol: { type: 'string' },
              kind: { type: 'string' },
              line: { type: 'number' },
              projectPath: { type: 'string' },
            },
            required: ['file'],
          },
        },
        related: {
          type: 'array',
          description:
            'Soft related_to ids — overview hubs / series. Prefer typed `links` for solves/verifies.',
          items: { type: 'string' },
        },
        links: {
          type: 'array',
          description:
            'Typed edges: [{ id, relation }]. relation one of: solves | verifies | results_in | part_of | derives_from | supersedes | contradicts | related_to.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              relation: { type: 'string', enum: RelationTypeEnum.options },
            },
            required: ['id', 'relation'],
          },
        },
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
      'Export the knowledge vault (sensitive). Formats: tar.gz or git directory layout. Optional project/type filters; git may initGit.',
    effect: 'sensitive',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['tar.gz', 'git'] },
        output: { type: 'string' },
        project: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional project filter',
        },
        type: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional knowledge type filter',
        },
        initGit: {
          type: 'boolean',
          description: 'When format=git, run git init + commit',
        },
      },
    },
  },
  {
    name: 'kmind_import',
    description:
      'Import vault from tar.gz or git directory (sensitive). Supports merge + conflict policy.',
    effect: 'sensitive',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'Archive path or git export dir' },
        format: { type: 'string', enum: ['tar.gz', 'git'] },
        merge: { type: 'boolean', default: false },
        conflict: {
          type: 'string',
          enum: ['skip', 'overwrite', 'rename'],
          default: 'skip',
        },
      },
      required: ['input'],
    },
  },
];
