import { describe, expect, test } from 'bun:test';
import { hasNavIconVariants, navIconVariantSvg } from '@/utils/ui/icon-variants.js';
import { NAV_LABEL_KEYS, navItemFor } from '@/utils/ui/nav-layout.js';

/**
 * The MD3 active-destination rule needs EVERY nav icon to ship both official
 * Material Symbols variants: the active item renders FILL1, inactive FILL0.
 * A nav icon missing a pair would silently fall back to the single catalog
 * glyph and never change when its destination becomes active.
 */

/** Canonical nav key → its icon. `more` is a pseudo-item (no view of its own). */
function iconForNavKey(key: string): string {
  if (key === 'more') return 'moreHoriz';
  const item = navItemFor(key);
  expect(item).toBeDefined();
  return item?.iconName ?? '';
}

const dOf = (svg: string | null): string | undefined => svg?.match(/ d="([^"]+)"/)?.[1];

describe('nav icon variant pairs', () => {
  test('every nav destination ships both official variants', () => {
    for (const { key } of NAV_LABEL_KEYS) {
      const iconName = iconForNavKey(key);
      expect(iconName).toBeTruthy();
      expect(hasNavIconVariants(iconName)).toBe(true);
    }
  });

  test('FILL1 and FILL0 are the same snapshot - paired geometry, not mixed', () => {
    // The one exception: more_horiz's FILL1 equals its FILL0 (three solid
    // dots); every other pair must differ (fill removes interior detail).
    for (const { key } of NAV_LABEL_KEYS) {
      const name = iconForNavKey(key);
      const outlinedD = dOf(navIconVariantSvg(name, false, ''));
      const filledD = dOf(navIconVariantSvg(name, true, ''));
      expect(outlinedD).toBeTruthy();
      expect(filledD).toBeTruthy();
      if (name === 'moreHoriz') {
        expect(filledD).toBe(outlinedD);
      } else {
        expect(filledD).not.toBe(outlinedD);
      }
    }
  });

  test('the FILL1 glyph is the outline minus interior detail (shorter or equal path)', () => {
    for (const { key } of NAV_LABEL_KEYS) {
      const name = iconForNavKey(key);
      const outlinedD = dOf(navIconVariantSvg(name, false, '')) ?? '';
      const filledD = dOf(navIconVariantSvg(name, true, '')) ?? '';
      expect(filledD.length).toBeLessThanOrEqual(outlinedD.length);
    }
  });

  test('names without a variant pair resolve to null (catalog fallback preserved)', () => {
    expect(navIconVariantSvg('archive', true, '')).toBeNull();
    expect(navIconVariantSvg('star', false, '')).toBeNull();
    expect(navIconVariantSvg('nonexistent-icon', true, '')).toBeNull();
    expect(hasNavIconVariants('archive')).toBe(false);
  });

  test('the class string is injected into the rendered svg shell', () => {
    const out = navIconVariantSvg('inbox', true, 'w-full h-full');
    expect(out).toContain('class="w-full h-full"');
    expect(out?.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(out).toContain('viewBox="0 -960 960 960"');
    expect(out).toContain('fill="currentColor"');
  });
});
