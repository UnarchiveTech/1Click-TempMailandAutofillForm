/**
 * `existingTagNames` / `buildTagAddressUsage` - the one derivation of "which tags
 * exist" and "which addresses use each tag".
 *
 * The duplicate-tag bug lived here: a case-SENSITIVE `Set` in each caller showed
 * `Banking` and `banking` as two tags in the dialog, so the list is pinned to one
 * spelling per tag (first wins) here, and the usage map is keyed the same way so
 * a hover can never miss on casing. `buildTagColors` is keyed the same way, so one
 * tag cannot paint two colors either.
 */
import { describe, expect, test } from 'bun:test';
import {
  type AddressTagEntry,
  buildTagAddressUsage,
  buildTagColors,
  caseVariantTags,
  colorVariantTags,
  existingTagNames,
  mergeTagSpellings,
  tagColorFor,
  tagReachCount,
  tagUsageEmails,
  tagUsageInfo,
  tagUsedByLabel,
  unifyTagColors,
} from '@/utils/address/address-tags.js';
import type { Address } from '@/utils/types.js';

function address(overrides: Partial<Address> & { address: string }): Address {
  return {
    id: overrides.address,
    provider: 'mailtm',
    createdAt: 0,
    expiresAt: 0,
    ...overrides,
  } as Address;
}

const tag = (name: string, color = '#6366F1'): AddressTagEntry => ({ name, color });

describe('existingTagNames', () => {
  test('lists every tag from the tags[] schema, alphabetically', () => {
    const names = existingTagNames([
      address({ address: 'a@x.com', tags: [tag('Work'), tag('Banking')] }),
      address({ address: 'b@x.com', tags: [tag('News')] }),
    ]);
    expect(names).toEqual(['Banking', 'News', 'Work']);
  });

  test('de-duplicates CASE-INSENSITIVELY, keeping the first spelling', () => {
    const names = existingTagNames([
      address({ address: 'a@x.com', tags: [tag('Banking')] }),
      address({ address: 'b@x.com', tags: [tag('banking')] }),
      address({ address: 'c@x.com', tags: [tag('BANKING')] }),
    ]);
    // One entry, not three - the dialog used to print the same tag three times.
    expect(names).toEqual(['Banking']);
  });

  test('reads the legacy single-tag schema too, without double-adding it', () => {
    // `tag` mirrors `tags[0]` in the v3 schema, so the union must collapse.
    const names = existingTagNames([
      address({ address: 'a@x.com', tag: 'Banking', tags: [tag('Banking'), tag('Work')] }),
    ]);
    expect(names).toEqual(['Banking', 'Work']);
  });

  test('ignores empty and whitespace-only names', () => {
    const names = existingTagNames([
      address({ address: 'a@x.com', tags: [tag('   '), tag('Work'), tag('')] }),
      address({ address: 'b@x.com', tag: '  ' }),
    ]);
    expect(names).toEqual(['Work']);
  });

  test('an address list with no tags has no tags', () => {
    expect(existingTagNames([])).toEqual([]);
    expect(existingTagNames([address({ address: 'a@x.com' })])).toEqual([]);
  });
});

describe('buildTagAddressUsage', () => {
  test('maps each tag to the addresses that carry it, sorted', () => {
    const usage = buildTagAddressUsage([
      address({ address: 'zeta@x.com', tags: [tag('Banking')] }),
      address({ address: 'alpha@x.com', tags: [tag('Banking'), tag('Work')] }),
      address({ address: 'beta@x.com' }),
    ]);
    expect(usage.banking).toEqual(['alpha@x.com', 'zeta@x.com']);
    expect(usage.work).toEqual(['alpha@x.com']);
    expect(Object.keys(usage).sort()).toEqual(['banking', 'work']);
  });

  test('is keyed by lower-cased name, so a hover lookup cannot miss on casing', () => {
    const usage = buildTagAddressUsage([address({ address: 'a@x.com', tags: [tag('Banking')] })]);
    expect(usage.Banking).toBeUndefined();
    expect(usage.banking).toEqual(['a@x.com']);
  });

  test('counts an address once per tag even when both schemas carry it', () => {
    const usage = buildTagAddressUsage([
      address({ address: 'a@x.com', tag: 'Banking', tags: [tag('Banking')] }),
    ]);
    expect(usage.banking).toEqual(['a@x.com']);
  });

  test('an address with no tags contributes nothing', () => {
    expect(buildTagAddressUsage([address({ address: 'a@x.com' })])).toEqual({});
  });
});

