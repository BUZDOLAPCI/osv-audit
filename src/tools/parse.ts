import yaml from 'js-yaml';
import { parse as parseTOML } from 'smol-toml';
import {
  type ManifestType,
  type ParseDependenciesInput,
  type ParsedDependency,
  type Response,
  ECOSYSTEM_MAP,
  createSuccessResponse,
  createErrorResponse,
} from '../types.js';

// ============================================================================
// Parser Functions
// ============================================================================

interface PackageLockPackage {
  version?: string;
  resolved?: string;
  dev?: boolean;
}

interface PackageLockV2 {
  packages?: Record<string, PackageLockPackage>;
}

interface PackageLockV1 {
  dependencies?: Record<string, PackageLockPackage>;
}

function parsePackageLock(text: string): ParsedDependency[] {
  const data = JSON.parse(text) as PackageLockV2 & PackageLockV1;
  const deps: ParsedDependency[] = [];
  const ecosystem = ECOSYSTEM_MAP['package-lock'];

  // Package-lock v2/v3 format (packages object)
  if (data.packages) {
    for (const [path, pkg] of Object.entries(data.packages)) {
      if (!path || path === '') continue; // Skip root package

      // Extract package name from path (e.g., "node_modules/lodash" -> "lodash")
      const name = path.replace(/^node_modules\//, '').replace(/\/node_modules\//g, '/');
      if (name && pkg.version) {
        deps.push({
          ecosystem,
          name,
          version: pkg.version,
        });
      }
    }
  }

  // Package-lock v1 format (dependencies object)
  if (data.dependencies && deps.length === 0) {
    const extractDeps = (dependencies: Record<string, PackageLockPackage>, prefix = ''): void => {
      for (const [name, info] of Object.entries(dependencies)) {
        const fullName = prefix ? `${prefix}/${name}` : name;
        if (info.version) {
          deps.push({
            ecosystem,
            name: fullName,
            version: info.version,
          });
        }
        // Handle nested dependencies
        const nested = info as unknown as { dependencies?: Record<string, PackageLockPackage> };
        if (nested.dependencies) {
          extractDeps(nested.dependencies, fullName);
        }
      }
    };
    extractDeps(data.dependencies);
  }

  return deps;
}

interface PnpmLockPackage {
  version?: string;
  resolution?: { integrity?: string };
}

interface PnpmLockData {
  packages?: Record<string, PnpmLockPackage>;
  dependencies?: Record<string, string | { version: string }>;
  devDependencies?: Record<string, string | { version: string }>;
}

function parsePnpmLock(text: string): ParsedDependency[] {
  const data = yaml.load(text) as PnpmLockData;
  const deps: ParsedDependency[] = [];
  const ecosystem = ECOSYSTEM_MAP['pnpm-lock'];

  if (data?.packages) {
    for (const [pkgPath] of Object.entries(data.packages)) {
      // pnpm-lock format: /package-name@version or /package-name/version
      const match = pkgPath.match(/^\/?(@?[^@/]+(?:\/[^@/]+)?)[@/](.+)$/);
      if (match && match[1] && match[2]) {
        deps.push({
          ecosystem,
          name: match[1],
          version: match[2],
        });
      }
    }
  }

  // Also check direct dependencies if packages is empty
  if (deps.length === 0) {
    const extractFromDeps = (depObj: Record<string, string | { version: string }> | undefined): void => {
      if (!depObj) return;
      for (const [name, value] of Object.entries(depObj)) {
        const version = typeof value === 'string' ? value : value.version;
        if (version) {
          deps.push({
            ecosystem,
            name,
            version,
          });
        }
      }
    };
    extractFromDeps(data?.dependencies);
    extractFromDeps(data?.devDependencies);
  }

  return deps;
}

function parseYarnLock(text: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const ecosystem = ECOSYSTEM_MAP['yarn-lock'];
  const seen = new Set<string>();

  // Yarn.lock format parsing
  // Pattern: "package@version" or package@version:
  const lines = text.split('\n');
  let currentPackages: string[] = [];
  let currentVersion: string | null = null;

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') {
      continue;
    }

    // Check for package declaration line (not indented, ends with : or is quoted)
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      // Save previous package if we have version
      if (currentPackages.length > 0 && currentVersion) {
        for (const pkg of currentPackages) {
          const key = `${pkg}@${currentVersion}`;
          if (!seen.has(key)) {
            seen.add(key);
            deps.push({
              ecosystem,
              name: pkg,
              version: currentVersion,
            });
          }
        }
      }

      currentPackages = [];
      currentVersion = null;

      // Parse package names from declaration
      // Format: "pkg@^1.0.0", pkg@^1.0.0, or "pkg@^1.0.0", "pkg@^2.0.0":
      const cleanLine = line.replace(/:$/, '').trim();
      const parts = cleanLine.split(/,\s*/);

      for (const part of parts) {
        // Remove quotes and extract package name (before @version)
        const clean = part.replace(/^["']|["']$/g, '').trim();
        // Match: @scope/name@version or name@version
        const match = clean.match(/^(@?[^@]+)@/);
        if (match && match[1]) {
          currentPackages.push(match[1]);
        }
      }
    } else if (line.match(/^\s+version\s+["']?([^"'\s]+)["']?/)) {
      // Parse version line
      const match = line.match(/^\s+version\s+["']?([^"'\s]+)["']?/);
      if (match && match[1]) {
        currentVersion = match[1];
      }
    }
  }

  // Don't forget the last package
  if (currentPackages.length > 0 && currentVersion) {
    for (const pkg of currentPackages) {
      const key = `${pkg}@${currentVersion}`;
      if (!seen.has(key)) {
        seen.add(key);
        deps.push({
          ecosystem,
          name: pkg,
          version: currentVersion,
        });
      }
    }
  }

  return deps;
}

