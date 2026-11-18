# MCP Tools

Effect levels: `read` | `write` | `sensitive`

| Tool | Effect | Description |
|:---|:---|:---|
| `kmind_search` | read | Hybrid search; pass `k-YYYY-MM-DD-NNN` or `k-YYYY-MM-DD-NNN-<4hex>` for exact id lookup; manual captures ranked above session dumps |
| `kmind_pack` | read | **ADR-002 Context Pack:** focus + ego + anchors + `anchorImpact` (callers + co-cites, ADR-003) + problem status (structured recall for Agents; not LLM answers). Prefer over raw search when answering from vault |
| `kmind_get` | read | Fetch one asset by exact id (prefer over search when id is known) |
| `kmind_related` | read | Related assets by graph |
| `kmind_problem_status` | read | Problem resolution: `open` / `addressed` / `verified` via `solves` + `verifies` |
| `kmind_coverage` | read | **Depth vs catalog:** `complete` + issues/nextActions for a `project` (+ optional `topic`/`hubId`). Also `broken_anchor_path` / `expired_asset`, plus `protocolViolation` + `recentRecall` (24h; warn only for session pollution / no recall). Includes `type_mono` / `type_homogeneous` / `bootstrap_done_without_hub`, `metrics`, and **`quality`**（覆盖率·内容·种类三维分数）. Required before claiming「知识已完整」; search hits alone ≠ complete. CLI alias: `kmind quality` |
| `kmind_bootstrap_preview` | read | **ADR-004 init plan:** select→group→types (+ optional LLM). `BootstrapPlan`. Optional `repoPath`. Not complete. |
| `kmind_bootstrap_status` | read | Bootstrap dig progress (`audit/bootstrap-progress.json`) |
| `kmind_bootstrap_mark` | write | Mark DigTask `todo\|capturing\|done` (optional `assetId`); no capture |
| `kmind_bootstrap_delegate` | read | DigPacket for one `groupLabel`, or list groups with `recommendedNext` + `stats`; host-agent dig checklist |
| `kmind_status` | read | Vault health stats |
| `kmind_recall_stats` | read | **ADR-002 M6** local recall stats from `audit/search-queries` (`emptyRate`, pack vs search, `topFocusIds`). Optional `project` / `windowHours` (1–168) |
| `kmind_recall_feedback` | write | Local usefulness feedback → `audit/recall-feedback` JSONL only (never mutates knowledge) |
| `kmind_ontology_describe` | read | Ontology class/relation info |
| `kmind_asset_types` | read | ADR-001 asset type registry: scaffold / guidance / requiredSections / rules (enabled by default; `includeDisabled` / `id`) |
| `kmind_evolution_queue` | read | **ADR-002 evolution todos:** coverage + lint queue (`refresh` to rescan). Diagnosis only — never auto-captures |
| `kmind_capture_suggest` | read | **ADR-002 smart write:** duplicates / type retype / hub / links / anchors / quality; `proposedCapture` includes registry `guidance`/`scaffold`. Do not default `architecture_design`. Show to human; merge `apply` into capture on confirm. Does not write |
| `kmind_capture_propose` | write | Stage `CaptureProposal` under `audit/proposals` (no knowledge write). Optional when `capture.twoPhase=true` |
| `kmind_capture_commit` | write | Commit staged proposal by `proposalId` (same capture path; second commit fails) |
| `kmind_capture` | write | Capture confirmed knowledge (prefer `kmind_capture_suggest` first; pass `title` + `type` + optional `anchors` / `related` / `links` / `bootstrapTask`). **Type** must be enabled in registry. **Quality gate** failure also returns `suggestions`. Success returns `coverage` + `claimCompleteAllowed`; optional `bootstrapMarked` when DigTask mark succeeds |
| `kmind_retire_expired` | write | Retire expired cards: `list` / `deprecate` / `supersede` / `refresh` / `deprecate-all` (prefer `dryRun`). Closes `expired_asset` coverage gaps |
| `kmind_graph_query` | sensitive | Cypher-like graph query |
| `kmind_export` | sensitive | Export vault (`tar.gz` / `git`；可选 project/type；`initGit`) |
| `kmind_import` | sensitive | Import vault（`merge` + `conflict`: skip/overwrite/rename） |

Write/sensitive tools require confirmation or `autoApprove` whitelist (M2).

**System ingest hygiene:** 「整理某系统」— `kmind_bootstrap_preview` → per group `kmind_bootstrap_delegate` → dig → `capture_suggest`→`capture` (optional `bootstrapTask` / `kmind_bootstrap_mark`) → hub → `kmind_coverage`. Bootstrap/DigPacket ≠ complete. Optional: `kmind bootstrap apply-tree|sync-tree|status|mark`. Do not claim complete under `type_mono`.

**Capture hygiene:** default `capture.compileSessions=false` — adapter session JSONL stays in `raw/` and is not promoted to knowledge unless you opt in. Same raw path updates the same asset id (no churn). Use CLI `kmind purge-sessions` to drop noisy session-derived assets after a polluted compile.

**Lint:** `kmind lint` includes `coverage_*` rules (shallow children, duplicate overviews, empty hubs).
