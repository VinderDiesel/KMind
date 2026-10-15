import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'packages/core/src/storage/migrations/schema.sql');
const dest = join(root, 'packages/core/dist/storage/migrations/schema.sql');
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