describe('tagUsageEmails / tagUsedByLabel', () => {
  /** Stands in for `$t`: records the key and renders the `{addresses}` slot. */
  const fakeT = (key: string, options: { values: Record<string, string | number> }): string =>
    `${key}[${options.values.addresses}]`;

  test('looks a tag up case-insensitively, because the map is keyed lower-cased', () => {
    const usage = { banking: ['a@x.com', 'b@x.com'] };
    expect(tagUsageEmails(usage, 'Banking')).toEqual(['a@x.com', 'b@x.com']);
    expect(tagUsageEmails(usage, '  BANKING  ')).toEqual(['a@x.com', 'b@x.com']);
  });

  test('counts one address once even when both tag schemas carry the tag', () => {
    const usage = buildTagAddressUsage([
      address({ address: 'a@x.com', tag: 'Banking', tagColor: '#6366F1', tags: [tag('Banking')] }),
    ]);
    expect(usage.banking).toEqual(['a@x.com']);
    expect(tagUsageInfo(fakeT, usage, 'Banking')?.count).toBe(1);
  });

  test('an unknown, empty or missing tag has no addresses', () => {
    const usage = { banking: ['a@x.com'] };
    expect(tagUsageEmails(usage, 'work')).toEqual([]);
    expect(tagUsageEmails(usage, '')).toEqual([]);
    expect(tagUsageEmails(usage, '   ')).toEqual([]);
    expect(tagUsageEmails(usage, null)).toEqual([]);
    expect(tagUsageEmails(usage, undefined)).toEqual([]);
  });

  test('renders the used-by detail through the shared key, listing every address', () => {
    const usage = buildTagAddressUsage([
      address({ address: 'zeta@x.com', tags: [tag('Banking')] }),
      address({ address: 'alpha@x.com', tags: [tag('banking')] }),
    ]);
    expect(tagUsedByLabel(fakeT, usage, 'BANKING')).toBe(
      'tagManagement.usedBy[alpha@x.com, zeta@x.com]'
    );
  });

  test('a tag on no address yields NO tooltip - never an empty “Used by:”', () => {
    const usage = buildTagAddressUsage([address({ address: 'a@x.com', tags: [tag('Work')] })]);
    expect(tagUsedByLabel(fakeT, usage, 'Banking')).toBeUndefined();
    expect(tagUsedByLabel(fakeT, {}, 'Work')).toBeUndefined();
  });

  test('tagUsageInfo pairs the count with the detail that lists those same addresses', () => {
    const usage = buildTagAddressUsage([
      address({ address: 'zeta@x.com', tags: [tag('Banking')] }),
      address({ address: 'alpha@x.com', tags: [tag('banking')] }),
    ]);
    const info = tagUsageInfo(fakeT, usage, 'Banking');
    expect(info?.count).toBe(2);
    // The count and the hover text are one fact: 2 addresses, and the label names
    // exactly those two.
    expect(info?.label).toBe('tagManagement.usedBy[alpha@x.com, zeta@x.com]');
  });

  test('tagUsageInfo is null - not a zero - when nothing carries the tag', () => {
    expect(tagUsageInfo(fakeT, {}, 'Banking')).toBeNull();
    expect(tagUsageInfo(fakeT, { banking: [] }, 'Banking')).toBeNull();
  });
});

