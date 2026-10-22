import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';

const visits: string[] = [];
mock.module('@/features/analytics/visit-tracker.js', () => ({
  trackVisit: async (viewId: string) => {
    visits.push(viewId);
  },
}));

const { observeDialogVisits } = await import('@/features/analytics/dialog-visit-observer.js');

const globalNames = ['window', 'document', 'Element', 'MutationObserver'] as const;
const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
for (const name of globalNames) {
  savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
}

let dom: JSDOM | null = null;
let stopObserving: (() => void) | null = null;
let nextFrameId = 1;
const frames = new Map<number, FrameRequestCallback>();

function flushAnimationFrames(): void {
  const callbacks = Array.from(frames.values());
  frames.clear();
  for (const callback of callbacks) callback(0);
}

async function flushMutationObservers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  visits.length = 0;
  frames.clear();
  nextFrameId = 1;
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.com/',
  });
  const window = dom.window;
  window.requestAnimationFrame = (callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: window },
    document: { configurable: true, writable: true, value: window.document },
    Element: { configurable: true, writable: true, value: window.Element },
    MutationObserver: { configurable: true, writable: true, value: window.MutationObserver },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ width: 100, height: 40 }],
  });
  stopObserving = observeDialogVisits();
});

afterEach(() => {
  stopObserving?.();
  stopObserving = null;
  dom?.window.close();
  dom = null;
});

afterAll(() => {
  mock.restore();
  for (const name of globalNames) {
    const descriptor = savedGlobals.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('observeDialogVisits', () => {
  test('does not count a dialog portal move as a close and reopen', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-activity-dialog-key', 'dialog:confirm');
    document.body.appendChild(dialog);
    await flushMutationObservers();
    flushAnimationFrames();
    await Promise.resolve();
    expect(visits).toEqual(['dialog:confirm']);

    const temporaryParent = document.createElement('div');
    document.body.appendChild(temporaryParent);
    dialog.remove();
    temporaryParent.appendChild(dialog);
    document.body.appendChild(dialog);
    temporaryParent.remove();
    await flushMutationObservers();
    flushAnimationFrames();
    await Promise.resolve();

    expect(visits).toEqual(['dialog:confirm']);

    dialog.remove();
    await flushMutationObservers();
    flushAnimationFrames();
    expect(visits).toEqual(['dialog:confirm']);

    document.body.appendChild(dialog);
    await flushMutationObservers();
    flushAnimationFrames();
    await Promise.resolve();

    expect(visits).toEqual(['dialog:confirm', 'dialog:confirm']);
  });
});
