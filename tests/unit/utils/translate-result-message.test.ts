/**
 * The `LocalizedMessage` slot contract - guard for the WebDAV status regression.
 *
 * The three slot-bearing `errors.*` keys (`errors.webdavServerStatus`,
 * `errors.webdavUploadStatus`, `errors.webdavDownloadStatus`) are meaningless
 * without the values their `{slot}`s need, so the two are now **one value**:
 * producers return `localizedMessage('errors.webdavUploadStatus', { status })`
 * and consumers render that whole value. There is no `params` argument left to
 * drop - the compiler rejects a slot-bearing key that arrives without its
 * values - which is why this file no longer scans call sites as source text.
 *
 * Two things still need a test, because the type system cannot state them:
 *
 *   1. `SLOT_BEARING_ERROR_KEYS` and `en.json` agree. The list is what makes the
 *      compiler demand values, so a NEW slot-bearing key must fail this suite
 *      until it is listed - and listing it is what makes its values mandatory at
 *      every producer. (One list, used as both type and runtime value.)
 *   2. `translateResultMessage` still substitutes correctly and never lets a
 *      `{slot}` reach the screen. That guard is the belt for the bare strings
 *      which cross the messaging boundary, where only a key survives and no type
 *      can follow it.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  type LocalizedMessage,
  localizedErrorMessageOrFallback,
  localizedMessage,
  SLOT_BEARING_ERROR_KEYS,
  translateResultMessage,
  ValidationError,
} from '@/utils/errors.js';

const PROJECT_ROOT = `${import.meta.dir}/../../..`;

const SLOT_RE = /\{(\w+)\}/g;
const SLOT_PRESENT_RE = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

/** Flattened `en.json` (source of truth) - `errors.foo` → its English value. */
const EN_MESSAGES: Map<string, string> = (() => {
  const out = new Map<string, string>();
  const walk = (node: unknown, prefix: string): void => {
    if (typeof node === 'string') {
      out.set(prefix, node);
      return;
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, prefix ? `${prefix}.${key}` : key);
      }
    }
  };
  const en = JSON.parse(readFileSync(`${PROJECT_ROOT}/src/locales/en.json`, 'utf8')) as Record<
    string,
    unknown
  >;
  walk(en, '');
  return out;
})();

/** English value of a locale key; asserts the key exists so assertions can't go vacuous. */
function enValue(key: string): string {
  const value = EN_MESSAGES.get(key);
  expect(value).toBeDefined();
  return value ?? '';
}

/** Minimal stand-in for svelte-i18n's `$t`: fills `{name}` slots, echoes a miss. */
function fakeT(key: string, options?: { values?: Record<string, string | number> }): string {
  const template = EN_MESSAGES.get(key);
  if (template === undefined) return key;
  if (!options?.values) return template;
  const values = options.values;
  return template.replace(SLOT_RE, (match, name: string) =>
    name in values ? String(values[name]) : match
  );
}

function slotNames(value: string): string[] {
  return [...value.matchAll(SLOT_RE)].map((match) => match[1]);
}

/** Every `errors.*` key whose English value declares a `{slot}`. */
function slotBearingErrorKeys(): string[] {
  return [...EN_MESSAGES.entries()]
    .filter(([key, value]) => key.startsWith('errors.') && SLOT_PRESENT_RE.test(value))
    .map(([key]) => key);
}

describe('SLOT_BEARING_ERROR_KEYS - the type list and en.json cannot drift', () => {
  test('exactly the slot-bearing errors.* keys of en.json are listed', () => {
    const listed = new Set<string>(SLOT_BEARING_ERROR_KEYS);
    const inEn = slotBearingErrorKeys();

    expect(listed.size).toBeGreaterThan(0);
    // A key that gained a `{slot}` (or a new one) must be listed, because that
    // is what makes `localizedMessage()` require its values at the producer.
    expect(inEn.filter((key) => !listed.has(key))).toEqual([]);
    // And a listed key that lost its slot would keep demanding values for
    // nothing - the list only shrinks on purpose.
    expect([...listed].filter((key) => !inEn.includes(key))).toEqual([]);
    for (const key of listed) expect(enValue(key)).toContain('{');
  });
});

describe('compile-time contract - a slot key cannot be built without its values', () => {
  test('the values argument is required for a slot-bearing key, optional otherwise', () => {
    // Compile-time proof, checked by `bun run typecheck` rather than at runtime:
    // instantiating the generic shows the conditional rest tuple resolved to
    // `[values]` for a slot-bearing key and `[values?]` for anything else. If
    // `localizedMessage` ever loosened that, these assignments stop compiling.
    type SlotKeyParams = Parameters<typeof localizedMessage<'errors.webdavUploadStatus'>>;
    type PlainKeyParams = Parameters<typeof localizedMessage<'errors.webdavTimeout'>>;
    const slotValuesRequired: SlotKeyParams extends [string, Record<string, string | number>]
      ? true
      : false = true;
    const plainValuesOptional: PlainKeyParams extends [string, Record<string, string | number>?]
      ? true
      : false = true;

    expect(slotValuesRequired).toBe(true);
    expect(plainValuesOptional).toBe(true);
  });

  test('a key and its values stay together in the produced value', () => {
    const paired = localizedMessage('errors.webdavUploadStatus', { status: 507 });

    expect(paired.key).toBe('errors.webdavUploadStatus');
    expect(paired.values).toEqual({ status: 507 });
    // Raw pass-through text and slot-free keys pair with nothing, harmlessly.
    expect(localizedMessage('1click-backup.json')).toEqual({
      key: '1click-backup.json',
      values: undefined,
    });
    expect(localizedMessage('errors.webdavTimeout').values).toBeUndefined();
  });
});

