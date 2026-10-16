# Architecture

KMind is a local-first knowledge system:

```
CLI / MCP Server / UI HTTP → @kmind/core → Vault (~/.kmind)
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
- `compiler` — capture → classify → **confidence gate** → map → graph → embed → index
  - Adapter raw below `capture.minConfidence` stays `pending` (`gated`, no asset)
  - Manual / `typeHint` captures bypass the gate
- `query` — fulltext / structured / graph / semantic / hybrid / ego
- `health` — lint rules
- `migration` — export / import

## Local UI (`kmind ui`)

- Package `@kmind/ui` (Vite + React + `react-force-graph-3d`) builds static assets.
- CLI serves them on `127.0.0.1:7821` (override with `--port`) plus read-only `/api/*`.
- Graph model: **ego neighborhood** with **hop shells** (default depth 2, node cap 150).
- Health: vault summary + focus-scoped issues; problem nodes weakly highlighted in the graph.
- No write APIs; capture / compile / export remain CLI or MCP.

### Read-only API

| Method | Path | Purpose |
|:---|:---|:---|
| GET | `/api/status` | Vault counters |
| GET | `/api/health` | Full health report (`issueCount`，0=无告警) |
| GET | `/api/assets?limit=` | List recent assets |
| GET | `/api/search?q=` | Hybrid search |
| GET | `/api/assets/:id` | Asset detail |
| GET | `/api/ego/:id?depth=&cap=` | Ego graph (+ health flags on nodes) |
| GET | `/api/ego/:id/health` | Issues touching the ego node set |

## Storage notes

- SQLite via Node.js built-in `node:sqlite` (no native addon; offline-friendly).
- Vectors stored as BLOB; query layer uses metadata pre-filter + cosine brute force.
- Config flags `embedding.hnswThreshold` / `quantization` reserved for adaptive HNSW / SQ8.

## Iron rules

See project `.cursorrules` (R-01–R-08).
