import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { withResolvedMcpLaunch } from './adapters.js';

describe('withResolvedMcpLaunch', () => {
  it('given no vault when resolve then args are cli + mcp-serve', () => {
    const cli = '/tmp/kmind-cli.js';
    const out = withResolvedMcpLaunch(
      { mcpServers: { kmind: { command: 'kmind', args: ['mcp-serve'] } } },
      { cliEntry: cli },
    );
    const kmind = (out.mcpServers as Record<string, { args: string[] }>).kmind;
    expect(kmind.args).toEqual([cli, 'mcp-serve']);
  });

  it('given vault when resolve then injects --vault before mcp-serve', () => {
    const cli = '/tmp/kmind-cli.js';
    const vault = '/repos/app/.kmind-knowledge';
    const out = withResolvedMcpLaunch(
      { mcpServers: { kmind: { command: 'kmind' } } },
      { cliEntry: cli, vault },
    );
    const kmind = (out.mcpServers as Record<string, { args: string[] }>).kmind;
    expect(kmind.args).toEqual([
      cli,
      '--vault',
      path.resolve(vault),
      'mcp-serve',
    ]);
  });
});
