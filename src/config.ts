export interface Config {
  port: number;
  host: string;
  osvApiUrl: string;
  requestTimeout: number;
  debug: boolean;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] || '8080', 10),
    host: process.env['HOST'] || '0.0.0.0',
    osvApiUrl: process.env['OSV_API_URL'] || 'https://api.osv.dev',
    requestTimeout: parseInt(process.env['REQUEST_TIMEOUT'] || '30000', 10),
    debug: process.env['DEBUG'] === 'true',
  };
}

export const config = loadConfig();
