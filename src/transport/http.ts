import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

interface HttpTransportOptions {
  host: string;
  port: number;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

const sessions = new Map<string, Session>();

export function createHttpTransport(
  createServerFn: () => Server,
  options: HttpTransportOptions
): { start: () => Promise<void>; stop: () => Promise<void> } {
  let httpServer: HttpServer | null = null;

  const handleMcpRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Get or create session
    let sessionId = req.headers['mcp-session-id'] as string | undefined;
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      // Create new session
      sessionId = randomUUID();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId!,
      });
      const server = createServerFn();

      session = { transport, server };
      sessions.set(sessionId, session);

      // Connect server to transport
      await server.connect(transport);

      // Clean up session when transport closes
      transport.onclose = () => {
        sessions.delete(sessionId!);
      };
    }

    // Handle the request with raw Node.js objects (no third argument)
    await session.transport.handleRequest(req, res);
  };

  const handleHealthCheck = (res: ServerResponse): void => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      activeSessions: sessions.size,
      timestamp: new Date().toISOString(),
    }));
  };

  const handleNotFound = (res: ServerResponse): void => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    switch (url.pathname) {
      case '/mcp':
        await handleMcpRequest(req, res);
        break;
      case '/health':
        handleHealthCheck(res);
        break;
      default:
        handleNotFound(res);
    }
  };

  return {
    start: async () => {
      return new Promise((resolve, reject) => {
        httpServer = createServer((req, res) => {
          handleRequest(req, res).catch((err) => {
            console.error('Request handler error:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Internal Server Error' }));
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
      // Close all sessions
      for (const [sessionId, session] of sessions) {
        try {
          await session.transport.close();
        } catch (err) {
          console.error(`Error closing session ${sessionId}:`, err);
        }
      }
      sessions.clear();

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
