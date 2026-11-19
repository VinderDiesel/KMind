import { describe, expect, it } from 'vitest';
import {
  buildSymbolQueries,
  filePathMatches,
  symbolNameMatches,
} from './cli-client.js';

describe('buildSymbolQueries', () => {
  it('given java file when build then qualified query comes first', () => {
    expect(buildSymbolQueries('resolve', 'a/b/AskAgentRouter.java')).toEqual([
      'AskAgentRouter.resolve',
      'resolve',
    ]);
  });

  it('given no file when build then bare symbol only', () => {
    expect(buildSymbolQueries('resolve')).toEqual(['resolve']);
  });

  it('given file stem equal to symbol when build then dedupes', () => {
    expect(buildSymbolQueries('resolve', 'lib/resolve.ts')).toEqual(['resolve']);
  });
});

describe('symbolNameMatches', () => {
  it('given exact name when match then true', () => {
    expect(symbolNameMatches('routeAsk', 'routeAsk')).toBe(true);
  });

  it('given qualified suffix when match then true', () => {
    expect(
      symbolNameMatches('routeAsk', 'x', 'mod.routeAsk'),
    ).toBe(true);
  });

  it('given unrelated when match then false', () => {
    expect(symbolNameMatches('routeAsk', 'other')).toBe(false);
  });
});

describe('filePathMatches', () => {
  it('given suffix path when match then true', () => {
    expect(
      filePathMatches(
        'packages/core/src/query/coverage.ts',
        'Users/x/kmind/packages/core/src/query/coverage.ts',
      ),
    ).toBe(true);
  });

  it('given different basename when match then false', () => {
    expect(filePathMatches('a.ts', 'b.ts')).toBe(false);
  });
});
