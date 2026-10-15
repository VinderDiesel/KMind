# MCP Tools

Effect levels: `read` | `write` | `sensitive`

| Tool | Effect | Description |
|:---|:---|:---|
| `kmind_search` | read | Hybrid search |
| `kmind_related` | read | Related assets by graph |
| `kmind_status` | read | Vault health stats |
| `kmind_ontology_describe` | read | Ontology class/relation info |
| `kmind_capture` | write | Manually capture knowledge |
| `kmind_graph_query` | sensitive | Cypher-like graph query |
| `kmind_export` | sensitive | Export vault |

Write/sensitive tools require confirmation or `autoApprove` whitelist (M2).
