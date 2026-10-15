# @kmind/mcp-server Contract

## Tool effects

| Effect | Tools | Default policy |
|:---|:---|:---|
| `read` | search, related, status, ontology_describe | allow |
| `write` | capture | confirm or autoApprove |
| `sensitive` | export, graph_query | confirm or autoApprove |

Handlers depend on `QueryEngine` / domain services only — never on SQLite directly.
