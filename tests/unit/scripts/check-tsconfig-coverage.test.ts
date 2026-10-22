/**
 * Unit tests for scripts/check-tsconfig-coverage.ts.
 *
 * The guard exists because tsconfig's `include` list silently defines what
 * `bun run typecheck` covers. Root config files (wxt.config.ts) and the whole
 * scripts/ directory were once OUTSIDE it - a truncated wxt.config.ts passed
 * every local gate and only failed when WXT loaded the config. The guard has
 * two layers:
 *   1. Anchors: the four include entries (src, tests, scripts, *.config.ts)
 *      must all still be present - a removed anchor fails even when the area
 *      is momentarily empty.
 *   2. Membership: every root *.config.ts file and every TypeScript file
 *      under scripts/ must resolve into the REAL parsed TS program (via the
 *      TypeScript config API), so narrowing a glob to a subset is caught too.
 *
 * The pure checks are pinned here with crafted inputs; the last test runs the
 * full check against the repo's actual tsconfig so include drift breaks CI
 * even when commits bypass the local lefthook hook.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ANCHOR_INCLUDES,
  canonicalPath,
  checkCoverage,
  collectExpectedFiles,
  parseTsconfig,
} from '../../../scripts/check-tsconfig-coverage';

const ROOT = join(import.meta.dir, '..', '..', '..');
const SCRIPTS_DIR = join(ROOT, 'scripts');
const TSCONFIG_PATH = join(ROOT, 'tsconfig.json');

describe('checkCoverage (pure policy)', () => {
  test('passes when all anchors are present and every expected file is in the program', () => {
    const issues = checkCoverage({
      includes: [...ANCHOR_INCLUDES],
      programFiles: new Set([canonicalPath(join(ROOT, 'wxt.config.ts'))]),
      expectedFiles: [canonicalPath(join(ROOT, 'wxt.config.ts'))],
    });
    expect(issues).toEqual([]);
  });

  test('flags a REMOVED anchor even when the area has no expected files', () => {
    const issues = checkCoverage({
      includes: ['src/**/*', 'tests/**/*', '*.config.ts'], // scripts anchor dropped
      programFiles: new Set(),
      expectedFiles: [],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('scripts/**/*');
    expect(issues[0]).toContain('missing');
  });

  test('flags an expected file the program does not load (narrowed glob)', () => {
    const file = canonicalPath(join(ROOT, 'scripts', 'bump-version.ts'));
    const issues = checkCoverage({
      includes: [...ANCHOR_INCLUDES],
      programFiles: new Set(), // nothing resolved
      expectedFiles: [file],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('bump-version.ts');
    expect(issues[0]).toContain('NOT covered');
  });
});

describe('collectExpectedFiles', () => {
  test('discovers the root *.config.ts files and the scripts tree', () => {
    const expected = collectExpectedFiles(ROOT, SCRIPTS_DIR);
    expect(expected).toContain(canonicalPath(join(ROOT, 'wxt.config.ts')));
    expect(expected).toContain(canonicalPath(join(ROOT, 'playwright.config.ts')));
    expect(expected).toContain(canonicalPath(join(ROOT, 'playwright.webkit.config.ts')));
    expect(expected).toContain(canonicalPath(join(ROOT, 'scripts', 'check-version-parity.ts')));
    expect(expected).toContain(
      canonicalPath(join(ROOT, 'scripts', 'i18n-fit', 'i18n-fit-metrics.ts'))
    );
    // The ambient selenium shim is a .d.ts and must count as typecheckable.
    expect(expected).toContain(canonicalPath(join(ROOT, 'scripts', 'selenium-webdriver.d.ts')));
  });
});

describe('parseTsconfig JSONC tolerance', () => {
  test('accepts comment-only tsconfig.json like tsc does (no strict-JSON failure)', () => {
    // Write a temp tsconfig with JSONC comments (as tsc allows) and verify
    // parseTsconfig reports no errors and still reads the include anchors.
    const tmpDir = mkdtempSync(join(tmpdir(), 'tsconfig-jsonc-'));
    const tmpTsconfig = join(tmpDir, 'tsconfig.json');
    try {
      // The include globs must resolve to real files or the TS program reports
      // "No inputs were found" - create dummies so only comment handling is tested.
      mkdirSync(join(tmpDir, 'src'));
      mkdirSync(join(tmpDir, 'tests'));
      writeFileSync(join(tmpDir, 'src', 'dummy.ts'), 'export const a = 1;\n', 'utf8');
      writeFileSync(join(tmpDir, 'tests', 'dummy.test.ts'), 'export const b = 1;\n', 'utf8');
      writeFileSync(
        tmpTsconfig,
        `{
  // comment: noUnusedLocals stays OFF (Svelte snippet forwarding)
  /* block comment */
  "compilerOptions": { "strict": true },
  "include": ["src/**/*", "tests/**/*"]
}`,
        'utf8'
      );
      const { includes, errors } = parseTsconfig(tmpTsconfig);
      expect(errors).toEqual([]);
      expect(includes).toEqual(['src/**/*', 'tests/**/*']);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('parseTsconfig + live integration', () => {
  test('the real tsconfig include list keeps every anchor', () => {
    const { includes } = parseTsconfig(TSCONFIG_PATH);
    for (const anchor of ANCHOR_INCLUDES) expect(includes).toContain(anchor);
  });

  test('the real tsconfig program covers wxt.config.ts and the scripts tree', () => {
    const { fileNames, errors } = parseTsconfig(TSCONFIG_PATH);
    expect(errors).toEqual([]);
    expect(fileNames).toContain(canonicalPath(join(ROOT, 'wxt.config.ts')));
    expect(fileNames).toContain(canonicalPath(join(ROOT, 'scripts', 'check-version-parity.ts')));
    expect(fileNames).toContain(canonicalPath(join(ROOT, 'scripts', 'selenium-webdriver.d.ts')));
  });

  test('full guard passes on the live repo (drift breaks CI)', () => {
    const { includes, fileNames, errors } = parseTsconfig(TSCONFIG_PATH);
    expect(errors).toEqual([]);
    const issues = checkCoverage({
      includes,
      programFiles: new Set(fileNames),
      expectedFiles: collectExpectedFiles(ROOT, SCRIPTS_DIR),
    });
    expect(issues).toEqual([]);
  });
});
