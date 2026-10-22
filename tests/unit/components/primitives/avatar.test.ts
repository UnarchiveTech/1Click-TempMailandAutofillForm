/**
 * DOM-level tests for the Avatar primitive via the Svelte component harness.
 *
 * Regression coverage:
 *  1. Muted shells (`AVATAR_MUTED` = bg-md-surface-variant + text-md-on-surface-variant)
 *     must NOT hardcode `text-white` on the letter span - white-on-light-gray
 *     letters were invisible in light mode (surface-variant is #e1e4d5).
 *  2. Letter extraction must be code-point safe - `charAt(0)`/`[0]` split emoji
 *     into a lone surrogate (broken glyph).
 *  3. The size/position class guards must not false-positive on `max-w-*`,
 *     `inset-*` etc. (class-boundary-aware regexes).
 *  4. Fallback path (engines without CSS leading-trim): Latin-style letters
 *     get the -0.06em optical nudge (line-height:1 flex centering leaves
 *     uppercase ink ~0.06em low); full-em glyphs (emoji/CJK) must NOT be
 *     nudged.
 *  5. Engines WITH `text-box-trim`/`text-box-edge` use CSS leading-trim
 *     instead (no em nudge, no code-point gate) - pixel-verified end to end
 *     by tests/e2e/avatar-geometry.e2e.ts.
 *  6. `size` is a TIER from `@/utils/ui/avatar-size.js`, and the box it paints
 *     is that tier's px - the scale, not a call-site number, decides.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { AVATAR_BOX, AVATAR_TIERS } from '@/utils/ui/avatar-size.js';

const { renderComponent, cleanupDom } = await import('../../helpers/svelte-harness.js');

describe('Avatar (DOM)', () => {
  beforeEach(() => {
    cleanupDom();
  });

  test('default avatar renders the first letter uppercase in white', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'xl',
      letter: 'alice',
    });

    const span = target.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe('A');
    // avatarColor() ships `text-white` on the shell; the letter inherits it
    // instead of hardcoding it on the span.
    const shell = target.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain('text-white');
    expect(span?.className).not.toContain('text-white');
  });

  test('muted shell keeps its own text color - letter is NOT forced white', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'xl',
      letter: 'a',
      email: 'a@x.com',
      color: 'bg-md-surface-variant text-md-on-surface-variant',
    });

    const span = target.querySelector('span');
    expect(span?.className).not.toContain('text-white');
    const shell = target.firstElementChild as HTMLElement | null;
    expect(shell?.className).toContain('bg-md-surface-variant');
    expect(shell?.className).toContain('text-md-on-surface-variant');
  });

  test('plain bg-only shell still forces white letters', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'xl',
      letter: 'a',
      color: 'bg-[#C62828]',
    });

    const span = target.querySelector('span');
    expect(span?.className).toContain('text-white');
  });

  test('emoji letter renders the full code point, not a lone surrogate', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'xl',
      letter: '🌟Developer',
    });

    const span = target.querySelector('span');
    expect(span?.textContent).toBe('🌟');
    // A lone surrogate would fail this round-trip (broken glyph).
    expect(Array.from(span?.textContent ?? '')).toHaveLength(1);
  });

  test('Latin letter gets the 0.06em optical centering nudge', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'row',
      letter: 'noreply',
    });

    const span = target.querySelector('span') as HTMLElement;
    expect(span?.textContent).toBe('N');
    // Fallback path (no CSS leading-trim support, e.g. jsdom): line-height:1 +
    // flex centers the em box; uppercase ink sits ~0.06em low (measured 12px/
    // 10px gaps on a 35px avatar). The nudge re-centers the ink.
    expect(span?.style.transform).toContain('translateY(-0.06em)');
  });

  test('uses CSS leading-trim when the engine supports it (no em nudge, any glyph)', async () => {
    // jsdom has no CSS.supports, so emulate a supporting engine. supportsTextTrim
    // is evaluated per mount, so scoping the stub around each render is enough.
    const supports = () => true;
    (globalThis as unknown as { CSS?: { supports: () => boolean } }).CSS = { supports };
    try {
      const latin = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
        size: 'row',
        letter: 'noreply',
      });
      const latinSpan = latin.target.querySelector('span') as HTMLElement;
      expect(latinSpan?.style.textBoxTrim).toBe('trim-both');
      expect(latinSpan?.style.textBoxEdge).toBe('cap alphabetic');
      expect(latinSpan?.style.transform).toBe('');

      // The trim path needs no code-point gate: full-em glyphs (emoji/CJK)
      // are trimmed to their own ink band too.
      const emoji = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
        size: 'row',
        letter: '🌟Star',
      });
      const emojiSpan = emoji.target.querySelector('span') as HTMLElement;
      expect(emojiSpan?.style.textBoxTrim).toBe('trim-both');
      expect(emojiSpan?.style.transform).toBe('');
    } finally {
      delete (globalThis as unknown as { CSS?: { supports: () => boolean } }).CSS;
    }
  });

  test('full-em glyphs (emoji / CJK) are NOT nudged', async () => {
    const emoji = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'row',
      letter: '🌟Star',
    });
    expect((emoji.target.querySelector('span') as HTMLElement).style.transform).toBe('');

    const cjk = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'row',
      letter: '名字',
    });
    expect((cjk.target.querySelector('span') as HTMLElement).style.transform).toBe('');
  });

  test('every tier paints its own px, and the default is the sm tier', async () => {
    for (const tier of Object.keys(AVATAR_TIERS) as Array<keyof typeof AVATAR_TIERS>) {
      const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
        size: tier,
        letter: 'a',
      });
      const el = target.firstElementChild as HTMLElement;
      expect(el.style.width).toBe(`${AVATAR_TIERS[tier]}px`);
      expect(el.style.height).toBe(`${AVATAR_TIERS[tier]}px`);
    }

    const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      letter: 'a',
    });
    expect((target.firstElementChild as HTMLElement).style.width).toBe(`${AVATAR_TIERS.sm}px`);
  });

  test('an explicit size class suppresses the inline size style', async () => {
    const withClass = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'xl',
      letter: 'a',
      class: AVATAR_BOX.xl,
    });
    expect((withClass.target.firstElementChild as HTMLElement).style.width).toBe('');

    const withoutClass = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'xl',
      letter: 'a',
    });
    const el = withoutClass.target.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('32px');
    expect(el.style.height).toBe('32px');
  });

  test('max-w-/inset- classes do not false-positive as size/position classes', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/Avatar.svelte', {
      size: 'md',
      letter: 'a',
      class: 'max-w-full inset-x-0',
    });

    // No w-*/h-* and no absolute/fixed/relative/sticky → inline size applies,
    // and the fallback `relative` position class is added.
    const el = target.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('24px');
    expect(el.className).toContain('relative');
  });
});
