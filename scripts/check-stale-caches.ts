/**
 * check-stale-caches.ts - flags a module-level cache with no lifetime story.
 *
 * WHAT IT CATCHES
 *
 * A container declared at module scope and written after initialization - a
 * `Map`/`Set`/array/object record living as long as its context (a service
 * worker that runs for minutes-to-hours, an app tab for days, a content script
 * for the lifetime of a page). Nothing evicts those entries on its own, so they
 * outlive the truth they hold: a provider config captured before the user
 * changed it, an address list from before a delete, a selection registry left
 * behind by a view that was torn down, an inbox "active mailbox" record still
 * pointing at a mailbox that no longer exists.
 *
 * The gate does NOT demand a cache be removed - caches are how this app stays
 * usable. It demands each one NAME its lifetime, because the alternative is a
 * container whose entries are correct only until the first write elsewhere in
 * the app, and nothing on screen says so.
 *
 * THE RULE
 *
 * A written container must carry at least one of:
 *
 *   ttl           entries are stamped and compared against a clock
 *                 (`Date.now()` / `performance.now()` plus `ttl` / `maxAge` /
 *                 `expiresAt` / `timestamp` / `staleAfter` beside the container)
 *   invalidation  entries are removed - `.delete(`, `.clear(`, `delete x[k]`,
 *                 `.shift()` / `.pop()` / `.splice(`, `x.length = 0`, a
 *                 whole-container reset (`x = new Map()`), or a `clear*` /
 *                 `invalidate*` / `purge*` / `evict*` / `reset*` path for it
 *   bound         capacity is capped (`.size > MAX`, `.slice(0, N)`, a `max*`
 *                 constant) so it cannot grow without limit
 *   weak          `WeakMap` / `WeakSet` - keys are held weakly, so entries die
 *                 with their owner and no lifetime story is needed
 *
 * Evidence is looked for on lines that mention the container, in the same file,
 * AFTER its declaration: a clock or a bound somewhere else in the file is not a
 * lifetime story for this container.
 *
 * WHAT IS NOT A CACHE
 *
 *  - A container that is never written after initialization: a lookup table
 *    (`new Set([...])` of allowed keys, a domain list) holds constants, not
 *    data that can go stale.
 *  - A Svelte component's per-instance state, which is why a `.svelte` file is
 *    scanned in its `<script module>` block only (instance state dies with the
 *    component; module state does not).
 *
 * WHAT IT CANNOT SEE (stated, because the gate is a ratchet, not a proof)
 *
 *  - **Aliased writes.** A container handed to a helper that writes it under a
 *    different name, or reached through a destructured alias, reads as
 *    write-free here - so it is skipped rather than reported (a skipped
 *    container can hide a real finding; the count is printed).
 *  - **Containers built by a factory.** `const x = createRegistry()` is not a
 *    literal declaration, so it is invisible however long it lives; only a
 *    `new Map` / `new Set` / `[...]` / `{...}` initializer is recognised.
 *  - **Property writes on a record.** `cache.foo = v` mutates a member of the
 *    object rather than rebinding it, so it is not counted as a write - the same
 *    exclusion that keeps an object used as a namespace of functions from being
 *    reported. A record written ONLY that way (`x[k] = v` and whole-container
 *    reassignment are both recognised) is skipped.
 *  - **Indented module-level declarations.** Only a column-0 `const`/`let` is
 *    treated as module scope, so a container declared inside a top-level `if`
 *    block is invisible.
 *  - **Cross-file lifetime.** A `clear()` exported for tests counts as an
 *    invalidation path here, because the gate cannot tell a test hook from a
 *    production one.
 *
 * Ratchet: `scripts/baselines/stale-caches.txt` lists `<path><TAB><container><TAB># why`
 * rows for the reviewed exceptions - pre-existing debt to fix, or a PERMANENT
 * registry that must never be cleared (and then the why column is what makes
 * the difference legible). It is PRESERVED across `--update` rather than
 * regenerated, because a row's reason is the one thing a regeneration cannot
 * reconstruct. A new finding fails the build, and so does a row whose container
 * now carries evidence - the list may only shrink.
 *
 * Usage:
 *   bun scripts/check-stale-caches.ts            # gate (exit 1 on findings)
 *   bun scripts/check-stale-caches.ts --list     # every container + its evidence
 *   bun scripts/check-stale-caches.ts --update   # rewrite the baseline
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectAbsoluteFiles, REPO_ROOT } from './source-files';
import { codeOnly } from './source-lexer';

const SRC_DIR = join(REPO_ROOT, 'src');
export const BASELINE_PATH = join(REPO_ROOT, 'scripts', 'baselines', 'stale-caches.txt');

export type CacheKind = 'Map' | 'Set' | 'WeakMap' | 'WeakSet' | 'array' | 'record';
export type CacheEvidence = 'ttl' | 'invalidation' | 'bound' | 'weak';

export interface CacheSite {
  /** Container identifier as declared. */
  name: string;
  kind: CacheKind;
  /** 1-based line of the declaration, in the file. */
  line: number;
  /** 1-based lines that write the container (after its declaration). */
  writeLines: number[];
  evidence: CacheEvidence[];
}

