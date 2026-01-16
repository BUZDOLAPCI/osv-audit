import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { parseDependencies, osvQuery, suggestFixes } from '../tools/index.js';
import {
  ParseDependenciesInputSchema,
  OSVQueryInputSchema,
  SuggestFixesInputSchema,
} from '../types.js';
import { config } from '../config.js';

// ============================================================================
// JSON-RPC Types
// ============================================================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

const toolDefinitions = [
  {
    name: 'parse_dependencies',
    description:
      'Parse a dependency manifest file and extract package names/versions. Supports package-lock.json, pnpm-lock.yaml, yarn.lock, requirements.txt, poetry.lock, go.mod, and Cargo.lock.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The content of the dependency manifest file',
        },
        manifest_type: {
          type: 'string',
          enum: [
            'package-lock',
            'pnpm-lock',
            'yarn-lock',
            'requirements',
            'poetry-lock',
            'go-mod',
            'cargo-lock',
          ],
          description: 'The type of manifest file',
        },
      },
      required: ['text', 'manifest_type'],
    },
  },
  {
    name: 'osv_query',
    description:
      'Query OSV.dev API for vulnerabilities affecting the given dependencies. Returns vulnerability details including severity, affected versions, and fixed versions.',
    inputSchema: {
      type: 'object',
      properties: {
        dependencies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ecosystem: {
                type: 'string',
                description: 'The package ecosystem (npm, PyPI, Go, crates.io)',
              },
              name: {
                type: 'string',
                description: 'The package name',
              },
              version: {
                type: 'string',
                description: 'The package version (optional)',
              },
            },
            required: ['ecosystem', 'name'],
          },
          description: 'Array of dependencies to check for vulnerabilities',
        },
      },
      required: ['dependencies'],
    },
  },
  {
    name: 'suggest_fixes',
    description:
      'Analyze vulnerability results and suggest version upgrades or mitigations. Returns prioritized fix suggestions based on severity.',
    inputSchema: {
      type: 'object',
      properties: {
        vuln_results: {
          type: 'array',
          description: 'Vulnerability results from osv_query tool',
          items: {
            type: 'object',
            properties: {
              dependency: {
                type: 'object',
                properties: {
                  ecosystem: { type: 'string' },
                  name: { type: 'string' },
                  version: { type: 'string' },
                },
              },
              vulnerabilities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    summary: { type: 'string' },
                    severity: { type: ['string', 'null'] },
                    severity_score: { type: ['number', 'null'] },
                    fixed_versions: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    aliases: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                    references: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: { type: 'string' },
                          url: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      required: ['vuln_results'],
    },
  },
];

// ============================================================================
// JSON-RPC Request Handler
// ============================================================================

/**
 * Handle a single JSON-RPC request
 */
async function handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'osv-audit',
              version: '1.0.0',
            },
          },
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: toolDefinitions,
          },
        };
      }

      case 'tools/call': {
        const toolName = params?.name as string;
        const args = params?.arguments as Record<string, unknown>;

        let result: unknown;

        switch (toolName) {
          case 'parse_dependencies': {
            const input = ParseDependenciesInputSchema.parse(args);
            result = await parseDependencies(input);
            break;
          }

          case 'osv_query': {
            const input = OSVQueryInputSchema.parse(args);
            result = await osvQuery(input);
            break;
          }

          case 'suggest_fixes': {
            const input = SuggestFixesInputSchema.parse(args);
            result = await suggestFixes(input);
            break;
          }

          default:
            return {
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Unknown tool: ${toolName}`,
              },
            };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Internal error: ${message}`,
      },
    };
  }
}

// ============================================================================
// HTTP Helpers
// ============================================================================

/**
 * Read the request body as a string
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * Send a JSON response
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Handle health check endpoint
 */
function handleHealthCheck(res: ServerResponse): void {
  sendJson(res, 200, { status: 'ok', service: 'osv-audit' });
}

/**
 * Handle not found
 */
function handleNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not found' });
}

/**
 * Handle method not allowed
 */
function handleMethodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method not allowed' });
}

/**
 * Handle MCP JSON-RPC endpoint
 */
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readBody(req);
    const request: JsonRpcRequest = JSON.parse(body);

    if (!request.jsonrpc || request.jsonrpc !== '2.0') {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        id: request.id || 0,
        error: {
          code: -32600,
          message: 'Invalid Request: missing or invalid jsonrpc version',
        },
      });
      return;
    }

    const response = await handleJsonRpcRequest(request);
    sendJson(res, 200, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  }
}

// ============================================================================
// HTTP Server
// ============================================================================

/**
 * Create and configure the HTTP server
 */
export function createHttpServer(): Server {
  const httpServer = createServer();

  httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
    const method = req.method?.toUpperCase();

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      switch (url.pathname) {
        case '/mcp':
          if (method === 'POST') {
            await handleMcpRequest(req, res);
          } else {
            handleMethodNotAllowed(res);
          }
          break;

        case '/health':
          if (method === 'GET') {
            handleHealthCheck(res);
          } else {
            handleMethodNotAllowed(res);
          }
          break;

        default:
          handleNotFound(res);
      }
    } catch (error) {
      console.error('Server error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  return httpServer;
}

/**
 * Create HTTP transport for osv-audit server
 */
export function createHttpTransport(options?: { host?: string; port?: number }): {
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const host = options?.host ?? config.host;
  const port = options?.port ?? config.port;
  let httpServer: Server | null = null;

  return {
    start: async () => {
      return new Promise((resolve, reject) => {
        httpServer = createHttpServer();

        httpServer.on('error', reject);
        httpServer.listen(port, host, () => {
          console.log(`osv-audit HTTP server listening on http://${host}:${port}`);
          console.log(`MCP endpoint: http://${host}:${port}/mcp`);
          console.log(`Health check: http://${host}:${port}/health`);
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
