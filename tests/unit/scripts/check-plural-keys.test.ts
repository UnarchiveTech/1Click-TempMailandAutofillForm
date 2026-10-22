/**
 * Unit tests for the plural-key gate in scripts/check-plural-keys.ts.
 *
 * The gate exists because a plural message used to be "selected" with
 * `$t(base, { default: basePlural })`, which svelte-i18n ignores whenever the base
 * key exists - every counted string rendered the singular ("5 address") in all
 * eight locales, and no other gate could see it: the keys existed, both were
 * referenced, and the plural was simply unreachable text.
 *
 * `findPluralCalls` / `findKeyedDefaults` are the pure cores that decide what a
 * call site and a keyed `default:` look like; `checkPluralRegistry` is the rule set
 * over them. Fixtures cover every rule and - just as important - what must never be
 * flagged, since a gate that cries wolf gets ignored. The last describe runs both
 * against the live repository, so `bun test` fails the moment a real call site
 * regresses to the broken shape or a plural ships that no count can reach.
 */

import { describe, expect, test } from 'bun:test';
import {
  checkPluralRegistry,
  collectRegistry,
  findKeyedDefaults,
  findPluralCalls,
  type PluralFinding,
  type PluralRegistry,
  slotsOf,
} from '../../../scripts/check-plural-keys';

/** The rules a set of findings reports, in order. */
function rulesOf(findings: PluralFinding[]): string[] {
  return findings.map((finding) => finding.rule);
}

/**
 * A registry holding just the pair `demo` / `demoPlural`, both carrying `{n}`.
 *
 * The fixture keys are deliberately NOT key-shaped (`a.b` would be):
 * `check-locale-key-references` scans this test's object literals too and would
 * rightly report a dotted literal in a `oneKey:` / `otherKey:` position as a key
 * that does not exist in `en.json`. Fixtures inside strings exercise the dotted
 * shape instead - that walker ignores string interiors, exactly as the tests of the
 * other gates rely on.
 */
function registryOf(overrides: Partial<PluralRegistry> = {}): PluralRegistry {
  return {
    sites: [],
    defaults: [],
    keys: new Map<string, string[]>([
      ['demo', ['n']],
      ['demoPlural', ['n']],
    ]),
    ...overrides,
  };
}

describe('findPluralCalls', () => {
  test('reads both halves of a static pair off the second argument', () => {
    const src =
      "pluralMessage($t, { oneKey: 'demo', otherKey: 'demoPlural' }, count, { size: '2 MB' })";
    expect(findPluralCalls(src)).toEqual([{ line: 1, oneKey: 'demo', otherKey: 'demoPlural' }]);
  });

  test('pluralKey is a pair site too - it is the same selector', () => {
    const src = "const key = pluralKey({ oneKey: 'demo', otherKey: 'demoPlural' }, 3);";
    expect(findPluralCalls(src)[0]?.otherKey).toBe('demoPlural');
  });

  test('a nested call in a later argument does not split the argument list', () => {
    const src =
      "pluralMessage($t, { oneKey: 'demo', otherKey: 'demoPlural' }, items.length, { x: f(a, b) })";
    expect(findPluralCalls(src)[0]).toEqual({ line: 1, oneKey: 'demo', otherKey: 'demoPlural' });
  });

  test('a runtime pair reports nulls, so the gate can refuse to guess', () => {
    expect(findPluralCalls('pluralMessage($t, keys, n)')).toEqual([
      { line: 1, oneKey: null, otherKey: null },
    ]);
  });

  test('a comment, a doc example or a quoted fixture is not a call site', () => {
    const src = [
      "// pluralMessage($t, { oneKey: 'in.comment', otherKey: 'in.commentPlural' }, n)",
      "/* pluralMessage($t, { oneKey: 'block.comment', otherKey: 'x' }, n) */",
      "const note = \"pluralMessage($t, { oneKey: 'in.string', otherKey: 'x' }, n)\";",
      "pluralMessage($t, { oneKey: 'demo', otherKey: 'demoPlural' }, n)",
    ].join('\n');
    expect(findPluralCalls(src)).toEqual([{ line: 4, oneKey: 'demo', otherKey: 'demoPlural' }]);
  });

  test('reports every site with its own line, in order', () => {
    const src = [
      "pluralMessage($t, { oneKey: 'demo', otherKey: 'demoPlural' }, 1)",
      'const x = 1;',
      "pluralKey({ oneKey: 'c.d', otherKey: 'c.dPlural' }, 2)",
    ].join('\n');
    expect(findPluralCalls(src).map((site) => site.line)).toEqual([1, 3]);
  });
});

describe('findKeyedDefaults', () => {
  test('flags a key-shaped literal in the default position', () => {
    expect(
      findKeyedDefaults(
        "$t('mailProvider.addressCount', { default: 'mailProvider.addressCountPlural' })"
      )
    ).toEqual([{ line: 1, key: 'mailProvider.addressCountPlural' }]);
  });

  test('a prose fallback is not a key, and stays unflagged', () => {
    expect(findKeyedDefaults("$t('x.y', { default: 'Please try again.' })")).toEqual([]);
    expect(findKeyedDefaults("const o = { default: 'myDefault' };")).toEqual([]);
  });

  test('comments and strings are not positions', () => {
    const src = [
      "// $t('x.y', { default: 'in.comment.key' })",
      'const note = "{ default: \'in.string.key\' }";',
    ].join('\n');
    expect(findKeyedDefaults(src)).toEqual([]);
  });
});

