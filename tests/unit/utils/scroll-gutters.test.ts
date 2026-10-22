import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { observeScrollGutters } from '@/utils/ui/scroll-gutters.js';

let dispose: (() => void) | undefined;
let dom: JSDOM | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  dom?.window.close();
});

function fixture(direction = 'ltr') {
  dom = new JSDOM(
    `<html dir="${direction}"><body><div class="scroll-frame"><div class="scroll-edge"></div><div class="scroll-body scroll-body-framed" style="padding-inline-end:16px; border-left:1px solid; border-right:1px solid"></div></div></body></html>`
  );
  const w = dom.window;
  let callback: FrameRequestCallback | undefined;
  let resized = () => {};
  const observed = new Set<Element>();
  Object.assign(globalThis, {
    window: w,
    document: w.document,
    MutationObserver: w.MutationObserver,
    getComputedStyle: w.getComputedStyle.bind(w),
    requestAnimationFrame: (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    },
    cancelAnimationFrame: () => {
      callback = undefined;
    },
    ResizeObserver: class {
      constructor(next: () => void) {
        resized = next;
      }
      observe(node: Element) {
        observed.add(node);
      }
      unobserve(node: Element) {
        observed.delete(node);
      }
      disconnect() {
        observed.clear();
      }
    },
  });
  const body = w.document.querySelector<HTMLElement>('.scroll-body');
  if (!body?.parentElement) throw new Error('Missing scroll fixture');
  const frame = body.parentElement;
  let width = 310;
  Object.defineProperties(body, {
    offsetWidth: { get: () => 322 },
    clientWidth: { get: () => width },
  });
  const flush = () => {
    const next = callback;
    callback = undefined;
    next?.(0);
  };
  dispose = observeScrollGutters(w.document.body);
  flush();
  return {
    body,
    frame,
    observed,
    flush,
    resize: () => resized(),
    setWidth: (next: number) => {
      width = next;
    },
  };
}

describe('visible scroll gutters', () => {
  test('shared gutters preserve horizontal insets and use adaptive vertical spacing', () => {
    const css = readFileSync(
      new URL('../../../src/styles/scroll-gutters.css', import.meta.url),
      'utf8'
    );
    expect(css).toContain('--page-content-inset: 8px');
    expect(css).toContain('--dialog-content-inset: 16px');
    expect(css).toContain('--dialog-viewport-inset: 8px');
    expect(css).toContain('padding-block: var(--dialog-block-inset, 16px)');
    expect(css).toContain('padding-inline: var(--dialog-content-inset)');
    expect(css).toContain('padding-inline: var(--page-content-inset)');
    expect(css).toContain('padding-inline: var(--dialog-viewport-inset)');
    expect(css).toContain('margin-block-start: var(--dialog-action-offset, 4px)');
  });

  for (const dir of ['ltr', 'rtl']) {
    test(`measures native space and preserves base padding (${dir})`, () => {
      const { body, frame } = fixture(dir);
      expect(body.style.getPropertyValue('--scroll-base-padding')).toBe('16px');
      expect(body.style.getPropertyValue('--scrollbar-space')).toBe('10px');
      expect(frame.style.getPropertyValue('--scroll-edge-space')).toBe('10px');
    });
  }

  test('short content / overlay scrollbars reserve no extra space', () => {
    const { body, frame, setWidth, resize, flush } = fixture();
    setWidth(320);
    resize();
    flush();
    expect(body.style.getPropertyValue('--scrollbar-space')).toBe('0px');
    expect(frame.style.getPropertyValue('--scroll-edge-space')).toBe('0px');
  });

  test('recomputes responsive padding after resize', () => {
    const { body, resize, flush } = fixture();
    body.style.paddingInlineEnd = '24px';
    resize();
    flush();
    expect(body.style.getPropertyValue('--scroll-base-padding')).toBe('24px');
  });

  test('detached bodies release their owner and resize subscription', async () => {
    const { body, frame, observed, flush } = fixture();
    body.remove();
    await Promise.resolve();
    flush();
    expect(observed.has(body)).toBe(false);
    expect(frame.style.getPropertyValue('--scroll-edge-space')).toBe('');
    expect(body.dataset.scrollBalanced).toBeUndefined();
  });

  test('teardown cancels work and clears owned variables', () => {
    const { body, frame, observed, resize, flush } = fixture();
    resize();
    dispose?.();
    dispose = undefined;
    flush();
    expect(observed.size).toBe(0);
    expect(body.style.getPropertyValue('--scrollbar-space')).toBe('');
    expect(frame.style.getPropertyValue('--scroll-edge-space')).toBe('');
  });
});
