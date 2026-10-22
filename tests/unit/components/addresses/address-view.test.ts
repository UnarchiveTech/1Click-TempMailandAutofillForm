/**
 * DOM-level tests for AddressView's email-row domain selector via the Svelte
 * harness. No browser - jsdom + mocked wxt/browser.
 *
 * Covers the three things we shipped together: the provider(instance) pill in
 * the row, the account-bar-style domain chip with the chevron, and the domain
 * dropdown with its per-domain accent-color swatches (plus the D / Escape
 * keyboard shortcuts on the focused row).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const storage: Record<string, unknown> = {
  // Per-inbox accent colors: id-keyed (legacy address fallback also supported).
  addressColors: { 'guerrilla-1': '#123456', 'user@guerrillamail.com': '#654321' },
};

const sessionStore: Record<string, unknown> = {};

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
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

// Initialize svelte-i18n exactly like the app does (register 'en' + init) so
// $t() resolves real strings instead of raw keys.
await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();

const { renderComponent, cleanupDom, unmountComponent } = await import(
  '../../helpers/svelte-harness.js'
);

const ACCOUNT = {
  id: 'guerrilla-1',
  address: 'user@guerrillamail.com',
  provider: 'guerrilla',
  token: 'token-x',
  createdAt: Date.now() - 60_000,
  expiresAt: Date.now() + 3_600_000,
  accountStatus: 'active',
  status: 'active',
};

describe('AddressView domain dropdown (DOM)', () => {
  beforeEach(() => {
    cleanupDom();
  });

  test('renders the domain chip with chevron and the provider pill', async () => {
    const { target, instance } = await renderComponent(
      'src/ui/views/addresses/AddressView.svelte',
      { currentEmailDetail: ACCOUNT }
    );

    // Domain chip: account-bar treatment with the current domain + chevron.
    const chip = target.querySelector('button[aria-haspopup="menu"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('@guerrillamail.com');
    expect(chip?.querySelector('svg')).not.toBeNull(); // chevronDown icon

    // Provider pill renders Guerrilla Mail (no instance bracket). Scope to the
    // pill's root span (title attribute) - the page has other parens like
    // "Saved logins (0)".
    const pill = target.querySelector('span[title]');
    expect(pill?.textContent).toContain('Guerrilla Mail');
    expect(pill?.getAttribute('title')).toBe('Guerrilla Mail');
    expect(pill?.textContent).not.toContain('(');

    await unmountComponent(instance);
  });

  test('clicking the chip opens the dropdown with the multi-domain list and accent swatches', async () => {
    const { target, instance } = await renderComponent(
      'src/ui/views/addresses/AddressView.svelte',
      { currentEmailDetail: ACCOUNT }
    );

    const chip = target.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    chip.click();
    await new Promise((r) => setTimeout(r, 0)); // flush refreshAddressAccentColor

    const menu = document.body.querySelector('[role="menu"][data-anchored-flyout]');
    expect(menu).not.toBeNull();
    expect(target.contains(menu)).toBe(false); // body portal escapes clipped view chrome
    expect(chip.getAttribute('aria-expanded')).toBe('true');

    const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? []);
    // At least the own domain + one more from the guerrilla multi-domain set.
    expect(items.length).toBeGreaterThanOrEqual(2);
    const texts = items.map((i) => i.textContent || '');
    expect(texts.some((t) => t.includes('@guerrillamail.com'))).toBe(true);
    expect(texts.some((t) => t.includes('@sharklasers.com'))).toBe(true);

    // Accent swatch: addressColors['guerrilla-1'] - shown on every item.
    // jsdom normalizes hex to rgb(), so compare against the rgb form.
    const swatches = Array.from(menu?.querySelectorAll('span[style*="background-color"]') ?? []);
    expect(swatches.length).toBe(items.length);
    const rgb = (h: string) =>
      `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(
        h.slice(5, 7),
        16
      )})`;
    expect(swatches[0]?.getAttribute('style')).toContain(rgb('#123456'));

    // Active domain is disabled; alternatives are enabled.
    const active = items.find((i) => i.textContent?.includes('@guerrillamail.com'));
    const alt = items.find((i) => i.textContent?.includes('@sharklasers.com'));
    expect((active as HTMLButtonElement).disabled).toBe(true);
    expect((alt as HTMLButtonElement).disabled).toBe(false);

    await unmountComponent(instance);
    expect(document.body.querySelector('[role="menu"][data-anchored-flyout]')).toBeNull();
  });

  test('the D shortcut opens the dropdown and Escape closes it', async () => {
    const { target, instance } = await renderComponent(
      'src/ui/views/addresses/AddressView.svelte',
      { currentEmailDetail: ACCOUNT }
    );

    const row = target.querySelector('[role="toolbar"]') as HTMLElement;
    expect(row).not.toBeNull();

    // 'D' on the focused row opens the picker.
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.querySelector('[role="menu"][data-anchored-flyout]')).not.toBeNull();

    // Escape closes it.
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.body.querySelector('[role="menu"][data-anchored-flyout]')).toBeNull();

    await unmountComponent(instance);
  });
});
