#!/usr/bin/env node

import { config, loadConfig } from './config.js';

interface ParsedArgs {
  transport: 'stdio' | 'http';
  port: number;
  host: string;
  help: boolean;
  version: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    transport: config.transport,
    port: config.port,
    host: config.host,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '-t':
      case '--transport': {
        const nextArg = args[++i];
        if (nextArg === 'stdio' || nextArg === 'http') {
          result.transport = nextArg;
        } else {
          console.error(`Invalid transport: ${nextArg}. Must be 'stdio' or 'http'.`);
          process.exit(1);
        }
        break;
      }
      case '-p':
      case '--port': {
        const nextArg = args[++i];
        const port = parseInt(nextArg ?? '', 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error(`Invalid port: ${nextArg}`);
          process.exit(1);
        }
        result.port = port;
        break;
      }
      case '--host': {
        const nextArg = args[++i];
        if (nextArg) {
          result.host = nextArg;
        }
        break;
      }
      default:
        if (arg && arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
osv-audit - MCP server for vulnerability scanning

USAGE:
    osv-audit [OPTIONS]

OPTIONS:
    -t, --transport <TYPE>   Transport type: stdio (default) or http
    -p, --port <PORT>        HTTP server port (default: 3000)
        --host <HOST>        HTTP server host (default: 127.0.0.1)
    -h, --help               Show this help message
    -v, --version            Show version information

ENVIRONMENT VARIABLES:
    TRANSPORT          Transport mode (stdio or http)
    PORT               HTTP server port
    HOST               HTTP server host
    OSV_API_URL        OSV API base URL
    REQUEST_TIMEOUT    Request timeout in milliseconds
    DEBUG              Enable debug logging (true/false)

EXAMPLES:
    # Run with stdio transport (default)
    osv-audit

    # Run with HTTP transport on port 8080
    osv-audit --transport http --port 8080

    # Using environment variables
    TRANSPORT=http PORT=3000 osv-audit
`);
}

function printVersion(): void {
  console.log('osv-audit v1.0.0');
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const parsedArgs = parseArgs(args);

  if (parsedArgs.help) {
    printHelp();
    process.exit(0);
  }

  if (parsedArgs.version) {
    printVersion();
    process.exit(0);
  }

  // Dynamically import to avoid circular dependencies
  const { createServer } = await import('./server.js');
  const { createStdioTransport, createHttpTransport } = await import('./transport/index.js');

  const server = createServer();

  if (parsedArgs.transport === 'stdio') {
    const transport = createStdioTransport();
    await server.connect(transport);
    console.error('OSV Audit MCP server running on stdio');
  } else {
    const httpTransport = createHttpTransport(server, {
      host: parsedArgs.host,
      port: parsedArgs.port,
    });
    await httpTransport.start();
    console.error(`OSV Audit MCP server running on http://${parsedArgs.host}:${parsedArgs.port}`);

    // Handle graceful shutdown
    const shutdown = async () => {
      console.error('\nShutting down...');
      await httpTransport.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

// Run if this is the main module
const isMain = process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('cli.ts');
if (isMain) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
