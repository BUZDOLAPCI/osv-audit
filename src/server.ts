import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { parseDependencies, osvQuery, suggestFixes } from './tools/index.js';
import {
  ParseDependenciesInputSchema,
  OSVQueryInputSchema,
  SuggestFixesInputSchema,
} from './types.js';

export function createServer(): Server {
  const server = new Server(
    {
      name: 'osv-audit',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
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
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'parse_dependencies': {
          const input = ParseDependenciesInputSchema.parse(args);
          const result = await parseDependencies(input);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'osv_query': {
          const input = OSVQueryInputSchema.parse(args);
          const result = await osvQuery(input);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        case 'suggest_fixes': {
          const input = SuggestFixesInputSchema.parse(args);
          const result = await suggestFixes(input);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: false,
                  error: {
                    code: 'INVALID_INPUT',
                    message: `Unknown tool: ${name}`,
                    details: {},
                  },
                  meta: {
                    retrieved_at: new Date().toISOString(),
                  },
                }),
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: {
                code: 'INTERNAL_ERROR',
                message,
                details: {},
              },
              meta: {
                retrieved_at: new Date().toISOString(),
              },
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
