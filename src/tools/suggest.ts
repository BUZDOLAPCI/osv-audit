import {
  type SuggestFixesInput,
  type FixSuggestion,
  type Response,
  createSuccessResponse,
  createErrorResponse,
} from '../types.js';

// ============================================================================
// Version Comparison
// ============================================================================

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  original: string;
}

function parseVersion(version: string): ParsedVersion | null {
  // Handle various version formats:
  // 1.2.3, v1.2.3, 1.2.3-alpha, 1.2.3.4
  const cleaned = version.replace(/^v/, '');

  // Match semantic version with optional prerelease
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-.](.+))?$/);
  if (!match) return null;

  return {
    major: parseInt(match[1] || '0', 10),
    minor: parseInt(match[2] || '0', 10),
    patch: parseInt(match[3] || '0', 10),
    prerelease: match[4] || null,
    original: version,
  };
}

function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  if (!parsedA || !parsedB) {
    // Fall back to string comparison
    return a.localeCompare(b);
  }

  // Compare major, minor, patch
  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch;

  // Prerelease versions have lower precedence
  if (parsedA.prerelease && !parsedB.prerelease) return -1;
  if (!parsedA.prerelease && parsedB.prerelease) return 1;
  if (parsedA.prerelease && parsedB.prerelease) {
    return parsedA.prerelease.localeCompare(parsedB.prerelease);
  }

  return 0;
}

function isVersionGreaterOrEqual(version: string, target: string): boolean {
  return compareVersions(version, target) >= 0;
}

// ============================================================================
// Priority Calculation
// ============================================================================

function getPriorityFromSeverity(severity: string | null): FixSuggestion['priority'] {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    default:
      return 'low';
  }
}

function getHighestSeverity(severities: (string | null)[]): string {
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'];
  for (const level of order) {
    if (severities.some((s) => s?.toUpperCase() === level)) {
      return level;
    }
  }
  return 'UNKNOWN';
}

// ============================================================================
// Fix Suggestion Logic
// ============================================================================

function findMinimumSafeVersion(
  currentVersion: string,
  fixedVersions: string[]
): string | null {
  if (fixedVersions.length === 0) return null;

  // Sort fixed versions
  const sortedVersions = [...fixedVersions].sort(compareVersions);

  // Find the minimum version that is greater than current
  const currentParsed = parseVersion(currentVersion);

  for (const fixed of sortedVersions) {
    // If we can't parse current version, just return the minimum fixed version
    if (!currentParsed) {
      return fixed;
    }

    // Return the first fixed version that's greater than current
    if (compareVersions(fixed, currentVersion) > 0) {
      return fixed;
    }
  }

  // If no version is greater than current (edge case), return the highest
  return sortedVersions[sortedVersions.length - 1] ?? null;
}

// ============================================================================
// Main Suggest Function
// ============================================================================

export async function suggestFixes(
  input: SuggestFixesInput
): Promise<Response<{ suggestions: FixSuggestion[]; summary: { total: number; by_priority: Record<string, number> } }>> {
  const { vuln_results } = input;

  if (!vuln_results || !Array.isArray(vuln_results)) {
    return createErrorResponse('INVALID_INPUT', 'vuln_results must be an array', {});
  }

  const suggestions: FixSuggestion[] = [];
  const byPriority: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const result of vuln_results) {
    const { dependency, vulnerabilities } = result;

    // Skip if no vulnerabilities
    if (!vulnerabilities || vulnerabilities.length === 0) {
      continue;
    }

    // Collect all fixed versions and severity info
    const allFixedVersions: string[] = [];
    const severities: (string | null)[] = [];
    const vulnIds: string[] = [];

    for (const vuln of vulnerabilities) {
      vulnIds.push(vuln.id);
      severities.push(vuln.severity);
      allFixedVersions.push(...vuln.fixed_versions);
    }

    // Deduplicate fixed versions
    const uniqueFixedVersions = [...new Set(allFixedVersions)];

    // Calculate highest severity and priority
    const highestSeverity = getHighestSeverity(severities);
    const priority = getPriorityFromSeverity(highestSeverity);

    // Find minimum safe version
    const currentVersion = dependency.version || 'unknown';
    const suggestedVersion = findMinimumSafeVersion(currentVersion, uniqueFixedVersions);

    // Determine action
    let action: FixSuggestion['action'] = 'investigate';
    const notes: string[] = [];

    if (suggestedVersion) {
      action = 'upgrade';
      notes.push(`Upgrade from ${currentVersion} to ${suggestedVersion}`);

      // Check if it's a major version bump
      const currentParsed = parseVersion(currentVersion);
      const suggestedParsed = parseVersion(suggestedVersion);

      if (currentParsed && suggestedParsed && suggestedParsed.major > currentParsed.major) {
        notes.push('Warning: This is a major version upgrade - review changelog for breaking changes');
      }
    } else {
      action = 'review';
      notes.push('No fixed version available - consider alternative packages or manual mitigation');
    }

    // Add CVE references
    const cves = vulnerabilities
      .flatMap((v) => v.aliases)
      .filter((a) => a.startsWith('CVE-'));
    if (cves.length > 0) {
      notes.push(`Related CVEs: ${[...new Set(cves)].join(', ')}`);
    }

    const suggestion: FixSuggestion = {
      package: dependency.name,
      ecosystem: dependency.ecosystem,
      current_version: currentVersion,
      suggested_version: suggestedVersion,
      vulnerabilities_fixed: vulnIds,
      severity: highestSeverity,
      priority,
      action,
      notes,
    };

    suggestions.push(suggestion);
    byPriority[priority] = (byPriority[priority] || 0) + 1;
  }

  // Sort by priority (critical first)
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return createSuccessResponse(
    {
      suggestions,
      summary: {
        total: suggestions.length,
        by_priority: byPriority,
      },
    },
    {
      warnings:
        suggestions.length === 0
          ? ['No vulnerabilities found - no fix suggestions needed']
          : [],
    }
  );
}
