import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { isVerificationPage } from '@/entrypoints/content/otp/wait-otp-panel.js';

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/signup',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  for (const key of [
    'window',
    'document',
    'navigator',
    'getComputedStyle',
    'Document',
    'HTMLElement',
    'HTMLInputElement',
    'Element',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: window[key],
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () =>
      ({
        width: 240,
        height: 32,
        top: 0,
        left: 0,
        right: 240,
        bottom: 32,
      }) as DOMRect,
  });
});

afterAll(() => {
  dom.window.close();
});

describe('verification-page detection', () => {
  test('does not treat signup copy as an active OTP step', () => {
    document.body.innerHTML = `
      <h2>Enter your details - verification code will be sent after signup</h2>
      <input type="email" autocomplete="email" />
      <input type="password" autocomplete="new-password" />
    `;

    expect(isVerificationPage(document)).toBe(false);
  });

  test('recognizes a visible one-time-code field', () => {
    document.body.innerHTML = `
      <h2>Enter verification code</h2>
      <input autocomplete="one-time-code" />
    `;

    expect(isVerificationPage(document)).toBe(true);
  });

  test('ignores hidden verification inputs', () => {
    document.body.innerHTML = `
      <h2>Join our community</h2>
      <input type="hidden" name="verification_token" />
      <input type="email" autocomplete="email" />
    `;

    expect(isVerificationPage(document)).toBe(false);
  });
});
