import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { JSDOM } from 'jsdom';

let shadowRoot: ShadowRoot | null = null;
let dom: JSDOM | null = null;
const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
const globalNames = [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'Element',
  'MouseEvent',
  'CSS',
  'MutationObserver',
  'ResizeObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];
for (const name of globalNames)
  savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));

mock.module('@/entrypoints/content/dom/shadow-dom.js', () => ({
  getOrCreateShadowRoot: () => shadowRoot,
}));

const { showDryRunPreview } = await import('@/features/intelligence/dry-run.js');

function setDomGlobals(next: JSDOM): void {
  const win = next.window;
  const values: Record<string, unknown> = {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    HTMLSelectElement: win.HTMLSelectElement,
    Element: win.Element,
    MouseEvent: win.MouseEvent,
    CSS: { escape: (value: string) => value },
    MutationObserver: win.MutationObserver,
    // jsdom has no layout engine or resize observer; the e2e tests verify
    // the actual action row and mouse hit testing in the built extension.
    ResizeObserver: class {
      observe() {
        /* No browser layout changes in jsdom. */
      }
      unobserve() {
        /* No browser layout changes in jsdom. */
      }
      disconnect() {
        /* No browser layout changes in jsdom. */
      }
    },
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  };
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
}

beforeEach(() => {
  dom?.window.close();
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://example.com/signup',
  });
  setDomGlobals(dom);
  const host = document.createElement('div');
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);
  shadowRoot = host.attachShadow({ mode: 'open' });
});

afterAll(() => {
  dom?.window.close();
  shadowRoot = null;
  mock.restore();
  for (const name of globalNames) {
    const descriptor = savedGlobals.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('autofill preview field correction', () => {
  test('Escape cancels a labelled dialog and restores the opener focus', async () => {
    if (!dom) throw new Error('DOM fixture not initialized');
    const win = dom.window;
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const pending = showDryRunPreview({
      rows: [],
      title: 'Preview',
      confirmLabel: 'Fill',
      cancelLabel: 'Cancel',
    });
    const panel = shadowRoot?.querySelector('[role="dialog"]');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(panel?.getAttribute('aria-label')).toBe('Preview');
    document.dispatchEvent(
      new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await expect(pending).resolves.toBe('cancel');
    expect(shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test('Tab wraps both directions inside the shadow-root dialog', async () => {
    if (!dom) throw new Error('DOM fixture not initialized');
    const win = dom.window;
    const pending = showDryRunPreview({
      rows: [],
      title: 'Preview',
      confirmLabel: 'Fill',
      cancelLabel: 'Cancel',
    });
    const buttons = Array.from(shadowRoot?.querySelectorAll('button') || []);
    for (const button of buttons) {
      button.getBoundingClientRect = () => new win.DOMRect(0, 0, 80, 40);
    }
    const [cancel, fill] = buttons;
    fill.focus();
    const forward = new win.KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    fill.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(shadowRoot?.activeElement).toBe(cancel);
    const backward = new win.KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    cancel.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(true);
    expect(shadowRoot?.activeElement).toBe(fill);
    cancel.click();
    await expect(pending).resolves.toBe('cancel');
  });

  test('selects a compatible form control, returns its selector, and restores its outline', async () => {
    const form = document.createElement('form');
    const email = document.createElement('input');
    email.name = 'contact-email';
    email.style.outline = '1px solid red';
    form.appendChild(email);
    document.body.appendChild(form);

    const pending = showDryRunPreview({
      rows: [{ label: 'Email', value: 'user@example.com', kind: 'email' }],
      form,
      title: 'Preview',
      confirmLabel: 'Fill',
      cancelLabel: 'Cancel',
      correctLabel: 'Correct field',
      selectionPrompt: 'Choose a field',
    });

    const buttons = Array.from(shadowRoot?.querySelectorAll('button') || []);
    buttons.find((button) => button.textContent === 'Correct field')?.click();
    email.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(email.style.outline).toBe('1px solid red');
    buttons.find((button) => button.textContent === 'Fill')?.click();

    await expect(pending).resolves.toEqual({ email: 'input[name="contact-email"]' });
  });

  test('cancelling during selection removes the page click handler', async () => {
    const form = document.createElement('form');
    const email = document.createElement('input');
    form.appendChild(email);
    document.body.appendChild(form);

    const pending = showDryRunPreview({
      rows: [{ label: 'Email', value: 'user@example.com', kind: 'email' }],
      form,
      title: 'Preview',
      confirmLabel: 'Fill',
      cancelLabel: 'Cancel',
      correctLabel: 'Correct field',
      selectionPrompt: 'Choose a field',
    });

    const buttons = Array.from(shadowRoot?.querySelectorAll('button') || []);
    buttons.find((button) => button.textContent === 'Correct field')?.click();
    buttons.find((button) => button.textContent === 'Cancel')?.click();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    email.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    await expect(pending).resolves.toBe('cancel');
  });

  test('keyboard correction chooses the focused input without submitting the host form', async () => {
    if (!dom) throw new Error('DOM fixture not initialized');
    const form = document.createElement('form');
    const email = document.createElement('input');
    email.id = 'keyboard-email';
    email.type = 'email';
    form.appendChild(email);
    document.body.appendChild(form);
    const pending = showDryRunPreview({
      rows: [{ label: 'Email', value: 'user@example.com', kind: 'email' }],
      form,
      title: 'Preview',
      confirmLabel: 'Fill',
      cancelLabel: 'Cancel',
      correctLabel: 'Correct field',
      selectionPrompt: 'Tab to a field and press Enter',
    });
    const buttons = Array.from(shadowRoot?.querySelectorAll('button') || []);
    buttons.find((button) => button.textContent === 'Correct field')?.click();
    expect(document.activeElement).toBe(email);
    const event = new dom.window.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    email.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shadowRoot?.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    buttons.find((button) => button.textContent === 'Fill')?.click();
    await expect(pending).resolves.toEqual({ email: 'input#keyboard-email' });
  });

  test('keyboard correction accepts a field explicitly named username', async () => {
    if (!dom) throw new Error('DOM fixture not initialized');
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'username';
    input.autocomplete = 'username';
    form.appendChild(input);
    document.body.appendChild(form);
    const pending = showDryRunPreview({
      rows: [{ label: 'Username', value: 'sample-user', kind: 'username' }],
      form,
      title: 'Preview',
      confirmLabel: 'Fill',
      cancelLabel: 'Cancel',
      correctLabel: 'Correct field',
    });
    const buttons = Array.from(shadowRoot?.querySelectorAll('button') || []);
    buttons.find((button) => button.textContent === 'Correct field')?.click();
    input.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    buttons.find((button) => button.textContent === 'Fill')?.click();
    await expect(pending).resolves.toEqual({ username: 'input[name="username"]' });
  });

  test('focus wrapping excludes a native button with tabindex minus one', async () => {
    if (!dom) throw new Error('DOM fixture not initialized');
    const win = dom.window;
    const pending = showDryRunPreview({
      rows: [],
      title: 'Preview',
      confirmLabel: 'Fill',
      cancelLabel: 'Cancel',
    });
    const buttons = Array.from(shadowRoot?.querySelectorAll('button') || []);
    const [cancel, fill] = buttons;
    cancel.tabIndex = -1;
    for (const button of buttons)
      button.getBoundingClientRect = () => new win.DOMRect(0, 0, 80, 40);
    fill.focus();
    const event = new dom.window.KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fill.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shadowRoot?.activeElement).toBe(fill);
    cancel.click();
    await expect(pending).resolves.toBe('cancel');
  });
});
