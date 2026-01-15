#!/usr/bin/env node

// Main entry point - delegates to CLI
import { main } from './cli.js';

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
