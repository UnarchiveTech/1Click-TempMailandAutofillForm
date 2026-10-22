/**
 * DOM-level tests for ProviderPill via the Svelte component harness.
 *
 * These complement the pure-function tests in provider-instance.test.ts: they
 * mount the real component in jsdom and assert what actually renders - the
 * pill text, the bracket suffix, the title attribute, and the guarded favicon
 * fetch URL. FaviconImage only renders cached data URLs, never a remote <img>.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// FaviconImage touches browser.storage in an effect - stub it before the
// harness compiles/imports any component. Scoped to this file's process.
const storage: Record<string, unknown> = {};
const faviconRequests: string[] = [];
const fakeBrowser = {
  runtime: {
    id: 'test-ext',
    sendMessage: async (message: { type?: string; url?: string }) => {
      if (message.type === 'fetchFavicon' && message.url) faviconRequests.push(message.url);
      return { success: false };
    },
  },
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
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

const { renderComponent, cleanupDom } = await import('../../helpers/svelte-harness.js');

describe('ProviderPill (DOM)', () => {
  beforeEach(() => {
    cleanupDom();
    faviconRequests.length = 0;
  });

  test('renders the provider name with the instance display name in brackets', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/ProviderPill.svelte', {
      provider: 'burner',
      instanceUrl: 'https://alphac.qzz.io/api/v2',
    });

    expect(target.textContent).toContain('Burner.kiwi');
    expect(target.textContent).toContain('(Alphac)');
    expect(target.querySelector('span')?.getAttribute('title')).toBe('Burner.kiwi (Alphac)');
  });

  test('own-instance and no-instance providers render without a bracket', async () => {
    const own = await renderComponent('src/ui/components/primitives/ProviderPill.svelte', {
      provider: 'burner',
      instanceUrl: 'https://burner.kiwi/api/v2',
    });
    expect(own.target.textContent).toContain('Burner.kiwi');
    expect(own.target.textContent).not.toContain('(');
    expect(own.target.querySelector('span')?.getAttribute('title')).toBe('Burner.kiwi');

    const plain = await renderComponent('src/ui/components/primitives/ProviderPill.svelte', {
      provider: 'guerrilla',
    });
    expect(plain.target.textContent).toContain('Guerrilla Mail');
    expect(plain.target.textContent).not.toContain('(');
  });

  test('favicon fetch uses the instance host and keeps the fallback when fetch fails', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/ProviderPill.svelte', {
      provider: 'burner',
      instanceUrl: 'https://alphac.qzz.io/api/v2',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(faviconRequests).toContain('https://alphac.qzz.io/favicon.ico');
    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).toContain('Burner.kiwi');
  });

  test('favicon fetch falls back to websiteUrl, not the raw provider id', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/ProviderPill.svelte', {
      provider: 'guerrilla',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(faviconRequests).toContain('https://guerrillamail.com/favicon.ico');
    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).toContain('Guerrilla Mail');
  });
});