describe('tagReachCount', () => {
  const usage = buildTagAddressUsage([
    address({ address: 'a@x.com', tags: [tag('Banking'), tag('Work')] }),
    address({ address: 'b@x.com', tags: [tag('Banking')] }),
    address({ address: 'c@x.com', tags: [tag('Work')] }),
    address({ address: 'd@x.com' }),
  ]);

  test('counts the addresses one tag reaches, and the union over several', () => {
    expect(tagReachCount(usage, ['Banking'])).toBe(2);
    expect(tagReachCount(usage, ['Work'])).toBe(2);
    expect(tagReachCount(usage, ['Banking', 'Work'])).toBe(3);
  });

  test('an address carrying two of the selected tags counts ONCE - it moves once', () => {
    // a@x.com carries both, so the pair reaches 3 addresses, not 4.
    expect(tagReachCount(usage, ['Banking', 'Work'])).toBe(3);
  });

  test('folds casing, so one tag written two ways cannot count an address twice', () => {
    const split = buildTagAddressUsage([
      address({ address: 'a@x.com', tags: [tag('Banking')] }),
      address({ address: 'b@x.com', tags: [tag('banking')] }),
    ]);
    expect(tagReachCount(split, ['Banking', 'banking'])).toBe(2);
  });

  test('an empty selection and tags nothing carries reach nothing', () => {
    expect(tagReachCount(usage, [])).toBe(0);
    expect(tagReachCount(usage, ['Ghost'])).toBe(0);
    expect(tagReachCount(usage, [''])).toBe(0);
    expect(tagReachCount({}, ['Banking'])).toBe(0);
  });
});

describe('caseVariantTags', () => {
  test('reports a tag that exists under two casings, with what it is carried by', () => {
    const groups = caseVariantTags([
      address({ address: 'a@x.com', tags: [tag('Banking')] }),
      address({ address: 'b@x.com', tags: [tag('banking')] }),
    ]);
    expect(groups).toEqual([
      {
        canonical: 'Banking',
        spellings: [
          { name: 'Banking', addressCount: 1 },
          { name: 'banking', addressCount: 1 },
        ],
      },
    ]);
  });

  test('the spelling the most addresses already write wins, so the fewest get renamed', () => {
    const groups = caseVariantTags([
      address({ address: 'a@x.com', tags: [tag('banking')] }),
      address({ address: 'b@x.com', tags: [tag('banking')] }),
      address({ address: 'c@x.com', tags: [tag('Banking')] }),
    ]);
    expect(groups[0]?.canonical).toBe('banking');
    expect(groups[0]?.spellings.map((s) => s.name)).toEqual(['banking', 'Banking']);
  });

  test('a tie keeps the first spelling seen - the one the dialog already shows', () => {
    const groups = caseVariantTags([
      address({ address: 'a@x.com', tags: [tag('Banking')] }),
      address({ address: 'b@x.com', tags: [tag('BANKING')] }),
      address({ address: 'c@x.com', tags: [tag('banking')] }),
    ]);
    expect(groups[0]?.canonical).toBe('Banking');
    // Remaining spellings are ordered by usage, then A→Z.
    expect(groups[0]?.spellings.map((s) => s.name)).toEqual(['Banking', 'BANKING', 'banking']);
  });

  test('a tag written one way only is not a variant', () => {
    expect(
      caseVariantTags([
        address({ address: 'a@x.com', tags: [tag('Banking'), tag('Work')] }),
        address({ address: 'b@x.com', tags: [tag('Work')] }),
      ])
    ).toEqual([]);
    expect(caseVariantTags([])).toEqual([]);
  });

  test('counts an address once per spelling even when both schemas carry it', () => {
    const groups = caseVariantTags([
      address({ address: 'a@x.com', tag: 'banking', tags: [tag('Banking'), tag('banking')] }),
      address({ address: 'b@x.com', tags: [tag('Banking')] }),
    ]);
    expect(groups[0]?.canonical).toBe('Banking');
    expect(groups[0]?.spellings).toEqual([
      { name: 'Banking', addressCount: 2 },
      { name: 'banking', addressCount: 1 },
    ]);
  });

  test('a spelling pair created but never assigned (catalog only) is still a split', () => {
    const groups = caseVariantTags([], ['Banking', 'banking']);
    expect(groups).toEqual([
      {
        canonical: 'Banking',
        spellings: [
          { name: 'Banking', addressCount: 0 },
          { name: 'banking', addressCount: 0 },
        ],
      },
    ]);
  });

  test('ignores empty and whitespace-only spellings', () => {
    expect(
      caseVariantTags([address({ address: 'a@x.com', tags: [tag('  '), tag(''), tag('Work')] })])
    ).toEqual([]);
  });
});

