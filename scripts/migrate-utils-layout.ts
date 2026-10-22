/**
 * One-shot codemod: regroup the flat `src/utils/` directory into topic buckets.
 *
 * `src/utils/` had grown to ~108 flat files spanning storage, i18n, email,
 * provider, crypto, OTP, clipboard, theme and UI-interaction helpers, while
 * docs/ARCHITECTURE.md documents it as "utilities + dsl/" only. This tool moves
 * each file into a topic bucket and rewrites EVERY reference to it:
 *
 *   1. alias specifiers        `@/utils/storage-keys.js`
 *   2. literal path strings    `src/utils/storage-keys.ts`  (the gate scripts)
 *   3. mirrored unit tests     `tests/unit/utils/x.test.ts` -> `.../<bucket>/`
 *   4. relative specifiers     `./crypto.js` -> `../security/crypto.js`
 *
 * (4) is the subtle one: a moved file's own `./sibling.js` imports were written
 * relative to its OLD directory, and a file left behind can import a moved
 * sibling by its old relative path. The fixup phase therefore resolves every
 * relative specifier against the directory the specifier was AUTHORED in
 * (the old path for moved files), maps the target through the move table, and
 * re-emits the path relative to the file's CURRENT directory - preserving the
 * original extension style (`.js` stays `.js`, extensionless stays bare).
 *
 * Every phase is idempotent, so re-running is safe. History is preserved with
 * `git mv` (falling back to a plain rename when git is unavailable).
 *
 * Usage:
 *   bun scripts/migrate-utils-layout.ts                       # dry-run, all buckets
 *   bun scripts/migrate-utils-layout.ts --only=storage,i18n   # dry-run, subset
 *   bun scripts/migrate-utils-layout.ts --only=storage --write
 *   bun scripts/migrate-utils-layout.ts --fixup-only --write   # repair specifiers only
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

/** Topic buckets: [target dir under src/utils, flat file basenames (with ext)]. */
const BUCKETS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'storage',
    [
      'email-labels-store.ts',
      'mailbox-read-state.ts',
      'storage-hygiene.ts',
      'storage-keys.ts',
      'storage-repository.ts',
      'storage-snapshot.ts',
      'storageMonitor.ts',
      'stored-prefs-sync.ts',
      'vault-lock.ts',
    ],
  ],
  [
    'i18n',
    [
      'content-i18n.ts',
      'i18n-background.ts',
      'i18n-shared.ts',
      'i18n-utils.ts',
      'i18n.ts',
      'locale-font-scale.ts',
      'locale-profile.ts',
      'view-display-names.ts',
    ],
  ],
  ['otp', ['otp-auto-copy.ts', 'otp-code.ts', 'otp-magic-expiry.ts', 'totp.ts']],
  ['clipboard', ['clipboard-purge-status.ts', 'clipboard-settings.ts', 'clipboard.ts']],
  ['notifications', ['notification-permission.ts', 'notification-sound.ts']],
  ['time', ['time-format.ts', 'time-store.ts', 'time.ts']],
  [
    'email',
    [
      'csv-export.ts',
      'email-body-zoom.ts',
      'email-label-catalog.ts',
      'email-links.ts',
      'email-mapper.ts',
      'email-service.ts',
      'email-star-key.ts',
      'email-threads.ts',
      'print-email.ts',
      'sanitize-html.ts',
      'sender-avatars.ts',
    ],
  ],
  [
    'provider',
    [
      'blocked-temp-mail-sites.ts',
      'connectivity-log.ts',
      'instance-manager.ts',
      'instance-validation.ts',
      'ping-service.ts',
      'provider-expiry.ts',
      'provider-instance.ts',
      'provider-validation.ts',
    ],
  ],
  [
    'content',
    [
      'autofill-blocklist.ts',
      'content-bg-bridge.ts',
      'content-constants.ts',
      'content-default-theme-colors.ts',
      'content-errors.ts',
      'content-logger.ts',
      'content-message-guard.ts',
      'user-agent.ts',
    ],
  ],
  [
    'security',
    [
      'client-ip.ts',
      'crypto.ts',
      'dom-guard.ts',
      'dom-safe.ts',
      'login-credential-normalization.ts',
      'root-domain.ts',
      'safe-fetch.ts',
      'secure-random.ts',
    ],
  ],
  [
    'theme',
    [
      'avatar-color.ts',
      'avatar-initials.ts',
      'color-utils.ts',
      'default-avatar.ts',
      'material-color-utils.ts',
      'theme-generator.ts',
    ],
  ],
  ['activity', ['action-history.ts', 'activity-tracker.ts']],
  ['search', ['search-history.ts', 'search-shortcuts.ts']],
  ['address', ['address-status.ts', 'address-tags.ts']],
  [
    'ui',
    [
      'action-pill-spacing.ts',
      'breakpoints.ts',
      'dialog-lifecycle.ts',
      'elevation.ts',
      'favicon-content-type.ts',
      'favicon.ts',
      'fit-label-font.ts',
      'focusTrap.ts',
      'gesture-selection.ts',
      'gesture-token.ts',
      'horizontal-wheel-scroll.ts',
      'iconMapping.ts',
      'layout-state-store.ts',
      'marquee-selection.ts',
      'nav-layout.ts',
      'optical-center.ts',
      'portal-layers.ts',
      'resize-observer.ts',
      'shared-ui.ts',
      'sidebar-fab.ts',
      'toastStore.ts',
      'responsive-button-layout.ts',
      'virtual-list.ts',
    ],
  ],
];

