import { z } from 'zod';

// ============================================================================
// Manifest Types
// ============================================================================

export const ManifestTypeSchema = z.enum([
  'package-lock',
  'pnpm-lock',
  'yarn-lock',
  'requirements',
  'poetry-lock',
  'go-mod',
  'cargo-lock',
]);

export type ManifestType = z.infer<typeof ManifestTypeSchema>;

// Ecosystem mapping from manifest type to OSV ecosystem
export const ECOSYSTEM_MAP: Record<ManifestType, string> = {
  'package-lock': 'npm',
  'pnpm-lock': 'npm',
  'yarn-lock': 'npm',
  'requirements': 'PyPI',
  'poetry-lock': 'PyPI',
  'go-mod': 'Go',
  'cargo-lock': 'crates.io',
};

// ============================================================================
// Dependency Types
// ============================================================================

export const DependencySchema = z.object({
  ecosystem: z.string(),
  name: z.string(),
  version: z.string().optional(),
});

export type Dependency = z.infer<typeof DependencySchema>;

export const DependencyArraySchema = z.array(DependencySchema);

// ============================================================================
// OSV API Types
// ============================================================================

export interface OSVQuery {
  package: {
    ecosystem: string;
    name: string;
  };
  version?: string;
}

export interface OSVBatchQuery {
  queries: OSVQuery[];
}

export interface OSVAffected {
  package: {
    ecosystem: string;
    name: string;
    purl?: string;
  };
  ranges?: Array<{
    type: string;
    events: Array<{
      introduced?: string;
      fixed?: string;
      last_affected?: string;
    }>;
  }>;
  versions?: string[];
  severity?: Array<{
    type: string;
    score: string;
  }>;
}

export interface OSVVulnerability {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified: string;
  published?: string;
  database_specific?: Record<string, unknown>;
  references?: Array<{
    type: string;
    url: string;
  }>;
  affected: OSVAffected[];
  severity?: Array<{
    type: string;
    score: string;
  }>;
}

export interface OSVQueryResult {
  vulns?: OSVVulnerability[];
}

export interface OSVBatchQueryResult {
  results: OSVQueryResult[];
}

// ============================================================================
// Tool Input/Output Types
// ============================================================================

// parse_dependencies
export const ParseDependenciesInputSchema = z.object({
  text: z.string().describe('The content of the dependency manifest file'),
  manifest_type: ManifestTypeSchema.describe('The type of manifest file'),
});

export type ParseDependenciesInput = z.infer<typeof ParseDependenciesInputSchema>;

export interface ParsedDependency {
  ecosystem: string;
  name: string;
  version: string;
}

// osv_query
export const OSVQueryInputSchema = z.object({
  dependencies: DependencyArraySchema.describe('Array of dependencies to check'),
});

export type OSVQueryInput = z.infer<typeof OSVQueryInputSchema>;

export interface VulnerabilityResult {
  dependency: Dependency;
  vulnerabilities: Array<{
    id: string;
    summary: string;
    severity: string | null;
    severity_score: number | null;
    fixed_versions: string[];
    aliases: string[];
    references: Array<{ type: string; url: string }>;
  }>;
}

// suggest_fixes
export const SuggestFixesInputSchema = z.object({
  vuln_results: z.array(z.object({
    dependency: DependencySchema,
    vulnerabilities: z.array(z.object({
      id: z.string(),
      summary: z.string(),
      severity: z.string().nullable(),
      severity_score: z.number().nullable(),
      fixed_versions: z.array(z.string()),
      aliases: z.array(z.string()),
      references: z.array(z.object({
        type: z.string(),
        url: z.string(),
      })),
    })),
  })).describe('Vulnerability results from osv_query'),
});

export type SuggestFixesInput = z.infer<typeof SuggestFixesInputSchema>;

export interface FixSuggestion {
  package: string;
  ecosystem: string;
  current_version: string;
  suggested_version: string | null;
  vulnerabilities_fixed: string[];
  severity: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  action: 'upgrade' | 'review' | 'investigate';
  notes: string[];
}

// ============================================================================
// Standard Response Envelope
// ============================================================================

export interface ResponseMeta {
  source?: string;
  retrieved_at: string;
  pagination?: {
    next_cursor: string | null;
  };
  warnings?: string[];
}

export interface SuccessResponse<T> {
  ok: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  ok: false;
  error: {
    code: 'INVALID_INPUT' | 'UPSTREAM_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'PARSE_ERROR' | 'INTERNAL_ERROR';
    message: string;
    details: Record<string, unknown>;
  };
  meta: ResponseMeta;
}

export type Response<T> = SuccessResponse<T> | ErrorResponse;

// ============================================================================
// Helper Functions
// ============================================================================

export function createSuccessResponse<T>(data: T, meta?: Partial<ResponseMeta>): SuccessResponse<T> {
  return {
    ok: true,
    data,
    meta: {
      retrieved_at: new Date().toISOString(),
      warnings: [],
      ...meta,
    },
  };
}

export function createErrorResponse(
  code: ErrorResponse['error']['code'],
  message: string,
  details: Record<string, unknown> = {}
): ErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      retrieved_at: new Date().toISOString(),
    },
  };
}
