import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { safeAccessibleName } from '@/utils/security/dom-safe';

mock.module('wxt/browser', () => ({
  browser: {
    runtime: {
      id: 'test-extension',
      sendMessage: async (message: { type: string; text?: string }) => {
        if (message.type === 'classifyFieldFast')
          return {
            success: true,
            result: {
              isUsername: /username|user name/.test(message.text || ''),
              isEmailish: false,
            },
          };
        return { success: true };
      },
    },
  },
}));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/signup' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  HTMLInputElement: dom.window.HTMLInputElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
afterAll(() => {
  mock.restore();
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const { resolveAutofillPreviewTargets } = await import(
  '@/entrypoints/content/autofill/form-filler'
);
function form(html: string) {
  document.body.innerHTML = `<form>${html}</form>`;
  for (const input of document.querySelectorAll('input')) {
    input.getBoundingClientRect = () =>
      ({ width: 300, height: 40, top: 100, left: 100 }) as DOMRect;
  }
  const root = document.querySelector('form');
  if (!root) throw new Error('Missing test form');
  return root;
}
beforeEach(() => {
  document.body.innerHTML = '';
});

describe('autofill review targets', () => {
  test('reports an associated label only once when ARIA references the same label', () => {
    const root = form(
      '<label id="label" for="entry">Phone/Email (personal or work)</label><input id="entry" aria-labelledby="label">'
    );
    expect(safeAccessibleName(root.querySelector('input'))).toBe('Phone/Email (personal or work)');
  });
  test('combined phone/email username field previews only email', async () => {
    const root = form(
      '<label for="entry">Phone number or email</label><input id="entry" name="username" autocomplete="username webauthn" placeholder="Phone number or email"><input type="hidden" name="fullname">'
    );
    const targets = await resolveAutofillPreviewTargets(root);
    expect(Object.keys(targets)).toEqual(['email']);
    expect(targets.email?.[0]?.id).toBe('entry');
  });
  test('does not list hidden, readonly or disabled controls', async () => {
    const targets = await resolveAutofillPreviewTargets(
      form(
        '<input type="email" readonly><input type="password" disabled><input name="phone" style="display:none"><input name="fullname" type="hidden">'
      )
    );
    expect(targets).toEqual({});
  });
  test('uses editable name controls after a hidden lookalike', async () => {
    const root = form(
      '<input name="firstName" type="hidden"><input autocomplete="given-name"><input autocomplete="family-name"><input type="tel"><input type="password">'
    );
    const targets = await resolveAutofillPreviewTargets(root);
    expect(targets.fullName).toHaveLength(2);
    expect(targets.fullName?.[0]?.autocomplete).toBe('given-name');
    expect(targets.phone).toHaveLength(1);
    expect(targets.password).toHaveLength(1);
  });
  test('a username is not mistaken for a full name', async () => {
    const targets = await resolveAutofillPreviewTargets(
      form('<input name="username" placeholder="User name">')
    );
    expect(targets.fullName).toBeUndefined();
    expect(targets.email).toBeUndefined();
    expect(targets.username).toHaveLength(1);
  });
});
