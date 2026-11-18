import { describe, expect, it } from 'vitest';
import { matchPathGlob } from './glob.js';

describe('matchPathGlob', () => {
  it('given **/*.ts when match then accepts nested ts', () => {
    expect(matchPathGlob('**/*.ts', 'packages/core/src/a.ts')).toBe(true);
    expect(matchPathGlob('**/*.ts', 'packages/core/src/a.js')).toBe(false);
  });

  it('given packages/cli/** when match then scoped', () => {
    expect(matchPathGlob('packages/cli/**', 'packages/cli/src/commands')).toBe(
      true,
    );
    expect(matchPathGlob('packages/cli/**', 'packages/core/src')).toBe(false);
  });
});
