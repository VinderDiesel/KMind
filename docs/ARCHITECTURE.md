# Architecture

KMind is a local-first knowledge system:

```
CLI / MCP Server → @kmind/core → Vault (~/.kmind)
                      ↑
                 adapters (interface only)
```

## Layers

1. **Raw** — immutable session captures (`raw/`)
2. **Knowledge** — compiled Markdown assets (`knowledge/`) — source of truth
3. **Index** — SQLite FTS + vectors + graph (`index.db`) — rebuildable via `kmind reindex`

## Core modules

- `storage` — Vault, Markdown, SQLite, blob
- `ontology` — load / validate / evolve
- `compiler` — capture → classify → map → graph → embed → index
- `query` — fulltext / structured / graph / semantic / hybrid
- `health` — lint rules
- `migration` — export / import

## Storage notes

- SQLite via Node.js built-in `node:sqlite` (no native addon; offline-friendly).
- Vectors stored as BLOB; query layer uses metadata pre-filter + cosine brute force.
- Config flags `embedding.hnswThreshold` / `quantization` reserved for adaptive HNSW / SQ8.

## Iron rules

See project `.cursorrules` (R-01–R-08).

