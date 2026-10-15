import { startMcpServer } from '@kmind/mcp-server';

/**
 * Start MCP server (stdio).
 */
export async function cmdMcpServe(vault?: string): Promise<void> {
  await startMcpServer(vault);
}
