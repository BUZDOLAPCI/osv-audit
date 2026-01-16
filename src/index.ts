#!/usr/bin/env node

import { createHttpTransport } from './transport/http.js';

const PORT = parseInt(process.env['PORT'] || '8080', 10);
const HOST = process.env['HOST'] || '0.0.0.0';

const httpTransport = createHttpTransport({
  host: HOST,
  port: PORT,
});

httpTransport.start().then(() => {
  console.log(`OSV Audit MCP server running on http://${HOST}:${PORT}`);
  console.log('MCP endpoint available at /mcp');

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    await httpTransport.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
