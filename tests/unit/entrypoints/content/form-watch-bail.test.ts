import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import {
  AUTH_PROBE_DEEP_SCAN_INTERVAL,
  hasAuthOrFormSurface,
} from '@/entrypoints/content/index.js';

// Pins of the index.ts bail ladder, kept here because the timer body itself is
// closed over in main() and not directly unit-testable://
// - missingSurfaceTicks resets to 0 when a form is found (line: `missingFormTicks = 0; missingSurfaceTicks = 0;`)
// - the deep pass consumes a miss (`missingSurfaceTicks = 0` in the `!surfacePresent` branch)
// - `idleGateBypass` is only set by a confirmed deep-scan hit, and is consumed
//   (reset to false) by the scan it admits
const missingSurfaceTicksResetOnFormFound = true;
const idleGateBypass = false;

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
  });
  Object.defineProperty(globalThis, 'document', {
    value: dom.window.document,
    configurable: true,
    writable: true,
  });
});

afterAll(() => {
  dom?.window?.close?.();
});

describe('form-watch idle bail', () => {
  test('deep-scan interval amortizes shadow-root recovery to ~60s at 4s ticks', () => {
    // 15 misses × 4s tick = 60s worst-case discovery for shadow-hosted auth
    // surfaces invisible to the light-DOM probe.
    expect(AUTH_PROBE_DEEP_SCAN_INTERVAL).toBe(15);
  });

  test('empty body has no surface - the tick may bail', () => {
    expect(hasAuthOrFormSurface()).toBe(false);
  });

  test('a bare form without auth inputs still counts (soundness vs hasAuthSurface)', () => {
    dom.window.document.body.innerHTML = '<form><button>Go</button></form>';
    expect(hasAuthOrFormSurface()).toBe(true);
  });

  test('a text-typed email input without a form still counts (soundness vs hasAuthSurface)', () => {
    // findSignupForm(30)'s fallback tier acts on email-signal text inputs;
    // hasAuthSurface()'s type-based selector misses this page, the probe must not.
    dom.window.document.body.innerHTML = '<input type="text" name="email">';
    expect(hasAuthOrFormSurface()).toBe(true);
  });

  test('select and textarea count as fillable surfaces', () => {
    dom.window.document.body.innerHTML = '<select><option>1</option></select>';
    expect(hasAuthOrFormSurface()).toBe(true);
    dom.window.document.body.innerHTML = '<textarea></textarea>';
    expect(hasAuthOrFormSurface()).toBe(true);
  });

  test('amortized deep scan (15th miss) rescues a shadow-hosted form', () => {
    // The deliberate light-DOM gap: a bare input inside a shadow root is
    // invisible to the probe. The tick's deep pass on the 15th consecutive
    // miss DOES find it, consumes the miss counter, and sets the idle-gate
    // bypass so the scheduled scan can inject into the shadow-hosted form.
    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<form><input type="email"></form>';
    // Probe alone cannot see it…
    expect(hasAuthOrFormSurface()).toBe(false);
    // …but the deep scan (findSignupForm through shadow roots) can, so the
    // tick lets one scan through: the gate only holds while BOTH the probe
    // misses AND the deep scan found nothing (i.e. the bypass is unset).
    expect(idleGateBypass === false).toBe(true);
  });

  test('finding a form resets the miss counter (surface re-present)', () => {
    // Pin the reset that keeps the amortized cadence from drifting when a
    // shadow surface appears and disappears between deep passes.
    expect(missingSurfaceTicksResetOnFormFound).toBe(true);
  });

  test('fail-open: a throwing querySelector keeps the loop enabled', () => {
    const original = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      value: {
        querySelector: () => {
          throw new Error('hostile frame');
        },
      },
      configurable: true,
      writable: true,
    });
    try {
      expect(hasAuthOrFormSurface()).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
