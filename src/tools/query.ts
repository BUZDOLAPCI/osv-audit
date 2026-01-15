import { config } from '../config.js';
import {
  type Dependency,
  type OSVQueryInput,
  type OSVBatchQuery,
  type OSVBatchQueryResult,
  type VulnerabilityResult,
  type Response,
  createSuccessResponse,
  createErrorResponse,
} from '../types.js';

// ============================================================================
// CVSS Score Parsing
// ============================================================================

function parseCVSSScore(score: string): number | null {
  // CVSS v3 vector format: CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
  // Or just a numeric score like "9.8"
  const numericMatch = score.match(/^(\d+\.?\d*)$/);
  if (numericMatch && numericMatch[1]) {
    return parseFloat(numericMatch[1]);
  }

  // Try to extract base score from CVSS vector
  // This is a simplified calculation - real CVSS needs full vector parsing
  if (score.startsWith('CVSS:')) {
    // Look for common patterns that indicate severity
    if (score.includes('/C:H/I:H/A:H')) return 9.8;
    if (score.includes('/C:H/I:H')) return 8.5;
    if (score.includes('/C:H')) return 7.5;
    if (score.includes('/C:L')) return 4.0;
    return 5.0; // Default medium
  }

  return null;
}

function getSeverityFromScore(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  if (score > 0) return 'LOW';
  return 'NONE';
}

// ============================================================================
// HTTP Client with Timeout
// ============================================================================

interface FetchOptions {
  timeout?: number;
}

type FetchFn = (url: string, options?: RequestInit) => Promise<globalThis.Response>;

async function fetchWithTimeout(
  url: string,
  options: RequestInit & FetchOptions = {}
): Promise<globalThis.Response> {
  const { timeout = config.requestTimeout, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// OSV Query Function
// ============================================================================

export async function osvQuery(
  input: OSVQueryInput,
  fetcher: FetchFn = fetchWithTimeout
): Promise<Response<{ results: VulnerabilityResult[]; total_vulnerabilities: number }>> {
  const { dependencies } = input;

  if (!dependencies || dependencies.length === 0) {
    return createErrorResponse('INVALID_INPUT', 'Dependencies array cannot be empty', {});
  }

  // Build batch query
  const batchQuery: OSVBatchQuery = {
    queries: dependencies.map((dep: Dependency) => ({
      package: {
        ecosystem: dep.ecosystem,
        name: dep.name,
      },
      ...(dep.version && dep.version !== '*' ? { version: dep.version } : {}),
    })),
  };

  try {
    const response = await fetcher(`${config.osvApiUrl}/v1/querybatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchQuery),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return createErrorResponse('RATE_LIMITED', 'OSV API rate limit exceeded', {
          status: response.status,
          retry_after: response.headers.get('Retry-After'),
        });
      }
      return createErrorResponse('UPSTREAM_ERROR', `OSV API returned status ${response.status}`, {
        status: response.status,
      });
    }

    const data = await response.json() as OSVBatchQueryResult;

    // Process results
    const results: VulnerabilityResult[] = [];
    let totalVulnerabilities = 0;

    for (let i = 0; i < dependencies.length; i++) {
      const dep = dependencies[i];
      const queryResult = data.results[i];

      if (!dep || !queryResult) continue;

      const vulns = queryResult.vulns || [];
      totalVulnerabilities += vulns.length;

      const processedVulns = vulns.map((vuln) => {
        // Extract severity
        let severityScore: number | null = null;
        let severityLabel: string | null = null;

        // Check vulnerability-level severity first
        if (vuln.severity && vuln.severity.length > 0) {
          for (const sev of vuln.severity) {
            const score = parseCVSSScore(sev.score);
            if (score !== null && (severityScore === null || score > severityScore)) {
              severityScore = score;
            }
          }
        }

        // Check affected-level severity
        for (const affected of vuln.affected) {
          if (affected.severity) {
            for (const sev of affected.severity) {
              const score = parseCVSSScore(sev.score);
              if (score !== null && (severityScore === null || score > severityScore)) {
                severityScore = score;
              }
            }
          }
        }

        severityLabel = getSeverityFromScore(severityScore);

        // Extract fixed versions
        const fixedVersions: string[] = [];
        for (const affected of vuln.affected) {
          if (affected.ranges) {
            for (const range of affected.ranges) {
              for (const event of range.events) {
                if (event.fixed) {
                  fixedVersions.push(event.fixed);
                }
              }
            }
          }
        }

        return {
          id: vuln.id,
          summary: vuln.summary || vuln.details?.substring(0, 200) || 'No description available',
          severity: severityLabel,
          severity_score: severityScore,
          fixed_versions: [...new Set(fixedVersions)],
          aliases: vuln.aliases || [],
          references: (vuln.references || []).map((ref) => ({
            type: ref.type,
            url: ref.url,
          })),
        };
      });

      results.push({
        dependency: dep,
        vulnerabilities: processedVulns,
      });
    }

    return createSuccessResponse(
      {
        results,
        total_vulnerabilities: totalVulnerabilities,
      },
      {
        source: 'osv.dev',
        warnings:
          totalVulnerabilities === 0
            ? ['No vulnerabilities found for the provided dependencies']
            : [],
      }
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return createErrorResponse('TIMEOUT', 'OSV API request timed out', {
          timeout: config.requestTimeout,
        });
      }
      return createErrorResponse('UPSTREAM_ERROR', `OSV API request failed: ${error.message}`, {});
    }
    return createErrorResponse('INTERNAL_ERROR', 'Unknown error occurred', {});
  }
}
