/**
 * Unit tests for the suppression-ratchet core in scripts/check-suppressions.ts.
 *
 * The file-level scanner is thin I/O (walk src/scripts/tests, read, count);
 * everything that decides pass/fail lives in the pure functions covered here:
 * findSuppressions (per-line detection), parseBaseline/formatBaseline
 * (round-trip + malformed-input rejection), and diffAgainstBaseline (the
 * ratchet: grows fail, shrinks pass).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DIRECTIVES,
  diffAgainstBaseline,
  findSuppressions,
  formatBaseline,
  parseBaseline,
  type SuppressionCounts,
  totalSuppressions,
} from '../../../scripts/check-suppressions';

/** Fragment-assembled tokens - mirrors the scanner so tests never self-match. */
const T_BIOME_ALL = DIRECTIVES.biomeIgnoreAll;
const T_BIOME = DIRECTIVES.biomeIgnore;
const T_SVELTE = DIRECTIVES.svelteIgnore;
const T_TS_IGNORE = DIRECTIVES.tsIgnore;
const T_TS_EXPECT = DIRECTIVES.tsExpectError;
const T_TS_NOCHECK = DIRECTIVES.tsNocheck;
const T_ESLINT = DIRECTIVES.eslintDisable;

function countsOf(rows: Array<[string, string, number]>): SuppressionCounts {
  const out: SuppressionCounts = new Map();
  for (const [path, kind, n] of rows) {
    const kinds = out.get(path) ?? new Map();
    kinds.set(
      kind as keyof typeof DIRECTIVES,
      (kinds.get(kind as keyof typeof DIRECTIVES) ?? 0) + n
    );
    out.set(path, kinds);
  }
  return out;
}

describe('check-suppressions findSuppressions', () => {
  test('detects every directive family with correct lines', () => {
    const text = [
      `// ${T_BIOME_ALL} lint/suspicious/noExplicitAny: reason`,
      'const a = 1;',
      `<!-- ${T_SVELTE} a11y_no_static_element_interactions -->`,
      `// ${T_BIOME} lint/style/noNonNullAssertion`,
      `// ${T_TS_IGNORE}`,
      `// ${T_TS_EXPECT}`,
      `// ${T_TS_NOCHECK}`,
      `// ${T_ESLINT} no-console`,
    ].join('\n');
    const hits = findSuppressions(text);
    expect(hits.map((h) => [h.line, h.kind])).toEqual([
      [1, 'biomeIgnoreAll'],
      [3, 'svelteIgnore'],
      [4, 'biomeIgnore'],
      [5, 'tsIgnore'],
      [6, 'tsExpectError'],
      [7, 'tsNocheck'],
      [8, 'eslintDisable'],
    ]);
  });

  test('counts multiple occurrences on one line', () => {
    const text = `x(); // ${T_BIOME} a - y(); // ${T_BIOME} b`;
    expect(findSuppressions(text)).toEqual([{ line: 1, kind: 'biomeIgnore', count: 2 }]);
  });

  test('file-level -all is counted once, as its own stricter kind', () => {
    // The generic biomeIgnore matcher must not also match the -all token.
    const text = `// ${T_BIOME_ALL} lint/suspicious/noExplicitAny`;
    expect(findSuppressions(text)).toEqual([{ line: 1, kind: 'biomeIgnoreAll', count: 1 }]);
  });

  test('clean code produces no hits', () => {
    expect(findSuppressions('const x = 1;\nexport { x };\n')).toEqual([]);
  });

  test('near-miss identifiers do not trigger (word boundary)', () => {
    // A suffixed token ('...ignored') must NOT match (\b fails: 'd' follows),
    // but a real directive token in prose (T_SVELTE below, followed by a
    // space) still does - comments are scanned because directives only ever
    // live inside comments.
    const text = `const x_${T_BIOME}d = 1; // mentions ${T_SVELTE} in prose`;
    expect(findSuppressions(text)).toEqual([{ line: 1, kind: 'svelteIgnore', count: 1 }]);
  });

  test('scanner never matches its own directive constants (self-scan hygiene)', () => {
    // The checker assembles tokens from string fragments specifically so its
    // own source cannot contain a full directive token. Pin that invariant:
    // scanning the checker's own source must yield zero hits, or the gate
    // would flag itself the moment the baseline was seeded.
    const src = readFileSync(
      new URL('../../../scripts/check-suppressions.ts', import.meta.url),
      'utf8'
    );
    expect(findSuppressions(src)).toEqual([]);
  });
});