describe('mergeTagSpellings', () => {
  test('rewrites every casing to the one spelling', () => {
    const merged = mergeTagSpellings(
      [
        address({ address: 'a@x.com', tags: [tag('Banking')] }),
        address({ address: 'b@x.com', tags: [tag('banking')] }),
        address({ address: 'c@x.com', tags: [tag('BANKING')] }),
      ],
      'Banking'
    );
    expect(merged.map((a) => a.tags?.map((t) => t.name))).toEqual([
      ['Banking'],
      ['Banking'],
      ['Banking'],
    ]);
    // ...and only one spelling is left in play, so the split is really gone.
    expect(caseVariantTags(merged)).toEqual([]);
  });

  test('collapses two casings held by ONE address into a single tag', () => {
    const [merged] = mergeTagSpellings(
      [
        address({
          address: 'a@x.com',
          tag: 'Banking',
          tagColor: '#6366F1',
          tags: [tag('Banking'), tag('banking', '#10B981')],
        }),
      ],
      'Banking'
    );
    // The first matching entry's colour survives - the merge keeps the tag the
    // user was already looking at.
    expect(merged?.tags).toEqual([tag('Banking', '#6366F1')]);
    expect(merged?.tag).toBe('Banking');
    expect(merged?.tagColor).toBe('#6366F1');
  });

  test('brings a legacy-only tag into both schemas, keeping its colour', () => {
    const [merged] = mergeTagSpellings(
      [address({ address: 'a@x.com', tag: 'banking', tagColor: '#EC4899' })],
      'Banking'
    );
    expect(merged?.tags).toEqual([tag('Banking', '#EC4899')]);
    expect(merged?.tag).toBe('Banking');
    expect(merged?.tagColor).toBe('#EC4899');
  });

  test('leaves every other address and tag as the SAME object, so nothing is written for them', () => {
    const untouched = address({ address: 'b@x.com', tags: [tag('Work')] });
    const prefix = address({ address: 'c@x.com', tags: [tag('bank')] });
    const canonical = address({
      address: 'd@x.com',
      tag: 'Banking',
      tagColor: '#6366F1',
      tags: [tag('Banking')],
    });
    const input = [untouched, prefix, canonical];
    const merged = mergeTagSpellings(input, 'Banking');
    expect(merged[0]).toBe(untouched);
    expect(merged[1]).toBe(prefix);
    // Already the canonical spelling, in both schemas: no needless write.
    expect(merged[2]).toBe(canonical);
  });

  test('with the shared color, the merged tag is written in ONE color', () => {
    const merged = mergeTagSpellings(
      [
        address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] }),
        address({ address: 'b@x.com', tags: [tag('Banking', '#6366F1')] }),
      ],
      'banking',
      '#EC4899'
    );
    expect(merged.map((a) => a.tags)).toEqual([
      [tag('banking', '#EC4899')],
      [tag('banking', '#EC4899')],
    ]);
    // ...so the tag cannot come out of the merge still written in two colors.
    expect(buildTagColors(merged)).toEqual({ banking: '#EC4899' });
  });

  test('a blank target merges nothing', () => {
    const input = [address({ address: 'a@x.com', tags: [tag('banking')] })];
    expect(mergeTagSpellings(input, '   ')).toBe(input);
  });
});

