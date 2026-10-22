/**
 * Unit tests for the locale-key reference gate in
 * scripts/check-locale-key-references.ts.
 *
 * `findKeyReferences()` is the pure core - it decides which string literals sit
 * in a *translation-key position*, which is what makes the gate precise enough
 * to run repo-wide. The file-level walker only adds I/O. Fixtures cover every
 * position the gate promises to check and, just as important, everything it must
 * never flag: a gate that cries wolf gets baselined into silence, which is the
 * failure mode this repo already fought with `.hardcoded-english-ignore`.
 *
 * The last describe runs it against the live repository, so `bun test` fails the
 * moment a call site references a key that `en.json` does not define, or a
 * baseline row outlives the bug it recorded.
 */

import { describe, expect, test } from 'bun:test';
import {
  baselineRow,
  collectRepositoryReferences,
  diffAgainstBaseline,
  findKeyReferences,
  firstArgument,
  type KeyReference,
  loadBaseline,
  loadSourceKeys,
} from '../../../scripts/check-locale-key-references';
import { REPO_SCAN_TIMEOUT_MS } from '../harness/repo-scan-timeout.js';

/** Keys the scanner extracts from a snippet, in order. */
function keysOf(source: string, path = 'src/ui/example.svelte'): string[] {
  return findKeyReferences(path, source).map((reference) => reference.key);
}

const ref = (path: string, key: string): KeyReference => ({ path, line: 1, key });

describe('firstArgument', () => {
  test('stops at a top-level comma, ignoring nested commas', () => {
    expect(firstArgument("'a.b', { values: { n: 1, m: 2 } }")).toBe("'a.b'");
    expect(firstArgument("cond ? 'a.b' : 'c.d'")).toBe("cond ? 'a.b' : 'c.d'");
  });
});

describe('findKeyReferences - positions that hold keys', () => {
  test('translator calls', () => {
    expect(keysOf("$t('nav.mailbox')")).toEqual(['nav.mailbox']);
    expect(keysOf("tSync('toasts.addressDeleted')")).toEqual(['toasts.addressDeleted']);
    expect(keysOf("translate('errors.webdavTimeout')")).toEqual(['errors.webdavTimeout']);
    expect(keysOf('t(`autofill.form`)')).toEqual(['autofill.form']);
    expect(keysOf("get(t)('inbox.title')")).toEqual(['inbox.title']);
  });

  test('translateResultMessage and the fallback-key argument', () => {
    expect(keysOf("translateResultMessage('errors.webdavTimeout', $t)")).toEqual([
      'errors.webdavTimeout',
    ]);
    expect(keysOf("renderResultError(res.error, $t, 'errors.unknownError')")).toEqual([
      'errors.unknownError',
    ]);
    expect(keysOf("localizedErrorMessageOrFallback(e, $t, 'diagnostics.details.swFail')")).toEqual([
      'diagnostics.details.swFail',
    ]);
  });
  test('*Key properties and the default option', () => {
    expect(keysOf("const meta = { labelKey: 'settings.appearance' };")).toEqual([
      'settings.appearance',
    ]);
    expect(
      keysOf(
        "$t('storagePerformance.faviconsCached', { default: 'storagePerformance.faviconsCachedPlural' })"
      )
    ).toEqual(['storagePerformance.faviconsCached', 'storagePerformance.faviconsCachedPlural']);
  });

  test('values of a string-record *KEYS map (VIEW_LABEL_KEYS)', () => {
    const src =
      "const VIEW_LABEL_KEYS: Record<string, string> = { mailbox: 'nav.mailbox', about: 'nav.about' };";
    expect(keysOf(src)).toEqual(['nav.mailbox', 'nav.about']);
  });

  test('a SINGULAR *KEY string-record map is a key map too', () => {
    // The name is `…_KEY` (one key per kind), so without `KEYS?` this map's
    // values reached the screen through `$t(MAP[kind])` while no rule saw them.
    const src =
      "const LOGIN_HEALTH_KIND_LABEL_KEY: Record<Kind, string> = { expired_mailbox: 'savedLoginInfo.healthExpiredMailbox', stale_login: 'savedLoginInfo.healthStaleLogin' };";
    expect(keysOf(src)).toEqual([
      'savedLoginInfo.healthExpiredMailbox',
      'savedLoginInfo.healthStaleLogin',
    ]);
  });

  test('a key-shaped literal RETURNED from a helper is a reference', () => {
    // `$t(statusPillLabel(pill))` - the call is in a key position, the literal
    // is not, and `t()` renders the key itself on a miss, so a rename here ships
    // raw `address.live` text to the user.
    const src = [
      'function statusPillLabel(pill) {',
      '  switch (pill) {',
      "    case 'live': return 'address.live';",
      "    case 'expired': return 'address.expiredStatus';",
      '  }',
      '}',
    ].join('\n');
    expect(keysOf(src)).toEqual(['address.live', 'address.expiredStatus']);
  });

  test('a ternary in the first argument yields every named key', () => {
    expect(keysOf("$t(ok ? 'common.yes' : 'common.no')")).toEqual(['common.yes', 'common.no']);
  });

  test('the ERROR_CODE_TO_TRANSLATION_KEY map is read only in errors.ts', () => {
    const map = "export const M = { [ErrorCode.BACKUP_EMPTY]: 'errors.backupEmpty' };";
    expect(keysOf(map, 'src/utils/errors.ts')).toEqual(['errors.backupEmpty']);
    expect(keysOf(map, 'src/utils/other.ts')).toEqual([]);
  });
});

