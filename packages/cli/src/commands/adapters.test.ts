import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { withResolvedMcpLaunch } from './adapters.js';

describe('withResolvedMcpLaunch', () => {
  it('given mcpServers kmind placeholder when resolve then uses node absolute path', () => {
    const cli = path.join('/abs', 'KMind', 'packages', 'cli', 'dist', 'index.js');
    const out = withResolvedMcpLaunch(
      {
        mcpServers: {
          kmind: { command: 'kmind', args: ['mcp-serve'] },
          other: { command: 'echo' },
        },
      },
      cli,
    );
    expect(out).toEqual({
      mcpServers: {
        kmind: { command: 'node', args: [cli, 'mcp-serve'] },
        other: { command: 'echo' },
      },
    });
  });

  it('given mcp_servers (codex) when resolve then rewrites kmind entry', () => {
    const cli = '/tmp/kmind/packages/cli/dist/index.js';
    const out = withResolvedMcpLaunch(
      { mcp_servers: { kmind: { command: 'kmind', args: ['mcp-serve'] } } },
      cli,
    );
    expect(out.mcp_servers).toEqual({
      kmind: { command: 'node', args: [cli, 'mcp-serve'] },
    });
  });
});
