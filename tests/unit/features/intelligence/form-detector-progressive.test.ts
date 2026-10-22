import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { findSignupForm } from '@/entrypoints/content/autofill/form-detector.js';

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.canva.com/en_in/signup/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const windowKeys = [
    'window',
    'document',
    'navigator',
    'getComputedStyle',
    'DOMRect',
    'Document',
    'ShadowRoot',
    'Element',
    'HTMLElement',
    'HTMLFormElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'HTMLIFrameElement',
    'Node',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'InputEvent',
    'FocusEvent',
    'CustomEvent',
    'MutationObserver',
    'CSS',
  ] as const;
  for (const key of windowKeys) {
    Object.defineProperty(globalThis, key, {
      value: window[key],
      configurable: true,
      writable: true,
    });
  }
  // Give every element a realistically-sized box (progressive container
  // detection requires height > 40 and width within the viewport).
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 240,
    bottom: 300,
    width: 240,
    height: 300,
  } as DOMRect;
  Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  });
});

afterAll(() => {
  dom.window.close();
});

describe('progressive auth step detection (formless React SPA, Canva-style)', () => {
  test('detects an email step labelled only via aria-labelledby', async () => {
    document.body.innerHTML = `
      <div class="card">
        <h1 id="email-question">What's your email?</h1>
        <input type="text" aria-labelledby="email-question" />
        <button>Continue</button>
      </div>
    `;
    const form = await findSignupForm(30);
    expect(form).not.toBeNull();
  });

  test('detects an email step labelled only via a for-linked label', async () => {
    document.body.innerHTML = `
      <div class="card">
        <label for="email">Email</label>
        <input id="email" type="text" />
        <button>Continue</button>
      </div>
    `;
    const form = await findSignupForm(30);
    expect(form).not.toBeNull();
  });

  test('detects a password-only step without a <form> element', async () => {
    document.body.innerHTML = `
      <div class="card">
        <h1>Create a password</h1>
        <input type="password" autocomplete="new-password" />
        <button>Continue</button>
      </div>
    `;
    const form = await findSignupForm(30);
    expect(form).not.toBeNull();
  });

  test('detects an email step whose only signal is autocomplete', async () => {
    document.body.innerHTML = `
      <div class="card">
        <h1>What's your email?</h1>
        <input type="text" autocomplete="email" />
        <button>Continue</button>
      </div>
    `;
    const form = await findSignupForm(30);
    expect(form).not.toBeNull();
  });

  test('does NOT seed a formless login password step (enter, not create)', async () => {
    document.body.innerHTML = `
      <div class="card">
        <h1>Welcome back</h1>
        <input type="password" autocomplete="current-password" />
        <button>Sign in</button>
      </div>
    `;
    const form = await findSignupForm(30);
    expect(form).toBeNull();
  });
});
