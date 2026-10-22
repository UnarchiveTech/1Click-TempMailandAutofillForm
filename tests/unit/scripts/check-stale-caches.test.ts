/**
 * Unit tests for the stale-cache gate in scripts/check-stale-caches.ts.
 *
 * The gate exists because a module-level container has the lifetime of its
 * context - a service worker that runs for minutes-to-hours, an app tab for days
 * - and nothing evicts its entries: a provider config captured before the user
 * changed it, an address list from before a delete, a selection registry left
 * behind by a view that was torn down. Such a container is perfectly correct
 * until the first write elsewhere in the app, and nothing on screen says so.
 *
 * `scanSegment` is the pure core that decides what a container declaration is,
 * whether it is written after initialization, and what evidence of a lifetime
 * story sits beside it; `diffBaseline` is the ratchet over those verdicts.
 * Fixtures cover each rule and - as importantly - what must NEVER be reported,
 * because a gate that flags lookup tables and per-component state gets muted.
 * The last describe runs the CLI's own `scanRepository()` against the live tree,
 * so `bun test` fails the moment the gate would: a cache that names no lifetime,
 * or a baseline row whose container has since grown one.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASELINE_PATH,
  type BaselineRow,
  type CacheSite,
  diffBaseline,
  formatBaseline,
  isFinding,
  moduleScript,
  parseBaseline,
  readBaseline,
  scanRepository,
  scanSegment,
} from '../../../scripts/check-stale-caches';
import { REPO_ROOT } from '../../../scripts/source-files';

/** `scanSegment` for a single fixture, asserting it found at least one site. */
function oneSite(code: string): CacheSite {
  const sites = scanSegment(code);
  expect(sites.length).toBeGreaterThan(0);
  return sites[0] as CacheSite;
}

const rows = (...entries: Array<[string, string, string?]>): BaselineRow[] =>
  entries.map(([file, name, reason]) =>
    reason === undefined ? { file, name } : { file, name, reason }
  );

describe('what a container declaration is', () => {
  test('a Map, a Set and a WeakMap at module scope are all containers', () => {
    const sites = scanSegment(
      'const a = new Map();\nconst b = new Set();\nconst c = new WeakMap();\na.set(1, 2);\nb.add(1);\nc.set({}, 1);\n'
    );
    expect(sites.map((s) => [s.name, s.kind])).toEqual([
      ['a', 'Map'],
      ['b', 'Set'],
      ['c', 'WeakMap'],
    ]);
  });

  test('an array or a record literal is a container - populated or not', () => {
    // The rule that spares a lookup table is "never written after
    // initialization", NOT "started empty". Recognising only an EMPTY `[]`/`{}`
    // left a seeded module-level cache invisible: `cachedHtmlSettings` (a
    // settings copy its loader rewrites) was found the moment the bracket was
    // matched by itself rather than as `[]`.
    const seeded = oneSite(
      'const seeded: Config = { ...DEFAULT_CONFIG };\nfunction refresh(raw) { seeded = { ...DEFAULT_CONFIG, ...raw }; }\n'
    );
    expect([seeded.name, seeded.kind]).toEqual(['seeded', 'record']);
    expect(isFinding(seeded)).toBe(true);

    const list = oneSite("const list = ['a'];\nlist.push('b');\n");
    expect([list.name, list.kind]).toEqual(['list', 'array']);
    expect(isFinding(list)).toBe(true);
  });

  test('a multi-line annotated declaration is still module scope', () => {
    // The longest-lived caches here are the annotated ones; a scanner that only
    // saw the one-line form would miss exactly the containers it exists for.
    const site = oneSite('const cache = new Map<\n  string,\n  Entry\n>();\ncache.set(1, 2);\n');
    expect([site.name, site.kind, site.line]).toEqual(['cache', 'Map', 1]);
  });

  test('the declaration spans `export const` / `let` too', () => {
    const sites = scanSegment(
      'export const cache = new Map();\ncache.set(1, 2);\nlet bag = [];\nbag.push(1);\n'
    );
    expect(sites.map((s) => s.name)).toEqual(['cache', 'bag']);
  });

  test('an INDENTED declaration is invisible (documented limitation)', () => {
    // Only a column-0 declaration is module scope. Stated in the gate's header
    // rather than left to be discovered: a container declared inside a
    // top-level `if` block is not judged at all.
    expect(scanSegment('if (x) {\n  const inner = new Map();\n  inner.set(1, 2);\n}\n')).toEqual(
      []
    );
  });
});

