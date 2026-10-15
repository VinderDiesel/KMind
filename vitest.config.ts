import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    env: {
      KMIND_LOG: 'silent',
    },
    include: [
      'packages/**/src/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@kmind/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@kmind/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
});
