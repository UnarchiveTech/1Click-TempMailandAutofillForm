/**
 * The plural selector, rendered through the REAL formatter and the REAL
 * dictionaries.
 *
 * Seven call sites "selected" a plural with `$t(base, { default: basePlural })`,
 * which renders the singular for every count, in every locale: svelte-i18n reads
 * `default` only when the key is MISSING. The first describe pins that behaviour so
 * the reason this module exists cannot quietly stop being true; the second renders
 * every `<key>` / `<key>Plural` pair the dictionaries actually carry, in all eight
 * locales, and asserts the PLURAL string is what arrives at the screen for a count
 * above one. A plural key that no count can reach is exactly the bug this replaces,
 * so the test fails on it whichever locale ships it.
 *
 * `scripts/check-plural-keys.ts` proves the call sites are wired to pairs that
 * exist, are distinct and declare the same slots; this file proves the wiring
 * produces the plural text.
 */

import { describe, expect, test } from 'bun:test';
import { get } from 'svelte/store';
import { addMessages, init, t } from 'svelte-i18n';
import ar from '@/locales/ar.json';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import es from '@/locales/es.json';
import fr from '@/locales/fr.json';
import ja from '@/locales/ja.json';
import th from '@/locales/th.json';
import zh from '@/locales/zh.json';
import { type PluralKeys, pluralKey, pluralMessage } from '@/utils/i18n/i18n-plural.js';

const DICTS = { en, es, fr, de, ja, zh, ar, th } as const;

type LocaleCode = keyof typeof DICTS;
type Dict = Record<string, string>;

/** One locale's nested dictionary flattened to dotted keys. */
function flatten(obj: Record<string, unknown>, prefix = '', out: Dict = {}): Dict {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else if (value !== null && typeof value === 'object') {
      flatten(value as Record<string, unknown>, full, out);
    }
  }
  return out;
}

/**
 * Every slot any pair declares, so one message renders however many it has:
 * `{n}` is the helper's count; bulk-email pairs use the caller's `{count}` slot.
 * `{size}` / `{domain}` belong to the pairs that
 * carry them. IntlMessageFormat throws - and the formatter then returns the RAW
 * message - when a declared slot is missing, so a render must supply them all.
 */
const EXTRAS = {
  size: '2 MB',
  domain: 'x.com',
  addresses: 'a@x.com',
  unarchivedCount: '3',
} as const;

/** `message` with its `{slots}` filled, i.e. what the user would read. */
function fill(message: string, values: Record<string, string>): string {
  return message.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** The `<key>` / `<key>Plural` pairs a dictionary carries. */
function pairsOf(dict: Dict): Array<{ keys: PluralKeys; one: string; other: string }> {
  return Object.keys(dict)
    .filter((other) => other.endsWith('Plural'))
    .map((other) => {
      const one = other.slice(0, -'Plural'.length);
      return { keys: { oneKey: one, otherKey: other }, one, other };
    })
    .filter(({ one, other }) => one in dict && other in dict);
}

/** Load one locale and hand back its formatter. */
async function formatterFor(locale: LocaleCode) {
  addMessages(locale, DICTS[locale]);
  await init({ fallbackLocale: 'en', initialLocale: locale });
  return get(t);
}

describe('the bug this replaces', () => {
  test('a `default:` naming the plural key renders the singular instead', async () => {
    const $t = await formatterFor('en');
    const rendered = $t('mailProvider.addressCount', {
      default: 'mailProvider.addressCountPlural',
      values: { n: 5 },
    });

    // `default` is consulted only for a MISSING key, and the base key exists - so
    // the plural text never reaches the screen, whatever the count is.
    expect(rendered).toBe(fill(en.mailProvider.addressCount, { ...EXTRAS, n: '5' }));
    expect(rendered).not.toBe(fill(en.mailProvider.addressCountPlural, { ...EXTRAS, n: '5' }));
  });
});

describe('pluralKey / pluralMessage', () => {
  // A fixture pair, deliberately NOT key-shaped: a dotted literal in a `oneKey:` /
  // `otherKey:` position is a real translation-key position, and
  // `check-locale-key-references` would rightly report this one as missing from
  // `en.json`. This test uses a stub formatter, so the names are arbitrary.
  const keys: PluralKeys = { oneKey: 'demo', otherKey: 'demoPlural' };

  test('selects the singular at exactly 1 and the plural for every other count', () => {
    expect([1, 0, 2, 11, 1.5, -1].map((n) => pluralKey(keys, n))).toEqual([
      'demo',
      'demoPlural',
      'demoPlural',
      'demoPlural',
      'demoPlural',
      'demoPlural',
    ]);
  });

  test('passes the count as {n}, and a caller cannot shadow it', () => {
    const calls: Array<{ key: string; values: Record<string, string | number> }> = [];
    const fake = (key: string, options: { values: Record<string, string | number> }) => {
      calls.push({ key, values: options.values });
      return key;
    };

    expect(pluralMessage(fake, keys, 5, { size: '2 MB' })).toBe('demoPlural');
    expect(calls[0]).toEqual({ key: 'demoPlural', values: { size: '2 MB', n: 5 } });

    pluralMessage(fake, keys, 1, { n: 99 });
    expect(calls[1]?.values.n).toBe(1);
    expect(calls[1]?.key).toBe('demo');
  });
});

describe('every plural pair, in every locale', () => {
  const pluralKeys = (locale: LocaleCode): string[] =>
    Object.keys(flatten(DICTS[locale])).filter((key) => key.endsWith('Plural'));

  test('there are pairs to iterate - the loop below is not vacuous', () => {
    for (const locale of Object.keys(DICTS) as LocaleCode[]) {
      expect(pluralKeys(locale).length).toBeGreaterThanOrEqual(6);
    }
  });

  for (const locale of Object.keys(DICTS) as LocaleCode[]) {
    test(`${locale}: count > 1 renders the PLURAL text, count 1 the singular`, async () => {
      const $t = await formatterFor(locale);
      const dict = flatten(DICTS[locale]);
      const pairs = pairsOf(dict);

      expect(pairs.length).toBeGreaterThan(0);
      for (const { keys, one, other } of pairs) {
        const many = pluralMessage($t, keys, 5, { ...EXTRAS, count: 5 });
        const single = pluralMessage($t, keys, 1, { ...EXTRAS, count: 1 });
        expect(many).toBe(fill(dict[other] ?? '', { ...EXTRAS, n: '5', count: '5' }));
        expect(single).toBe(fill(dict[one] ?? '', { ...EXTRAS, n: '1', count: '1' }));
        // Returning the same unresolved message on both sides must not pass.
        expect(many).not.toContain('{');
        expect(single).not.toContain('{');
      }
    });
  }

  test('the singular and the plural are different strings in en', async () => {
    const $t = await formatterFor('en');
    const keys: PluralKeys = {
      oneKey: 'mailProvider.addressCount',
      otherKey: 'mailProvider.addressCountPlural',
    };
    // "1 address" / "5 addresses": the screen text changes with the count, which is
    // precisely what the `default:` selection could never do.
    const one = pluralMessage($t, keys, 1);
    const many = pluralMessage($t, keys, 5);
    expect(one).toBe(fill(en.mailProvider.addressCount, { ...EXTRAS, n: '1' }));
    expect(many).toBe(fill(en.mailProvider.addressCountPlural, { ...EXTRAS, n: '5' }));
    expect(one).not.toBe(many);
  });
});