function parseRequirements(text: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const ecosystem = ECOSYSTEM_MAP['requirements'];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines, comments, and options
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
      continue;
    }

    // Parse various formats:
    // package==1.0.0
    // package>=1.0.0
    // package<=1.0.0
    // package~=1.0.0
    // package!=1.0.0
    // package[extra]==1.0.0
    // package @ url

    // Remove extras like [dev,test]
    const withoutExtras = trimmed.replace(/\[.*?\]/g, '');

    // Match package name and version with various operators
    const match = withoutExtras.match(/^([a-zA-Z0-9_-]+)\s*(==|>=|<=|~=|!=|>|<)\s*([^\s;#]+)/);
    if (match && match[1] && match[3]) {
      deps.push({
        ecosystem,
        name: match[1].toLowerCase(),
        version: match[3],
      });
    } else {
      // Package without version specifier
      const nameOnly = withoutExtras.match(/^([a-zA-Z0-9_-]+)/);
      if (nameOnly && nameOnly[1]) {
        deps.push({
          ecosystem,
          name: nameOnly[1].toLowerCase(),
          version: '*',
        });
      }
    }
  }

  return deps;
}

interface PoetryPackage {
  name?: string;
  version?: string;
}

interface PoetryLockData {
  package?: PoetryPackage[];
}

function parsePoetryLock(text: string): ParsedDependency[] {
  const data = parseTOML(text) as PoetryLockData;
  const deps: ParsedDependency[] = [];
  const ecosystem = ECOSYSTEM_MAP['poetry-lock'];

  if (data.package && Array.isArray(data.package)) {
    for (const pkg of data.package) {
      if (pkg.name && pkg.version) {
        deps.push({
          ecosystem,
          name: pkg.name.toLowerCase(),
          version: pkg.version,
        });
      }
    }
  }

  return deps;
}

function parseGoMod(text: string): ParsedDependency[] {
  const deps: ParsedDependency[] = [];
  const ecosystem = ECOSYSTEM_MAP['go-mod'];
  const lines = text.split('\n');
  let inRequireBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('//')) {
      continue;
    }

    // Check for require block start/end
    if (trimmed === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (trimmed === ')') {
      inRequireBlock = false;
      continue;
    }

    // Parse single-line require
    if (trimmed.startsWith('require ')) {
      const match = trimmed.match(/^require\s+([^\s]+)\s+v?([^\s]+)/);
      if (match && match[1] && match[2]) {
        deps.push({
          ecosystem,
          name: match[1],
          version: match[2].replace(/^v/, ''),
        });
      }
      continue;
    }

    // Parse dependencies inside require block
    if (inRequireBlock) {
      const match = trimmed.match(/^([^\s]+)\s+v?([^\s]+)/);
      if (match && match[1] && match[2]) {
        // Skip indirect dependencies comment
        const version = match[2].replace(/\s*\/\/.*$/, '').replace(/^v/, '');
        deps.push({
          ecosystem,
          name: match[1],
          version,
        });
      }
    }
  }

  return deps;
}

interface CargoPackage {
  name?: string;
  version?: string;
}

interface CargoLockData {
  package?: CargoPackage[];
}

function parseCargoLock(text: string): ParsedDependency[] {
  const data = parseTOML(text) as CargoLockData;
  const deps: ParsedDependency[] = [];
  const ecosystem = ECOSYSTEM_MAP['cargo-lock'];

  if (data.package && Array.isArray(data.package)) {
    for (const pkg of data.package) {
      if (pkg.name && pkg.version) {
        deps.push({
          ecosystem,
          name: pkg.name,
          version: pkg.version,
        });
      }
    }
  }

  return deps;
}

// ============================================================================
// Main Parser Function
// ============================================================================

const PARSERS: Record<ManifestType, (text: string) => ParsedDependency[]> = {
  'package-lock': parsePackageLock,
  'pnpm-lock': parsePnpmLock,
  'yarn-lock': parseYarnLock,
  'requirements': parseRequirements,
  'poetry-lock': parsePoetryLock,
  'go-mod': parseGoMod,
  'cargo-lock': parseCargoLock,
};

export async function parseDependencies(
  input: ParseDependenciesInput
): Promise<Response<{ dependencies: ParsedDependency[]; count: number }>> {
  const { text, manifest_type } = input;

  if (!text || text.trim() === '') {
    return createErrorResponse('INVALID_INPUT', 'Manifest text cannot be empty', {
      manifest_type,
    });
  }

  const parser = PARSERS[manifest_type];
  if (!parser) {
    return createErrorResponse('INVALID_INPUT', `Unsupported manifest type: ${manifest_type}`, {
      supported_types: Object.keys(PARSERS),
    });
  }

  try {
    const dependencies = parser(text);

    return createSuccessResponse(
      {
        dependencies,
        count: dependencies.length,
      },
      {
        source: `parsed from ${manifest_type}`,
        warnings: dependencies.length === 0 ? ['No dependencies found in manifest'] : [],
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parsing error';
    return createErrorResponse('PARSE_ERROR', `Failed to parse ${manifest_type}: ${message}`, {
      manifest_type,
    });
  }
}
