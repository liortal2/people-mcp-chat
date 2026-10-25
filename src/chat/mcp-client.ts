import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

export type McpClient = Client;

export class McpUnavailableError extends Error {}

// The server is stateless, so a connection per chat request is simple and costs one local round trip.
export async function withMcp<T>(url: string, fn: (client: McpClient) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'people-chat', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  } catch (err) {
    throw new McpUnavailableError(`Could not connect to the MCP server at ${url}`, { cause: err });
  }
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}
