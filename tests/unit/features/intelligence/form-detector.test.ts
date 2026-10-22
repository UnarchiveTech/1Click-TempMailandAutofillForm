import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import {
  classifyFormIntent,
  findSignupForm,
  isSigninForm,
  isSignupForm,
  scoreSignupForm,
} from '@/entrypoints/content/autofill/form-detector.js';

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
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
  // jsdom returns zero-sized rects, which would make every input "invisible"
  // to scoring - give elements a real size so visibility checks pass.
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 240,
    bottom: 32,
    width: 240,
    height: 32,
  } as DOMRect;
  Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  });
});

afterAll(() => {
  dom.window.close();
});

function setPageBody(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  const form = document.getElementById('f') as HTMLFormElement;
  if (!form) throw new Error('test page must contain <form id="f">');
  return form;
}

describe('form intent classification', () => {
  test('classifies a signup form as signup', () => {
    const form = setPageBody(`
      <form id="f">
        <h1>Create your account</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="new-password" />
        <input type="password" name="password2" />
        <input type="text" name="firstName" />
      </form>
    `);
    expect(classifyFormIntent(form)).toBe('signup');
    expect(isSignupForm(form)).toBe(true);
    expect(isSigninForm(form)).toBe(false);
  });

  test('classifies a signin form as signin', () => {
    const form = setPageBody(`
      <form id="f">
        <h1>Welcome back</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="current-password" />
      </form>
    `);
    expect(classifyFormIntent(form)).toBe('signin');
    expect(isSigninForm(form)).toBe(true);
    expect(isSignupForm(form)).toBe(false);
  });

  test('login wording wins over a confirm-password shape', () => {
    // A "Sign in" page that renders two password fields (password change)
    // must not be treated as a signup form.
    const form = setPageBody(`
      <form id="f">
        <h1>Sign in</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="current-password" />
        <input type="password" name="password2" autocomplete="new-password" />
      </form>
    `);
    expect(classifyFormIntent(form)).toBe('signin');
  });

  test('"log in" link inside a signup form does not flip intent', () => {
    const form = setPageBody(`
      <form id="f">
        <h1>Create your account</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="new-password" />
        <input type="password" name="password2" />
        <p>Already have an account? <a href="/login">Log in</a></p>
      </form>
    `);
    expect(classifyFormIntent(form)).toBe('signup');
  });

  test('signin forms score far below signup forms', () => {
    const signin = setPageBody(`
      <form id="f">
        <h1>Welcome back</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="current-password" />
      </form>
    `);
    const signup = setPageBody(`
      <form id="f">
        <h1>Create your account</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="new-password" />
        <input type="password" name="password2" />
        <input type="text" name="firstName" />
        <input type="text" name="lastName" />
      </form>
    `);
    expect(scoreSignupForm(signin)).toBeLessThan(scoreSignupForm(signup));
  });
});

describe('findSignupForm thresholds', () => {
  test('success-page search and hidden contact forms do not offer signup autofill', async () => {
    setPageBody(`
      <h1>Account successfully created.</h1>
      <h2>Get started</h2>
      <form id="f" action="/"><input type="text" id="sitewide-search" name="s"><button>Search</button></form>
      <div style="display:none"><form action="/Fraud/Contact">
        <label>Email</label><input type="email"><button>Send</button>
      </form></div>
    `);
    expect(await findSignupForm(30)).toBeNull();
    expect(await findSignupForm(55)).toBeNull();
  });

  test('hidden ancestors exclude signup fields even when their own boxes have size', async () => {
    for (const attribute of ['hidden', 'inert', 'style="opacity:0"', 'style="visibility:hidden"']) {
      setPageBody(`<div ${attribute}><form id="f"><h1>Create account</h1>
        <input type="email"><input type="password"><button>Continue</button>
      </form></div>`);
      expect(await findSignupForm(30)).toBeNull();
    }
  });

  test('completed form disappearing does not leave a search form as its replacement', async () => {
    setPageBody(
      '<form id="f"><h1>Create account</h1><input type="email"><input type="password"></form>'
    );
    expect(await findSignupForm(30)).not.toBeNull();
    setPageBody(
      '<h1>Create account</h1><form id="f"><input name="q"><button>Search</button></form>'
    );
    expect(await findSignupForm(30)).toBeNull();
  });

  test('a signin form is found at the icon threshold (30) but not the strict one (55)', async () => {
    setPageBody(`
      <form id="f">
        <h1>Welcome back</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="current-password" />
      </form>
    `);
    const atIconThreshold = await findSignupForm(30);
    expect(atIconThreshold).not.toBeNull();
    const atStrictThreshold = await findSignupForm(55);
    expect(atStrictThreshold).toBeNull();
  });

  test('a strong signup form is found at the strict threshold (55)', async () => {
    setPageBody(`
      <form id="f">
        <h1>Create your account</h1>
        <input type="email" name="email" />
        <input type="password" name="password" autocomplete="new-password" />
        <input type="password" name="password2" />
        <input type="text" name="firstName" />
        <input type="text" name="lastName" />
      </form>
    `);
    const form = await findSignupForm(55);
    expect(form).not.toBeNull();
  });
});
