/**
 * check-tsconfig-coverage.ts - fail when tsconfig.json `include` drifts so a
 * code area silently drops out of `bun run typecheck`.
 *
 * History: wxt.config.ts (a root config) lived OUTSIDE tsconfig's include list
 * (which covered only src and tests), so a file-truncating edit passed every
 * local gate and only exploded when WXT tried to load the config. The fix
 * added root `*.config.ts` files and later the whole scripts directory to
 * include - but nothing stopped a future refactor from quietly narrowing
 * those patterns again. This guard closes that loop:
 *
 *   1. Anchors - the four include entries that define the coverage policy
 *      (src, tests, scripts, root *.config.ts) must ALL still be present.
 *   2. Membership - every root *.config.ts file and every TypeScript file
 *      under scripts/ must actually resolve into the parsed TS program. If
 *      someone narrows the scripts pattern to a subset of files, the anchor
 *      check alone would pass while individual script files go unchecked.
 *
 * Uses the real TypeScript config resolver (ts.parseJsonConfigFileContent via
 * getParsedCommandLineOfConfigFile) so the membership check reflects exactly
 * what the compiler - and svelte-check - will load, not a reimplementation of
 * tsconfig glob semantics.
 *
 * Run: bun run check-tsconfig-coverage
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { collectSourceFiles, repoAbsolute } from './source-files';

const ROOT = resolve(import.meta.dir, '..');
const TSCONFIG_PATH = join(ROOT, 'tsconfig.json');
const SCRIPTS_DIR = join(ROOT, 'scripts');

/**
 * The include entries that define this repo's typecheck coverage policy.
 * Removing ANY of them (even when the area is momentarily empty) fails.
 */
export const ANCHOR_INCLUDES: readonly string[] = [
  'src/**/*',
  'tests/**/*',
  'scripts/**/*',
  '*.config.ts',
];

/** Extensions the guard treats as typecheckable source under scripts/. */
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/** Canonical path for set membership - case-insensitive on Windows. */
export function canonicalPath(p: string): string {
  const abs = resolve(p);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * Every file the coverage policy says MUST be typechecked: root *.config.ts
 * files plus every TypeScript file under scripts/ (recursively).
 */
export function collectExpectedFiles(rootDir: string, scriptsDir: string): string[] {
  const expected: string[] = [];
  // Both lists come from the shared lister (`scripts/source-files.ts`), so a
  // file `.gitignore` covers is not demanded into the typecheck program by this
  // gate while every other gate and `bun run check` treat it as absent.
  for (const file of collectSourceFiles({ dirs: [rootDir], extensions: ['.ts'], flat: true })) {
    if (/\.config\.ts$/.test(file)) expected.push(canonicalPath(repoAbsolute(file)));
  }
  if (dirExists(scriptsDir)) {
    for (const file of collectSourceFiles({ dirs: [scriptsDir], extensions: [...TS_EXTENSIONS] })) {
      expected.push(canonicalPath(repoAbsolute(file)));
    }
  }
  return expected;
}

function dirExists(dir: string): boolean {
  try {
    readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve tsconfig through the real TypeScript API. Returns the raw `include`
 * entries (as written), the canonical file list the compiler program loads,
 * and any config-file diagnostics.
 *
 * The raw text is parsed with `ts.parseConfigFileTextToJson` (not strict
 * `JSON.parse`) so JSONC comments / trailing commas in tsconfig.json are
 * tolerated exactly the way tsc and svelte-check read them - a comment-only
 * doc note must not make the guard report the config as invalid.
 */
export function parseTsconfig(tsconfigPath: string): {
  includes: string[];
  fileNames: string[];
  errors: string[];
} {
  const rawText = readFileSync(tsconfigPath, 'utf8');
  const { config: raw, error: parseError } = ts.parseConfigFileTextToJson(tsconfigPath, rawText);
  if (parseError || !raw || typeof raw !== 'object') {
    const detail = parseError
      ? ts.flattenDiagnosticMessageText(parseError.messageText, '\n')
      : 'unable to parse config';
    return {
      includes: [],
      fileNames: [],
      errors: [`${relative(ROOT, tsconfigPath)} is not valid JSON: ${detail}`],
    };
  }
  const includes = Array.isArray(raw.include) ? raw.include.map(String) : [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfigPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diag) => {
        throw new Error(ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
      },
    }
  );
  const errors = (parsed?.errors ?? []).map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n')
  );
  const fileNames = (parsed?.fileNames ?? []).map(canonicalPath);
  return { includes, fileNames, errors };
}

export interface CoverageInput {
  includes: readonly string[];
  /** Canonical file names the parsed TS program actually loads. */
  programFiles: ReadonlySet<string>;
  /** Canonical file names that MUST be covered by the policy. */
  expectedFiles: readonly string[];
}

/** Pure policy check - returns the list of coverage issues (empty = pass). */
export function checkCoverage(input: CoverageInput): string[] {
  const issues: string[] = [];
  for (const anchor of ANCHOR_INCLUDES) {
    if (!input.includes.includes(anchor)) {
      issues.push(
        `tsconfig include is missing the "${anchor}" anchor - that area is no longer typechecked.`
      );
    }
  }
  for (const file of input.expectedFiles) {
    if (!input.programFiles.has(file)) {
      issues.push(
        `${relative(ROOT, file)} is NOT covered by tsconfig include - add or widen an include pattern so it is typechecked.`
      );
    }
  }
  return issues;
}

function main(): void {
  const { includes, fileNames, errors } = parseTsconfig(TSCONFIG_PATH);
  const issues = [...errors.map((e) => `tsconfig error: ${e}`)];
  if (errors.length === 0) {
    const expectedFiles = collectExpectedFiles(ROOT, SCRIPTS_DIR);
    issues.push(...checkCoverage({ includes, programFiles: new Set(fileNames), expectedFiles }));
  }

  if (issues.length > 0) {
    console.error(`\nTSCONFIG COVERAGE DRIFT (${issues.length}):`);
    for (const issue of issues) console.error(`  ✗ ${issue}`);
    console.error(
      '\nFix tsconfig.json include so every source area stays typechecked - this guard fails\n' +
        'CLOSED when the include list is narrowed or a root config / script file falls outside it.'
    );
    process.exit(1);
  }

  const configCount = expectedRootConfigCount();
  console.log(
    `✓ tsconfig include covers src/, tests/, scripts/, and all ${configCount} root *.config.ts file(s) - ` +
      `${countExpectedScriptFiles()} script file(s) verified in the parsed program.`
  );
}

function expectedRootConfigCount(): number {
  let n = 0;
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && /^.+\.config\.ts$/.test(entry.name)) n += 1;
  }
  return n;
}

function countExpectedScriptFiles(): number {
  const expected = collectExpectedFiles(ROOT, SCRIPTS_DIR);
  return expected.filter((p) => p.startsWith(canonicalPath(SCRIPTS_DIR))).length;
}

if (import.meta.main) main();
