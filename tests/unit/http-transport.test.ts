import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHttpTransport } from '../../src/transport/http.js';

describe('HTTP Transport /mcp endpoint', () => {
  let transport: ReturnType<typeof createHttpTransport>;
  const TEST_PORT = 18080;
  const TEST_HOST = '127.0.0.1';
  const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;

  beforeAll(async () => {
    transport = createHttpTransport({
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
    expect(data.status).toBe('ok');
    expect(data.service).toBe('osv-audit');
  });

  it('should respond to /mcp endpoint with initialize JSON-RPC request', async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(1);
    expect(result.result).toBeDefined();
    expect(result.result.protocolVersion).toBe('2024-11-05');
    expect(result.result.serverInfo.name).toBe('osv-audit');
  });

  it('should respond to /mcp endpoint with tools/list JSON-RPC request', async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(2);
    expect(result.result).toBeDefined();
    expect(result.result.tools).toBeInstanceOf(Array);

    // Verify the expected tools are present
    const tools = result.result.tools as Array<{ name: string }>;
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain('parse_dependencies');
    expect(toolNames).toContain('osv_query');
    expect(toolNames).toContain('suggest_fixes');
  });

  it('should handle tools/call for parse_dependencies', async () => {
    const packageLock = JSON.stringify({
      packages: {
        '': { name: 'test', version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.21' },
      },
    });

    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'parse_dependencies',
          arguments: {
            text: packageLock,
            manifest_type: 'package-lock',
          },
        },
      }),
    });

    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(3);
    expect(result.result).toBeDefined();
    expect(result.result.content).toBeInstanceOf(Array);
    expect(result.result.content[0].type).toBe('text');

    const toolResult = JSON.parse(result.result.content[0].text);
    expect(toolResult.ok).toBe(true);
    expect(toolResult.data.dependencies).toHaveLength(1);
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

  it('should return error for unknown tool', async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {},
        },
      }),
    });

    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.id).toBe(4);
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32601);
    expect(result.error.message).toContain('unknown_tool');
  });

  it('should return error for invalid JSON-RPC request', async () => {
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 5,
        method: 'tools/list',
      }),
    });

    expect(response.status).toBe(400);

    const result = await response.json();
    expect(result.jsonrpc).toBe('2.0');
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32600);
  });
});
