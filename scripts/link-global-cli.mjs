#!/usr/bin/env node
/**
 * After build / postinstall: expose `kmind` on PATH from anywhere.
 *
 * Writes an executable wrapper to ~/.local/bin/kmind that runs this repo's
 * packages/cli/dist/index.js (no sudo; works with pnpm 9–12).
 */
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(root, 'packages', 'cli', 'dist', 'index.js');

if (!existsSync(cliEntry)) {
  console.error(
    `[kmind] skip global link: missing ${cliEntry} (run pnpm build first)`,
  );
  process.exit(0);
}

try {
  chmodSync(cliEntry, 0o755);
} catch {
  /* ignore */
}

const localBin = path.join(homedir(), '.local', 'bin');
mkdirSync(localBin, { recursive: true });
const wrapperPath = path.join(localBin, 'kmind');

const wrapper = `#!/usr/bin/env bash
set -euo pipefail
ENTRY=${JSON.stringify(cliEntry)}
if [[ ! -f "$ENTRY" ]]; then
  echo "kmind: CLI entry missing: $ENTRY" >&2
  echo "Rebuild from the KMind repo: pnpm build && pnpm link:cli" >&2
  exit 1
fi
exec node "$ENTRY" "$@"
`;

try {
  writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
  chmodSync(wrapperPath, 0o755);
  console.log(`[kmind] installed ${wrapperPath}`);
  console.log(`[kmind] → ${cliEntry}`);
} catch (err) {
  console.error(
    '[kmind] failed to write ~/.local/bin/kmind:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}

if (!pathOnPath(localBin)) {
  console.log(
    `[kmind] add to shell profile if \`kmind\` is not found:\n  export PATH="${localBin}:$PATH"`,
  );
} else {
  console.log('[kmind] ready: run `kmind --help` from any directory');
}

function pathOnPath(dir) {
  const parts = (process.env.PATH || '').split(path.delimiter);
  const norm = path.resolve(dir);
  return parts.some((p) => {
    try {
      return path.resolve(p) === norm;
    } catch {
      return false;
    }
  });
}
