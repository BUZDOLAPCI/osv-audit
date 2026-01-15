import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

interface HttpTransportOptions {
  host: string;
  port: number;
}

export function createHttpTransport(
  server: Server,
  options: HttpTransportOptions
): { start: () => Promise<void>; stop: () => Promise<void> } {
  let httpServer: ReturnType<typeof createServer> | null = null;

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString('utf-8');
      const request = JSON.parse(body);

      // Process through MCP server
      // Note: This is a simplified HTTP adapter - for production use,
      // consider using the official MCP HTTP transport when available
      const response = await processRequest(server, request);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  };

  return {
    start: async () => {
      return new Promise((resolve, reject) => {
        httpServer = createServer((req, res) => {
          handleRequest(req, res).catch((err) => {
            console.error('Request handler error:', err);
            if (!res.headersSent) {
              res.writeHead(500);
              res.end('Internal Server Error');
            }
          });
        });

        httpServer.on('error', reject);
        httpServer.listen(options.port, options.host, () => {
          console.log(`HTTP server listening on http://${options.host}:${options.port}`);
          resolve();
        });
      });
    },
    stop: async () => {
      return new Promise((resolve, reject) => {
        if (httpServer) {
          httpServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    },
  };
}

// Simplified request processor for HTTP transport
async function processRequest(server: Server, request: unknown): Promise<unknown> {
  // This is a placeholder - in a real implementation, we'd need to
  // properly route requests through the MCP protocol
  // For now, we return a basic response indicating HTTP mode
  return {
    jsonrpc: '2.0',
    id: (request as { id?: string | number })?.id ?? null,
    result: {
      message: 'HTTP transport active. Use stdio transport for full MCP compatibility.',
    },
  };
}
