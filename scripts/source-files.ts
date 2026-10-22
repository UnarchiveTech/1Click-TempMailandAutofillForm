/**
 * scripts/source-files.ts
 *
 * ONE file-discovery mechanism for every audit gate.
 *
 * A gate that finds its own files finds its own ignore rules. Ten scripts here
 * each carried a private `collectSvelteFiles` / `collectFiles` / `walk`, and not
 * one of them consulted `.gitignore` - while `bun x biome check` (the last step
 * of `bun run audit`, and every pre-commit run) DOES, because `biome.json` sets
 * `vcs.useIgnoreFile: true`. So the same scratch file could fail one gate and be
 * invisible to another, and the verdict of the whole audit depended on which
 * gate happened to look at it first.
 *
 * The rule this module enforces is the one the repo already implies everywhere:
 *
 *   **gitignored ⇒ invisible to the gates.**
 *
 * HOW THE RULE IS RESOLVED, AND WHY THIS WAY
 *
 * 1. The file list comes from `git ls-files --cached --others --exclude-standard`
 *    - every file git considers part of the working tree: tracked files, plus
 *    untracked files no ignore rule covers. One spawn, no traversal, and ignored
 *    directories are never descended into (the old walkers hand-rolled their own
 *    `SKIP_DIRS` and disagreed with each other, and one of them walked the whole
 *    repository).
 *
 * 2. A second `git check-ignore --no-index --stdin -z` pass drops the files that
 *    are tracked *and* matched by a pattern. `--no-index` is the whole point:
 *    without it git shields tracked paths from its own rules, so a tracked file
 *    under an ignored directory (this repo has several, e.g. `audit/*.md`, which
 *    `.gitignore` covers as `audit/`) would be reported as NOT ignored. Biome
 *    applies the patterns with no index in sight - it skips `audit/AUDIT.md`,
 *    verified - so `--no-index` is what makes this module agree with it instead
 *    of contradicting it.
 *
 * 3. If git cannot answer (no git on PATH, not a repository), both helpers fail
 *    OPEN: everything is scanned. A gate that scans too much is noisy; a gate
 *    that scans too little hides the violation it exists to find. `ignoreRuleSet`
 *    says which mode is in force so a script can disclose it.
 *
 * The consequence of (2), stated plainly because it is a real trade: a tracked
 * file that an ignore rule matches stops being scanned. That is already true of
 * biome, so this makes the gates AGREE rather than introducing the gap - and
 * `tests/unit/scripts/source-files.test.ts` fails if a tracked SOURCE file ever
 * lands in that state, which is the only way the trade could hurt.
 *
 * NOT for every caller: `check-stale-builds` deliberately measures mtimes under
 * `.output/`, which is ignored - its input is the build output, so it walks the
 * filesystem directly and is the documented exception.
 */

import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Repository root, derived from this file's own location (never `cwd`). */
export const REPO_ROOT = resolve(import.meta.dir, '..');

/** Which mode the ignore rule is running in, for a script's own disclosure. */
export type IgnoreRuleSet = 'gitignore' | 'none-git-unavailable';

let ruleSet: IgnoreRuleSet | null = null;
/** Resolved ignore status per absolute path - one answer per path per process. */
const ignoreCache = new Map<string, boolean>();
/** Memoized `git ls-files` result (null = git could not answer). */
let listedFiles: string[] | null | undefined;
/** Set once the whole repository has been resolved into `ignoreCache`. */
let primed = false;

/** Repo-relative, forward-slashed - the form git prints and accepts. */
function gitPath(absPath: string): string {
  return relative(REPO_ROOT, absPath).split(sep).join('/');
}

