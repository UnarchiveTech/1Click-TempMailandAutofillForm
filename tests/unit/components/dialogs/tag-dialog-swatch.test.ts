/**
 * DOM-level tests for the tag dialog's color palette, via the Svelte harness.
 *
 * The palette used to mark the chosen color with a ring and a slight scale-up
 * only. That ring reads exactly like a hover or a keyboard-focus ring, so it never
 * answered the question the row exists for: "which color does this tag have?" - and
 * the answer has to survive the case where the tag's color is NOT one of these eight
 * (a custom hex), where marking anything would claim a color the tag does not have.
 *
 * So the mark is a tick, it sits on the swatch equal to the tag's CURRENT color, it
 * follows a pick, and when there is no swatch to mark NOTHING is ticked - the
 * absence is the answer. These tests pin all four facts against the real component.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});

const storage: Record<string, unknown> = {};

const fakeBrowser = {
  runtime: { id: 'test-ext', sendMessage: async () => ({ success: false }) },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...storage };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in storage) out[k] = storage[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(storage, items),
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

// Initialize svelte-i18n exactly like the app does (register 'en' + init) so $t()
// resolves real strings instead of raw keys.
await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();

const { cleanupDom, renderComponent, unmountComponent } = await import(
  '../../helpers/svelte-harness.js'
);

const INDIGO = '#6366F1';
const EMERALD = '#10B981';
/** Not one of the eight swatches - a tag can carry a custom hex. */
const CUSTOM = '#123456';
const PALETTE_SIZE = 8;

/**
 * The dialog portals to `document.body` (PORTAL_Z.dialog), so its markup is a
 * SIBLING of the mount target - every query has to look at the body.
 */
const swatches = (): HTMLElement[] => [
  ...document.body.querySelectorAll<HTMLElement>('button[role="radio"][data-tag-swatch]'),
];

/**
 * The palette, with the size asserted: a query that finds nothing would make
 * "nothing is ticked" pass for the wrong reason.
 */
function palette(): HTMLElement[] {
  const found = swatches();
  expect(found.length).toBe(PALETTE_SIZE);
  return found;
}

/** The swatches that carry the "chosen" tick, by color. */
function chosenSwatches(): string[] {
  return palette()
    .filter((el) => el.hasAttribute('data-chosen'))
    .map((el) => (el.getAttribute('data-tag-swatch') ?? '').toUpperCase());
}

/** The swatches a screen reader reports as checked. */
function checkedSwatches(): string[] {
  return palette()
    .filter((el) => el.getAttribute('aria-checked') === 'true')
    .map((el) => (el.getAttribute('data-tag-swatch') ?? '').toUpperCase());
}

/** The ticks rendered inside the palette (one per chosen swatch, and no more). */
function ticks(): number {
  return document.body.querySelectorAll('button[role="radio"] svg').length;
}

/** Click a swatch by its color, as a user would. */
async function pick(color: string): Promise<void> {
  const swatch = document.body.querySelector<HTMLElement>(
    `button[role="radio"][data-tag-swatch="${color}"]`
  );
  expect(swatch).not.toBeNull();
  swatch?.click();
  await new Promise((r) => setTimeout(r, 0));
}

async function openDialog(props: Record<string, unknown>) {
  const rendered = await renderComponent('src/ui/blocks/dialogs/TagDialog.svelte', {
    open: true,
    existingTags: ['Banking'],
    tagColors: { banking: INDIGO },
    onClose: () => {},
    onSaveTags: () => true,
    ...props,
  });
  await new Promise((r) => setTimeout(r, 0));
  return rendered;
}

