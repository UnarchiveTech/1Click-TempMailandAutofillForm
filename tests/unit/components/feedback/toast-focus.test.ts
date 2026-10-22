import { afterAll, expect, mock, test } from 'bun:test';
import { cleanupDom, renderComponent, unmountComponent } from '../../helpers/svelte-harness.js';

afterAll(() => mock.restore());
mock.module('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-extension' },
    storage: {
      local: { get: async () => ({}) },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  },
}));
mock.module('@/utils/logger.js', () => ({
  logError: () => {},
  logWarn: () => {},
  logInfo: () => {},
  logDebug: () => {},
  log: () => {},
}));
await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();
const { toastStore } = await import('@/utils/ui/toastStore.js');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('real toast focus protects Undo against stack eviction and releases protection on blur', async () => {
  toastStore.clear();
  const { instance } = await renderComponent('src/ui/blocks/feedback/ToastContainer.svelte');
  try {
    const id = toastStore.success('Archived', 8000, () => {});
    await flush();
    const undo = document.querySelector<HTMLButtonElement>('[aria-label="Undo"]');
    expect(undo).not.toBeNull();
    undo?.focus();
    expect(document.activeElement).toBe(undo);
    await flush();
    for (let i = 0; i < 5; i++) toastStore.info(`Incoming ${i}`);
    await flush();
    expect(undo?.isConnected).toBe(true);
    expect(document.activeElement).toBe(undo);
    let currentIds: string[] = [];
    const unsubscribe = toastStore.subscribe((toasts) => {
      currentIds = toasts.map((toast) => toast.id);
    });
    expect(currentIds).toHaveLength(3);
    expect(currentIds).toContain(id);
    undo?.blur();
    toastStore.info('Incoming after blur');
    expect(currentIds).not.toContain(id);
    unsubscribe();
  } finally {
    await unmountComponent(instance);
    toastStore.clear();
    cleanupDom();
  }
});