describe('slotsOf', () => {
  test('lists the slots a message declares, sorted and de-duplicated', () => {
    expect(slotsOf('{n} favicons cached ({size})')).toEqual(['n', 'size']);
    expect(slotsOf('{n} of {n} done')).toEqual(['n']);
    expect(slotsOf('no slots here')).toEqual([]);
  });
});

describe('checkPluralRegistry - the rules', () => {
  test('a complete, distinct, reachable pair is clean', () => {
    expect(
      checkPluralRegistry(
        registryOf({
          sites: [{ path: 'src/a.svelte', line: 3, oneKey: 'demo', otherKey: 'demoPlural' }],
        })
      )
    ).toEqual([]);
  });

  test('a keyed default never renders the key it names', () => {
    const findings = checkPluralRegistry(
      registryOf({
        // The same pair, done right elsewhere - so the only finding is the default.
        sites: [{ path: 'src/a.svelte', line: 3, oneKey: 'demo', otherKey: 'demoPlural' }],
        defaults: [{ path: 'src/other.svelte', line: 9, key: 'demoPlural' }],
      })
    );
    expect(rulesOf(findings)).toEqual(['keyed-default']);
    expect(findings[0]?.detail).toContain('demoPlural');
  });

  test('a runtime pair is refused, because no gate can prove it', () => {
    expect(
      rulesOf(
        checkPluralRegistry(
          registryOf({
            keys: new Map([['demo', ['n']]]),
            sites: [{ path: 'src/a.svelte', line: 1, oneKey: null, otherKey: null }],
          })
        )
      )
    ).toEqual(['dynamic-pair']);
  });

  test('a half that is not a key in en.json is a raw-key-on-screen bug', () => {
    expect(
      rulesOf(
        checkPluralRegistry(
          registryOf({
            keys: new Map([['demo', ['n']]]),
            sites: [{ path: 'src/a.svelte', line: 1, oneKey: 'demo', otherKey: 'demoTypoPlural' }],
          })
        )
      )
    ).toEqual(['missing-key']);
  });

  test('identical halves mean the plural form is unreachable again', () => {
    expect(
      rulesOf(
        checkPluralRegistry(
          registryOf({
            keys: new Map([['demo', ['n']]]),
            sites: [{ path: 'src/a.svelte', line: 1, oneKey: 'demo', otherKey: 'demo' }],
          })
        )
      )
    ).toEqual(['identical-halves']);
  });

  test('the plural half must be the singular half plus the Plural suffix', () => {
    const findings = checkPluralRegistry(
      registryOf({
        keys: new Map([
          ['demo', ['n']],
          ['demoOther', ['n']],
        ]),
        sites: [{ path: 'src/a.svelte', line: 1, oneKey: 'demo', otherKey: 'demoOther' }],
      })
    );
    expect(rulesOf(findings)).toEqual(['suffix']);
    expect(findings[0]?.detail).toContain('demoPlural');
  });

  test('the halves must declare the SAME slots - a plural cannot drop {size}', () => {
    const findings = checkPluralRegistry(
      registryOf({
        keys: new Map([
          ['demo', ['n', 'size']],
          ['demoPlural', ['n']],
        ]),
        sites: [{ path: 'src/a.svelte', line: 1, oneKey: 'demo', otherKey: 'demoPlural' }],
      })
    );
    expect(rulesOf(findings)).toEqual(['slots']);
    expect(findings[0]?.detail).toContain('{size}');
  });

  test('a plural key no call site pairs is text no count can reach', () => {
    const findings = checkPluralRegistry(
      registryOf({
        keys: new Map([
          ['demo', ['n']],
          ['demoPlural', ['n']],
          ['orphan', ['n']],
        ]),
      })
    );
    // 'orphan' does not end in Plural; 'demoPlural' is unpaired and does.
    expect(rulesOf(findings)).toEqual(['unreachable']);
    expect(findings[0]?.path).toBe('src/locales/en.json');
  });
});

describe('the live repository', () => {
  const registry = collectRegistry();

  test('every plural pair ships reachable, distinct and complete', () => {
    expect(checkPluralRegistry(registry)).toEqual([]);
  });

  test('the plural call sites are real - the gate is not vacuous', () => {
    expect(registry.sites.length).toBeGreaterThanOrEqual(6);
    expect(registry.sites.every((site) => site.oneKey && site.otherKey)).toBe(true);
  });

  test('every `<key>Plural` in en.json is paired by a call site', () => {
    const pluralKeys = [...registry.keys.keys()].filter((key) => key.endsWith('Plural'));
    const paired = new Set(registry.sites.map((site) => site.otherKey));
    expect(pluralKeys.length).toBeGreaterThan(0);
    expect(pluralKeys.filter((key) => !paired.has(key))).toEqual([]);
  });

  test('nothing selects a key through a default: option any more', () => {
    expect(registry.defaults).toEqual([]);
  });
});
