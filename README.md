# OSV Audit MCP Server

A Model Context Protocol (MCP) server that parses dependency files and queries the OSV.dev API for vulnerabilities, providing actionable fix suggestions.

## Features

- **Multi-format dependency parsing**: Supports npm, Python, Go, and Rust lockfiles
- **Vulnerability scanning**: Queries OSV.dev API for known vulnerabilities
- **Fix suggestions**: Prioritized recommendations for version upgrades
- **Standard response envelope**: Consistent JSON response format

## Installation

```bash
npm install
npm run build
```

## Usage

### Running the Server

```bash
# Stdio transport (default)
npm start

# HTTP transport
npm start -- --transport http --port 3000

# Using environment variables
TRANSPORT=http PORT=8080 npm start
```

### CLI Options

```
osv-audit [OPTIONS]

OPTIONS:
    -t, --transport <TYPE>   Transport type: stdio (default) or http
    -p, --port <PORT>        HTTP server port (default: 3000)
        --host <HOST>        HTTP server host (default: 127.0.0.1)
    -h, --help               Show help message
    -v, --version            Show version
```

## Tools

### parse_dependencies

Parse a dependency manifest file and extract package names/versions.

**Input:**
```json
{
  "text": "<manifest file content>",
  "manifest_type": "package-lock" | "pnpm-lock" | "yarn-lock" | "requirements" | "poetry-lock" | "go-mod" | "cargo-lock"
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "dependencies": [
      { "ecosystem": "npm", "name": "lodash", "version": "4.17.21" }
    ],
    "count": 1
  },
  "meta": {
    "source": "parsed from package-lock",
    "retrieved_at": "2024-01-15T10:00:00.000Z",
    "warnings": []
  }
}
```

**Supported manifest types:**

| Type | File | Ecosystem |
|------|------|-----------|
| `package-lock` | package-lock.json | npm |
| `pnpm-lock` | pnpm-lock.yaml | npm |
| `yarn-lock` | yarn.lock | npm |
| `requirements` | requirements.txt | PyPI |
| `poetry-lock` | poetry.lock | PyPI |
| `go-mod` | go.mod | Go |
| `cargo-lock` | Cargo.lock | crates.io |

### osv_query

Query OSV.dev API for vulnerabilities affecting the given dependencies.

**Input:**
```json
{
  "dependencies": [
    { "ecosystem": "npm", "name": "lodash", "version": "4.17.20" }
  ]
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "results": [
      {
        "dependency": { "ecosystem": "npm", "name": "lodash", "version": "4.17.20" },
        "vulnerabilities": [
          {
            "id": "GHSA-xxxx-yyyy-zzzz",
            "summary": "Prototype Pollution in lodash",
            "severity": "CRITICAL",
            "severity_score": 9.8,
            "fixed_versions": ["4.17.21"],
            "aliases": ["CVE-2021-23337"],
            "references": [{ "type": "ADVISORY", "url": "https://..." }]
          }
        ]
      }
    ],
    "total_vulnerabilities": 1
  },
  "meta": {
    "source": "osv.dev",
    "retrieved_at": "2024-01-15T10:00:00.000Z",
    "warnings": []
  }
}
```

### suggest_fixes

Analyze vulnerability results and suggest version upgrades or mitigations.

**Input:**
```json
{
  "vuln_results": [
    {
      "dependency": { "ecosystem": "npm", "name": "lodash", "version": "4.17.20" },
      "vulnerabilities": [
        {
          "id": "GHSA-xxxx-yyyy-zzzz",
          "summary": "Prototype Pollution",
          "severity": "CRITICAL",
          "severity_score": 9.8,
          "fixed_versions": ["4.17.21"],
          "aliases": ["CVE-2021-23337"],
          "references": []
        }
      ]
    }
  ]
}
```

**Output:**
```json
{
  "ok": true,
  "data": {
    "suggestions": [
      {
        "package": "lodash",
        "ecosystem": "npm",
        "current_version": "4.17.20",
        "suggested_version": "4.17.21",
        "vulnerabilities_fixed": ["GHSA-xxxx-yyyy-zzzz"],
        "severity": "CRITICAL",
        "priority": "critical",
        "action": "upgrade",
        "notes": [
          "Upgrade from 4.17.20 to 4.17.21",
          "Related CVEs: CVE-2021-23337"
        ]
      }
    ],
    "summary": {
      "total": 1,
      "by_priority": { "critical": 1, "high": 0, "medium": 0, "low": 0 }
    }
  },
  "meta": {
    "retrieved_at": "2024-01-15T10:00:00.000Z",
    "warnings": []
  }
}
```

## Example Workflow

```typescript
// 1. Parse your dependencies
const parseResult = await client.callTool({
  name: 'parse_dependencies',
  arguments: {
    text: fs.readFileSync('package-lock.json', 'utf-8'),
    manifest_type: 'package-lock'
  }
});

// 2. Query OSV for vulnerabilities
const queryResult = await client.callTool({
  name: 'osv_query',
  arguments: {
    dependencies: parseResult.data.dependencies
  }
});

// 3. Get fix suggestions
const suggestions = await client.callTool({
  name: 'suggest_fixes',
  arguments: {
    vuln_results: queryResult.data.results
  }
});
```

## Response Envelope

All tools return responses in a standard envelope format:

**Success:**
```json
{
  "ok": true,
  "data": { ... },
  "meta": {
    "source": "optional string",
    "retrieved_at": "ISO-8601 timestamp",
    "pagination": { "next_cursor": null },
    "warnings": []
  }
}
```

**Error:**
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT | UPSTREAM_ERROR | RATE_LIMITED | TIMEOUT | PARSE_ERROR | INTERNAL_ERROR",
    "message": "human readable message",
    "details": {}
  },
  "meta": {
    "retrieved_at": "ISO-8601 timestamp"
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TRANSPORT` | Transport mode (stdio/http) | `stdio` |
| `PORT` | HTTP server port | `3000` |
| `HOST` | HTTP server host | `127.0.0.1` |
| `OSV_API_URL` | OSV API base URL | `https://api.osv.dev` |
| `REQUEST_TIMEOUT` | Request timeout (ms) | `30000` |
| `DEBUG` | Enable debug logging | `false` |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type checking
npm run typecheck
```

## License

MIT
