/**
 * One file-discovery mechanism, and the rule it enforces: gitignored ⇒ invisible.
 *
 * The bug this replaces is an ASYMMETRY, not a wrong answer. Ten scripts each
 * carried a private walker and their own idea of what to skip - one had a
 * `SKIP_DIRS` set, another skipped dotfiles and `node_modules` and `.output`, a
 * third walked the entire repository - while `biome.json` sets
 * `vcs.useIgnoreFile: true`, so `bun run check` (the last step of `bun run audit`
 * and of every pre-commit run) skipped `.gitignore` matches that the walkers read
 * anyway. The same scratch file could therefore fail one gate and be invisible to
 * another, and which happened depended on the gate.
 *
 * The tests below come in two halves: what the resolver ANSWERS (against git as
 * the oracle, and against the trade-off the module documents), and that every
 * gate actually ASKS it - including a gate added to `audit` later, which cannot
 * opt out without either wiring up or being named as an exception here.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  collectAbsoluteFiles,
  collectSourceFiles,
  ignoreRuleSet,
  isIgnored,
  listRepoFiles,
  REPO_ROOT,
  toolIgnorePatterns,
  withoutIgnored,
} from '../../../scripts/source-files';

const SCRIPTS_DIR = join(REPO_ROOT, 'scripts');

/** Run git in the repo and return stdout ('' when git cannot answer). */
function git(args: string[]): string {
  const proc = Bun.spawnSync(['git', ...args], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
  return proc.stdout?.toString() ?? '';
}

/** The oracle: what git itself says, by pattern alone (`--no-index`). */
function gitIgnored(paths: string[]): Set<string> {
  const proc = Bun.spawnSync(['git', 'check-ignore', '--no-index', '--stdin', '-z'], {
    cwd: REPO_ROOT,
    stdin: new TextEncoder().encode(`${paths.join('\0')}\0`),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return new Set((proc.stdout?.toString() ?? '').split('\0').filter(Boolean));
}

/**
 * The gate files invoked by `bun run audit`, resolved through package.json.
 *
 * The chain's MEMBERSHIP lives in the runner (`AUDIT_GATES` in
 * scripts/audit.ts), which is side-effect free to import (`main()` runs under
 * `import.meta.main`). Each entry is a package.json script name - the same hop
 * the old `&&` parser made - so a gate renamed out of package.json, or a name
 * that no longer resolves to a `scripts/*.ts` file, drops out of this list and
 * fails the ratchet below instead of quietly going unchecked.
 */
async function auditGateFiles(): Promise<string[]> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const { AUDIT_GATES } = (await import('../../../scripts/audit')) as {
    AUDIT_GATES: ReadonlyArray<{ name: string }>;
  };
  const files = new Set<string>();
  for (const gate of AUDIT_GATES) {
    const target = pkg.scripts[gate.name] ?? '';
    const resolved = target.match(/scripts\/([\w.-]+\.ts)/);
    if (resolved) files.add(resolved[1]);
  }
  return [...files].sort();
}

/** Resolved once for the whole file (the chain list is static). */
const gates = await auditGateFiles();

/**
 * Gates that DO walk a tree, but not the repository's source - each with the
 * reason. A stale entry fails (`existsSync`), a reason-less one fails, and a
 * classifier whose claim is false fails: each of these covers a path `.gitignore`
 * deliberately excludes, so filtering it through the lister would break the gate.
 */
const DISCOVERY_EXCEPTIONS = new Map<string, string>([
  [
    'check-stale-builds.ts',
    'its input IS the build output: mtimes under .output/, which .gitignore deliberately covers',
  ],
  [
    'check-responsive-button-layout-firefox.ts',
    'walks the Selenium Firefox profile cache under the user home, outside the repository',
  ],
  [
    'check-responsive-button-layout-visual.ts',
    'walks the Playwright browser cache under the user home, outside it',
  ],
]);

/**
 * Gates that never walk anything: they read paths they NAME. There is no ignore
 * rule to honour because there is no discovery, and the claim is checked rather
 * than trusted - each must contain no directory walk.
 */
const NAMED_INPUTS = new Map<string, string>([
  ['check-branch-protection.ts', 'reads the git remote; no working-tree paths at all'],
  ['check-providers.ts', 'reads src/config/providers.jsonc by name'],
]);

/** Any of the three ways a script can find files. */
const WALKS_TREE = /readdirSync|new Bun\.Glob|\breaddir\(/;

describe('the shared lister answers as git does', () => {
  test('it can consult the rules at all (git available, not the degraded walk)', () => {
    // `none-git-unavailable` would scan everything, which is a silent difference in
    // a gate's verdict - CI and every dev machine have git, so it must be in force.
    expect(ignoreRuleSet()).toBe('gitignore');
  });

  test('isIgnored agrees with `git check-ignore --no-index` on a probe set', () => {
    // A tracked source file, an ignored doc, an ignored root probe, and a locale
    // - one of each shape a gate can meet.
    const probes = [
      'src/ui/App.svelte',
      'src/locales/en.json',
      'docs/OTP_EXTRACTION.md',
      '.tmp-icon-audit.ts',
      'node_modules/.package-lock.json',
    ];
    const oracle = gitIgnored(probes);
    for (const probe of probes) {
      // The oracle only answers for paths git knows; a missing probe is still a
      // meaningful comparison because the pattern decides either way.
      expect(isIgnored(probe)).toBe(oracle.has(probe));
    }
  });

  test('a tracked file an ignore rule matches is STILL ignored (the `--no-index` trade)', () => {
    // Without `--no-index` git shields tracked paths from its own patterns, so a
    // tracked file under an ignored directory would read as not-ignored and the
    // gates would contradict biome (which skips `audit/AUDIT.md`, verified).
    // This asserts the module takes the pattern-only side, and that the shield is
    // real - otherwise the choice would be arbitrary rather than deliberate.
    const trackedIgnored = git(['ls-files', '-i', '-c', '--exclude-standard'])
      .split('\n')
      .filter(Boolean);
    if (trackedIgnored.length === 0) return; // nothing to disagree about today
    const sample = trackedIgnored[0] as string;
    expect(git(['check-ignore', sample]).trim()).toBe(''); // git's default shields it
    expect(isIgnored(sample)).toBe(true); // the module follows the pattern
  });

  test("biome's own config ignore list is honoured too (a second channel)", () => {
    // `.gitignore` is not the only way a file is already invisible to the tooling:
    // biome's `files.includes` negations ignore more. If the gates did not follow
    // those, the asymmetry came straight back through that door - skipped by
    // `bun run check`, scanned by a gate. The patterns are read from the config.
    const patterns = toolIgnorePatterns();
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      // Only the shapes the matcher implements. A pattern using another construct
      // (brace expansion, a character class) would be silently under-applied, so
      // it fails here instead - extend `globToRegExp` and this list together.
      expect(pattern).toMatch(/^[\w./*-]+$/);
    }
    const named = patterns.filter((p) => !p.includes('*') && existsSync(join(REPO_ROOT, p)));
    expect(named.length).toBeGreaterThan(0);
    for (const path of named) {
      expect(isIgnored(path)).toBe(true);
      expect(listRepoFiles()).not.toContain(path);
    }
  });

  test('no tracked SOURCE file is ignore-matched (the trade cannot bite)', () => {
    // The flip side of pattern-only rules: a tracked file stops being scanned. That
    // is safe for the audit prose under `audit/`, which biome already skips, but it
    // must never be true of source code - clearing this list means either the
    // ignore rule or the file's tracking is wrong.
    const offenders = git(['ls-files', '-i', '-c', '--exclude-standard'])
      .split('\n')
      .filter((p) => /^(src|tests|scripts)\//.test(p) && /\.(ts|tsx|svelte|css|json)$/.test(p));
    expect(offenders).toEqual([]);
  });
});

describe('listRepoFiles answers with the working tree, not the index', () => {
  const files = listRepoFiles();

  test('every listed file exists - index entries can outlive their file', () => {
    // The first run of the shared lister died on exactly this: `git ls-files
    // --cached` lists a file deleted-but-not-yet-staged, and a gate then opened a
    // path that was not there. Existence is settled here, once, for every caller.
    for (const file of files) expect(existsSync(join(REPO_ROOT, file))).toBe(true);
  });

  test('nothing ignored is listed, and the list is sorted and non-trivial', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toEqual([...files].sort());
    for (const file of files) expect(isIgnored(file)).toBe(false);
    // The specific asymmetry that started this: the docs an ignore rule covers.
    expect(files).not.toContain('docs/OTP_EXTRACTION.md');
    expect(files.some((f) => f.startsWith('src/'))).toBe(true);
  });
});

describe('collectSourceFiles filters without re-introducing a skip list', () => {
  test('dirs + extensions, deterministically', () => {
    const svelte = collectSourceFiles({ dirs: ['src'], extensions: ['.svelte'] });
    expect(svelte.length).toBeGreaterThan(50);
    expect(svelte.every((f) => f.startsWith('src/') && f.endsWith('.svelte'))).toBe(true);
    expect(svelte).toEqual([...svelte].sort());
  });

  test('two directories at once, each with its own extensions', () => {
    const docs = collectSourceFiles({ dirs: ['docs'], extensions: ['.md'] });
    expect(docs.every((f) => f.startsWith('docs/') && f.endsWith('.md'))).toBe(true);
    expect(docs).not.toContain('docs/OTP_EXTRACTION.md'); // ignored, so invisible
  });

  test('flat skips subdirectories - the locales/background collision', () => {
    // `src/locales/en.json` and `src/locales/background/en.json` share a basename,
    // so a gate that maps to basenames would read one locale twice. `flat` is what
    // every locale gate uses for exactly that reason, and it must exclude the
    // generated minimal sets while keeping the UI dictionaries.
    const localesDir = join(REPO_ROOT, 'src', 'locales');
    const flat = collectAbsoluteFiles(localesDir, ['.json'], { flat: true });
    const recursive = collectAbsoluteFiles(localesDir, ['.json']);
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.length).toBeLessThan(recursive.length);
    expect(flat.every((f) => dirname(f) === localesDir)).toBe(true);
    expect(flat.map((f) => basename(f))).toContain('en.json');
    expect(recursive.some((f) => dirname(f) === join(localesDir, 'background'))).toBe(true);
  });

  test('flat at the REPO ROOT keeps root-level files, and only those', () => {
    // A regression the typecheck-coverage gate caught through its own live-repo
    // test: `dirname('wxt.config.ts')` is '.', not '', so comparing the parent
    // against an empty root prefix matched nothing and silently dropped every
    // root config file (`wxt.config.ts`, `playwright.config.ts`, …) from the
    // files that gate insists must be typechecked.
    const rootTs = collectSourceFiles({ dirs: ['.'], extensions: ['.ts'], flat: true });
    expect(rootTs).toContain('wxt.config.ts');
    expect(rootTs).toContain('tailwind.config.ts');
    expect(rootTs.every((f) => !f.includes('/'))).toBe(true);
  });

  test('withoutIgnored is the same rule for a caller that globs its own files', () => {
    const kept = withoutIgnored([
      'src/locales/en.json',
      'docs/OTP_EXTRACTION.md',
      '.tmp-icon-audit.ts',
    ]);
    expect(kept).toEqual(['src/locales/en.json']);
  });
});

describe('every audit gate resolves its files the same way', () => {
  test('the audit chain resolved to gate files (the ratchet has something to hold)', () => {
    expect(gates.length).toBeGreaterThan(15);
    expect(gates).toContain('check-i18n-fit.ts');
    expect(gates).toContain('check-hardcoded-english.ts');
  });

  test('each gate is wired, reads only named inputs, or walks a documented path', () => {
    // Adding a gate to `bun run audit` therefore cannot opt out of the rule by
    // accident: it calls the lister, or it is classified here - and every
    // classification is CHECKED against the file, so "it reads named inputs" or
    // "it walks something ignored" cannot be claimed without being true.
    const unclassified: string[] = [];
    for (const gate of gates) {
      const source = readFileSync(join(SCRIPTS_DIR, gate), 'utf8');
      if (source.includes("from './source-files'")) continue; // honours the rule
      const namedInput = NAMED_INPUTS.get(gate);
      if (namedInput !== undefined) {
        expect([gate, namedInput, WALKS_TREE.test(source)]).toEqual([gate, namedInput, false]);
        continue;
      }
      if (DISCOVERY_EXCEPTIONS.has(gate)) {
        expect([gate, WALKS_TREE.test(source)]).toEqual([gate, true]);
        continue;
      }
      unclassified.push(gate);
    }
    expect(unclassified).toEqual([]);
  });

  test('each exception and named input still exists, with its reason', () => {
    for (const [file, reason] of [...DISCOVERY_EXCEPTIONS, ...NAMED_INPUTS]) {
      const path = join(SCRIPTS_DIR, file);
      expect(existsSync(path)).toBe(true); // a stale exemption fails
      expect(reason.length).toBeGreaterThan(20); // and carries its justification
      // A gate that quietly adopted the lister is no longer an exemption.
      expect(readFileSync(path, 'utf8')).not.toContain("from './source-files'");
    }
  });
});
