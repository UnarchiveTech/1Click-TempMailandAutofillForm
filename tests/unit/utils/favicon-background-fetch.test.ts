import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

const sentMessages: unknown[] = [];
const storageStore: Record<string, unknown> = {};

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...storageStore };
          const keyArr = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            keyArr.filter((key) => key in storageStore).map((key) => [key, storageStore[key]])
          );
        },
        set: async (items: Record<string, unknown>) => Object.assign(storageStore, items),
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storageStore[key];
        },
        getBytesInUse: async () => 0,
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      sendMessage: async (message: unknown) => {
        sentMessages.push(message);
        return {
          success: true,
          base64: 'ZmF2aWNvbg==',
          contentType: 'image/png',
          hash: 'safe-hash',
        };
      },
    },
  },
}));

const { fetchFaviconViaBackground } = await import('@/utils/ui/favicon');

beforeEach(() => {
  sentMessages.length = 0;
  for (const key of Object.keys(storageStore)) delete storageStore[key];
});

afterAll(() => mock.restore());

describe('fetchFaviconViaBackground', () => {
  test('routes remote favicon requests through the background validation handler', async () => {
    const result = await fetchFaviconViaBackground('https://sender.example/favicon.ico');

    expect(sentMessages).toEqual([
      { type: 'fetchFavicon', url: 'https://sender.example/favicon.ico' },
    ]);
    expect(result?.dataUrl).toBe('data:image/png;base64,ZmF2aWNvbg==');
  });
});
