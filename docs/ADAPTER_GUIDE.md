# Adapter Guide

Each adapter implements the `Adapter` interface from `@kmind/core`:

- `detect()` — is the terminal installed?
- `getSessionPaths()` — glob patterns for session files
- `parseSession(path)` — parse to `SessionRecord`
- `getMcpConfig()` — MCP config template
- `getLifecycleHooks?()` — optional hooks

## Rules

- New adapter &lt; 200 lines of source
- Must pass `tests/contract/adapter.contract.ts`
- Package name: `@kmind/adapter-<name>`
- Depend only on `@kmind/shared` and `@kmind/core` public APIs

## Built-in adapters

| Name | Package |
|:---|:---|
| claude-code | `@kmind/adapter-claude-code` |
| cursor | `@kmind/adapter-cursor` |
| qoder | `@kmind/adapter-qoder` |
| codex | `@kmind/adapter-codex` |
| kiro | `@kmind/adapter-kiro` |

## Agent Skills

Bundled skills live in repo `skills/` (also shipped as `packages/cli/skills/`):

| Skill | Role |
|:---|:---|
| `kmind-capture` | High-quality vault writes (search → template capture) |
| `kmind-code-bridge` | Route structure Qs to Codegraph, experience Qs to KMind; optional code anchors on capture |

| Command | Effect |
|:---|:---|
| `kmind adapters install <name>` | MCP + copy skills → `~/.<tool>/skills/` |
| `kmind skills install --all` | Skills only, every supported terminal |
| `kmind skills install <name> --project` | Skills → `./.<tool>/skills/` (git-shareable) |

| Terminal | Global skills dir |
|:---|:---|
| cursor | `~/.cursor/skills` |
| claude-code | `~/.claude/skills` |
| codex | `~/.codex/skills` |
| kiro | `~/.kiro/skills` |
| qoder | `~/.qoder/skills` |
