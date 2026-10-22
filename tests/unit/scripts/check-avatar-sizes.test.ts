/**
 * The avatar-size gate's pure core.
 *
 * The regression this pins: `size={35}` inside a `w-9 h-9` wrapper (35 declared,
 * 36 painted), a numeric `size` at all, and a fixed box class that disagrees
 * with the named tier. Each case below is one of those, plus the two forms that
 * must stay legal - a tier alone, and a tier with an equal box or a fill.
 */
import { describe, expect, test } from 'bun:test';
import { findAvatarSites, findAvatarViolations } from '../../../scripts/check-avatar-sizes';

function messages(source: string): string[] {
  return findAvatarViolations(findAvatarSites(source, 'X.svelte')).map((v) => v.message);
}

describe('check-avatar-sizes', () => {
  test('a tier alone is on the scale', () => {
    expect(messages('<Avatar size="row" letter="a" email="a@b.c" />')).toEqual([]);
    expect(messages('<FaviconImage email="a@b.c" size="xs" class="shrink-0" />')).toEqual([]);
  });

  test('the tier’s own box, or a fill, is allowed in class', () => {
    expect(messages('<Avatar size="row" class="w-9 h-9 shrink-0" />')).toEqual([]);
    expect(messages('<Avatar size="row" class="w-full h-full pointer-events-none" />')).toEqual([]);
    expect(messages('<Avatar size="sm" class="w-5 h-5 object-contain" />')).toEqual([]);
  });

  test('a numeric size is a violation - the value the scale replaced', () => {
    expect(messages('<Avatar size={35} letter="a" />')).toEqual([
      'size="35" is not a tier - use one of xs, sm, md, lg, xl, row',
    ]);
  });

  test('a size class that disagrees with the tier is a violation', () => {
    const [message] = messages('<Avatar size="row" class="w-5 h-5" />');
    expect(message).toContain('"w-5" disagrees with size="row" (w-9 h-9)');
  });

  test('a fixed box with no tier named is a violation', () => {
    expect(messages('<FaviconImage domain="x.com" class="w-4 h-4" />')).toEqual([
      'no `size` - name a tier from @/utils/ui/avatar-size.js (a list row takes "row")',
    ]);
  });

  test('an unknown tier name is a violation', () => {
    expect(messages('<Avatar size="huge" />')[0]).toContain('"huge" is not a tier');
  });

  test('the box tokens are read through variant prefixes', () => {
    // `hover:w-9` is still a fixed box on the element; only the fill is exempt.
    expect(messages('<Avatar size="row" class="hover:w-5" />').length).toBe(1);
  });

  test('a multi-line tag and the primitives’ own callers are read whole', () => {
    const source = [
      '<FaviconImage',
      '  domain="mail.example.com"',
      '  size="row"',
      '  class="object-contain pointer-events-none"',
      '/>',
    ].join('\n');
    const sites = findAvatarSites(source, 'X.svelte');
    expect(sites).toHaveLength(1);
    expect(sites[0].tier).toBe('row');
    expect(sites[0].line).toBe(1);
    expect(sites[0].boxes).toEqual([]);
  });
});
