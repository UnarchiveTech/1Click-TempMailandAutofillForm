/**
 * content-i18n's ICU guard (see docs/icu-plurals-evaluation.md §3).
 *
 * Content scripts render text straight into HOST PAGES with a flat
 * `{name}` interpolator - no svelte-i18n engine. A value carrying ICU
 * structured syntax (`{n, plural, one {…} other {…}}`) would reach the page
 * verbatim: selectors, arm bodies, raw braces. These tests pin the three
 * defenses: the detector's precision (rendered prose never false-positives),
 * the sync-fallback refusal, and the defense-in-depth check on what the
 * background returns (the formatter emits the RAW message when a structured
 * value is malformed - that must never print).
 */

import { afterAll, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { collectSourceFiles, repoAbsolute } from '../../../scripts/source-files';

// Restore every module mock so nothing leaks into later test files (AGENTS §5.14).
afterAll(() => {
  mock.restore();
});

const loggerErrors: Array<{ message: string; context?: unknown }> = [];
mock.module('@/utils/logger.js', () => ({
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  initLogger: async () => {},
  setLoggingEnabled: async () => {},
  setLogLevel: async () => {},
  logDebug: () => {},
  logInfo: () => {},
  logWarn: () => {},
  logError: (message: string, context?: unknown) => loggerErrors.push({ message, context }),
  log: () => {},
}));

type SendResponse = { success?: boolean; translated?: string } | undefined;
let sendMessageImpl: () => Promise<SendResponse> = async () => ({ success: true });
let sendMessageCalls = 0;
mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: async () => {
        sendMessageCalls++;
        return sendMessageImpl();
      },
    },
  },
}));

const { t, tSync, hasIcuStructuredSyntax } = await import('@/utils/i18n/content-i18n.js');

describe('hasIcuStructuredSyntax', () => {
  test('detects plural and select messages in their ICU forms', () => {
    expect(hasIcuStructuredSyntax('{n, plural, one {# email} other {# emails}}')).toBe(true);
    expect(hasIcuStructuredSyntax('{ count , plural , =0 {none} other {some} }')).toBe(true);
    expect(hasIcuStructuredSyntax('{gender, select, male {he} female {she} other {they}}')).toBe(
      true
    );
    expect(hasIcuStructuredSyntax('prefix {n,plural,zero {لا رسائل} other {# رسالة}}')).toBe(true);
  });

  test('never fires on rendered prose or flat templates (precision)', () => {
    expect(hasIcuStructuredSyntax('5 emails archived')).toBe(false);
    expect(hasIcuStructuredSyntax('{n} emails archived')).toBe(false);
    expect(hasIcuStructuredSyntax('Autofilling…')).toBe(false);
    expect(hasIcuStructuredSyntax('تمت أرشفة 5 رسائل')).toBe(false);
    expect(hasIcuStructuredSyntax('foo {bar} baz {count}')).toBe(false);
    // The two commas of prose (not an arg,keyword opener) do not match.
    expect(hasIcuStructuredSyntax('hello, world, goodbye')).toBe(false);
  });
});

describe('tSync (sync fallback path)', () => {
  test('interpolates flat slots in a registered fallback', () => {
    expect(tSync('contentAutofill.autofilling')).toBe('Autofilling…');
    expect(tSync('common.done')).toBe('Done');
    expect(tSync('time.durationS', { s: '1.5' })).toBe('1.5s');
    expect(tSync('time.milliseconds', { n: 250 })).toBe('250 ms');
  });

  test('every literal tSync call in content-i18n callers has a synchronous fallback', () => {
    const files = collectSourceFiles({ dirs: ['src/entrypoints/content'], extensions: ['.ts'] });
    const keys = new Set<string>();
    const importPattern = /from\s+['"][^'"]*content-i18n(?:\.js)?['"]/;
    const callPattern = /\btSync\s*\(\s*(['"])([^'"]+)\1/g;

    for (const file of files) {
      const source = readFileSync(repoAbsolute(file), 'utf8');
      if (!importPattern.test(source)) continue;
      callPattern.lastIndex = 0;
      for (let match = callPattern.exec(source); match; match = callPattern.exec(source)) {
        keys.add(match[2]);
      }
    }

    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) expect(tSync(key)).not.toBe(key);
  });

  test('falls back to the raw key when no fallback is registered', () => {
    expect(tSync('storagePerformance.messages')).toBe('storagePerformance.messages');
  });
});

describe('t (background round-trip path)', () => {
  test('passes rendered background output through and caches it', async () => {
    sendMessageCalls = 0;
    sendMessageImpl = async () => ({ success: true, translated: '5 رسائل مؤرشفة' });

    expect(await t('storagePerformance.archivedCount', { n: 5 })).toBe('5 رسائل مؤرشفة');
    expect(await t('storagePerformance.archivedCount', { n: 5 })).toBe('5 رسائل مؤرشفة');
    // Second call served from cache - one round-trip for two renders.
    expect(sendMessageCalls).toBe(1);
  });

  test('refuses unrendered ICU from the background: returns the key, logs loudly, does not cache', async () => {
    const ICU = '{n, plural, zero {لا رسائل} one {رسالة واحدة} other {# رسالة}}';
    loggerErrors.length = 0;
    sendMessageCalls = 0;
    // First call "leaks" raw ICU (a malformed structured value rendered raw -
    // exactly what intl-messageformat does on a malformed message).
    sendMessageImpl = async () => ({ success: true, translated: ICU });

    expect(await t('storagePerformance.messages', { n: 2 })).toBe('storagePerformance.messages');
    expect(loggerErrors.length).toBe(1);
    expect(loggerErrors[0].message).toContain('ICU structured syntax');

    // The refusal is NOT cached: a fixed background recovers immediately.
    sendMessageImpl = async () => ({ success: true, translated: 'رسالتان' });
    expect(await t('storagePerformance.messages', { n: 2 })).toBe('رسالتان');
  });

  test('flat `{name}` output from the background is interpolated locally and safe', async () => {
    sendMessageImpl = async () => ({ success: true, translated: '{n} emails unarchived' });
    // Even a flat template that slips through is only rendered when vars name
    // its slot - an unsubstituted `{n}` is flat-slot syntax, NOT ICU, so the
    // guard correctly leaves it to the caller (documented behavior).
    expect(await t('toasts.emailsUnarchivedCount')).toBe('{n} emails unarchived');
  });

  test('on a transport failure the English fallback is interpolated, never the raw key', async () => {
    sendMessageImpl = async () => {
      throw new Error('background unreachable');
    };
    expect(await t('common.done')).toBe('Done');
  });
});
