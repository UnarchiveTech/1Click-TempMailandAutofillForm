/**
 * One-off evaluation spike (delete after reading the report): render ICU
 * `{n, plural, …}` messages through svelte-i18n's REAL formatter, including
 * the failure mode the two-way selector never faces - a count whose plural
 * category the message does not declare.
 */

import { get } from 'svelte/store';
import { addMessages, init, t } from 'svelte-i18n';

const en = {
  icu: {
    full: '{n, plural, one {# email archived} other {# emails archived}}',
    exactZero:
      '{n, plural, =0 {nothing archived} one {# email archived} other {# emails archived}}',
    numberAsIs: '{n, plural, one {# email} other {# emails}}',
  },
  ar: {
    full: '{n, plural, zero {لا رسائل} one {رسالة واحدة} two {رسالتان} few {# رسائل} many {# رسالة} other {# رسالة}}',
  },
};

addMessages('en', en);
addMessages('ar', en);

async function sample(locale: string, n: number, key: string) {
  await init({ fallbackLocale: 'en', initialLocale: locale });
  const fmt = get(t);
  try {
    const out = fmt(key, { values: { n } });
    return `ok: ${JSON.stringify(out)}`;
  } catch (e) {
    return `THROW: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const cases: Array<[string, number, string]> = [
  // en: the two-way English case through ICU syntax
  ['en', 1, 'icu.full'],
  ['en', 5, 'icu.full'],
  // en: =0 exact-match arm
  ['en', 0, 'icu.exactZero'],
  ['en', 0, 'icu.full'],
  // ar: every CLDR category against a full-armed message
  ['ar', 0, 'ar.full'],
  ['ar', 1, 'ar.full'],
  ['ar', 2, 'ar.full'],
  ['ar', 6, 'ar.full'],
  ['ar', 11, 'ar.full'],
  ['ar', 100, 'ar.full'],
  // ar: the FAILURE MODE - full-armed message, but only one/other declared
  // (what happens when a locale-agnostic two-arm message meets Arabic zero)
  ['ar', 0, 'icu.full'],
  ['ar', 2, 'icu.full'],
  // and: number substitution sanity - is # the formatted number?
  ['ar', 6, 'icu.numberAsIs'],
];

for (const [locale, n, key] of cases) {
  console.log(
    `${locale} n=${String(n).padStart(3)} ${key.padEnd(16)} →`,
    await sample(locale, n, key)
  );
}
