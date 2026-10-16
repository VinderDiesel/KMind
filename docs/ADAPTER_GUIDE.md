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
