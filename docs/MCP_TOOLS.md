# MCP Tools

Effect levels: `read` | `write` | `sensitive`

| Tool | Effect | Description |
|:---|:---|:---|
| `kmind_search` | read | Hybrid search; pass `k-YYYY-MM-DD-NNN` for exact id lookup; manual captures ranked above session dumps |
| `kmind_get` | read | Fetch one asset by exact id (prefer over search when id is known) |
| `kmind_related` | read | Related assets by graph |
| `kmind_problem_status` | read | Problem resolution: `open` / `addressed` / `verified` via `solves` + `verifies` |
| `kmind_coverage` | read | **Depth vs catalog:** `complete` + issues/nextActions for a `project` (+ optional `topic`/`hubId`). Required before claiming「知识已完整」; search hits alone ≠ complete |
| `kmind_status` | read | Vault health stats |
| `kmind_ontology_describe` | read | Ontology class/relation info |
| `kmind_capture` | write | Capture confirmed knowledge (search first; pass `title` + `type` + optional `anchors` / `related` / `links`). Types include `problem` + `outcome`. **Quality gate:** detail + one-topic; overview thin + `related[]` to non-shallow children; outcome requires `links.verifies`. Success returns `coverage` + `claimCompleteAllowed` |
| `kmind_graph_query` | sensitive | Cypher-like graph query |
| `kmind_export` | sensitive | Export vault (`tar.gz` / `git`；可选 project/type；`initGit`) |
| `kmind_import` | sensitive | Import vault（`merge` + `conflict`: skip/overwrite/rename） |

Write/sensitive tools require confirmation or `autoApprove` whitelist (M2).

**System ingest hygiene:** 「整理某系统」must run four stages (inventory → dig → capture details → hub) then `kmind_coverage`. Do not stop at re-linking an overview. CLI: `kmind coverage --project <p> --topic <t>`.

**Capture hygiene:** default `capture.compileSessions=false` — adapter session JSONL stays in `raw/` and is not promoted to knowledge unless you opt in. Same raw path updates the same asset id (no churn). Use CLI `kmind purge-sessions` to drop noisy session-derived assets after a polluted compile.

**Lint:** `kmind lint` includes `coverage_*` rules (shallow children, duplicate overviews, empty hubs).