describe('translateResultMessage slot handling', () => {
  test('substitutes the values its producer supplied', () => {
    expect(
      translateResultMessage(localizedMessage('errors.webdavServerStatus', { status: 500 }), fakeT)
    ).toBe(enValue('errors.webdavServerStatus').replace('{status}', '500'));
    expect(
      translateResultMessage(localizedMessage('errors.webdavUploadStatus', { status: 507 }), fakeT)
    ).not.toContain('{');
    expect(
      translateResultMessage(
        localizedMessage('errors.webdavDownloadStatus', { status: 503 }),
        fakeT
      )
    ).not.toContain('{');
  });

  test('a bare slot-bearing key never leaks the placeholder', () => {
    // Bare strings still arrive from payloads that crossed the messaging
    // boundary, where only the key survives serialization - the runtime belt.
    const keys = slotBearingErrorKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const withoutValues = translateResultMessage(key, fakeT);
      // The regression: this used to render the raw `{status}` value verbatim.
      expect(withoutValues).toBe('');
      expect(withoutValues).not.toContain('{');
    }
  });

  test('a pair smuggled past the compiler degrades instead of printing the slot', () => {
    // `localizedMessage` cannot produce this, so the cast is the only way in -
    // and the guard still refuses to show a raw placeholder.
    const smuggled = { key: 'errors.webdavDownloadStatus' } as LocalizedMessage;
    expect(translateResultMessage(smuggled, fakeT)).toBe('');
  });

  test('every slot-bearing errors.* key fills completely with plausible params', () => {
    for (const key of SLOT_BEARING_ERROR_KEYS) {
      const params = Object.fromEntries(slotNames(enValue(key)).map((name) => [name, 500]));
      const rendered = translateResultMessage(localizedMessage(key, params), fakeT);
      expect(rendered).not.toBe('');
      expect(SLOT_PRESENT_RE.test(rendered)).toBe(false);
    }
  });

  test('values that do not cover the slot are treated as dropped values', () => {
    expect(
      translateResultMessage(localizedMessage('errors.webdavServerStatus', { other: 1 }), fakeT)
    ).toBe('');
  });

  test('slot-free keys render with or without values', () => {
    expect(translateResultMessage('errors.webdavTimeout', fakeT)).toBe(
      enValue('errors.webdavTimeout')
    );
    expect(
      translateResultMessage(localizedMessage('errors.webdavTimeout', { status: 500 }), fakeT)
    ).toBe(enValue('errors.webdavTimeout'));
    expect(translateResultMessage(undefined, fakeT)).toBe('');
  });

  test('passes non-key dynamic text through untouched, braces included', () => {
    expect(translateResultMessage('Server said {oops}', fakeT)).toBe('Server said {oops}');
    expect(translateResultMessage(localizedMessage('Server said {oops}'), fakeT)).toBe(
      'Server said {oops}'
    );
  });
});

describe('localizedErrorMessageOrFallback - raw prose cannot reach the UI', () => {
  test('a keyed error renders through the values that travel with its key', () => {
    const err = new ValidationError(
      'Username must be less than 32 characters',
      { field: 'username' },
      'errors.validationUsernameMaxLength',
      { max: 32 }
    );

    const rendered = localizedErrorMessageOrFallback(err, fakeT, 'errors.validationError');
    expect(rendered).toBe(enValue('errors.validationUsernameMaxLength').replace('{max}', '32'));
    expect(SLOT_PRESENT_RE.test(rendered)).toBe(false);
  });

  test('a keyed error whose values were dropped falls back, never printing the slot', () => {
    // The shape a producer introduces by attaching a slot-bearing key and
    // forgetting its values: without the guard this renders `{field}` on screen.
    const err = new ValidationError(
      'Add tag must be less than 32 characters',
      { field: 'Add tag', maxLength: 32 },
      'errors.validationTextTooLong'
    );

    const rendered = localizedErrorMessageOrFallback(err, fakeT, 'errors.validationError');
    expect(rendered).toBe(enValue('errors.validationError'));
    expect(SLOT_PRESENT_RE.test(rendered)).toBe(false);
  });

  test('an arbitrary Error never renders its own message', () => {
    const rendered = localizedErrorMessageOrFallback(
      new Error('ECONNREFUSED 127.0.0.1:8080'),
      fakeT,
      'errors.unknownError'
    );

    expect(rendered).toBe(enValue('errors.unknownError'));
    expect(rendered).not.toContain('ECONNREFUSED');
  });

  test('a non-errors.* translationKey falls back rather than rendering the key text', () => {
    const err = new ValidationError('nope', {}, 'toasts.tagSaveFailed');

    expect(localizedErrorMessageOrFallback(err, fakeT, 'errors.validationError')).toBe(
      enValue('errors.validationError')
    );
  });
});
