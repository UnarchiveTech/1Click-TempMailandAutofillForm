import { afterEach, describe, expect, test } from 'bun:test';
import {
  cleanupDom,
  renderComponent,
  setupDom,
  unmountComponent,
} from '../../helpers/svelte-harness.js';

let mounted: unknown;
let secondMounted: unknown;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(async () => {
  if (secondMounted) await unmountComponent(secondMounted);
  secondMounted = undefined;
  if (mounted) await unmountComponent(mounted);
  mounted = undefined;
  cleanupDom();
});

async function open() {
  setupDom();
  // jsdom has no layout/scrolling engine; real-browser coverage checks visibility.
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const rendered = await renderComponent('src/ui/components/primitives/Dropdown.svelte', {
    label: 'Test choices',
    value: 'one',
    options: [
      { value: 'one', label: 'One' },
      { value: 'two', label: 'Two' },
      { value: 'disabled', label: 'Unavailable', disabled: true },
    ],
  });
  mounted = rendered.instance;
  const trigger = rendered.target.querySelector<HTMLButtonElement>('[role="combobox"]');
  if (!trigger) throw new Error('Dropdown trigger missing');
  trigger.focus();
  trigger.click();
  await flush();
  return trigger;
}

describe('Dropdown focus and active option', () => {
  test('icon-only menu triggers retain an accessible name and show labels in the menu', async () => {
    setupDom();
    window.HTMLElement.prototype.scrollIntoView = () => {};
    const rendered = await renderComponent('src/ui/components/primitives/Dropdown.svelte', {
      value: 'one',
      options: [{ value: 'one', label: 'First message' }],
      triggerLabel: '',
      ariaLabel: 'Open messages',
      size: 'button',
    });
    mounted = rendered.instance;
    const trigger = rendered.target.querySelector<HTMLButtonElement>('[role="combobox"]');
    expect(trigger?.getAttribute('aria-label')).toBe('Open messages');
    expect(trigger?.textContent).not.toContain('First message');
    trigger?.click();
    await flush();
    expect(document.querySelector('[role="option"]')?.textContent).toContain('First message');
  });
  test('simultaneously mounted fields own distinct accessible label and menu IDs', async () => {
    const originalNow = Date.now;
    Date.now = () => 123456789;
    try {
      const first = await open();
      const rendered = await renderComponent('src/ui/components/primitives/Dropdown.svelte', {
        label: 'Second field',
        value: 'one',
        options: [{ value: 'one', label: 'One' }],
      });
      secondMounted = rendered.instance;
      const second = rendered.target.querySelector<HTMLButtonElement>('[role="combobox"]');
      expect(second).not.toBeNull();
      expect(second?.getAttribute('aria-controls')).not.toBe(first.getAttribute('aria-controls'));
      expect(
        document.getElementById(first.getAttribute('aria-labelledby') || '')?.textContent
      ).toBe('Test choices');
      expect(
        document.getElementById(second?.getAttribute('aria-labelledby') || '')?.textContent
      ).toBe('Second field');
    } finally {
      Date.now = originalNow;
    }
  });

  test('choosing a pointer-focused option restores focus to its trigger', async () => {
    const trigger = await open();
    const option = document.body.querySelector<HTMLButtonElement>('[role="option"]:nth-child(2)');
    expect(option).not.toBeNull();
    option?.focus();
    option?.click();
    await flush();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.textContent).toContain('Two');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  test('arrows paint the active option, skip disabled choices, and Escape closes only the list', async () => {
    const trigger = await open();
    trigger.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    await flush();
    const active = document.getElementById(trigger.getAttribute('aria-activedescendant') || '');
    expect(active?.textContent).toContain('Two');
    expect(active?.classList.contains('row-surface-active')).toBe(true);
    expect(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].every(
        (option) => option.tabIndex === -1
      )
    ).toBe(true);
    trigger.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    await flush();
    expect(
      document.getElementById(trigger.getAttribute('aria-activedescendant') || '')?.textContent
    ).toContain('One');
    const escapeEvent = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    trigger.dispatchEvent(escapeEvent);
    await flush();
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
