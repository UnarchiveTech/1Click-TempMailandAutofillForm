import { describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { isFillableField } from '@/entrypoints/content/autofill/fillable';

// jsdom has no layout engine, so every rect would be 0×0 - stub the rect so
// the visibility half of the guard is exercised like a real browser.
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://example.test/',
});
const w = dom.window;
Object.assign(globalThis, {
  window: w,
  document: w.document,
  HTMLInputElement: w.HTMLInputElement,
  HTMLSelectElement: w.HTMLSelectElement,
  HTMLTextAreaElement: w.HTMLTextAreaElement,
  getComputedStyle: w.getComputedStyle.bind(w),
});

function visibleInput(): HTMLInputElement {
  const el = document.createElement('input');
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 100, height: 24, top: 0, left: 0 }) as DOMRect,
  });
  return el;
}

describe('isFillableField', () => {
  test('accepts a normal visible editable input', () => {
    expect(isFillableField(visibleInput())).toBe(true);
  });

  test('rejects type=hidden', () => {
    const el = visibleInput();
    el.type = 'hidden';
    expect(isFillableField(el)).toBe(false);
  });

  test('rejects disabled fields', () => {
    const el = visibleInput();
    el.disabled = true;
    expect(isFillableField(el)).toBe(false);
  });

  test('rejects readOnly fields', () => {
    const el = visibleInput();
    el.readOnly = true;
    expect(isFillableField(el)).toBe(false);
  });

  test('rejects display:none', () => {
    const el = visibleInput();
    el.style.display = 'none';
    expect(isFillableField(el)).toBe(false);
  });

  test('rejects visibility:hidden', () => {
    const el = visibleInput();
    el.style.visibility = 'hidden';
    expect(isFillableField(el)).toBe(false);
  });

  test('rejects opacity:0', () => {
    const el = visibleInput();
    el.style.opacity = '0';
    expect(isFillableField(el)).toBe(false);
  });

  test('rejects zero-size (off-screen) fields', () => {
    const el = visibleInput();
    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 0, height: 0, top: 0, left: 0 }) as DOMRect,
    });
    expect(isFillableField(el)).toBe(false);
  });

  test('accepts select and textarea when visible', () => {
    const select = document.createElement('select');
    Object.defineProperty(select, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 100, height: 24, top: 0, left: 0 }) as DOMRect,
    });
    const textarea = document.createElement('textarea');
    Object.defineProperty(textarea, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 100, height: 24, top: 0, left: 0 }) as DOMRect,
    });
    expect(isFillableField(select)).toBe(true);
    expect(isFillableField(textarea)).toBe(true);
  });

  test('rejects detached elements (no layout)', () => {
    // Without the stubbed rect, jsdom reports 0×0 - same as a real
    // display:none/off-screen element.
    const el = document.createElement('input');
    expect(isFillableField(el)).toBe(false);
  });
});
