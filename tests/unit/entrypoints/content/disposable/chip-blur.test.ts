import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';

type BridgeMessage = Record<string, unknown>;

let dom: JSDOM | null = null;
let shadowRoot: ShadowRoot | null = null;
const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
const storage: Record<string, unknown> = {
  activeAddressId: 'active-1',
  addresses: [{ id: 'active-1', address: 'alias@temporary.example', accountStatus: 'active' }],
  dismissedDisposableDomains: {},
  preferredDisposableDomains: [],
};

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: async (message: BridgeMessage) => {
        if (message.type === 'getStorageViaBg') {
          const keys = Array.isArray(message.keys) ? message.keys : [message.keys];
          return {
            success: true,
            data: Object.fromEntries(
              keys
                .filter((key): key is string => typeof key === 'string' && key in storage)
                .map((key) => [key, storage[key]])
            ),
          };
        }
        if (message.type === 'translate') return { success: false };
        return { success: true };
      },
    },
  },
}));
mock.module('@/entrypoints/content/dom/shadow-dom.js', () => ({
  getOrCreateShadowRoot: () => shadowRoot,
}));

const { attachDisposableHint } = await import(
  '@/entrypoints/content/disposable/disposable-detector.js'
);

beforeEach(() => {
  dom?.window.close();
  const nextDom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.com/signup',
  });
  dom = nextDom;
  for (const key of [
    'window',
    'document',
    'location',
    'Event',
    'HTMLInputElement',
    'MouseEvent',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    if (!originalGlobals.has(key)) {
      originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    }
    let value: unknown;
    switch (key) {
      case 'getComputedStyle':
        value = nextDom.window.getComputedStyle.bind(nextDom.window);
        break;
      case 'requestAnimationFrame':
        value = nextDom.window.requestAnimationFrame.bind(nextDom.window);
        break;
      case 'cancelAnimationFrame':
        value = nextDom.window.cancelAnimationFrame.bind(nextDom.window);
        break;
      default:
        value = nextDom.window[key as keyof typeof nextDom.window];
    }
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  shadowRoot = host.attachShadow({ mode: 'open' });
});

afterAll(() => {
  dom?.window.close();
  mock.restore();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

describe('disposable suggestion press', () => {
  test('prevents default focus change so a long press does not trigger blur-hide', async () => {
    const field = document.createElement('input');
    field.type = 'email';
    field.value = 'person@gmail.com';
    document.body.appendChild(field);
    const positionCleanups: Array<() => void> = [];
    const tracker = attachDisposableHint(field, positionCleanups);
    expect(tracker).not.toBeNull();

    try {
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const chip = shadowRoot?.querySelector<HTMLElement>('.disposable-suggest-chip');
      expect(chip).not.toBeNull();

      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      chip?.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
    } finally {
      tracker?.cleanup();
      for (const cleanup of positionCleanups) cleanup();
    }
  });
});
