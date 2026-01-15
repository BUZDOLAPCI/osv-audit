import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server.js';

describe('MCP Server E2E', () => {
  let client: Client;
  let serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[0];
  let clientTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1];

  beforeEach(async () => {
    const server = createServer();
    [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  describe('Tool listing', () => {
    it('should list all available tools', async () => {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(3);

      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toContain('parse_dependencies');
      expect(toolNames).toContain('osv_query');
      expect(toolNames).toContain('suggest_fixes');
    });

    it('should have correct schema for parse_dependencies', async () => {
      const result = await client.listTools();
      const parseTool = result.tools.find((t) => t.name === 'parse_dependencies');

      expect(parseTool).toBeDefined();
      expect(parseTool?.inputSchema.properties).toHaveProperty('text');
      expect(parseTool?.inputSchema.properties).toHaveProperty('manifest_type');
      expect(parseTool?.inputSchema.required).toContain('text');
      expect(parseTool?.inputSchema.required).toContain('manifest_type');
    });
  });

  describe('parse_dependencies tool', () => {
    it('should parse package-lock.json successfully', async () => {
      const packageLock = JSON.stringify({
        packages: {
          '': { name: 'test', version: '1.0.0' },
          'node_modules/lodash': { version: '4.17.21' },
        },
      });

      const result = await client.callTool({
        name: 'parse_dependencies',
        arguments: {
          text: packageLock,
          manifest_type: 'package-lock',
        },
      });

      expect(result.content).toHaveLength(1);

      const content = result.content[0];
      expect(content).toHaveProperty('type', 'text');

      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);
        expect(response.ok).toBe(true);
        expect(response.data.dependencies).toHaveLength(1);
        expect(response.data.dependencies[0]).toEqual({
          ecosystem: 'npm',
          name: 'lodash',
          version: '4.17.21',
        });
      }
    });

    it('should parse requirements.txt successfully', async () => {
      const requirements = `
requests==2.31.0
flask>=2.0.0
`;

      const result = await client.callTool({
        name: 'parse_dependencies',
        arguments: {
          text: requirements,
          manifest_type: 'requirements',
        },
      });

      const content = result.content[0];
      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);
        expect(response.ok).toBe(true);
        expect(response.data.dependencies).toHaveLength(2);
        expect(response.data.dependencies[0].ecosystem).toBe('PyPI');
      }
    });

    it('should return error for invalid input', async () => {
      const result = await client.callTool({
        name: 'parse_dependencies',
        arguments: {
          text: '',
          manifest_type: 'package-lock',
        },
      });

      const content = result.content[0];
      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('INVALID_INPUT');
      }
    });
  });

  describe('suggest_fixes tool', () => {
    it('should suggest fixes for vulnerabilities', async () => {
      const vulnResults = [
        {
          dependency: { ecosystem: 'npm', name: 'lodash', version: '4.17.20' },
          vulnerabilities: [
            {
              id: 'GHSA-test',
              summary: 'Test vulnerability',
              severity: 'HIGH',
              severity_score: 8.0,
              fixed_versions: ['4.17.21'],
              aliases: ['CVE-2021-test'],
              references: [],
            },
          ],
        },
      ];

      const result = await client.callTool({
        name: 'suggest_fixes',
        arguments: { vuln_results: vulnResults },
      });

      const content = result.content[0];
      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);
        expect(response.ok).toBe(true);
        expect(response.data.suggestions).toHaveLength(1);
        expect(response.data.suggestions[0]).toMatchObject({
          package: 'lodash',
          current_version: '4.17.20',
          suggested_version: '4.17.21',
          action: 'upgrade',
        });
      }
    });

    it('should handle empty vulnerability results', async () => {
      const result = await client.callTool({
        name: 'suggest_fixes',
        arguments: { vuln_results: [] },
      });

      const content = result.content[0];
      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);
        expect(response.ok).toBe(true);
        expect(response.data.suggestions).toHaveLength(0);
      }
    });
  });

  describe('Unknown tool handling', () => {
    it('should return error for unknown tool', async () => {
      const result = await client.callTool({
        name: 'unknown_tool',
        arguments: {},
      });

      expect(result.isError).toBe(true);

      const content = result.content[0];
      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);
        expect(response.ok).toBe(false);
        expect(response.error.code).toBe('INVALID_INPUT');
        expect(response.error.message).toContain('unknown_tool');
      }
    });
  });

  describe('Response envelope format', () => {
    it('should return responses in standard envelope format', async () => {
      const result = await client.callTool({
        name: 'parse_dependencies',
        arguments: {
          text: JSON.stringify({ packages: {} }),
          manifest_type: 'package-lock',
        },
      });

      const content = result.content[0];
      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);

        // Check envelope structure
        expect(response).toHaveProperty('ok');
        expect(response).toHaveProperty('meta');
        expect(response.meta).toHaveProperty('retrieved_at');

        if (response.ok) {
          expect(response).toHaveProperty('data');
        } else {
          expect(response).toHaveProperty('error');
          expect(response.error).toHaveProperty('code');
          expect(response.error).toHaveProperty('message');
        }
      }
    });

    it('should include warnings in meta', async () => {
      const result = await client.callTool({
        name: 'parse_dependencies',
        arguments: {
          text: JSON.stringify({ packages: {} }),
          manifest_type: 'package-lock',
        },
      });

      const content = result.content[0];
      if (content && 'text' in content) {
        const response = JSON.parse(content.text as string);
        expect(response.meta.warnings).toContain('No dependencies found in manifest');
      }
    });
  });

  describe('Integration workflow', () => {
    it('should support full parse -> suggest workflow', async () => {
      // Step 1: Parse dependencies
      const packageLock = JSON.stringify({
        packages: {
          '': { name: 'test', version: '1.0.0' },
          'node_modules/vulnerable-pkg': { version: '1.0.0' },
        },
      });

      const parseResult = await client.callTool({
        name: 'parse_dependencies',
        arguments: {
          text: packageLock,
          manifest_type: 'package-lock',
        },
      });

      const parseContent = parseResult.content[0];
      let dependencies: unknown[] = [];
      if (parseContent && 'text' in parseContent) {
        const response = JSON.parse(parseContent.text as string);
        expect(response.ok).toBe(true);
        dependencies = response.data.dependencies;
      }

      // Step 2: Mock vulnerability data and suggest fixes
      const vulnResults = [
        {
          dependency: dependencies[0],
          vulnerabilities: [
            {
              id: 'VULN-001',
              summary: 'Test vuln',
              severity: 'HIGH',
              severity_score: 8.5,
              fixed_versions: ['1.0.1'],
              aliases: [],
              references: [],
            },
          ],
        },
      ];

      const suggestResult = await client.callTool({
        name: 'suggest_fixes',
        arguments: { vuln_results: vulnResults },
      });

      const suggestContent = suggestResult.content[0];
      if (suggestContent && 'text' in suggestContent) {
        const response = JSON.parse(suggestContent.text as string);
        expect(response.ok).toBe(true);
        expect(response.data.suggestions).toHaveLength(1);
        expect(response.data.suggestions[0].action).toBe('upgrade');
      }
    });
  });
});
