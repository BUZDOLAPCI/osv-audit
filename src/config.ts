export interface Config {
  transport: 'stdio' | 'http';
  port: number;
  host: string;
  osvApiUrl: string;
  requestTimeout: number;
  debug: boolean;
}

export function loadConfig(): Config {
  return {
    transport: (process.env['TRANSPORT'] as 'stdio' | 'http') || 'stdio',
    port: parseInt(process.env['PORT'] || '3000', 10),
    host: process.env['HOST'] || '127.0.0.1',
    osvApiUrl: process.env['OSV_API_URL'] || 'https://api.osv.dev',
    requestTimeout: parseInt(process.env['REQUEST_TIMEOUT'] || '30000', 10),
    debug: process.env['DEBUG'] === 'true',
  };
}

export const config = loadConfig();
