import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import {
  armSignupOutcomeAfterSubmit,
  clickPrimaryAction,
  findPrimaryActionButton,
  hasAutoSubmitConsent,
} from '@/features/intelligence/submit-action.js';

const progress: string[] = [];
mock.module('@/utils/content/content-bg-bridge.js', () => ({
  reportSignupProgressViaBg: async (_id: string, status: string) => {
    progress.push(status);
    return true;
  },
}));

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
    'HTMLButtonElement',
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
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 40,
    width: 200,
    height: 40,
  } as DOMRect;
  Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  });
});

afterAll(() => {
  mock.restore();
  dom.window.close();
});

function pickedLabel(step: HTMLElement): string {
  const picked = findPrimaryActionButton(step);
  return picked ? (picked.textContent || picked.getAttribute('aria-label') || '').trim() : '';
}

describe('primary action button selection', () => {
  test('does not select unrelated page controls outside the given form', () => {
    document.body.innerHTML =
      '<form id="signup"><input type="email"></form><button>Create your account</button>';
    expect(findPrimaryActionButton(document.getElementById('signup'))).toBeNull();
  });
  test('preserves native form-associated buttons outside the form', () => {
    document.body.innerHTML =
      '<form id="signup"></form><button form="signup" type="submit">Create account</button>';
    expect(pickedLabel(document.getElementById('signup') as HTMLElement)).toBe('Create account');
  });
  test('invalid forms cannot be automatically clicked', () => {
    document.body.innerHTML =
      '<form id="signup"><input required type="email"><button>Register</button></form>';
    expect(clickPrimaryAction(document.getElementById('signup'))).toBe(false);
  });
  test('synthetic click/submit and old visible success do not submit an attempt', async () => {
    progress.length = 0;
    document.body.innerHTML =
      '<p>Your account has been created</p><form id="signup"><button type="button">Register</button></form><button id="other">Continue</button>';
    const form = document.getElementById('signup');
    if (!form) throw new Error('Expected signup form');
    const stop = armSignupOutcomeAfterSubmit(
      {
        id: 'attempt',
        credentialId: 'A',
        domain: 'example.com',
        email: 'a@inbox.example',
        submitted: false,
        expiresAt: Date.now() + 100_000,
      },
      form
    );
    form.querySelector('button')?.click();
    form.dispatchEvent(new Event('submit', { bubbles: true }));
    document.getElementById('other')?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    expect(progress).toHaveLength(0);
  });
  test('prefers Continue over a Back button on the same step', () => {
    document.body.innerHTML = `
      <div id="step">
        <button type="button">Back</button>
        <button type="submit">Continue</button>
      </div>
    `;
    expect(pickedLabel(document.getElementById('step') as HTMLElement)).toBe('Continue');
  });

  test('prefers Continue even when Back is also a submit button', () => {
    document.body.innerHTML = `
      <div id="step">
        <button type="submit">Back</button>
        <button type="submit">Continue</button>
      </div>
    `;
    expect(pickedLabel(document.getElementById('step') as HTMLElement)).toBe('Continue');
  });

  test('never auto-clicks a Back submit button when Continue is a plain anchor', () => {
    // The real "Continue" is a React-styled <a> that the button/role selector
    // does not match; the first submit control is the "Back" step button.
    // It must be excluded, not clicked (previously it was the only candidate).
    document.body.innerHTML = `
      <div id="step">
        <button type="submit">Back</button>
        <a href="#" class="next-step">Continue</a>
      </div>
    `;
    const picked = findPrimaryActionButton(document.getElementById('step') as HTMLElement);
    expect(picked?.textContent?.trim()).toBe('Continue');
  });
});

describe('automatic submit consent', () => {
  test('fails closed when the setting cannot be read', async () => {
    await expect(
      hasAutoSubmitConsent(async () => Promise.reject(new Error('storage unavailable')))
    ).resolves.toBe(false);
  });

  test('requires the explicit setting to be exactly true', async () => {
    await expect(
      hasAutoSubmitConsent(async () => ({ autoClickSubmitButtons: 'true' }))
    ).resolves.toBe(false);
    await expect(
      hasAutoSubmitConsent(async () => ({ autoClickSubmitButtons: true }))
    ).resolves.toBe(true);
  });
});