function typeIntoTagField(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('TagDialog palette (DOM)', () => {
  beforeEach(() => {
    cleanupDom();
  });

  test('pending saves run once, freeze the draft, and block dismissal until completion', async () => {
    let complete: ((value: boolean) => void) | undefined;
    const pending = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    const save = mock(() => pending);
    const close = mock(() => {});
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: INDIGO,
      onSaveTags: save,
      onClose: close,
    });
    try {
      const button = document.body.querySelector<HTMLButtonElement>('#button-save-tag');
      button?.click();
      button?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(save).toHaveBeenCalledTimes(1);
      expect(button?.disabled).toBe(true);
      expect(document.querySelector<HTMLElement>('.dialog-form')?.inert).toBe(true);
      document.body.querySelector<HTMLButtonElement>('#button-cancel-tag')?.click();
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(close).not.toHaveBeenCalled();
      complete?.(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(button?.disabled).toBe(false);
      expect(document.querySelector<HTMLElement>('.dialog-form')?.inert).toBe(false);
      button?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(save).toHaveBeenCalledTimes(2);
    } finally {
      complete?.(false);
      await unmountComponent(instance);
    }
  });

  test('comma adds each completed tag once and Backspace removes the last chip', async () => {
    const { instance } = await openDialog({
      currentTag: null,
      currentTagColor: null,
      existingTags: [],
      tagColors: {},
    });
    const input = document.body.querySelector<HTMLInputElement>('#input-tag-name');
    expect(input).not.toBeNull();
    if (!input) throw new Error('Tag name input was not rendered');

    typeIntoTagField(input, 'Alpha,');
    await new Promise((r) => setTimeout(r, 0));

    expect(input.value).toBe('');
    expect(document.body.textContent?.split('Alpha').length).toBe(2);

    typeIntoTagField(input, 'Beta,');
    await new Promise((r) => setTimeout(r, 0));

    expect(input.value).toBe('');
    expect(document.body.textContent?.split('Beta').length).toBe(2);

    const backspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(backspace);
    await new Promise((r) => setTimeout(r, 0));

    expect(backspace.defaultPrevented).toBe(true);
    expect(document.body.textContent?.includes('Alpha')).toBe(true);
    expect(document.body.textContent?.includes('Beta')).toBe(false);
    await unmountComponent(instance);
  });

  test('a comma-separated paste adds completed names and keeps the unfinished name editable', async () => {
    const { instance } = await openDialog({
      currentTag: null,
      currentTagColor: null,
      existingTags: [],
      tagColors: {},
    });
    const input = document.body.querySelector<HTMLInputElement>('#input-tag-name');
    expect(input).not.toBeNull();
    if (!input) throw new Error('Tag name input was not rendered');

    typeIntoTagField(input, 'Alpha, Beta');
    await new Promise((r) => setTimeout(r, 0));

    expect(input.value).toBe('Beta');
    expect(document.body.textContent?.split('Alpha').length).toBe(2);
    expect(document.body.textContent?.includes('Beta')).toBe(false);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(input.value).toBe('');
    expect(document.body.textContent?.split('Beta').length).toBe(2);
    await unmountComponent(instance);
  });

  test('selected tags appear once below the palette and can be removed there', async () => {
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: INDIGO,
      currentTags: [{ name: 'Banking', color: INDIGO }],
    });

    const paletteRow = document.body.querySelector('[role="radiogroup"]');
    const selectedChip = document.body.querySelector<HTMLButtonElement>(
      'button[data-tag-chip-preview]'
    );
    expect(selectedChip).not.toBeNull();
    if (!paletteRow || !selectedChip) throw new Error('Tag preview or palette was not rendered');
    expect(selectedChip.textContent).toContain('Banking');
    expect(document.body.textContent?.split('Banking').length).toBe(2);
    expect(
      paletteRow.compareDocumentPosition(selectedChip) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    selectedChip.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.querySelector('button[data-tag-chip-preview]')).toBeNull();
    expect(document.body.querySelector('button[aria-label="Add tag Banking"]')).not.toBeNull();
    await unmountComponent(instance);
  });

  test('the tick sits on the swatch equal to the tag’s current color', async () => {
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: INDIGO,
      tagColors: { banking: INDIGO },
    });

    expect(chosenSwatches()).toEqual([INDIGO]);
    expect(ticks()).toBe(1);
    expect(checkedSwatches()).toEqual([INDIGO]);
    // The mark is ONE swatch, never "the first one" or "the default one".
    expect(chosenSwatches()[0]).not.toBe('#EC4899');
    await unmountComponent(instance);
  });

  test('the tag’s ONE color wins over this address’s own stored color', async () => {
    // The chip behind the dialog paints `buildTagColors`'s answer, so the palette
    // has to tick that color - not the one row the dialog was opened from.
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: '#EC4899',
      tagColors: { banking: INDIGO },
    });

    expect(chosenSwatches()).toEqual([INDIGO]);
    await unmountComponent(instance);
  });

  test('a color outside the palette ticks NOTHING - picking nothing reads as choosing nothing', async () => {
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: CUSTOM,
      tagColors: { banking: CUSTOM },
    });

    palette();
    expect(chosenSwatches()).toEqual([]);
    expect(checkedSwatches()).toEqual([]);
    expect(ticks()).toBe(0);
    await unmountComponent(instance);
  });

  test('a tag color stored in another case still ticks its swatch', async () => {
    // A tag stored as `#6366f1` is the swatch `#6366F1`: one tag, one color - and
    // the palette has to recognize it instead of falling back to "custom color".
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: '#6366f1',
      tagColors: { banking: '#6366f1' },
    });

    expect(chosenSwatches()).toEqual([INDIGO]);
    await unmountComponent(instance);
  });

  test('a brand-new tag starts unmarked, and a pick ticks that swatch', async () => {
    const { instance } = await openDialog({
      currentTag: null,
      currentTagColor: null,
      tagColors: {},
    });

    // Nothing is chosen yet - the default a typed tag would take is not a choice
    // the user made, so the palette claims nothing.
    expect(chosenSwatches()).toEqual([]);

    await pick(EMERALD);

    expect(chosenSwatches()).toEqual([EMERALD]);
    expect(checkedSwatches()).toEqual([EMERALD]);
    expect(ticks()).toBe(1);
    await unmountComponent(instance);
  });

  test('a pick on an existing tag MOVES the tick to the picked swatch', async () => {
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: INDIGO,
      tagColors: { banking: INDIGO },
    });

    expect(chosenSwatches()).toEqual([INDIGO]);

    await pick(EMERALD);

    // One mark, on the color that will be written to every address carrying the tag.
    expect(chosenSwatches()).toEqual([EMERALD]);
    expect(ticks()).toBe(1);
    await unmountComponent(instance);
  });

  test('the tick is legible on the swatch’s own color', async () => {
    const { instance } = await openDialog({
      currentTag: 'Banking',
      currentTagColor: EMERALD,
      tagColors: { banking: EMERALD },
    });

    const chosen = palette().find((el) => el.hasAttribute('data-chosen'));
    expect(chosen?.querySelector('svg')).not.toBeNull();
    // Emerald is light, so the ink is the dark contrast color - not the theme's
    // `--md-on-primary`, which is dark in the dark themes and would disappear.
    expect(chosen?.querySelector('span')?.style.color).toBe('rgb(26, 28, 22)');
    await unmountComponent(instance);
  });
});
