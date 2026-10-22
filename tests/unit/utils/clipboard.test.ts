import { afterAll, beforeAll, describe, expect, type Mock, mock, test } from 'bun:test';
import {
  copyToClipboardAndSchedulePurge,
  copyToClipboardFromBackground,
} from '@/utils/clipboard/clipboard.js';

/**
 * `navigator.clipboard` is absent in the test runtime, so these tests swap in a
 * minimal typed stub and restore whatever was installed before.
 */
type ClipboardLike = {
  writeText: (text: string) => Promise<void>;
  /** Only the background-copy path needs `readText`. */
  readText?: () => Promise<string>;
};
type ClipboardHost = { navigator?: { clipboard?: ClipboardLike } };

const clipboardHost = globalThis as unknown as ClipboardHost;

function installClipboard(clipboard: ClipboardLike): void {
  const nav = clipboardHost.navigator;
  if (nav) nav.clipboard = clipboard;
  else clipboardHost.navigator = { clipboard };
}

function restoreClipboard(original: ClipboardLike | undefined): void {
  const nav = clipboardHost.navigator;
  if (!nav) return;
  if (original) nav.clipboard = original;
  else delete nav.clipboard;
}

describe('clipboard helper', () => {
  let originalClipboard: ClipboardLike | undefined;
  let writeTextMock: Mock<(text: string) => Promise<void>>;
  let readTextMock: Mock<() => Promise<string>>;

  const waitForPurgeTimer = () => new Promise((resolve) => setTimeout(resolve, 150));

  beforeAll(() => {
    originalClipboard = clipboardHost.navigator?.clipboard;
    writeTextMock = mock<(text: string) => Promise<void>>(() => Promise.resolve());
    readTextMock = mock<() => Promise<string>>(() => Promise.resolve('verification-code'));
    installClipboard({ writeText: writeTextMock, readText: readTextMock });
  });

  afterAll(() => {
    restoreClipboard(originalClipboard);
  });

  test('successfully writes text to the clipboard and clears it after the timeout when content is unchanged', async () => {
    writeTextMock.mockClear();
    readTextMock.mockClear();
    readTextMock.mockImplementation(() => Promise.resolve('verification-code'));
    const success = await copyToClipboardAndSchedulePurge('verification-code', 100);
    expect(success).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('verification-code');

    // Wait for the purge timer to execute
    await waitForPurgeTimer();

    expect(readTextMock).toHaveBeenCalled();
    expect(writeTextMock).toHaveBeenCalledWith('');
  });

  test('skips the purge when the clipboard no longer holds the copied text', async () => {
    writeTextMock.mockClear();
    readTextMock.mockClear();
    readTextMock.mockImplementation(() => Promise.resolve('user-copied-url-https://example.com'));
    await copyToClipboardAndSchedulePurge('verification-code', 100);

    await waitForPurgeTimer();

    // Verified content differs → the user's newer copy must NOT be wiped.
    expect(writeTextMock).not.toHaveBeenCalledWith('');
    expect(writeTextMock.mock.calls.filter((c) => c[0] === '')).toHaveLength(0);
  });

  test('skips the purge when the clipboard cannot be read (no focus / permission)', async () => {
    writeTextMock.mockClear();
    readTextMock.mockClear();
    readTextMock.mockImplementation(() => Promise.reject(new Error('Not allowed')));
    await copyToClipboardAndSchedulePurge('verification-code', 100);

    await waitForPurgeTimer();

    expect(writeTextMock.mock.calls.filter((c) => c[0] === '')).toHaveLength(0);
  });
});

describe('copyToClipboardFromBackground (service worker)', () => {
  let originalClipboard: ClipboardLike | undefined;
  let writeTextMock: Mock<(text: string) => Promise<void>>;

  beforeAll(() => {
    originalClipboard = clipboardHost.navigator?.clipboard;
    writeTextMock = mock<(text: string) => Promise<void>>(() => Promise.resolve());
    installClipboard({ writeText: writeTextMock });
  });

  afterAll(() => {
    restoreClipboard(originalClipboard);
  });

  test('copies via the direct path when the Clipboard API is available', async () => {
    writeTextMock.mockClear();
    writeTextMock.mockImplementation(() => Promise.resolve());
    const ok = await copyToClipboardFromBackground('123456', 0);
    expect(ok).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('123456');
  });

  test('fails cleanly when the direct path rejects and no tab can be injected into', async () => {
    writeTextMock.mockClear();
    writeTextMock.mockImplementation(() => Promise.reject(new Error('Document is not focused')));
    // No `browser` global in this context → the tab-injection fallback throws
    // inside its try/catch and reports failure instead of crashing.
    const ok = await copyToClipboardFromBackground('654321', 0);
    expect(ok).toBe(false);
  });
});