/**
 * One baseline row: the container, and - for a row that is NOT debt - why its
 * entries can never go stale. The reason is free text after a third `<TAB>`.
 * It is compared by `file`/`name` only, and preserved by `--update`, because a
 * regenerated file would otherwise erase the one thing that distinguishes a
 * reviewed permanent registry from unexamined debt.
 */
export type BaselineRow = { file: string; name: string; reason?: string };

/**
 * `const NAME = new Map()` / `= […]` / `= {…}` at module scope. The declaration
 * may span lines - a `new Map<\n  string,\n  Entry\n>()` is as much a container
 * as the one-line form, and the longest-lived caches in this codebase are the
 * annotated multi-line ones. An initializer is matched by its opening bracket,
 * not by being empty: `const seen: string[] = []` and `const seen = ['a']` are
 * the same container, and the rule that spares a lookup table is "never written
 * after initialization", not "started empty" - `cachedHtmlSettings` (a seeded
 * settings copy, written by its loader) was invisible to the empty-only form.
 * Indented (non-module) declarations do not match.
 */
const DECLARATION =
  /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=\s*(new\s+(Map|Set|WeakMap|WeakSet)\b|\[|\{)/gm;

/** A clock or expiry token beside the container - half of the `ttl` evidence. */
const TTL_TOKEN =
  /(Date\.now\(|performance\.now\(|\bttl\b|maxAge|expiresAt|expires_at|\btimestamp\b|staleAfter)/;
/** A capacity ceiling beside the container. */
const BOUND_TOKEN =
  /(\.size\s*>|\.length\s*>|\.slice\(0,|\bmax[A-Z]\w*|\bMAX\w*|\bmaxItems\b|\bmaxSize\b)/;
/** Removing entries / resetting the whole container. */
const INVALIDATION_CALL =
  /\.(delete|clear|shift|pop|splice|unshift)\(|delete\s+[A-Za-z_$][\w$]*\s*\[|__clear|(clear|invalidate|purge|evict|reset)[A-Z]\w*/;
/** A whole-container reset: `x = []`, `x = {}`, `x = new Map()`. */
const RESET_ASSIGNMENT = /=\s*(new\s+(Map|Set|WeakMap|WeakSet)\b|\[\s*\]|\{\s*\})/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Is this line a write to `name` (as opposed to a read of it)? */
function isWrite(name: string, line: string): boolean {
  const id = escapeRegExp(name);
  if (
    new RegExp(
      `\\b${id}\\s*\\.\\s*(set|add|push|unshift|delete|clear|shift|pop|splice)\\s*\\(`
    ).test(line)
  ) {
    return true;
  }
  if (new RegExp(`\\bdelete\\s+${id}\\s*\\[`).test(line)) return true;
  if (new RegExp(`\\b${id}\\s*\\[[^\\]]*\\]\\s*=[^=]`).test(line)) return true;
  if (new RegExp(`\\b${id}\\s*\\.\\s*length\\s*=[^=]`).test(line)) return true;
  // Whole-container reassignment, excluding comparisons, arrow bodies and
  // member writes (`a.b = …`) on the same name.
  return new RegExp(`(^|[^\\w$.:=!<>+\\-*/|&?])\\b${id}\\s*=\\s*[^=]`).test(line);
}

/**
 * Containers declared at module scope in one code segment, with everything the
 * gate needs to judge them. `svelte` segments are `<script module>` blocks, so
 * the line numbers are shifted back onto the file by the caller.
 */
export function scanSegment(code: string, lineOffset = 0): CacheSite[] {
  const lines = code.split('\n');
  const sites: CacheSite[] = [];

  DECLARATION.lastIndex = 0;
  for (let match = DECLARATION.exec(code); match; match = DECLARATION.exec(code)) {
    const name = match[1] ?? '';
    // A `new Map` family name, else the initializer's own bracket decides.
    const kind: CacheKind = match[3]
      ? (match[3] as CacheKind)
      : match[2] === '['
        ? 'array'
        : 'record';
    const index = code.slice(0, match.index).split('\n').length - 1;
    const id = escapeRegExp(name);
    const mentions = new RegExp(`\\b${id}\\b`);
    const writeLines: number[] = [];
    const evidence = new Set<CacheEvidence>();

    for (let i = index + 1; i < lines.length; i += 1) {
      const candidate = lines[i] ?? '';
      if (!mentions.test(candidate)) continue;
      if (isWrite(name, candidate)) writeLines.push(lineOffset + i + 1);
      if (TTL_TOKEN.test(candidate)) evidence.add('ttl');
      if (BOUND_TOKEN.test(candidate)) evidence.add('bound');
      if (INVALIDATION_CALL.test(candidate)) evidence.add('invalidation');
      // A reset is BOTH a write and an invalidation path - an empty container
      // holds nothing to go stale.
      if (RESET_ASSIGNMENT.test(candidate) && isWrite(name, candidate)) {
        evidence.add('invalidation');
      }
    }

    // Never written after initialization → a lookup table, not a cache.
    if (writeLines.length === 0) continue;
    // A weak container's entries die with their key: no lifetime story needed.
    if (kind === 'WeakMap' || kind === 'WeakSet') evidence.add('weak');

    sites.push({
      name,
      kind,
      line: lineOffset + index + 1,
      writeLines,
      evidence: [...evidence].sort(),
    });
  }

  return sites;
}

/** Is this container missing a lifetime story? */
export function isFinding(site: CacheSite): boolean {
  return site.evidence.length === 0;
}

/**
 * The `<script module>` block of a Svelte component - the ONLY place module
 * state can be declared there. `null` when the component has no module script.
 */
export function moduleScript(text: string): { code: string; lineOffset: number } | null {
  const match = /<script\b[^>]*\bmodule\b[^>]*>([\s\S]*?)<\/script>/.exec(text);
  if (!match) return null;
  const body = match[1] ?? '';
  const consumed = text.slice(0, match.index + match[0].indexOf('>') + 1);
  return { code: body, lineOffset: consumed.split('\n').length - 1 };
}

/** Every cache candidate in one file (comments excluded, strings blanked). */
export function scanFile(path: string): CacheSite[] {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.svelte')) {
    const script = moduleScript(text);
    if (!script) return [];
    return scanSegment(codeOnly(script.code), script.lineOffset);
  }
  return scanSegment(codeOnly(text));
}

export type RepoSite = CacheSite & { file: string };

/**
 * Every container the gate judges, across `src`. Exported because the unit tests
 * assert against the LIVE repository through the CLI's own code path rather than
 * a second copy of its rules - a test that re-implemented the walk would keep
 * passing while the gate read nothing.
 */
export function scanRepository(): RepoSite[] {
  const sites: RepoSite[] = [];
  for (const file of collectAbsoluteFiles(SRC_DIR, ['.ts', '.svelte'])) {
    const repoPath = relative(REPO_ROOT, file).replace(/\\/g, '/');
    for (const site of scanFile(file)) sites.push({ ...site, file: repoPath });
  }
  return sites;
}

/** The stored baseline (empty when the file does not exist yet). */
export function readBaseline(): BaselineRow[] {
  return existsSync(BASELINE_PATH) ? parseBaseline(readFileSync(BASELINE_PATH, 'utf8')) : [];
}

export function parseBaseline(text: string): BaselineRow[] {
  const rows: BaselineRow[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [file, name, ...rest] = trimmed.split('\t');
    if (!file || !name) continue;
    const reason = rest.join('\t').trim().replace(/^#\s*/, '');
    rows.push(reason ? { file, name, reason } : { file, name });
  }
  return rows;
}

export function formatBaseline(rows: readonly BaselineRow[]): string {
  return `${[...rows]
    .sort((a, b) => `${a.file}\t${a.name}`.localeCompare(`${b.file}\t${b.name}`))
    .map((r) => `${r.file}\t${r.name}${r.reason ? `\t# ${r.reason}` : ''}`)
    .join('\n')}\n`;
}

/** Which findings are new, and which baseline rows no longer have a finding. */
export function diffBaseline(
  findings: readonly BaselineRow[],
  baseline: readonly BaselineRow[]
): { added: BaselineRow[]; stale: BaselineRow[] } {
  const key = (row: BaselineRow) => `${row.file}\t${row.name}`;
  const listed = new Set(baseline.map(key));
  const found = new Set(findings.map(key));
  return {
    added: findings.filter((row) => !listed.has(key(row))),
    stale: baseline.filter((row) => !found.has(key(row))),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const BASELINE_HEADER = `# Module-level cache baseline - a ratchet: rows may only disappear.
# Format: <path><TAB><container name>[<TAB># why]
# Each row is a module-level container that is written after initialization and
# carries NO lifetime story (see scripts/check-stale-caches.ts). A row is either
# debt to fix, or a reviewed PERMANENT registry whose entries can never go stale
# - and the second kind MUST say which in the trailing why column, which
# --update preserves. A new finding that is not listed here fails the gate, and
# a row whose container later grows a ttl / invalidation / bound also fails, so
# the list can only shrink.
# Refresh (after shrinking) with:
#   bun scripts/check-stale-caches.ts --update
`;

function main(): void {
  const update = process.argv.includes('--update');
  const list = process.argv.includes('--list');

  const sites = scanRepository();
  const findings = sites.filter(isFinding);

  if (list) {
    for (const site of sites) {
      const tag = isFinding(site) ? 'NO LIFETIME STORY' : site.evidence.join('+');
      console.log(
        `${site.file}:${site.line}\t[${tag}] ${site.name} (${site.kind}) ` +
          `writes@${site.writeLines.join(',')}`
      );
    }
    console.log(
      `\n${sites.length} container(s) written after initialization; ` +
        `${findings.length} without a lifetime story.`
    );
    return;
  }

  const baseline = readBaseline();
  // A row that is still a finding KEEPS its recorded reason: the file is a
  // ledger of reviewed exceptions, not a regenerated report.
  const reasonByKey = new Map(baseline.map((row) => [`${row.file}\t${row.name}`, row.reason]));
  const rows: BaselineRow[] = findings.map((site) => {
    const reason = reasonByKey.get(`${site.file}\t${site.name}`);
    return reason
      ? { file: site.file, name: site.name, reason }
      : { file: site.file, name: site.name };
  });
  const { added, stale } = diffBaseline(rows, baseline);

  if (update) {
    writeFileSync(BASELINE_PATH, BASELINE_HEADER + formatBaseline(rows));
    console.log(
      `stale-caches baseline updated: ${rows.length} row(s) ` +
        `(${stale.length} removed, ${added.length} added).`
    );
    return;
  }

  if (added.length > 0) {
    console.error(`Module-level caches with no lifetime story (${added.length} new):`);
    for (const row of added) {
      for (const site of findings.filter((s) => s.file === row.file && s.name === row.name)) {
        console.error(`  ${row.file}:${site.line}  ${site.name} (${site.kind})`);
        console.error(`    written at line(s): ${site.writeLines.join(', ')}`);
      }
    }
    console.error(
      '\nGive the container ONE of these, beside itself, in the same file:\n' +
        '  - a TTL: stamp each entry and compare it to a clock (`Date.now()` with\n' +
        '    `ttl` / `maxAge` / `expiresAt` / `timestamp`);\n' +
        '  - an invalidation path: `.delete(` / `.clear(` on the entry that ends\n' +
        '    its truth, `delete x[k]`, a whole-container reset, or an exported\n' +
        '    `clear*` / `invalidate*` the owner calls on teardown;\n' +
        '  - a capacity bound (`.size > MAX` with a `max*` constant), when the\n' +
        '    cache is genuinely append-only;\n' +
        '  - `WeakMap` / `WeakSet`, when the entry belongs to one object.\n' +
        'A container that is never written after initialization is a lookup table,\n' +
        'not a cache, and is not reported.'
    );
  }

  if (stale.length > 0) {
    console.error(
      `\nStale baseline row(s) - these containers now carry evidence (${stale.length}):`
    );
    for (const row of stale) console.error(`  ${row.file}\t${row.name}`);
    console.error('Run `bun scripts/check-stale-caches.ts --update` to drop them.');
  }

  if (added.length > 0 || stale.length > 0) process.exit(1);

  console.log(
    `No module-level cache without a lifetime story beyond the baseline ` +
      `(${sites.length} container(s) written after initialization; ` +
      `${sites.length - findings.length} with evidence; ${findings.length} row(s)).`
  );
}

// CLI entry only - unit tests import the pure core above.
if (import.meta.main) main();
