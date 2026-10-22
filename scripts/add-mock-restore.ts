/**
 * One-shot codemod: make every unit test file restore the module mocks it
 * registers.
 *
 * Bun runs the entire suite in a single process, and `mock.module()` replaces a
 * module for the WHOLE process - it is never undone automatically. 67 of this
 * repo's test files call it and none restored it, so every one of them left a
 * stubbed logger/storage/browser behind for whichever file happened to run
 * next. The suite only passed because the run order happened to be lucky, which
 * means the order was load-bearing: renaming or moving a test file could break
 * tests it never touched.
 *
 * This adds `afterAll` to the `bun:test` import of every file that registers a
 * mock and places `afterAll(() => mock.restore())` after that file's last import
 * statement, so each file cleans up after itself. Biome then normalizes import
 * order.
 *
 * The pass is idempotent and self-relocating: an existing block is removed and
 * re-inserted at the right place, so re-running after improvements converges.
 *
 * Usage:
 *   bun scripts/add-mock-restore.ts           # dry-run report
 *   bun scripts/add-mock-restore.ts --write   # apply
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const WRITE = process.argv.includes('--write');
const ROOT = join(import.meta.dir, '..');
const TESTS_DIR = join(ROOT, 'tests', 'unit');

/** One line, repeated per file, to keep the diff tight. */
const COMMENT = '// Restore module mocks so nothing leaks into later test files (one Bun process).';
const CALL = 'afterAll(() => {\n  mock.restore();\n});';
const BLOCK = `${COMMENT}\n${CALL}`;
const BLOCK_RE = new RegExp(`\\n*${escapeRe(COMMENT)}\\n${escapeRe(CALL)}\\n?`, 'g');
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*(['"])bun:test\2;/;
const MOCK_RE = /\bmock\.module\s*\(/;
const IMPORT_START_RE = /^import\s+(?:type\s+)?[\w{*'"]/;
const SKIP_DIRS = new Set(['node_modules', 'fixtures']);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (extname(entry.name) === '.ts') {
      yield full;
    }
  }
}

/**
 * Index of the line that terminates the last top-level import statement, or -1.
 * Line-based so multi-line `import { … } from '…';` blocks are handled.
 */
function lastImportLine(lines: string[]): number {
  let last = -1;
  let open = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!open && IMPORT_START_RE.test(lines[i])) open = true;
    if (open && /;\s*$/.test(lines[i])) {
      last = i;
      open = false;
    }
  }
  return last;
}

const edited: string[] = [];
const already: string[] = [];
const noImport: string[] = [];

for (const file of walk(TESTS_DIR)) {
  const source = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const hasBlock = source.includes(COMMENT);

  if (!MOCK_RE.test(source)) continue; // registers no mocks - nothing to restore
  if (source.includes('mock.restore()') && !hasBlock) {
    already.push(rel); // hand-written cleanup - leave it alone
    continue;
  }

  // Drop any block inserted by an earlier run so it can be re-positioned.
  let body = source.replace(BLOCK_RE, '\n');

  const match = IMPORT_RE.exec(body);
  if (match === null) {
    noImport.push(rel);
    continue;
  }
  const names = match[1];
  if (!/\bafterAll\b/.test(names)) {
    const merged = `${names.trim().replace(/,$/, '')}, afterAll`;
    body = body.replace(
      match[0],
      match[0].replace(`{${names}}`, `{ ${merged.replace(/\s+/g, ' ').trim()} }`)
    );
  }

  const lines = body.split('\n');
  const anchor = lastImportLine(lines);
  if (anchor === -1) {
    noImport.push(rel);
    continue;
  }
  // Skip a single blank line so the block sits directly under the imports.
  const insertAt = lines[anchor + 1]?.trim() === '' ? anchor + 2 : anchor + 1;
  lines.splice(insertAt, 0, `\n${BLOCK}`);
  const next = lines.join('\n').replace(/\n{3,}/g, '\n\n');

  edited.push(rel);
  if (WRITE) writeFileSync(file, next, 'utf8');
}

console.log(`${WRITE ? 'APPLIED' : 'DRY-RUN'} - ${edited.length} file(s)`);
if (already.length > 0) console.log(`Already restoring mocks (skipped): ${already.length}`);
if (noImport.length > 0) {
  console.log('\n⚠ No usable imports/statement anchor (needs a manual edit):');
  for (const f of noImport) console.log(`    ${f}`);
}
for (const f of edited.slice(0, 6)) console.log(`  ${f}`);
if (edited.length > 6) console.log(`  … ${edited.length - 6} more`);
if (!WRITE) console.log('\nDry run only. Re-run with --write to apply.');
