import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  createQueryEngine,
  createVault,
  SqliteStore,
  type Vault,
} from '@kmind/core';
import { MCP_TOOLS } from './tools.js';
import { handleToolCall } from './handlers.js';

/**
 * Start KMind MCP server over stdio.
 */
export async function startMcpServer(vaultRoot?: string): Promise<void> {
  const vault = createVault(vaultRoot);
  if (!(await vault.exists())) {
    await vault.init();
  }
  const store = new SqliteStore(vault.indexPath);
  await store.migrate();
  const engine = createQueryEngine(vault, store);
  const config = await vault.getConfig();

  const server = new Server(
    { name: 'kmind', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return handleToolCall(req.params.name, req.params.arguments as Record<string, unknown>, {
      vault,
      engine,
      store,
      autoApprove: config.mcp.autoApprove,
    });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { createVault, type Vault };
