/**
 * Unit tests for scripts/generate-locale-messages.ts.
 *
 * This generator is what keeps `public/_locales` honest: those dictionaries
 * localize the strings Chrome renders itself (manifest `name` / `description` /
 * `action.default_title` / `commands.*.description`), and `extName` is by
 * definition the same string as the in-app `actionTitle.tempMailAndAutofill`.
 * It also derives `store-listing/<code>.json` - the localized store detail
 * description and screenshot captions - from the same `src/locales` trees.
 * Hand-maintaining those artifacts meant duplicated strings that could drift,
 * so the duplication was removed rather than merely checked - these tests pin
 * the properties that make that safe:
 *
 *   - every `__MSG_*__` placeholder used by the manifest has a source (an
 *     unmapped one would ship an unresolved key to chrome://extensions);
 *   - every locale resolves every source, manifest and store alike (a missing
 *     key would localize to nothing);
 *   - store captions map to screenshot files that actually exist in the docs
 *     screenshot pipeline, so a renamed shot fails the audit instead of
 *     shipping an orphaned caption;
 *   - store strings fit the store dashboards' length limits, so nothing is
 *     silently truncated at upload time;
 *   - the staleness checks compare values, not formatting, so a formatting
 *     pass can never fake a diff.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMessages,
  buildStoreListing,
  LOCALE_DIRS,
  lookup,
  MESSAGE_SOURCES,
  matchesExisting,
  placeholdersIn,
  renderMessages,
  renderStoreListing,
  STORE_LENGTH_LIMITS,
  STORE_SCREENSHOT_VARIANT,
  STORE_SOURCES,
  type StoreListing,
  storeListingMatches,
  unmappedPlaceholders,
  validateStoreListingLengths,
} from '../../../scripts/generate-locale-messages';

const LOCALES_DIR = join(import.meta.dir, '..', '..', '..', 'src', 'locales');
const SCREENSHOTS_DIR = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'docs-site',
  'public',
  'screenshots'
);

describe('placeholdersIn', () => {
  test('collects, de-duplicates and sorts __MSG_*__ placeholders', () => {
    const source = `
      name: '__MSG_extName__',
      description: '__MSG_extDescription__',
      commands: { a: '__MSG_cmdA__', b: '__MSG_cmdB__' },
      action: { default_title: '__MSG_extName__' },
    `;
    expect(placeholdersIn(source)).toEqual(['cmdA', 'cmdB', 'extDescription', 'extName']);
  });

  test('ignores malformed or partial tokens', () => {
    expect(placeholdersIn(`'__MSG_extName'  '__extName__'  'MSG_extName__'`)).toEqual([]);
  });
});

describe('unmappedPlaceholders', () => {
  test('accepts placeholders that have a src/locales source', () => {
    expect(unmappedPlaceholders(Object.keys(MESSAGE_SOURCES))).toEqual([]);
  });

  test('flags a manifest placeholder with no source (would ship unresolved)', () => {
    expect(unmappedPlaceholders(['extName', 'cmdNotMappedYet'])).toEqual(['cmdNotMappedYet']);
  });
});

describe('lookup', () => {
  test('resolves a dotted path through nested objects', () => {
    expect(
      lookup({ actionTitle: { tempMailAndAutofill: 'Name' } }, 'actionTitle.tempMailAndAutofill')
    ).toBe('Name');
  });

  test('returns undefined for a missing or non-object path segment', () => {
    expect(lookup({ a: { b: 'c' } }, 'a.zzz')).toBeUndefined();
    expect(lookup({ a: 'scalar' }, 'a.b')).toBeUndefined();
    expect(lookup({}, 'missing')).toBeUndefined();
  });
});

describe('buildMessages', () => {
  const tree = {
    actionTitle: { tempMailAndAutofill: '1Click: Temp Mail' },
    manifest: {
      extDescription: 'Generate temporary email addresses.',
      cmdAutofillForm: 'Autofill the signup form',
      cmdOpenAutofillManager: 'Open Autofill manager',
      cmdQuickGenerateInbox: 'Quick generate an address',
      cmdCopyLatestOtp: 'Copy the latest OTP',
    },
  };

  test('resolves every source into an extName/command dictionary', () => {
    const { messages, missing } = buildMessages(tree);
    expect(missing).toEqual([]);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(MESSAGE_SOURCES).sort());
    expect(messages.extName).toBe('1Click: Temp Mail');
  });

  test('reports each missing source with the placeholder it backs', () => {
    const { missing } = buildMessages({
      actionTitle: { tempMailAndAutofill: 'Name' },
      manifest: {},
    });
    expect(missing).toContain('manifest.extDescription (for __MSG_extDescription__)');
    expect(missing).toHaveLength(5);
  });

  test('rejects blank values instead of shipping an empty message', () => {
    const { missing } = buildMessages({
      actionTitle: { tempMailAndAutofill: '   ' },
      manifest: {},
    });
    expect(missing).toContain('actionTitle.tempMailAndAutofill (for __MSG_extName__)');
  });
});

describe('renderMessages', () => {
  test('emits parseable JSON carrying every value', () => {
    const messages = { extName: 'Name', extDescription: 'Desc', cmdCopyLatestOtp: 'Copy' };
    const parsed = JSON.parse(renderMessages(messages)) as Record<string, { message: string }>;
    expect(parsed.extName.message).toBe('Name');
    expect(parsed.cmdCopyLatestOtp.message).toBe('Copy');
  });

  test('separates keys with commas so the output is valid JSON at any key count', () => {
    const rendered = renderMessages({ extName: 'a', extDescription: 'b', cmdCopyLatestOtp: 'c' });
    expect(rendered).not.toContain('}\n  {"');
    expect(() => JSON.parse(rendered)).not.toThrow();
  });
});

describe('matchesExisting', () => {
  const expected = { extName: 'Name', extDescription: 'Desc' };

  test('ignores formatting differences', () => {
    const pretty = `{\n  "extName": {\n    "message": "Name"\n  },\n  "extDescription": { "message": "Desc" }\n}`;
    expect(matchesExisting(pretty, expected)).toBe(true);
  });

  test('detects a changed value', () => {
    expect(matchesExisting(JSON.stringify({ ...expected, extName: 'Other' }), expected)).toBe(
      false
    );
  });

  test('detects an added or dropped key', () => {
    expect(matchesExisting(JSON.stringify({ extName: { message: 'Name' } }), expected)).toBe(false);
  });

  test('treats unparseable content as stale', () => {
    expect(matchesExisting('not json', expected)).toBe(false);
  });
});

describe('buildStoreListing', () => {
  const tree = {
    store: {
      detail: 'Long description.',
      caption: {
        mailboxOverview: 'Mailbox shot',
        autofill: 'Autofill shot',
        organize: 'Organize shot',
        settingsData: 'Settings shot',
        mailboxDetail: 'Detail shot',
      },
    },
  };

  test('resolves the detail and every screenshot caption in curated order', () => {
    const { listing, missing } = buildStoreListing(tree);
    expect(missing).toEqual([]);
    expect(listing.detail).toBe('Long description.');
    expect(listing.screenshots.map((s) => s.name)).toEqual(Object.keys(STORE_SOURCES));
    expect(
      listing.screenshots.every((s) => s.file === `${s.name}-${STORE_SCREENSHOT_VARIANT}.png`)
    ).toBe(true);
    expect(listing.screenshots[0]?.caption).toBe('Mailbox shot');
  });

  test('reports each missing store source by role', () => {
    const { missing } = buildStoreListing({ store: {} });
    expect(missing).toContain('store.detail (for the store detail description)');
    expect(missing).toContain('store.caption.autofill (for the autofill.png caption)');
    expect(missing).toHaveLength(6);
  });

  test('rejects blank captions instead of shipping an empty one', () => {
    const blank = structuredClone(tree) as typeof tree;
    (blank.store.caption as Record<string, string>).organize = '   ';
    const { missing } = buildStoreListing(blank);
    expect(missing).toContain('store.caption.organize (for the organize.png caption)');
  });
});

describe('validateStoreListingLengths', () => {
  const base: StoreListing = {
    detail: 'd'.repeat(STORE_LENGTH_LIMITS.detail),
    screenshots: [
      { name: 'autofill', file: 'autofill.png', caption: 'c'.repeat(STORE_LENGTH_LIMITS.caption) },
    ],
  };

  test('accepts values exactly at the limits', () => {
    expect(validateStoreListingLengths(base)).toEqual([]);
  });

  test('flags an over-long detail with its actual length', () => {
    const over = { ...base, detail: `${base.detail}x` };
    expect(validateStoreListingLengths(over)).toEqual([
      `store.detail is ${STORE_LENGTH_LIMITS.detail + 1} chars (limit ${STORE_LENGTH_LIMITS.detail})`,
    ]);
  });

  test('flags an over-long caption naming the screenshot', () => {
    const over: StoreListing = {
      ...base,
      screenshots: [
        {
          name: 'autofill',
          file: 'autofill.png',
          caption: `${base.screenshots[0]?.caption ?? ''}x`,
        },
      ],
    };
    const violations = validateStoreListingLengths(over);
    expect(violations).toEqual([
      `caption for autofill.png is ${STORE_LENGTH_LIMITS.caption + 1} chars (limit ${STORE_LENGTH_LIMITS.caption})`,
    ]);
  });
});

describe('renderStoreListing + storeListingMatches', () => {
  const listing: StoreListing = {
    detail: 'Detail',
    screenshots: [
      { name: 'autofill', file: 'autofill.png', caption: 'Cap' },
      { name: 'organize', file: 'organize.png', caption: 'Org' },
    ],
  };

  test('emits parseable JSON carrying every value', () => {
    const parsed = JSON.parse(renderStoreListing(listing)) as StoreListing;
    expect(parsed.detail).toBe('Detail');
    expect(parsed.screenshots).toEqual(listing.screenshots);
  });

  test('round-trips through the staleness check, ignoring formatting', () => {
    expect(storeListingMatches(renderStoreListing(listing), listing)).toBe(true);
  });

  test('detects a changed caption, detail, or screenshot order', () => {
    const rendered = renderStoreListing(listing);
    const [first, second] = listing.screenshots;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(storeListingMatches(rendered, { ...listing, detail: 'Other' })).toBe(false);
    expect(
      storeListingMatches(rendered, {
        ...listing,
        screenshots: [first, { ...second, caption: 'X' }],
      })
    ).toBe(false);
    expect(
      storeListingMatches(rendered, { ...listing, screenshots: [...listing.screenshots].reverse() })
    ).toBe(false);
  });

  test('treats unparseable content as stale', () => {
    expect(storeListingMatches('not json', listing)).toBe(false);
  });
});

describe('store listing invariants (real locales)', () => {
  test('every locale resolves detail + every caption and fits store limits', () => {
    for (const code of Object.keys(LOCALE_DIRS)) {
      const tree = JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8')) as Record<
        string,
        unknown
      >;
      const store = buildStoreListing(tree);
      expect({ code, missing: store.missing }).toEqual({ code, missing: [] });
      expect({ code, violations: validateStoreListingLengths(store.listing) }).toEqual({
        code,
        violations: [],
      });
      expect(store.listing.screenshots).toHaveLength(Object.keys(STORE_SOURCES).length);
    }
  });

  test('every mapped screenshot file exists in the docs screenshot pipeline', () => {
    // A caption mapped to a shot the pipeline no longer renders would ship an
    // orphaned store image; catch the rename at audit time instead. The
    // generator composes the concrete file from the curated variant (light).
    expect(existsSync(SCREENSHOTS_DIR)).toBe(true);
    for (const slug of Object.keys(STORE_SOURCES)) {
      const file = `${slug}-${STORE_SCREENSHOT_VARIANT}.png`;
      expect({ file, exists: existsSync(join(SCREENSHOTS_DIR, file)) }).toEqual({
        file,
        exists: true,
      });
    }
  });

  test('the shipped store-listing artifacts match the current locale trees', () => {
    const listingDir = join(import.meta.dir, '..', '..', '..', 'store-listing');
    for (const [code, dirName] of Object.entries(LOCALE_DIRS)) {
      const path = join(listingDir, `${dirName}.json`);
      expect({ dirName, exists: existsSync(path) }).toEqual({ dirName, exists: true });
      const tree = JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8')) as Record<
        string,
        unknown
      >;
      const { listing } = buildStoreListing(tree);
      expect(storeListingMatches(readFileSync(path, 'utf8'), listing)).toBe(true);
    }
  });
});

describe('locale mapping invariants', () => {
  test('maps the app locale code to Chrome directory names, zh → zh_CN', () => {
    expect(Object.keys(LOCALE_DIRS).sort()).toEqual([
      'ar',
      'de',
      'en',
      'es',
      'fr',
      'ja',
      'th',
      'zh',
    ]);
    expect(LOCALE_DIRS.zh).toBe('zh_CN');
  });

  test('every locale actually resolves every manifest source', () => {
    // The real invariant: a missing key in one locale would localize that
    // locale's manifest entry to nothing. This reads the shipped dictionaries.
    for (const code of Object.keys(LOCALE_DIRS)) {
      const tree = JSON.parse(readFileSync(join(LOCALES_DIR, `${code}.json`), 'utf8')) as Record<
        string,
        unknown
      >;
      const { messages, missing } = buildMessages(tree);
      expect({ code, missing }).toEqual({ code, missing: [] });
      expect(Object.keys(messages)).toHaveLength(Object.keys(MESSAGE_SOURCES).length);
    }
  });
});
