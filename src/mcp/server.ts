import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { openDb } from './db.ts';
import { registerTools } from './tools.ts';

const PORT = Number(process.env.MCP_PORT ?? 3000);
const db = openDb();

// Stateless: a fresh McpServer per request, nothing is kept between calls.
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'people-directory', version: '0.1.0' });
  registerTools(server, db);
  return server;
});

// createMcpExpressApp binds to localhost and validates Host/Origin headers (DNS rebinding protection).
const app = createMcpExpressApp();
const nodeHandler = toNodeHandler(handler);
// express.json() already consumed the body stream, so hand the parsed body over.
app.all('/mcp', (req, res) => nodeHandler(req, res, req.body));

app.listen(PORT, '127.0.0.1', () => console.log(`MCP server listening on http://localhost:${PORT}/mcp`));
