import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { writable } from 'svelte/store';

afterAll(() => {
  mock.restore();
});
mock.module('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-extension' },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  },
}));
type Request = { email: string; resolve: () => void; reject: (error: Error) => void };
const requests: Request[] = [];
mock.module('qrcode', () => ({
  toCanvas: (canvas: HTMLCanvasElement, email: string) => {
    canvas.dataset.qrEmail = email;
    return new Promise<void>((resolve, reject) => {
      requests.push({ email, resolve, reject });
    });
  },
}));

await import('@/utils/i18n/i18n.js');
const { waitLocale } = await import('svelte-i18n');
await waitLocale();
const { setupDom, renderComponent, unmountComponent, cleanupDom } = await import(
  '../../helpers/svelte-harness.js'
);
setupDom();
const drawn: string[] = [];
const canvasPrototype = Object.getPrototypeOf(document.createElement('canvas'));
const originalContext = Object.getOwnPropertyDescriptor(canvasPrototype, 'getContext');
Object.defineProperty(canvasPrototype, 'getContext', {
  configurable: true,
  value: () => ({
    drawImage: (canvas: HTMLCanvasElement) => {
      drawn.push(canvas.dataset.qrEmail || '');
    },
  }),
});
afterAll(() => {
  if (originalContext) Object.defineProperty(canvasPrototype, 'getContext', originalContext);
});

let mounted: unknown;
afterEach(async () => {
  if (mounted) await unmountComponent(mounted);
  mounted = undefined;
  requests.length = 0;
  drawn.length = 0;
  cleanupDom();
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const buttons = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('#button-qr-download, #button-qr-copy-image')
  );
async function open() {
  const scenario = writable({ open: true, email: 'first@example.test' });
  const download = mock(() => {});
  const copy = mock(() => {});
  const component = await renderComponent('tests/unit/fixtures/qr-generation-harness.svelte', {
    scenario,
    onDownload: download,
    onCopyImage: copy,
  });
  mounted = component.instance;
  await settle();
  return { scenario, download, copy };
}

describe('QR export readiness and generation ownership', () => {
  test('export is disabled until the current QR succeeds', async () => {
    const { download, copy } = await open();
    expect(requests).toHaveLength(1);
    expect(buttons()).toHaveLength(2);
    expect(buttons().every((button) => button.disabled)).toBe(true);
    buttons().forEach((button) => {
      button.click();
    });
    expect(download).not.toHaveBeenCalled();
    requests[0]?.resolve();
    await settle();
    expect(buttons().every((button) => !button.disabled)).toBe(true);
    buttons().forEach((button) => {
      button.click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  test('failed generation shows an error and cannot export a blank canvas', async () => {
    const { download, copy } = await open();
    requests[0]?.reject(new Error('encoder failure'));
    await settle();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(buttons().every((button) => button.disabled)).toBe(true);
    buttons().forEach((button) => {
      button.click();
    });
    expect(download).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(drawn).toEqual([]);
  });

  test('a slower old address cannot overwrite a newer successful QR', async () => {
    const { scenario } = await open();
    scenario.set({ open: true, email: 'second@example.test' });
    await settle();
    expect(requests).toHaveLength(2);
    requests[1]?.resolve();
    await settle();
    requests[0]?.resolve();
    await settle();
    expect(drawn).toEqual(['second@example.test']);
    expect(buttons().every((button) => !button.disabled)).toBe(true);
  });

  test('closing invalidates pending rendering', async () => {
    const { scenario } = await open();
    scenario.update((value) => ({ ...value, open: false }));
    await settle();
    requests[0]?.resolve();
    await settle();
    expect(drawn).toEqual([]);
  });
});
