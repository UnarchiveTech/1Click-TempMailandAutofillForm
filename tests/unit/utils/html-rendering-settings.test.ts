import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

afterAll(() => mock.restore());

type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners: ChangeListener[] = [];
let stored: unknown;
let read: () => Promise<{ htmlRenderingSettings?: unknown }> = async () => ({
  htmlRenderingSettings: stored,
});
let rejectWrite = false;

mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: { get: () => read() },
      onChanged: { addListener: (listener: ChangeListener) => listeners.push(listener) },
    },
  },
}));
mock.module('@/utils/logger.js', () => ({ logError: () => {} }));
mock.module('@/utils/storage/storage-write.js', () => ({
  writeWithRetry: async (values: { htmlRenderingSettings: unknown }) => {
    if (rejectWrite) throw new Error('write failed');
    stored = values.htmlRenderingSettings;
  },
}));

const { DEFAULT_HTML_RENDERING_SETTINGS, loadHtmlRenderingSettings, saveHtmlRenderingSettings } =
  await import('@/utils/email/sanitize-html.js');

function change(value: unknown, area = 'local') {
  for (const listener of listeners) listener({ htmlRenderingSettings: { newValue: value } }, area);
}

beforeEach(async () => {
  stored = undefined;
  rejectWrite = false;
  read = async () => ({ htmlRenderingSettings: stored });
  await loadHtmlRenderingSettings();
});

describe('HTML rendering preferences', () => {
  test('missing settings restore safe defaults instead of the previous opt-ins', async () => {
    await saveHtmlRenderingSettings({
      ...DEFAULT_HTML_RENDERING_SETTINGS,
      img: true,
      iframe: true,
    });
    stored = undefined;
    expect(await loadHtmlRenderingSettings()).toEqual(DEFAULT_HTML_RENDERING_SETTINGS);
    expect(listeners).toHaveLength(1);
  });

  test('a newer cross-window update wins over a delayed storage read', async () => {
    let finish: ((value: { htmlRenderingSettings: unknown }) => void) | undefined;
    read = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const loading = loadHtmlRenderingSettings();
    change({ style: false, img: 'true', iframe: null });
    finish?.({ htmlRenderingSettings: { style: true, img: true } });
    expect(await loading).toEqual({ ...DEFAULT_HTML_RENDERING_SETTINGS, style: false });
  });

  test('removing preferences immediately resets the mirror and ignores session events', async () => {
    change({ img: true });
    read = async () => {
      throw new Error('read unavailable');
    };
    expect((await loadHtmlRenderingSettings()).img).toBe(true);
    change(undefined, 'session');
    expect((await loadHtmlRenderingSettings()).img).toBe(true);
    change(undefined);
    expect(await loadHtmlRenderingSettings()).toEqual(DEFAULT_HTML_RENDERING_SETTINGS);
  });

  test('failed saves reject so the caller can roll back, preserving effective settings', async () => {
    rejectWrite = true;
    await expect(
      saveHtmlRenderingSettings({ ...DEFAULT_HTML_RENDERING_SETTINGS, iframe: true })
    ).rejects.toThrow('write failed');
    read = async () => {
      throw new Error('read unavailable');
    };
    expect(await loadHtmlRenderingSettings()).toEqual(DEFAULT_HTML_RENDERING_SETTINGS);
  });
});