describe('findKeyReferences - what must never be flagged', () => {
  test('comments and doc examples', () => {
    expect(keysOf("// $t('in.comment')")).toEqual([]);
    expect(keysOf("/* t('block.comment') */")).toEqual([]);
    expect(keysOf("/** e.g. `$t('settings.xTitle') || fallback` */")).toEqual([]);
    expect(keysOf("<!-- $t('html.comment') -->")).toEqual([]);
  });

  test('dynamic keys cannot be resolved statically', () => {
    // Assembled so the fixture never holds a literal `${` sequence in a
    // non-template string (biome's noTemplateCurlyInString).
    const interpolation = `${'$'}{code}`;
    expect(keysOf(['t(`errors.', interpolation, '`)'].join(''))).toEqual([]);
    expect(keysOf('tSync(someVariable)')).toEqual([]);
  });

  test('non-key shapes are rejected even in a key position', () => {
    expect(keysOf("t('invalid-current-password')")).toEqual([]);
    expect(keysOf("tSync('duplicate_live')")).toEqual([]);
    expect(keysOf("t('selectedInstance_x')")).toEqual([]);
    expect(keysOf("t('Please try again.')")).toEqual([]);
  });
  test('a call inside a template interpolation is still a reference', () => {
    const open = `${'$'}{`; // `${`, assembled for noTemplateCurlyInString
    const src = [
      'const tip = `Copy ',
      open,
      'String(addr)} then ',
      open,
      '$t("address.tooltipClickOpen")}',
      '`;',
    ].join('');
    expect(keysOf(src)).toEqual(['address.tooltipClickOpen']);
    // …while the surrounding template text is not code.
    expect(keysOf('const label = `$t("in.template.text")`;')).toEqual([]);
  });

  test('data positions are not searched for keys', () => {
    expect(keysOf("const codes = ['invalid-current-password', 'duplicate_live']; ")).toEqual([]);
    expect(keysOf("$t('nav.mailbox', { values: { host: 'mail.example.com' } }) ")).toEqual([
      'nav.mailbox',
    ]);
    expect(keysOf("document.querySelector('a.b')")).toEqual([]);
  });

  test('a key-map lookalike whose values are paths is not a key map', () => {
    expect(keysOf("const ICON_KEYS = { user: 'icons/user.svg' }; ")).toEqual([]);
    expect(
      keysOf("const CATEGORY_KEYS: Record<string, readonly string[]> = { a: ['x.y'] }; ")
    ).toEqual([]);
  });

  test('a returned literal that is not key-shaped is not a reference', () => {
    // Rule 5's precision rests on the SHARED shape filter: only
    // `lowercase.first` literals are candidates, so MIME types, bare marker
    // words and hyphenated codes are rejected even in a `return`. (A dotted
    // non-key like a hostname IS key-shaped - that is the rule's documented
    // boundary; measured across src/ + tests/ it matches 13 literals and every
    // one of them is a real key, which is why it ships.)
    expect(keysOf("function kind() { return 'image/png'; }")).toEqual([]);
    expect(keysOf("function marker() { return 'blocked'; }")).toEqual([]);
    expect(keysOf("function code() { return 'invalid-current-password'; }")).toEqual([]);
    expect(keysOf("function flag() { return 'ONECLICK_WEBMCP'; }")).toEqual([]);
  });
});

describe('diffAgainstBaseline (ratchet)', () => {
  test('an unlisted finding is reported', () => {
    const diff = diffAgainstBaseline([ref('src/a.ts', 'a.b')], new Set());
    expect(diff.newFindings.map(baselineRow)).toEqual(['src/a.ts\ta.b']);
    expect(diff.staleRows).toEqual([]);
  });

  test('a listed finding passes', () => {
    const diff = diffAgainstBaseline([ref('src/a.ts', 'a.b')], new Set(['src/a.ts\ta.b']));
    expect(diff.newFindings).toEqual([]);
    expect(diff.staleRows).toEqual([]);
  });

  test('a row excuses only its exact path and key', () => {
    const baseline = new Set(['src/a.ts\ta.b']);
    expect(diffAgainstBaseline([ref('src/b.ts', 'a.b')], baseline).newFindings).toHaveLength(1);
    expect(diffAgainstBaseline([ref('src/a.ts', 'a.c')], baseline).newFindings).toHaveLength(1);
  });

  test('a fixed row is reported stale so the list can only shrink', () => {
    const diff = diffAgainstBaseline([], new Set(['src/a.ts\ta.b']));
    expect(diff.staleRows).toEqual(['src/a.ts\ta.b']);
  });
});

describe('live repository', () => {
  // Both tests need the same two whole-tree passes (all of src/ lexed for key
  // references, all locale dictionaries parsed). Compute them ONCE: the second
  // load doubled this file's scan time for no new information.
  const keys = loadSourceKeys();
  const references = collectRepositoryReferences();

  test(
    'every referenced key exists in en.json (or is baselined)',
    () => {
      const missing = references.filter((reference) => !keys.has(reference.key));
      const { newFindings, staleRows } = diffAgainstBaseline(missing, loadBaseline());
      expect(
        newFindings.map((finding) => `${finding.path}:${finding.line} ${finding.key}`)
      ).toEqual([]);
      expect(staleRows).toEqual([]);
    },
    REPO_SCAN_TIMEOUT_MS
  );

  test(
    'the scan reaches the whole key surface',
    () => {
      expect(keys.size).toBeGreaterThan(2000);
      expect(references.length).toBeGreaterThan(2000);
    },
    REPO_SCAN_TIMEOUT_MS
  );
});