describe('what is NOT a cache', () => {
  test('a container never written after initialization is a lookup table', () => {
    // A static set of allowed keys, a domain list, a nav map: constants, not
    // data that can go stale.
    const table =
      "const ALLOWED = new Set(['a', 'b']);\nfunction ok(v) { return ALLOWED.has(v); }\n";
    expect(scanSegment(table)).toEqual([]);
    const map = "const BY_KEY = new Map([['a', 1]]);\nconst got = BY_KEY.get('a');\n";
    expect(scanSegment(map)).toEqual([]);
  });

  test('a weak container needs no lifetime story (its keys hold it)', () => {
    const site = oneSite('const stacks = new WeakMap();\nstacks.set(owner, 1);\n');
    expect(site.evidence).toEqual(['weak']);
    expect(isFinding(site)).toBe(false);
  });

  test('a component instance container dies with the component', () => {
    // Only `<script module>` is scanned in a Svelte file: instance state is
    // per-component and torn down with it, module state is not.
    const svelte = [
      '<p>hi</p>',
      '<script module lang="ts">',
      'const moduleCache = new Map();',
      'moduleCache.set(1, 2);',
      '</script>',
      '<script lang="ts">',
      'const instanceCache = new Map();',
      'instanceCache.set(1, 2);',
      '</script>',
      '',
    ].join('\n');
    const script = moduleScript(svelte);
    // The body begins at the END of the opening tag's own line (line 2), so its
    // line 0 is the remainder of line 2 - the offset is that many newlines.
    expect(script?.lineOffset).toBe(1);
    const sites = scanSegment(script?.code ?? '', script?.lineOffset ?? 0);
    // Line numbers are shifted back onto the FILE, so a finding is clickable.
    expect(sites.map((s) => [s.name, s.line])).toEqual([['moduleCache', 3]]);
  });
});

describe('what counts as a lifetime story', () => {
  test('an invalidation path is enough', () => {
    const site = oneSite('const cache = new Map();\ncache.set(1, 2);\ncache.delete(1);\n');
    expect(site.evidence).toEqual(['invalidation']);
    expect(isFinding(site)).toBe(false);
  });

  test('a whole-container reset is an invalidation path', () => {
    // An empty container holds nothing to go stale, so the reassignment itself
    // is the lifetime story - and it is also a write, which is why the reset is
    // judged rather than skipped.
    const site = oneSite('const cache = new Map();\ncache.set(1, 2);\ncache = new Map();\n');
    expect(site.evidence).toContain('invalidation');
    expect(isFinding(site)).toBe(false);
  });

  test('a clock beside an entry is enough', () => {
    const site = oneSite(
      'const cache = new Map();\nfunction put(k, v) { cache.set(k, { v, expiresAt: Date.now() + TTL_MS }); }\n'
    );
    expect(site.evidence).toEqual(['ttl']);
  });

  test('a capacity bound is enough', () => {
    // An append-only cache with a ceiling cannot grow without limit.
    const site = oneSite(
      'const cache = new Map();\ncache.set(1, 2);\nif (cache.size > MAX_CACHE_ENTRIES) cache.clear();\n'
    );
    expect(site.evidence).toEqual(['bound', 'invalidation']);
  });

  test('evidence must sit AFTER the declaration, on a line naming the container', () => {
    // A clock elsewhere in the file is not a lifetime story for THIS container.
    const before = oneSite(
      'const now = Date.now();\nconst cache = new Map();\ncache.set(1, now);\n'
    );
    expect(before.evidence).toEqual([]);
    expect(isFinding(before)).toBe(true);

    // …and nor is evidence on a line about something else.
    const unrelated = oneSite(
      'const cache = new Map();\nconst otherTtl = 1000;\notherTtl = Date.now();\ncache.set(1, 2);\n'
    );
    expect(unrelated.evidence).toEqual([]);
  });

  test('a comment mentioning a TTL is not evidence (comments are not code)', () => {
    const site = oneSite(
      'const cache = new Map();\ncache.set(1, 2);\n// no ttl here: entries are cleared on teardown\n'
    );
    expect(site.evidence).toEqual([]);
    expect(isFinding(site)).toBe(true);
  });

  test('write lines are reported, so a finding points at the writes', () => {
    const site = oneSite(
      'const cache = new Map();\ncache.set(1, 2);\nconst v = cache.get(1);\ncache.set(2, 3);\n'
    );
    expect(site.writeLines).toEqual([2, 4]); // reads are not writes
  });
});