describe('buildTagColors / tagColorFor', () => {
  test('two spellings of one tag cannot hold two colors', () => {
    const colors = buildTagColors([
      address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] }),
      address({ address: 'b@x.com', tags: [tag('Banking', '#6366F1')] }),
    ]);
    // ONE entry, under the lower-cased name - the exact-spelling map this
    // replaces produced two, so the same tag painted a different chip per row.
    expect(colors).toEqual({ banking: '#EC4899' });
    expect(tagColorFor(colors, 'Banking')).toBe('#EC4899');
  });

  test('the most addresses win, across spellings', () => {
    const colors = buildTagColors([
      address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] }),
      address({ address: 'b@x.com', tags: [tag('Banking', '#EC4899')] }),
      address({ address: 'c@x.com', tags: [tag('BANKING', '#6366F1')] }),
    ]);
    expect(colors).toEqual({ banking: '#EC4899' });
  });

  test('a tie keeps the first color seen', () => {
    const colors = buildTagColors([
      address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] }),
      address({ address: 'b@x.com', tags: [tag('Banking', '#6366F1')] }),
    ]);
    expect(colors).toEqual({ banking: '#EC4899' });
  });

  test('one address counts once, even though the legacy field mirrors tags[0]', () => {
    const colors = buildTagColors([
      // The mirror repeats the tag here; counting it twice would make this one
      // address outweigh the two below and flip the winner.
      address({
        address: 'a@x.com',
        tag: 'banking',
        tagColor: '#EC4899',
        tags: [tag('banking', '#EC4899')],
      }),
      address({ address: 'b@x.com', tags: [tag('banking', '#10B981')] }),
      address({ address: 'c@x.com', tags: [tag('banking', '#10B981')] }),
    ]);
    expect(colors).toEqual({ banking: '#10B981' });
  });

  test('a legacy-only tag has a color too', () => {
    const colors = buildTagColors([
      address({ address: 'a@x.com', tag: 'banking', tagColor: '#EC4899' }),
    ]);
    expect(colors).toEqual({ banking: '#EC4899' });
  });

  test('a tag no address carries is ABSENT, so a caller falls back to its own color', () => {
    const colors = buildTagColors([]);
    expect(colors).toEqual({});
    expect(tagColorFor(colors, 'banking')).toBeUndefined();
  });

  test('tagColorFor is case-insensitive and blanks out safely', () => {
    const colors = { banking: '#EC4899' };
    expect(tagColorFor(colors, 'BANKING')).toBe('#EC4899');
    expect(tagColorFor(colors, '  Banking  ')).toBe('#EC4899');
    expect(tagColorFor(colors, null)).toBeUndefined();
    expect(tagColorFor(colors, '')).toBeUndefined();
    expect(tagColorFor(colors, '   ')).toBeUndefined();
    expect(tagColorFor(colors, 'shopping')).toBeUndefined();
  });
});

