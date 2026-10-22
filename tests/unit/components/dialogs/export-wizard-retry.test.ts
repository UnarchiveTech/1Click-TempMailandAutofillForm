import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';

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
        const requested = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(
          requested.filter((key) => key in storage).map((key) => [key, storage[key]])
        );
      },
      set: async (items: Record<string, unknown>) => Object.assign(storage, items),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
      },
    },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));

await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();
const { cleanupDom, renderComponent, unmountComponent } = await import(
  '../../helpers/svelte-harness.js'
);

afterEach(() => cleanupDom());

describe('ExportWizardDialog failure recovery', () => {
  test('offers retry in place and reruns the selected export', async () => {
    let attempts = 0;
    const { instance } = await renderComponent('src/ui/blocks/dialogs/ExportWizardDialog.svelte', {
      open: true,
      onExecuteExport: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary export failure');
      },
    });

    try {
      expect(document.body.textContent).toContain('Export file');
      const exportButton = [...document.body.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Export file')
      );
      expect(exportButton).not.toBeUndefined();
      exportButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const retryButton = [...document.body.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Retry')
      );
      expect(retryButton).not.toBeUndefined();
      retryButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 220));

      expect(attempts).toBe(2);
      expect(document.body.textContent).toContain('Export complete');
    } finally {
      await unmountComponent(instance);
    }
  });
});
