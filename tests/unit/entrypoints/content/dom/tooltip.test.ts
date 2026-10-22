import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';

let dom: JSDOM | null = null;
let shadowRoot: ShadowRoot | null = null;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalAnimationFrame = globalThis.requestAnimationFrame;

mock.module('@/entrypoints/content/dom/shadow-dom.js', () => ({
  getOrCreateShadowRoot: () => shadowRoot,
}));

const { clearInjectedFeedback, showConflictChip, showFillMicroStatus, showTooltip } = await import(
  '@/entrypoints/content/dom/tooltip.js'
);

beforeEach(() => {
  dom?.window.close();
  const nextDom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.com/',
  });
  dom = nextDom;
  Object.defineProperty(globalThis, 'window', {
    value: nextDom.window,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: nextDom.window.document,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: nextDom.window.requestAnimationFrame.bind(nextDom.window),
    configurable: true,
    writable: true,
  });
  shadowRoot = null;
  clearInjectedFeedback();
});

afterAll(() => {
  clearInjectedFeedback();
  dom?.window.close();
  mock.restore();
  Object.defineProperty(globalThis, 'window', {
    value: originalWindow,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: originalDocument,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: originalAnimationFrame,
    configurable: true,
    writable: true,
  });
});

function anchorWithRect(top: number, left = 100): HTMLElement {
  const anchor = document.createElement('input');
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + 20,
      left,
      right: left + 100,
      width: 100,
      height: 20,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  return anchor;
}

describe('content tooltip lifecycle', () => {
  test('replaces the previous tooltip and remains covered by feedback cleanup', async () => {
    const anchor = anchorWithRect(100);
    await showTooltip(anchor, 'First', false);
    await showTooltip(anchor, 'Second', false);

    const tooltips = document.querySelectorAll('[data-1click-tooltip]');
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0]?.textContent).toBe('Second');

    clearInjectedFeedback();
    expect(document.querySelectorAll('[data-1click-tooltip]')).toHaveLength(0);
  });

  test('repositions the fixed tooltip when the anchor moves during scroll', async () => {
    let top = 120;
    const anchor = anchorWithRect(top);
    anchor.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 20,
        left: 100,
        right: 200,
        width: 100,
        height: 20,
        x: 100,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    await showTooltip(anchor, 'Saved', false);
    const tooltip = document.querySelector<HTMLElement>('[data-1click-tooltip]');
    expect(tooltip).not.toBeNull();
    const previousTop = tooltip?.style.top;

    top = 240;
    const activeWindow = dom?.window;
    if (activeWindow) activeWindow.dispatchEvent(new activeWindow.Event('scroll'));

    expect(tooltip?.style.top).not.toBe(previousTop);
  });

  test('places the tooltip below an anchor near the viewport top', async () => {
    const anchor = anchorWithRect(2);
    await showTooltip(anchor, 'Saved', false);
    const tooltip = document.querySelector<HTMLElement>('[data-1click-tooltip]');
    expect(tooltip?.style.top).toBe('30px');
  });

  test('removes the tooltip when its anchor is detached', async () => {
    const anchor = anchorWithRect(120);
    await showTooltip(anchor, 'Saved', false);
    expect(document.querySelector('[data-1click-tooltip]')).not.toBeNull();

    anchor.remove();
    const activeWindow = dom?.window;
    if (activeWindow) activeWindow.dispatchEvent(new activeWindow.Event('scroll'));

    expect(document.querySelector('[data-1click-tooltip]')).toBeNull();
  });

  test('keeps conflict and fill feedback attached to a moving field', async () => {
    let top = 100;
    const anchor = anchorWithRect(top);
    anchor.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 20,
        left: 100,
        right: 200,
        width: 100,
        height: 20,
        x: 100,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    showConflictChip(anchor, 'Existing account');
    const chip = document.querySelector<HTMLElement>('[data-1click-conflict-chip]');
    expect(chip).not.toBeNull();
    const oldChipTop = chip?.style.top;

    top = 220;
    dom?.window.dispatchEvent(new (dom.window as unknown as typeof window).Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(chip?.style.top).not.toBe(oldChipTop);

    showFillMicroStatus(anchor, 'Personal · user@example.com');
    const status = document.querySelector<HTMLElement>('[data-1click-fill-status]');
    expect(status).not.toBeNull();
    const oldStatusTop = status?.style.top;

    top = 300;
    dom?.window.dispatchEvent(new (dom.window as unknown as typeof window).Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(status?.style.top).not.toBe(oldStatusTop);
  });
});
