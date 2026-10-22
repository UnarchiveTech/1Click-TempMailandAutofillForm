import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { computeOpticalCenterOffset } from '@/utils/ui/optical-center.js';

// jsdom has no layout engine and no canvas - both paths are stubbed per-test.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.test/',
});
const w = dom.window;
Object.assign(globalThis, {
  window: w,
  document: w.document,
  NodeFilter: w.NodeFilter,
  getComputedStyle: w.getComputedStyle.bind(w),
});

function makeNotch(text: string, rect: { top: number; height: number }): HTMLElement {
  const el = w.document.createElement('span');
  el.textContent = text;
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        top: rect.top,
        height: rect.height,
        width: 100,
        left: 0,
        right: 100,
        bottom: rect.top + rect.height,
      }) as DOMRect,
  });
  return el;
}

function makeBaselineNotch(text: string, top: number, baseline: number): HTMLElement {
  const el = makeNotch('', { top, height: 12 });
  const label = w.document.createElement('span');
  label.dataset.opticalText = '';
  label.textContent = text;
  const marker = w.document.createElement('span');
  marker.dataset.opticalBaseline = '';
  Object.defineProperty(marker, 'getBoundingClientRect', {
    value: () => ({ top: baseline, height: 0 }) as DOMRect,
  });
  label.append(marker);
  el.append(label);
  return el;
}

describe('computeOpticalCenterOffset', () => {
  test('returns 0 for missing element or zero-height rect', () => {
    expect(computeOpticalCenterOffset(null as unknown as HTMLElement)).toBe(0);
    const el = makeNotch('x', { top: 10, height: 0 });
    expect(computeOpticalCenterOffset(el)).toBe(0);
  });

  test('falls back to the DOM Range line-box offset when canvas is unavailable', () => {
    const el = makeNotch('abc', { top: 10, height: 40 });
    const textNode = el.firstChild as Text;

    const originalCreateRange = w.Document.prototype.createRange;
    const originalCreateTreeWalker = w.Document.prototype.createTreeWalker;
    w.Document.prototype.createRange = () =>
      ({
        selectNodeContents: () => {},
        getClientRects: () => [{ top: 12, bottom: 32, height: 20 }],
      }) as unknown as Range;
    w.Document.prototype.createTreeWalker = () => {
      let walked = false;
      return {
        nextNode: () => {
          if (walked) return null;
          walked = true;
          return textNode;
        },
      } as unknown as TreeWalker;
    };

    try {
      // elementCenterY = 10 + 40/2 = 30; text midpoint = (12 + 32) / 2 = 22 → offset 8
      expect(computeOpticalCenterOffset(el)).toBe(8);
    } finally {
      w.Document.prototype.createRange = originalCreateRange;
      w.Document.prototype.createTreeWalker = originalCreateTreeWalker;
    }
  });

  test('centers glyph ink using the rendered baseline instead of a font-size guess', () => {
    const originalGetContext = w.HTMLCanvasElement.prototype.getContext;
    w.HTMLCanvasElement.prototype.getContext = (() =>
      ({
        font: '',
        measureText: () => ({ actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }),
      }) as unknown) as typeof w.HTMLCanvasElement.prototype.getContext;

    try {
      // Label center = 16, baseline = 21, ink center = 21 + (2 - 10)/2 = 17.
      expect(computeOpticalCenterOffset(makeBaselineNotch('Expired', 10, 21))).toBe(-1);
      // Translating the label and baseline together must not accumulate offset.
      expect(computeOpticalCenterOffset(makeBaselineNotch('Expired', 110, 121))).toBe(-1);
    } finally {
      w.HTMLCanvasElement.prototype.getContext = originalGetContext;
    }
  });

  test('keeps a genuine zero offset instead of substituting the line-box fallback', () => {
    const el = makeBaselineNotch('Archived', 10, 20);
    const originalGetContext = w.HTMLCanvasElement.prototype.getContext;
    const originalCreateRange = w.Document.prototype.createRange;
    w.HTMLCanvasElement.prototype.getContext = (() => ({
      font: '',
      measureText: () => ({ actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 0 }),
    })) as unknown as typeof w.HTMLCanvasElement.prototype.getContext;
    w.Document.prototype.createRange = () =>
      ({
        selectNodeContents: () => {},
        getClientRects: () => [{ top: 10, bottom: 20, height: 10 }],
      }) as unknown as Range;
    try {
      // Element and ink both center at 16; the line-box fallback would give 1.
      expect(computeOpticalCenterOffset(el)).toBe(0);
    } finally {
      w.HTMLCanvasElement.prototype.getContext = originalGetContext;
      w.Document.prototype.createRange = originalCreateRange;
    }
  });
});
