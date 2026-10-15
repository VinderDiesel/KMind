# Contributing to KMind

Thank you for contributing. Please follow these guidelines.

## Development setup

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Workflow

1. Fork and create a feature branch from `main`.
2. Keep each PR focused on one change.
3. Add or update tests for new behavior.
4. Update docs in the same PR when schemas or public APIs change.
5. Ensure `pnpm test && pnpm typecheck` pass before requesting review.

## Code style

- TypeScript strict mode; public APIs must be typed.
- Zod for all external input validation.
- Parameterized SQL only; `path.join` for filesystem paths.
- Commit messages: `feat:` / `fix:` / `docs:` / `test:` / `refactor:` / `chore:`

## PR review standards

- Must not break R-01–R-08 iron rules.
- Adapter packages must stay under 200 lines and pass contract tests.
- Schema changes require updates to `docs/DATA_CONTRACTS.md`.

## DCO

All commits must include a `Signed-off-by` line (Developer Certificate of Origin).
