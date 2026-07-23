// biome-ignore-all lint/suspicious/noExplicitAny: mock browser globals
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { copyToClipboardAndSchedulePurge } from '@/utils/clipboard.js';

describe('clipboard helper', () => {
  let originalClipboard: any;
  let writeTextMock: any;

  beforeAll(() => {
    originalClipboard = (global as any).navigator?.clipboard;
    writeTextMock = mock(() => Promise.resolve());
    if (!(global as any).navigator) {
      (global as any).navigator = {};
    }
    (global as any).navigator.clipboard = {
      writeText: writeTextMock,
    };
  });

  afterAll(() => {
    if (originalClipboard) {
      (global as any).navigator.clipboard = originalClipboard;
    } else {
      delete (global as any).navigator.clipboard;
    }
  });

  test('successfully writes text to the clipboard and clears it after the timeout', async () => {
    writeTextMock.mockClear();
    const success = await copyToClipboardAndSchedulePurge('verification-code', 100);
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('verification-code');

    // Wait for the purge timer to execute
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(writeTextMock).toHaveBeenCalledWith('');
  });
});