/** `git <args>` with stdin piped in. Null stdout when git could not answer. */
function git(args: string[], stdin?: string): { ok: boolean; stdout: string } {
  let result: ReturnType<typeof Bun.spawnSync>;
  try {
    result = Bun.spawnSync(['git', ...args], {
      cwd: REPO_ROOT,
      stdin: stdin === undefined ? 'ignore' : Buffer.from(stdin, 'utf8'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch {
    return { ok: false, stdout: '' };
  }
  // 0 = answered; 1 = a check-ignore "nothing matched", which is an answer too;
  // 128 = not a repository / git absent - not an answer.
  if (result.exitCode !== null && result.exitCode >= 128) return { ok: false, stdout: '' };
  return { ok: true, stdout: result.stdout?.toString() ?? '' };
}

/** Every file git would consider part of the working tree, repo-relative. */
function gitListedFiles(): string[] | null {
  if (listedFiles !== undefined) return listedFiles;
  const { ok, stdout } = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  listedFiles = ok ? stdout.split('\0').filter((p) => p.length > 0) : null;
  return listedFiles;
}

/**
 * The subset of `paths` that an ignore rule matches, resolved in ONE
 * `git check-ignore` call. `--no-index` makes the patterns apply regardless of
 * whether the path is tracked, which is what biome does.
 */
function patternIgnored(paths: readonly string[]): Set<string> {
  const ignored = new Set<string>();
  if (paths.length === 0) return ignored;
  const { ok, stdout } = git(
    ['check-ignore', '--no-index', '--stdin', '-z'],
    `${paths.join('\0')}\0`
  );
  if (!ok) {
    ruleSet = 'none-git-unavailable';
    return ignored;
  }
  for (const p of stdout.split('\0')) if (p.length > 0) ignored.add(p);
  return ignored;
}

/** Absolute, so a caller may pass either form and hit the same cache entry. */
function cacheKey(path: string): string {
  return resolve(REPO_ROOT, path);
}

/**
 * The second ignore channel: `biome.json`'s `files.includes` negations.
 *
 * `.gitignore` is not the only way a file becomes invisible to the tooling that
 * already skips it - biome's config has its own list (`!tests/visual/
 * preview-responsive-button-layout-module.js`, a generated artifact). Left out, the same failure
 * this module exists to remove comes straight back through that door: ignored by
 * `bun run check`, scanned by a gate. The patterns are READ from the config, not
 * mirrored here, so there is only one place to change and no drift to police.
 */
let toolPatterns: string[] | null = null;

/** The negated `files.includes` patterns from `biome.json` (empty if unreadable). */
export function toolIgnorePatterns(): string[] {
  if (toolPatterns !== null) return toolPatterns;
  try {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, 'biome.json'), 'utf8')) as {
      files?: { includes?: unknown };
    };
    const includes = config.files?.includes;
    toolPatterns = Array.isArray(includes)
      ? includes
          .filter((p): p is string => typeof p === 'string' && p.startsWith('!'))
          .map((p) => p.slice(1))
      : [];
  } catch {
    toolPatterns = [];
  }
  return toolPatterns;
}

/** Glob → RegExp, for the `**`, `*` and `?` shapes a config ignore list uses. */
function globToRegExp(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

const toolMatchers = new Map<string, RegExp>();

function toolIgnores(repoPath: string): boolean {
  for (const pattern of toolIgnorePatterns()) {
    let matcher = toolMatchers.get(pattern);
    if (matcher === undefined) {
      matcher = globToRegExp(pattern);
      toolMatchers.set(pattern, matcher);
    }
    if (matcher.test(repoPath)) return true;
  }
  return false;
}

/**
 * Resolve the WHOLE repository in one pass: the file listing plus the ignore
 * status of every path in it, cached. This is what keeps the per-path predicate
 * free - asking `isIgnored` about 850 listed files must not spawn git 850 times
 * (measured: 18.8s, and a unit test that timed out). After this, a listed path
 * is a cache hit and only a path OUTSIDE the listing costs a call.
 */
function prime(): void {
  if (primed) return;
  primed = true;
  const listed = gitListedFiles();
  if (listed === null) {
    ruleSet = 'none-git-unavailable';
    return;
  }
  const ignored = patternIgnored(listed);
  ruleSet = 'gitignore';
  for (const p of listed) {
    ignoreCache.set(join(REPO_ROOT, p), ignored.has(p) || toolIgnores(p));
  }
}

/** True when git's ignore rules cover this path (i.e. biome skips it too). */
export function isIgnored(path: string): boolean {
  const key = cacheKey(path);
  const cached = ignoreCache.get(key);
  if (cached !== undefined) return cached;
  prime();
  const afterPrime = ignoreCache.get(key);
  if (afterPrime !== undefined) return afterPrime;
  if (toolIgnores(gitPath(key))) {
    ignoreCache.set(key, true);
    return true;
  }
  // Not in the listing at all: either it does not exist, or a rule covers it (the
  // listing is tracked + untracked-not-ignored, so ignored paths are absent by
  // construction). Ask git, whose patterns answer for absent paths too.
  if (ruleSet === 'none-git-unavailable') {
    ignoreCache.set(key, false); // fail open: scan it
    return false;
  }
  const answer = patternIgnored([gitPath(key)]).size > 0;
  ignoreCache.set(key, answer);
  return answer;
}

/** `paths` minus everything git ignores - for callers that glob their own files. */
export function withoutIgnored<T extends string>(paths: readonly T[]): T[] {
  prime();
  // One `git check-ignore` call for whatever the prime did not already answer.
  const unresolved = paths.filter((p) => !ignoreCache.has(cacheKey(p)));
  if (unresolved.length > 0 && ruleSet === 'gitignore') {
    const ignored = patternIgnored(unresolved.map((p) => gitPath(cacheKey(p))));
    for (const p of unresolved) ignoreCache.set(cacheKey(p), ignored.has(gitPath(cacheKey(p))));
  }
  return paths.filter((p) => !isIgnored(p));
}

/** Which ignore rules are in force (`none-git-unavailable` = scanning everything). */
export function ignoreRuleSet(): IgnoreRuleSet {
  if (ruleSet === null) listRepoFiles();
  return ruleSet ?? 'none-git-unavailable';
}

/**
 * Fallback used ONLY when git cannot answer: a plain recursive walk. Without
 * ignore rules to consult, the only defensible choice is to look at everything -
 * so the two VCS-controlled directories that would make that pathological
 * (`node_modules`, `.git`) plus build output are skipped, and nothing else is.
 * Every one of those is covered by `.gitignore`, so this list can only ever
 * shrink what the git path already excludes, never introduce a rule of its own.
 */
const DEGRADED_SKIP = new Set(['node_modules', '.git', 'dist', '.output', '.wxt', 'coverage']);

function walkAll(dir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (DEGRADED_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkAll(full, out);
    else if (entry.isFile()) out.push(gitPath(full));
  }
}

/** Every scannable file in the repository, repo-relative and sorted. */
export function listRepoFiles(): string[] {
  prime();
  const listed = gitListedFiles();
  if (listed === null) {
    const walked: string[] = [];
    walkAll(REPO_ROOT, walked);
    return walked.sort();
  }
  // `git ls-files --cached` reports INDEX entries, and an entry whose working-tree
  // file is gone (deleted during a refactor, not yet staged) is still listed - the
  // first run of the shared lister died on exactly that, opening a test file that
  // no longer existed. A gate can only read what is there, so existence is checked
  // here, once, rather than leaving every caller to guess.
  return listed.filter((p) => !isIgnored(p) && existsSync(join(REPO_ROOT, p))).sort();
}

/** What a gate wants to scan: directories, extensions, and an optional filter. */
export interface CollectOptions {
  /** Directories to include, absolute or relative to the repo root. */
  dirs: readonly string[];
  /** Extensions to keep (`.svelte`, `.ts`, …). Omit for every file. */
  extensions?: readonly string[];
  /**
   * Only files DIRECTLY inside each directory. Needed where a subdirectory holds
   * a different KIND of file under the same name - `src/locales/*.json` are
   * dictionaries, `src/locales/background/*.json` are generated minimal sets, and
   * a recursive scan would read `en.json` twice.
   */
  flat?: boolean;
  /** Extra per-file filter, given the repo-relative path. */
  match?: (repoPath: string) => boolean;
}

/**
 * The gate file list: the repository's files, restricted to `dirs` and
 * `extensions`, with gitignored paths removed. Sorted, so a gate's output never
 * depends on filesystem order.
 */
export function collectSourceFiles(options: CollectOptions): string[] {
  // Repo-relative form of each requested dir: '' for the repository root, 'src',
  // 'docs/…'. Nothing else here reads a path, so this is the only place the two
  // forms (absolute in, repo-relative out) are bridged.
  const relDirs = options.dirs.map((dir) => gitPath(resolve(REPO_ROOT, dir)));
  const isUnder = (file: string, relDir: string): boolean =>
    relDir === '' ? true : file.startsWith(`${relDir}/`);
  // A file directly inside `relDir` - at the root that means "no slash at all",
  // which `dirname()` cannot express (it reports '.' for a bare filename).
  const isDirectChild = (file: string, relDir: string): boolean =>
    relDir === '' ? !file.includes('/') : dirname(file) === relDir;

  const extensions = options.extensions;
  return listRepoFiles().filter((file) => {
    const owner = relDirs.find((relDir) => isUnder(file, relDir));
    if (owner === undefined) return false;
    if (options.flat && !isDirectChild(file, owner)) return false;
    if (extensions && !extensions.some((ext) => file.endsWith(ext))) return false;
    return options.match ? options.match(file) : true;
  });
}

/** Absolute path for a repo-relative one, for callers that then read the file. */
export function repoAbsolute(repoPath: string): string {
  return join(REPO_ROOT, repoPath);
}

/**
 * `collectSourceFiles` for ONE directory, returned as absolute paths - the shape
 * a gate wants when it reads every file it scans (and reports them through
 * `relative(process.cwd(), …)`, so absolute paths keep their output identical).
 */
export function collectAbsoluteFiles(
  dir: string,
  extensions?: readonly string[],
  options: Omit<CollectOptions, 'dirs' | 'extensions'> = {}
): string[] {
  return collectSourceFiles({ ...options, dirs: [dir], extensions }).map(repoAbsolute);
}

/** Kept for the one caller that only needs "does this directory exist". */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