describe('check-suppressions baseline round-trip', () => {
  test('parse -> format -> parse is stable and sorted', () => {
    const original = countsOf([
      ['b.ts', 'svelteIgnore', 2],
      ['a.ts', 'biomeIgnoreAll', 1],
    ]);
    const text = formatBaseline(original);
    const reparsed = parseBaseline(text);
    expect(reparsed).toEqual(original);
    // Sorted output: a.ts before b.ts regardless of insertion order.
    expect(text.indexOf('a.ts')).toBeGreaterThan(-1);
    expect(text.indexOf('a.ts')).toBeLessThan(text.indexOf('b.ts'));
  });

  test('malformed rows are rejected (never silently shrink the ratchet)', () => {
    expect(() => parseBaseline('src/x.ts svelteIgnore')).toThrow();
    expect(() => parseBaseline('src/x.ts svelteIgnore 0')).toThrow();
    expect(() => parseBaseline('src/x.ts svelteIgnore -1')).toThrow();
    expect(() => parseBaseline('src/x.ts notAKind 1')).toThrow();
    expect(() => parseBaseline('src/x.ts svelteIgnore abc')).toThrow();
  });

  test('comments and blank lines are ignored', () => {
    const parsed = parseBaseline('# header\n\nsrc/x.ts svelteIgnore 1\n');
    expect(totalSuppressions(parsed)).toBe(1);
  });
});

describe('check-suppressions ratchet diff', () => {
  test('new directive in a clean file is a violation', () => {
    const baseline = countsOf([['a.ts', 'svelteIgnore', 1]]);
    const current = countsOf([
      ['a.ts', 'svelteIgnore', 1],
      ['b.ts', 'tsIgnore', 1],
    ]);
    const { violations, improved } = diffAgainstBaseline(current, baseline);
    expect(violations).toEqual([{ path: 'b.ts', kind: 'tsIgnore', count: 1, baseline: 0 }]);
    expect(improved).toEqual([]);
  });

  test('grown count is a violation; shrunk count is an improvement', () => {
    const baseline = countsOf([['a.ts', 'svelteIgnore', 2]]);
    const grown = diffAgainstBaseline(countsOf([['a.ts', 'svelteIgnore', 3]]), baseline);
    expect(grown.violations).toEqual([
      { path: 'a.ts', kind: 'svelteIgnore', count: 3, baseline: 2 },
    ]);

    const shrunk = diffAgainstBaseline(countsOf([['a.ts', 'svelteIgnore', 1]]), baseline);
    expect(shrunk.violations).toEqual([]);
    expect(shrunk.improved).toEqual([
      { path: 'a.ts', kind: 'svelteIgnore', count: 1, baseline: 2 },
    ]);
  });

  test('fully cleaned file shrinks to zero improvements', () => {
    const baseline = countsOf([['a.ts', 'tsNocheck', 1]]);
    const { violations, improved } = diffAgainstBaseline(new Map(), baseline);
    expect(violations).toEqual([]);
    expect(improved).toEqual([{ path: 'a.ts', kind: 'tsNocheck', count: 0, baseline: 1 }]);
  });

  test('unchanged counts produce neither violations nor improvements', () => {
    const counts = countsOf([['a.ts', 'eslintDisable', 1]]);
    const { violations, improved } = diffAgainstBaseline(counts, counts);
    expect(violations).toEqual([]);
    expect(improved).toEqual([]);
  });
});
