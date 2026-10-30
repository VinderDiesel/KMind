# Data Contracts

Canonical Zod schemas live in `packages/shared/src/schemas/`.

## Knowledge asset

- ID pattern: `k-YYYY-MM-DD-NNN`
- Types: snake_case id validated by `KnowledgeTypeIdSchema`; builtins default to `problem` | `outcome` | `problem_solution` | `best_practice` | `architecture_design` | `tool_usage` | `pitfall` | `code_snippet` | `process_spec`. Capture requires type **enabled** in Asset Type Registry (ADR-001). Disabled types: no new capture; existing cards stay readable.
- `ontologyClass`: short-term compat field (often PascalCase of `type`); product truth is `type`
- Status: `draft` | `reviewed` | `published` | `deprecated`
- Markdown frontmatter + body via gray-matter
- `related[]`: soft `related_to` edges
- `links[]`: typed edges `{ id, relation }` (`solves` | `verifies` | `results_in` | `part_of` | …)
- `metadata.codeAnchors[]`: `{ file, symbol?, kind?, line?, projectPath?, confidence }` — code citations (not full source dumps). Parsed from `## 代码锚点` bullets, `path:L42` citations, or capture `anchors` JSON.

## Asset types (ADR-001)

- Builtin defs in `@kmind/core`; vault overlays in `vault/asset-types/*.{yaml,yml,json}` (deep merge by id)
- Kernel (cannot disable): `problem`, `problem_solution`, `outcome`
- Fields: `scaffold`, `guidance`, `requiredSections`, whitelist `rules`, optional `classifyPatterns`
- MCP: `kmind_asset_types` — see [docs/adr/001-asset-type-registry.md](adr/001-asset-type-registry.md)

## Ontology

- Version: `MAJOR.MINOR`
- Classes with inheritance (`parent`) including `Problem`, `Outcome`
- Relations: `derives_from`, `supersedes`, `contradicts`, `related_to`, `mentions`, `solves`, `verifies`, `results_in`, `part_of`
- Problem resolution: inbound `solves` + `verifies` → `kmind_problem_status` (`open` | `addressed` | `verified`)

## Config

- Vault path, embedding, capture, adapters, healthCheck
- `capture.minConfidence` (default `0.6`): compile hard gate for non-manual raw
- `capture.compileSessions` (default `false`) **and** env `KMIND_COMPILE_SESSIONS=1`: double lock — sessions never become knowledge by accident
- `capture.requireQualityGate` (default `true`): pipeline rejects manual raw that fails `assessCaptureQuality` (明细 + 一卡一事)
- `capture.requireProject` (default `true`): reject missing/`global` project on manual compile/capture
- Titles always `sanitizeTitle` at compile time
- Health rule `session_pollution`: any session-sourced asset is high severity
- `healthCheck.requireCodeAnchors` (default `true`): lint `architecture_design` / `code_snippet` missing anchors

## SQLite

See `packages/core/src/storage/migrations/schema.sql`.
Index must be rebuildable from Markdown (`rebuildFromMarkdown`).