const WRITE = process.argv.includes('--write');
const FIXUP_ONLY = process.argv.includes('--fixup-only');
/** Move source files only - leave tests/unit/utils/ flat so run order is stable. */
const NO_TEST_MOVES = process.argv.includes('--no-test-moves');
const REVERT_TESTS = process.argv.includes('--revert-tests');
const ONLY = new Set(
  (process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const ROOT = join(import.meta.dir, '..');
const SELF = join(import.meta.dir, 'migrate-utils-layout.ts');
const SCAN_DIRS = ['src', 'tests', 'scripts'];
const SCAN_EXTS = new Set(['.ts', '.svelte', '.js']);
const SKIP_DIRS = new Set(['node_modules', '.output', '.wxt', 'dist']);

interface Planned {
  bucket: string;
  name: string;
  from: string;
  to: string;
  kind: 'src' | 'test';
}

// ── 1. Build the full plan, then split it into applied / pending by disk state ─

const plan: Planned[] = [];
const missing: string[] = [];

for (const [bucket, files] of BUCKETS) {
  for (const file of files) {
    const name = file.replace(/\.ts$/, '');
    const from = join(ROOT, 'src', 'utils', file);
    const to = join(ROOT, 'src', 'utils', bucket, file);
    if (!existsSync(from) && !existsSync(to)) {
      missing.push(relative(ROOT, from));
      continue;
    }
    plan.push({ bucket, name, from, to, kind: 'src' });

    // Mirrored unit tests move only when the basename matches exactly; alias
    // tests (e.g. action-btn-gap.test.ts covering responsive-button-layout.ts) stay put.
    const testFrom = join(ROOT, 'tests', 'unit', 'utils', `${name}.test.ts`);
    const testTo = join(ROOT, 'tests', 'unit', 'utils', bucket, `${name}.test.ts`);
    if (existsSync(testFrom) || existsSync(testTo)) {
      plan.push({ bucket, name, from: testFrom, to: testTo, kind: 'test' });
    }
  }
}

/** A planned move counts as done once the destination exists and the source is gone. */
const isApplied = (p: Planned): boolean => existsSync(p.to) && !existsSync(p.from);
const isPending = (p: Planned): boolean => existsSync(p.from) && !existsSync(p.to);

const selected = (p: Planned): boolean => ONLY.size === 0 || ONLY.has(p.bucket);

const toMove = plan.filter(
  (p) => isPending(p) && selected(p) && (NO_TEST_MOVES ? p.kind === 'src' : true)
);
const applied = plan.filter(isApplied);

if (plan.length === 0) {
  console.error('No planned files found - check the BUCKETS table.');
  process.exit(1);
}

// ── 1b. Optional: put moved test files back where they were ──────────────────
//
// Bun runs every test file in ONE process, and 68 files call `mock.module`
// without ever restoring it. Moving test files reshuffles the run order, which
// re-points those leaked global mocks at different consumers - so a test-file
// move can break files it never touches. Source-only moves leave the test set
// (and therefore its order) untouched, so this reverses the earlier test moves.
if (REVERT_TESTS) {
  let reverted = 0;
  for (const p of plan) {
    if (p.kind !== 'test') continue;
    if (!existsSync(p.to) || existsSync(p.from)) continue;
    mkdirSync(dirname(p.from), { recursive: true });
    try {
      execFileSync('git', ['mv', relative(ROOT, p.to), relative(ROOT, p.from)], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch {
      renameSync(p.to, p.from);
    }
    reverted += 1;
  }

  // git mv leaves the emptied bucket directories behind on disk.
  const flatTests = join(ROOT, 'tests', 'unit', 'utils');
  let pruned = 0;
  for (const entry of readdirSync(flatTests, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(flatTests, entry.name);
    if (readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true, force: true });
      pruned += 1;
    }
  }
  console.log(
    `Reverted ${reverted} test move(s) to tests/unit/utils/ (pruned ${pruned} empty dir(s)).`
  );
  process.exit(0);
}

// ── 2. MOVE phase ────────────────────────────────────────────────────────────

let movedCount = 0;
if (WRITE && !FIXUP_ONLY) {
  for (const p of toMove) {
    if (!statSync(p.from).isFile()) continue;
    mkdirSync(dirname(p.to), { recursive: true });
    try {
      execFileSync('git', ['mv', relative(ROOT, p.from), relative(ROOT, p.to)], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch {
      renameSync(p.from, p.to); // no git (or path untracked) - plain rename keeps content
    }
    movedCount += 1;
  }
}

// ── 3. Move table: base path (extension stripped) -> new base path ────────────

const EXT_RE = /\.(js|ts|mjs|cjs|svelte|css|json|html)$/;
const stripExt = (p: string): string => (EXT_RE.test(p) ? p.replace(EXT_RE, '') : p);

/**
 * Every move that will have happened by the end of this run - already-applied
 * plus the ones just performed (or, in a dry run, the ones that would be).
 */
const effectiveMoves = [...applied, ...toMove];
const moveBase = new Map<string, string>();
const newToOld = new Map<string, string>();
for (const p of effectiveMoves) {
  moveBase.set(stripExt(p.from), stripExt(p.to));
  newToOld.set(p.to, p.from);
}
const bucketByName = new Map(
  effectiveMoves.filter((p) => p.kind === 'src').map((p) => [p.name, p.bucket])
);

// ── 4. Alias / literal path rewriting: `@/utils/<name>` in any path context ───

// Longest-first so `time-format` wins over `time`, `storageMonitor` over `storage`.
const names = [...bucketByName.keys()].sort((a, b) => b.length - a.length);
const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const pathPrefix = 'utils/';
/**
 * Matches `<name>` in any path context - `@/utils/<name>.js`, `../src/utils/
 * <name>.js`, `'src/utils/<name>.ts'` - but only when the name is terminated by
 * an extension dot, a quote, whitespace or a delimiter, so a bucket-qualified
 * path (`utils/storage/storage-keys.js`) never re-matches.
 */
const NAME_RE =
  names.length > 0 ? new RegExp(`(${pathPrefix})(?:${escaped})(?=[.'"\`\\s,;)]|$)`, 'g') : null;

function rewritePathRefs(text: string): { text: string; count: number } {
  if (NAME_RE === null) return { text, count: 0 };
  let count = 0;
  const next = text.replace(
    NAME_RE,
    (match: string, prefix: string, offset: number, whole: string) => {
      const name = whole.slice(offset + prefix.length, offset + match.length);
      const bucket = bucketByName.get(name);
      if (bucket === undefined) return match;
      count += 1;
      return `${prefix}${bucket}/${name}`;
    }
  );
  return { text: next, count };
}

// ── 5. Relative-specifier fixup ──────────────────────────────────────────────

const REL_RE = /(from\s*|import\s*\(\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

function relativize(fromDir: string, target: string): string {
  let rel = relative(fromDir, target).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

/** True when `base` names a real module, trying the usual source extensions. */
function existsAsModule(base: string): boolean {
  if (existsSync(base)) return true;
  for (const ext of ['.ts', '.js', '.svelte', '.json']) {
    if (existsSync(base + ext)) return true;
  }
  for (const ext of ['.ts', '.js']) {
    if (existsSync(join(base, `index${ext}`))) return true;
  }
  return false;
}

/**
 * Rewrites relative specifiers after a move.
 *
 * A specifier is meaningful relative to the file's CURRENT directory (the usual
 * case) or, for a file moved in an earlier batch, relative to the directory it
 * was AUTHORED in. Both interpretations are therefore tried, and the winning
 * target is mapped through the move table before being re-emitted relative to
 * the file's current directory:
 *
 *   - `./crypto.js` written in `src/utils/` becomes `../crypto.js` once the file
 *     lives in `src/utils/storage/`, even if `crypto.ts` has not moved yet;
 *   - a later batch that moves `crypto.ts` then rewrites it again to
 *     `../security/crypto.js`.
 */
function rewriteRelativeRefs(file: string, text: string): { text: string; count: number } {
  const newDir = dirname(file);
  const oldPath = newToOld.get(file);
  const oldDir = oldPath === undefined ? newDir : dirname(oldPath);
  let count = 0;
  const next = text.replace(
    REL_RE,
    (match: string, keyword: string, quote: string, spec: string) => {
      const ext = EXT_RE.exec(spec)?.[0] ?? '';
      // A specifier is meaningful relative to the file's CURRENT directory (the
      // usual case) or, for a file moved in an earlier batch, the directory it
      // was authored in. Later batches move the target, so both must be checked:
      // `./crypto.js` and `../crypto.js` both have to resolve to the same module.
      const newBase = stripExt(resolve(newDir, spec));
      const oldBase = stripExt(resolve(oldDir, spec));
      let target: string | undefined;
      if (moveBase.has(newBase)) target = moveBase.get(newBase);
      else if (existsAsModule(newBase))
        target = newBase; // already correct for the current directory
      else if (moveBase.has(oldBase)) target = moveBase.get(oldBase);
      else if (oldPath !== undefined && existsAsModule(oldBase)) target = oldBase;
      if (target === undefined) return match; // virtual or non-module specifier - leave alone
      const updated = `${relativize(newDir, target)}${ext}`;
      if (updated === spec) return match;
      count += 1;
      return `${keyword}${quote}${updated}${quote}`;
    }
  );
  return { text: next, count };
}

// ── 6. Walk the scan roots and apply both rewrites ───────────────────────────

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (SCAN_EXTS.has(extname(entry.name))) {
      yield full;
    }
  }
}

const targets = SCAN_DIRS.flatMap((d) => {
  const full = join(ROOT, d);
  return existsSync(full) ? [...walk(full)] : [];
});
// Root-level configs (wxt.config.ts et al.) reference source paths too.
for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.config.ts')) targets.push(join(ROOT, entry.name));
}

const edited: Array<{ file: string; pathRefs: number; relRefs: number }> = [];
let totalPathRefs = 0;
let totalRelRefs = 0;

for (const file of targets) {
  if (file === SELF) continue; // the codemod's own bucket tables are not references
  const before = readFileSync(file, 'utf8');
  // The alias pass is a no-op for already-moved code; the relative pass repairs
  // moved files and anything left behind that pointed at them by old path.
  const aliased = rewritePathRefs(before);
  const fixed = rewriteRelativeRefs(file, aliased.text);
  if (aliased.count === 0 && fixed.count === 0) continue;
  edited.push({
    file: relative(ROOT, file).replace(/\\/g, '/'),
    pathRefs: aliased.count,
    relRefs: fixed.count,
  });
  totalPathRefs += aliased.count;
  totalRelRefs += fixed.count;
  if (WRITE) writeFileSync(file, fixed.text, 'utf8');
}

// ── 7. Report ────────────────────────────────────────────────────────────────

const byBucket = new Map<string, { src: number; test: number }>();
for (const p of effectiveMoves) {
  const entry = byBucket.get(p.bucket) ?? { src: 0, test: 0 };
  if (p.kind === 'src') entry.src += 1;
  else entry.test += 1;
  byBucket.set(p.bucket, entry);
}

const verb = FIXUP_ONLY ? 'FIXUP' : WRITE ? 'MOVE' : 'DRY-RUN';
console.log(
  `${verb} - ${toMove.filter((p) => p.kind === 'src').length} source + ${toMove.filter((p) => p.kind === 'test').length} test file(s) to move now; ${applied.length} already moved`
);
for (const [bucket, n] of [...byBucket].sort()) {
  console.log(
    `  src/utils/${bucket.padEnd(14)} ${String(n.src).padStart(3)} files, ${n.test} test(s)`
  );
}
console.log(
  `\n${WRITE ? 'Rewrote' : 'Would rewrite'} ${totalPathRefs} path reference(s) + ${totalRelRefs} relative specifier(s) across ${edited.length} file(s):`
);
for (const e of edited
  .sort((a, b) => b.pathRefs + b.relRefs - (a.pathRefs + a.relRefs))
  .slice(0, 10)) {
  console.log(
    `  ${String(e.pathRefs + e.relRefs).padStart(4)}  ${e.file}${e.relRefs > 0 ? `  (${e.relRefs} relative)` : ''}`
  );
}
if (edited.length > 10) console.log(`  … ${edited.length - 10} more file(s)`);
if (missing.length > 0) console.log(`\nSkipped (not found): ${missing.join(', ')}`);

// Filesystem paths are resolved at RUNTIME, so no specifier rewrite can see
// them. A moved file that builds a path from `import.meta.dir` + counted `../`
// hops, or scans a tree by relative path, needs a manual depth fix - flag them
// rather than letting the move fail silently at test time.
const FS_PATTERN =
  /import\.meta\.(dir|dirname|url)|readFileSync|readdirSync|Bun\.Glob|process\.cwd\(\)/;
const fsRisks: string[] = [];
for (const p of effectiveMoves) {
  if (!existsSync(p.to)) continue;
  if (FS_PATTERN.test(readFileSync(p.to, 'utf8')))
    fsRisks.push(relative(ROOT, p.to).replace(/\\/g, '/'));
}
if (fsRisks.length > 0) {
  console.log('\n⚠ REVIEW - moved file(s) build filesystem paths that no rewrite can fix:');
  for (const f of fsRisks) console.log(`    ${f}`);
}
if (movedCount > 0) console.log(`\nMoved ${movedCount} file(s) via git mv.`);
else if (!WRITE) console.log('\nDry run only. Re-run with --write to apply.');
console.log('\nNext: bun run typecheck');
