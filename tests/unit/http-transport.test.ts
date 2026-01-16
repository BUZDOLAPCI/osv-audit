import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHttpTransport } from '../../src/transport/http.js';
import { createStandaloneServer } from '../../src/server.js';

describe('HTTP Transport /mcp endpoint', () => {
  let transport: ReturnType<typeof createHttpTransport>;
  const TEST_PORT = 18080;
  const TEST_HOST = '127.0.0.1';
  const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;

  beforeAll(async () => {
    transport = createHttpTransport(createStandaloneServer, {
      host: TEST_HOST,
      port: TEST_PORT,
    });
    await transport.start();
  });

  afterAll(async () => {
    await transport.stop();
  });

  it('should respond to /health endpoint', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data).toHaveProperty('activeSessions');
    expect(data).toHaveProperty('timestamp');
  });

  it('should respond to /mcp endpoint with tools/list JSON-RPC request', async () => {
    // First request to establish session and initialize
    // MCP Streamable HTTP requires Accept header with both application/json and text/event-stream
    const initResponse = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0',
          },
        },
      }),
    });

    expect(initResponse.status).toBe(200);
    const sessionId = initResponse.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();

    // Parse initialization response - it could be SSE or JSON
    const initText = await initResponse.text();
    let initResult: unknown;
    if (initText.includes('event:') || initText.includes('data:')) {
      // Parse SSE format - find the message event
      const lines = initText.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const jsonData = line.substring(5).trim();
          if (jsonData) {
            initResult = JSON.parse(jsonData);
            break;
          }
        }
      }
    } else {
      initResult = JSON.parse(initText);
    }

    expect(initResult).toBeDefined();

    // Now send tools/list request with the session ID
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId!,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(response.status).toBe(200);

    const text = await response.text();
    // The response may be SSE format or JSON
    // Parse the response - it could be in SSE format
    let result: unknown;
    if (text.includes('event:') || text.includes('data:')) {
      // Parse SSE format - find the message event
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const jsonData = line.substring(5).trim();
          if (jsonData) {
            result = JSON.parse(jsonData);
            break;
          }
        }
      }
    } else {
      result = JSON.parse(text);
    }

    expect(result).toBeDefined();

    // Check the result structure
    const jsonRpcResult = result as { jsonrpc: string; id: number; result?: { tools: unknown[] } };
    expect(jsonRpcResult.jsonrpc).toBe('2.0');
    expect(jsonRpcResult.id).toBe(2);
    expect(jsonRpcResult.result).toBeDefined();
    expect(jsonRpcResult.result!.tools).toBeInstanceOf(Array);

    // Verify the expected tools are present
    const tools = jsonRpcResult.result!.tools as Array<{ name: string }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('parse_dependencies');
    expect(toolNames).toContain('osv_query');
    expect(toolNames).toContain('suggest_fixes');
  });

  it('should return 404 for unknown endpoints', async () => {
    const response = await fetch(`${BASE_URL}/unknown`);
    expect(response.status).toBe(404);
  });

  it('should handle CORS preflight requests', async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'OPTIONS',
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
