import { afterAll, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';

const reads: Array<{
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
}> = [];
const browserMock = {
  storage: {
    local: {
      get: (keys: string | string[]) => {
        if (!(Array.isArray(keys) ? keys : [keys]).includes('emailBodyZoom')) {
          return Promise.resolve({});
        }
        return new Promise<Record<string, unknown>>((resolve, reject) => {
          reads.push({ resolve, reject });
        });
      },
      set: async () => {},
    },
  },
};
mock.module('wxt/browser', () => ({ browser: browserMock }));
afterAll(() => mock.restore());

const { ensureDefaultEmailBodyZoomLoaded, getDefaultEmailBodyZoom, stepEmailBodyZoom } =
  await import('@/utils/email/email-body-zoom.js');

describe('email body zoom preference loading', () => {
  test('retries a failed read, coalesces pending reads and preserves a newer gesture', async () => {
    const failed = ensureDefaultEmailBodyZoomLoaded();
    reads[0].reject(new Error('Transient read failure'));
    expect(await failed).toBe(1);

    const first = ensureDefaultEmailBodyZoomLoaded();
    const second = ensureDefaultEmailBodyZoomLoaded();
    expect(reads).toHaveLength(2);
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    const dom = new JSDOM('<div></div>');
    try {
      const host = dom.window.document.createElement('div');
      expect(stepEmailBodyZoom(host, 1)).toBe(1.1);
      reads[1].resolve({ emailBodyZoom: 2 });
      expect(await first).toBe(1.1);
      expect(await second).toBe(1.1);
      expect(getDefaultEmailBodyZoom()).toBe(1.1);
      expect(await ensureDefaultEmailBodyZoomLoaded()).toBe(1.1);
      expect(reads).toHaveLength(2);
    } finally {
      dom.window.close();
    }
  });
});