describe('colorVariantTags', () => {
  test('finds a tag written in two colors, and keeps the more used one', () => {
    const variants = colorVariantTags([
      address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] }),
      address({ address: 'b@x.com', tags: [tag('banking', '#EC4899')] }),
      address({ address: 'c@x.com', tags: [tag('banking', '#6366F1')] }),
    ]);
    expect(variants).toEqual([
      {
        tag: 'banking',
        color: '#EC4899',
        colors: [
          { color: '#EC4899', addressCount: 2 },
          { color: '#6366F1', addressCount: 1 },
        ],
      },
    ]);
  });

  test('a tag written one way is not a variant', () => {
    expect(
      colorVariantTags([
        address({ address: 'a@x.com', tags: [tag('banking', '#EC4899'), tag('work', '#10B981')] }),
        address({ address: 'b@x.com', tags: [tag('banking', '#EC4899'), tag('work', '#10B981')] }),
      ])
    ).toEqual([]);
  });

  test('a tie keeps the first color seen - the one the chips already paint', () => {
    const variants = colorVariantTags([
      address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] }),
      address({ address: 'b@x.com', tags: [tag('Banking', '#6366F1')] }),
    ]);
    expect(variants[0]?.color).toBe('#EC4899');
    // The casing does not hide the disagreement: the tag is one tag.
    expect(variants).toHaveLength(1);
  });

  test('reports against the same color the chips paint', () => {
    const withSplit = [
      address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] }),
      address({ address: 'b@x.com', tags: [tag('banking', '#6366F1')] }),
    ];
    // Whatever the split is, the kept color is the resolved color - never a
    // second opinion about which one survives.
    expect(colorVariantTags(withSplit)[0]?.color).toBe(buildTagColors(withSplit).banking);
  });

  test('one address cannot disagree with itself', () => {
    expect(
      colorVariantTags([address({ address: 'a@x.com', tags: [tag('banking', '#EC4899')] })])
    ).toEqual([]);
  });
});

describe('unifyTagColors', () => {
  test('recolors the tag on every carrier, leaving the spellings alone', () => {
    const merged = unifyTagColors(
      [
        address({ address: 'a@x.com', tags: [tag('banking', '#6366F1'), tag('work', '#10B981')] }),
        address({ address: 'b@x.com', tags: [tag('Banking', '#6366F1')] }),
      ],
      'banking',
      '#EC4899'
    );
    expect(merged.map((a) => a.tags)).toEqual([
      [tag('banking', '#EC4899'), tag('work', '#10B981')],
      // `Banking` keeps its casing: this cleanup is about colors only.
      [tag('Banking', '#EC4899')],
    ]);
    // The color split is gone, and the tag resolves to the one color.
    expect(colorVariantTags(merged)).toEqual([]);
    expect(buildTagColors(merged)).toEqual({ banking: '#EC4899', work: '#10B981' });
  });

  test('keeps the legacy mirror on tags[0]', () => {
    const [merged] = unifyTagColors(
      [address({ address: 'a@x.com', tag: 'banking', tagColor: '#6366F1' })],
      'banking',
      '#EC4899'
    );
    expect(merged?.tags).toEqual([tag('banking', '#EC4899')]);
    expect(merged?.tag).toBe('banking');
    expect(merged?.tagColor).toBe('#EC4899');
  });

  test('matches a different casing, because the tag is one tag', () => {
    const [merged] = unifyTagColors(
      [address({ address: 'a@x.com', tags: [tag('BANKING', '#6366F1')] })],
      'banking',
      '#EC4899'
    );
    expect(merged?.tags).toEqual([tag('BANKING', '#EC4899')]);
  });

  test('leaves other addresses, other tags and uniform carriers as the SAME object', () => {
    const without = address({ address: 'a@x.com', tags: [tag('work', '#10B981')] });
    // Already the kept color, in BOTH schemas - nothing to write for it.
    const uniform = address({
      address: 'b@x.com',
      tag: 'banking',
      tagColor: '#EC4899',
      tags: [tag('banking', '#EC4899')],
    });
    const offPalette = address({ address: 'c@x.com', tags: [tag('banking', '#6366F1')] });
    const input = [without, uniform, offPalette];
    const merged = unifyTagColors(input, 'banking', '#EC4899');
    expect(merged[0]).toBe(without);
    expect(merged[1]).toBe(uniform);
    expect(merged[2]).not.toBe(offPalette);
  });

  test('a blank tag or color unifies nothing', () => {
    const input = [address({ address: 'a@x.com', tags: [tag('banking', '#6366F1')] })];
    expect(unifyTagColors(input, '   ', '#EC4899')).toBe(input);
    expect(unifyTagColors(input, 'banking', '')).toBe(input);
  });
});
