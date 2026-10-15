# Data Contracts

Canonical Zod schemas live in `packages/shared/src/schemas/`.

## Knowledge asset

- ID pattern: `k-YYYY-MM-DD-NNN`
- Types: `problem_solution` | `best_practice` | `architecture_design` | `tool_usage` | `pitfall` | `code_snippet` | `process_spec`
- Status: `draft` | `reviewed` | `published` | `deprecated`
- Markdown frontmatter + body via gray-matter

## Ontology

- Version: `MAJOR.MINOR`
- Classes with inheritance (`parent`)
- Relations: `derives_from`, `supersedes`, `contradicts`, `related_to`, `mentions`

## Config

- Vault path, embedding, capture, adapters, healthCheck

## SQLite

See `packages/core/src/storage/migrations/schema.sql`.
Index must be rebuildable from Markdown (`rebuildFromMarkdown`).
