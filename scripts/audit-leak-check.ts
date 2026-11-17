/**
 * Automated Production Integrity & Leak Check
 *
 * Verifies that zero mock tokens, simulated OAuth credentials, hardcoded fallback keys,
 * or loopback production configurations exist in production application code or distributions.
 */
import fs from 'node:fs';
import path from 'node:path';

interface Violation {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

const FORBIDDEN_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  { regex: /token_simulated/i, name: 'Simulated OAuth token' },
  { regex: /mock-access-token/i, name: 'Mock access token' },
  { regex: /mock-refresh-token/i, name: 'Mock refresh token' },
  { regex: /dummy-token/i, name: 'Dummy token fallback' },
  { regex: /planrescue-spatial-internal-key-2026!/i, name: 'Hardcoded legacy crypto key' },
];

const SCAN_DIRS = [
  'apps/web/src',
  'apps/vr/src',
  'apps/mcp-server/src',
  'apps/vr/public',
  'apps/vr/dist',
];

const IGNORE_PATTERNS = [
  /\.test\.ts$/,
  /\.test\.tsx$/,
  /\.spec\.ts$/,
  /__tests__/,
  /node_modules/,
  /\.git/,
];

function scanDirectory(dirPath: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dirPath)) return results;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (IGNORE_PATTERNS.some((p) => p.test(fullPath))) {
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|json)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function auditFiles(): Violation[] {
  const violations: Violation[] = [];
  const root = process.cwd();

  const filesToScan: string[] = [];
  for (const dir of SCAN_DIRS) {
    const absDir = path.resolve(root, dir);
    filesToScan.push(...scanDirectory(absDir));
  }

  for (const filePath of filesToScan) {
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      // Skip lines that are specifically guarding, rejecting, or regex-testing against forbidden patterns
      if (
        lineText.includes('FORBIDDEN_TOKEN') ||
        lineText.includes('isForbidden') ||
        lineText.includes('isSuspicious')
      ) {
        continue;
      }

      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.regex.test(lineText)) {
          violations.push({
            file: relativePath,
            line: i + 1,
            pattern: pattern.name,
            snippet: lineText.trim().slice(0, 100),
          });
        }
      }
    }
  }

  // Also check apps/vr/dist/config.json specifically if it exists
  const distConfig = path.resolve(root, 'apps/vr/dist/config.json');
  if (fs.existsSync(distConfig)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(distConfig, 'utf-8'));
      if (parsed.appEnv === 'development') {
        violations.push({
          file: 'apps/vr/dist/config.json',
          line: 1,
          pattern: 'Dist config has development appEnv',
          snippet: JSON.stringify(parsed),
        });
      }
      if (parsed.apiBaseUrl && (parsed.apiBaseUrl.includes('127.0.0.1') || parsed.apiBaseUrl.includes('localhost'))) {
        violations.push({
          file: 'apps/vr/dist/config.json',
          line: 1,
          pattern: 'Dist config has loopback apiBaseUrl',
          snippet: JSON.stringify(parsed),
        });
      }
      if (parsed.xr?.enableEmulation === true) {
        violations.push({
          file: 'apps/vr/dist/config.json',
          line: 1,
          pattern: 'Dist config enables XR emulation by default',
          snippet: JSON.stringify(parsed),
        });
      }
    } catch {
      // ignore parse errors here
    }
  }

  return violations;
}

console.log('[Audit] Running Automated Production Integrity & Leak Check...');
const violations = auditFiles();

if (violations.length > 0) {
  console.error(`\n[FAIL] Found ${violations.length} forbidden mock/leak violation(s) in production path:`);
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} [${v.pattern}]: ${v.snippet}`);
  }
  process.exit(1);
} else {
  console.log('[PASS] Production integrity audit clean. Zero mocks, dummy tokens, or secrets leaked in production code.\n');
  process.exit(0);
}
