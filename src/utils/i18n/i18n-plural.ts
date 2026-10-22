/**
 * The ONE place a counted message picks its key.
 *
 * Every counted string in the dictionaries comes as a pair: the base key holds
 * the singular, `<key>Plural` the other form -
 *
 *   "addressCount":       "{n} address"
 *   "addressCountPlural": "{n} addresses"
 *
 * Seven call sites used to "select" the pair with `$t(base, { default: pluralKey })`,
 * and that selects nothing. svelte-i18n consults `default` **only when the key is
 * missing**, so a dictionary that carries the base key always rendered the
 * singular: every one of those messages read "5 address" in all eight locales, and
 * no gate could see it - both keys exist, both are referenced, and the plural was
 * simply unreachable. Which grammatical number a count takes is a property of the
 * COUNT, so the choice belongs at the call site, once:
 *
 *   pluralMessage($t, { oneKey: 'mailProvider.addressCount',
 *                       otherKey: 'mailProvider.addressCountPlural' }, count)
 *
 * Both halves are named here as literals on purpose. A helper that derived
 * `<key>Plural` by concatenation would hide the plural key from every scanner
 * (`check-unused-locales` would report it dead, `check-locale-key-references` could
 * not prove it exists), and a pair that only exists at runtime is a pair no gate
 * can check - see `scripts/check-plural-keys.ts`, which reads these two properties
 * and proves the pair is complete, distinct, spelled per the convention, and
 * carries the same `{slots}` on both sides.
 *
 * The `*Key:` property names are part of that contract, not a style choice:
 * `check-locale-key-references` already treats `…Key:` literals as translation-key
 * positions, so naming the halves `oneKey`/`otherKey` keeps both ends of the pair
 * existence-checked with no gate changes.
 */

/** The two keys of one counted message, as the dictionaries pair them. */
export type PluralKeys = {
  /** Rendered when the count is exactly 1. */
  oneKey: string;
  /** Rendered for every other count - 0, 2, 5, … (the `<key>Plural` key). */
  otherKey: string;
};

/**
 * The key for `n`: `oneKey` at exactly 1, `otherKey` for every other count - the
 * same two-way split the English source of truth draws, and the split `fr`, `ja`,
 * `zh` and `th` are already written for (their `Plural` value simply repeats the
 * singular where the language does not inflect).
 */
export function pluralKey(keys: PluralKeys, n: number): string {
  return n === 1 ? keys.oneKey : keys.otherKey;
}

/**
 * The `$t` / `t` / `get(t)` shape this module formats with: a key plus svelte-i18n's
 * `{ values }` options. A structural type so both the store's formatter and the
 * unwrapped one can be passed without either importing the other.
 */
export type PluralFormat = (
  key: string,
  options: { values: Record<string, string | number> }
) => string;

/**
 * Render `keys`' plural for `n`, with the count passed as `{n}` - the slot every
 * pair in the dictionaries declares.
 *
 * `values` carries the pair's other slots (e.g. `faviconsCachedPlural`'s `{size}`).
 * `n` is written last, so a caller cannot shadow the count with its own `n`.
 */
export function pluralMessage(
  format: PluralFormat,
  keys: PluralKeys,
  n: number,
  values: Record<string, string | number> = {}
): string {
  return format(pluralKey(keys, n), { values: { ...values, n } });
}
