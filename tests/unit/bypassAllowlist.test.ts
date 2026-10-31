import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Tenant Bypass Static Analysis Guard', () => {
  const SRC_DIR = path.resolve(__dirname, '../../src');

  // Allowlisted files permitted to reference bypassTenantScope or withGlobalScope
  const ALLOWLISTED_FILES = new Set([
    path.normalize('src/plugins/tenantScoping.plugin.ts'),
    path.normalize('src/utils/tenantContext.ts'),
    path.normalize('src/utils/tenantBypass.ts'),
    // user.service.ts is allowlisted for global email lookups during auth/signup
    path.normalize('src/modules/user/user.service.ts'),
    // refreshToken.service.ts is allowlisted for global token lookups during auth/logout/refresh
    path.normalize('src/modules/auth/refreshToken.service.ts'),
    // authToken.service.ts is allowlisted for global token lookups during email verification and password reset
    path.normalize('src/modules/auth/authToken.service.ts'),
  ]);

  function getAllTypeScriptFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getAllTypeScriptFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  it('strictly forbids withGlobalScope or bypassTenantScope outside the approved allowlist', () => {
    const files = getAllTypeScriptFiles(SRC_DIR);
    const violations: { file: string; match: string }[] = [];

    const BYPASS_PATTERN = /\b(withGlobalScope|bypassTenantScope)\b/;

    for (const file of files) {
      const relativePath = path.normalize(
        path.relative(path.resolve(SRC_DIR, '..'), file),
      );
      if (ALLOWLISTED_FILES.has(relativePath)) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf-8');
      const match = content.match(BYPASS_PATTERN);
      if (match) {
        violations.push({ file: relativePath, match: match[0] });
      }
    }

    expect(
      violations,
      `Detected unauthorized tenant-scoping bypass usage outside allowlisted files:\n${violations
        .map((v) => `  • ${v.file}: references '${v.match}'`)
        .join('\n')}`,
    ).toHaveLength(0);
  });

  it('strictly forbids native-driver escape hatches (.collection., connection.db, connection.collection(, getClient() outside the approved allowlist', () => {
    const files = getAllTypeScriptFiles(SRC_DIR);
    const violations: { file: string; match: string }[] = [];

    const ESCAPE_HATCH_PATTERN =
      /(\.collection\.|connection\.db|connection\.collection\(|getClient\()/;

    for (const file of files) {
      const relativePath = path.normalize(
        path.relative(path.resolve(SRC_DIR, '..'), file),
      );
      if (ALLOWLISTED_FILES.has(relativePath)) {
        continue;
      }

      const content = fs.readFileSync(file, 'utf-8');
      const match = content.match(ESCAPE_HATCH_PATTERN);
      if (match) {
        violations.push({ file: relativePath, match: match[0] });
      }
    }

    expect(
      violations,
      `Detected unauthorized native-driver escape hatch usage outside allowlisted files:\n${violations
        .map((v) => `  • ${v.file}: references '${v.match}'`)
        .join('\n')}`,
    ).toHaveLength(0);
  });
});