describe('the baseline ratchet', () => {
  test('parse -> format -> parse is stable, sorted, and keeps reasons', () => {
    const original = rows(
      ['src/b.ts', 'second'],
      ['src/a.ts', 'first', 'PERMANENT: mirrors a process-global registry']
    );
    const text = formatBaseline(original);
    expect(parseBaseline(text)).toEqual([
      { file: 'src/a.ts', name: 'first', reason: 'PERMANENT: mirrors a process-global registry' },
      { file: 'src/b.ts', name: 'second' },
    ]);
    // The `#` is cosmetic: a hand-written row and a regenerated one read alike.
    expect(parseBaseline('src/a.ts\tfirst\tPERMANENT: keeps the reason\n')[0]?.reason).toBe(
      'PERMANENT: keeps the reason'
    );
  });

  test('comments and blank lines are ignored, and a malformed row exempts nothing', () => {
    expect(parseBaseline('# header\n\nsrc/a.ts\tfirst\n')).toEqual([
      { file: 'src/a.ts', name: 'first' },
    ]);
    // A row missing its name parses to nothing - so the container it meant stays
    // a finding and the gate reports it as NEW, rather than being silently
    // excused by a row that could never match it.
    expect(parseBaseline('src/a.ts\n')).toEqual([]);
  });

  test('a new finding is a violation; a row whose cache grew evidence is stale', () => {
    const baseline = rows(['src/a.ts', 'kept'], ['src/b.ts', 'fixed']);
    const current = rows(['src/a.ts', 'kept'], ['src/c.ts', 'new']);
    const { added, stale } = diffBaseline(current, baseline);
    expect(added).toEqual([{ file: 'src/c.ts', name: 'new' }]);
    expect(stale).toEqual([{ file: 'src/b.ts', name: 'fixed' }]);
  });

  test('the reason column is not part of the identity (a reworded reason is not a new row)', () => {
    const { added, stale } = diffBaseline(
      rows(['src/a.ts', 'kept', 'PERMANENT: reworded']),
      rows(['src/a.ts', 'kept', 'PERMANENT: original'])
    );
    expect(added).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe('against the live repository', () => {
  const sites = scanRepository();
  const findings = sites.filter(isFinding);

  test('the scanner reads the tree it claims to (it is not vacuously green)', () => {
    expect(sites.length).toBeGreaterThan(20);
    // A scanner that flagged everything would fail on volume, not on evidence.
    expect(findings.length).toBeLessThan(10);
    expect(sites.every((s) => s.file.startsWith('src/'))).toBe(true);
    expect(sites.every((s) => s.writeLines.length > 0)).toBe(true);
    // The containers this gate was written for, recognised by name - the
    // provider config captured at startup and the settings registry that keys
    // the minimal dictionaries are exactly the shape it must see.
    const names = new Set(sites.map((s) => s.name));
    expect(names).toContain('activeMailboxCache');
    expect(names).toContain('registeredLocales');
  });

  test('every container WITH evidence names at least one, and most carry it', () => {
    const withEvidence = sites.filter((s) => !isFinding(s));
    expect(withEvidence.length).toBeGreaterThan(20);
    for (const site of withEvidence) expect(site.evidence.length).toBeGreaterThan(0);
  });

  test('the live tree has no finding beyond the baseline, and no stale row', () => {
    // The gate's own verdict, through the gate's own code path - a regression
    // here is the same failure `bun run audit` would report.
    const baseline = readBaseline();
    const current: BaselineRow[] = findings.map((site) => ({ file: site.file, name: site.name }));
    const { added, stale } = diffBaseline(current, baseline);
    expect(added).toEqual([]);
    expect(stale).toEqual([]);
    expect(baseline.length).toBeGreaterThan(0); // the ratchet holds two reviewed rows
  });

  test('every baseline row names a file that exists, and a non-debt row says why', () => {
    const baseline = readBaseline();
    for (const row of baseline) {
      expect(existsSync(join(REPO_ROOT, row.file))).toBe(true);
      expect(readFileSync(join(REPO_ROOT, row.file), 'utf8').length).toBeGreaterThan(0);
    }
    // A row is either debt or a PERMANENT registry; the permanent kind is only
    // legible because it carries its reason, or it reads as unexamined debt.
    const permanent = baseline.filter((row) => row.reason?.startsWith('PERMANENT'));
    expect(permanent.length).toBeGreaterThan(0);
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });
});
