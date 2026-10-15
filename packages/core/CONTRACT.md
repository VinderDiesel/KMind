# @kmind/core Contract

Interaction boundaries take priority over package boundaries.

## Public surfaces

| Surface | Location | Consumers |
|:---|:---|:---|
| `Vault` | `storage/vault.ts` | cli, mcp-server, compiler, query |
| `CompilePipeline` | `compiler/pipeline.ts` | cli |
| `Adapter` | `adapters/types.ts` | adapters/*, cli |
| `QueryEngine` | `query/types.ts` | cli, mcp-server |
| `OntologyRegistry` | `ontology/ontology-registry.ts` | compiler, mcp-server |

## Rules

- core MUST NOT import any `@kmind/adapter-*` package.
- All SQL is parameterized.
- Raw layer is append-only; knowledge writes always start from Raw (R-02).
- SQLite index MUST be rebuildable from Markdown (R-03).
