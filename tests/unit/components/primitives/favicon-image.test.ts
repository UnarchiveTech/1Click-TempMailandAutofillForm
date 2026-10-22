/**
 * DOM-level regression tests for the FaviconImage anti-flash fix.
 *
 * Bug: the component resolved the cached favicon through async
 * browser.storage.local reads inside its $effect, so the letter Avatar always
 * painted first and swapped to the favicon a frame+ later - a visible
 * avatar→favicon flash on every mailbox open.
 *
 * Fix under test: a warm in-memory mirror (favicon.ts) lets the component
 * resolve a cached icon SYNCHRONOUSLY, and for cached icons the letter avatar
 * is not rendered at all (data: URLs are instant or broken - a placeholder
 * behind them only re-introduces a flash). Uncached network chains must keep
 * showing the letter avatar while the img loads.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// FaviconImage + the real favicon.ts touch browser.storage in module scope and
// effects - stub before the harness compiles/imports anything.
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
      remove: async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete storage[k];
      },
      getBytesInUse: async () => 0,
    },
    onChanged: { addListener: () => {} },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

const { renderComponent, cleanupDom } = await import('../../helpers/svelte-harness.js');

// Import the favicon module through the SAME resolution the compiled component
// uses (the harness rewrites `@/utils/ui/favicon.js` to this file URL), so the
// mirror warmed here is the very instance the component reads.
const ROOT = resolve(import.meta.dirname, '../../../..');
const faviconUrl = pathToFileURL(join(ROOT, 'src/utils/ui/favicon.js')).href;
const favicon = (await import(faviconUrl)) as typeof import('@/utils/ui/favicon');

const DATA_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

beforeEach(() => {
  cleanupDom();
  for (const k of Object.keys(storage)) delete storage[k];
  favicon.__resetFaviconMemoryMirrorForTests();
});

describe('FaviconImage (DOM, anti-flash)', () => {
  test('cached favicon: img mounts with NO letter avatar behind it (no flash)', async () => {
    storage[favicon.FAVICON_CACHE_KEY] = {
      'cached.test': { timestamp: Date.now(), url: DATA_ICON },
    };
    await favicon.warmFaviconMemoryMirror();

    const { target } = await renderComponent('src/ui/components/primitives/FaviconImage.svelte', {
      email: 'someone@cached.test',
      size: 32,
    });

    const img = target.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(DATA_ICON);
    expect(img?.classList.contains('opacity-0')).toBe(false);
    // The regression: a letter Avatar (shell div + span) must not render
    // underneath/before the cached icon - that is the visible flash.
    expect(target.querySelector('span')).toBeNull();
  });

  test('uncached domain: letter avatar still shows while the network chain runs', async () => {
    const { target } = await renderComponent('src/ui/components/primitives/FaviconImage.svelte', {
      email: 'someone@cold.test',
      size: 32,
    });

    // No cache anywhere → component falls through to the network chain and
    // keeps the letter avatar visible until something loads.
    expect(target.querySelector('span')).not.toBeNull();
    expect(target.textContent).toContain('?');
  });

  test('cached icon still wins after the mirror warms mid-session (write coherence)', async () => {
    // Component renders cold first - mirror empty.
    const first = await renderComponent('src/ui/components/primitives/FaviconImage.svelte', {
      email: 'late.test',
      domain: 'late.test',
      size: 32,
    });
    expect(first.target.querySelector('span')).not.toBeNull();

    // A fetch success lands (as the background chain would) → mirror updated.
    await favicon.setFaviconCacheSuccess('late.test', DATA_ICON);

    const second = await renderComponent('src/ui/components/primitives/FaviconImage.svelte', {
      email: 'late.test',
      domain: 'late.test',
      size: 32,
    });
    const img = second.target.querySelector('img');
    expect(img?.getAttribute('src')).toBe(DATA_ICON);
    expect(second.target.querySelector('span')).toBeNull();
  });

  test('favourites=false (enabled=false): letter avatar only, no img ever', async () => {
    storage[favicon.FAVICON_CACHE_KEY] = {
      'disabled.test': { timestamp: Date.now(), url: DATA_ICON },
    };
    await favicon.warmFaviconMemoryMirror();

    const { target } = await renderComponent('src/ui/components/primitives/FaviconImage.svelte', {
      email: 'someone@disabled.test',
      enabled: false,
      size: 32,
    });

    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('span')).not.toBeNull();
  });
});
