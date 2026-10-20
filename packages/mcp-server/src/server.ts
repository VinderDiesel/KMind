import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  createQueryEngine,
  createVault,
  SqliteStore,
  type QueryEngine,
  type Vault,
} from '@kmind/core';
import type { KMindConfig } from '@kmind/shared';
import { MCP_TOOLS } from './tools.js';
import { handleToolCall } from './handlers.js';

export interface McpRuntime {
  vault: Vault;
  store: SqliteStore;
  engine: QueryEngine;
  config: KMindConfig;
}

export interface McpHttpOptions {
  vaultRoot?: string;
  host?: string;
  port?: number;
}

export interface McpHttpServer {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Open vault + store + query engine for MCP.
 */
export async function createMcpRuntime(vaultRoot?: string): Promise<McpRuntime> {
  const vault = createVault(vaultRoot);
  if (!(await vault.exists())) {
    await vault.init();
  }
  const store = new SqliteStore(vault.indexPath);
  await store.migrate();
  const engine = createQueryEngine(vault, store);
  const config = await vault.getConfig();
  return { vault, store, engine, config };
}

/**
 * Build an MCP SDK Server wired to KMind tools.
 */
export function createMcpSdkServer(runtime: McpRuntime): Server {
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
    return handleToolCall(
      req.params.name,
      req.params.arguments as Record<string, unknown>,
      {
        vault: runtime.vault,
        engine: runtime.engine,
        store: runtime.store,
        autoApprove: runtime.config.mcp.autoApprove,
      },
    );
  });

  return server;
}

/**
 * Start KMind MCP server over stdio (IDE default).
 */
export async function startMcpServer(vaultRoot?: string): Promise<void> {
  const runtime = await createMcpRuntime(vaultRoot);
  const server = createMcpSdkServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Start KMind MCP over Streamable HTTP (suitable for --daemon).
 * Listens on 127.0.0.1 by default. POST/GET/DELETE `/mcp`.
 */
export async function startMcpHttpServer(
  options: McpHttpOptions = {},
): Promise<McpHttpServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 7822;
  const runtime = await createMcpRuntime(options.vaultRoot);

  const httpServer = createServer((req, res) => {
    void handleHttpRequest(runtime, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => resolve());
  });

  const addr = httpServer.address();
  const boundPort =
    addr && typeof addr === 'object' ? addr.port : port;

  return {
    host,
    port: boundPort,
    url: `http://${host}:${boundPort}/mcp`,
    close: () =>
      new Promise((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
        runtime.store.close();
      }),
  };
}

async function handleHttpRequest(
  runtime: McpRuntime,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, name: 'kmind', transport: 'http' }));
    return;
  }

  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const server = createMcpSdkServer(runtime);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    const parsedBody = await readJsonBody(req);
    await transport.handleRequest(req, res, parsedBody);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message },
          id: null,
        }),
      );
    }
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

export { createVault, type Vault };
