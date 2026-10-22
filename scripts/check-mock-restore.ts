/**
 * check-mock-restore.ts - fail when a test file registers a module mock but
 * never restores it.
 *
 * Bun runs the entire unit suite in a single process, and `mock.module()`
 * replaces a module in the process-wide registry with no automatic undo. A file
 * that mocks without restoring therefore rewrites the world for whichever test
 * file runs next, which makes the suite's verdict depend on file ORDER rather
 * than on the code: renaming or relocating a test file could (and did) break
 * tests it never touched. 67 files were leaking this way before the gate.
 *
 * A file is compliant when it calls `mock.restore()` somewhere (conventionally
 * in an `afterAll`, so the cleanup runs even when an assertion throws):
 *
 *   import { afterAll, describe, expect, mock, test } from 'bun:test';
 *
 *   // Restore module mocks so nothing leaks into later test files (one Bun process).
 *   afterAll(() => {
 *     mock.restore();
 *   });
 *
 * Detection runs on the syntax-only view from the shared `./source-lexer`
 * (comments, strings, templates and regexes blanked), so a mention of
 * `mock.module` in prose or in a string - a doc comment, a fixture such as
 * tests/unit/helpers/svelte-harness.ts - is not mistaken for a call, and
 * neither is a `mock.restore()` parked inside a trailing `// …` comment, which
 * the previous line-anchored regex accepted.
 *
 * Run: bun run check-mock-restore
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles, REPO_ROOT } from './source-files';
import { codeOnly } from './source-lexer';

const MOCKS_RE = /\bmock\.module\s*\(/;
const RESTORES_RE = /\bmock\.restore\s*\(/;

/**
 * The `tests/` unit files, minus the browser suites.
 *
 * `collectAbsoluteFiles` supplies the tree (gitignored files already excluded -
 * the shared rule every gate now follows); the `match` predicate keeps this
 * gate's OWN rule, which is unrelated to ignores: the Playwright/Selenium suites
 * under `e2e/` are not bun tests and never touch `mock.module`.
 */
function unitTestFiles(): string[] {
  return collectAbsoluteFiles(join(REPO_ROOT, 'tests'), ['.ts'], {
    match: (p) => !p.startsWith('tests/e2e/') && !p.startsWith('tests/e2e-webkit/'),
  });
}

const offenders: string[] = [];
let mockingFiles = 0;

for (const file of unitTestFiles()) {
  const syntax = codeOnly(readFileSync(file, 'utf8'));
  if (!MOCKS_RE.test(syntax)) continue;
  mockingFiles += 1;
  if (!RESTORES_RE.test(syntax)) offenders.push(relative(REPO_ROOT, file).replace(/\\/g, '/'));
}

if (offenders.length > 0) {
  console.error(
    `\n❌ ${offenders.length} test file(s) register a module mock without restoring it:\n`
  );
  for (const f of offenders) console.error(`    ${f}`);
  console.error(
    '\nBun runs the whole suite in one process, so an unrestored mock leaks into later\n' +
      'test files and makes the run order-dependent. Add:\n\n' +
      '    afterAll(() => {\n      mock.restore();\n    });\n'
  );
  process.exit(1);
}

console.log(`✓ every module mock is restored (${mockingFiles} test file(s) register mocks).`);
