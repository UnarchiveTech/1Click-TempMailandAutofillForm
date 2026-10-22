import { afterAll, afterEach, expect, mock, test } from 'bun:test';
import { addMessages, init } from 'svelte-i18n';
import en from '@/locales/en.json';
import { cleanupDom, renderComponent, unmountComponent } from '../../helpers/svelte-harness.js';

const opened: string[] = [];
const failures: string[] = [];
let rejectOpen = false;
mock.module('wxt/browser', () => ({
  browser: {
    tabs: {
      create: async ({ url }: { url: string }) => {
        if (rejectOpen) throw new Error('test-navigation-failure');
        opened.push(url);
      },
    },
  },
}));
mock.module('@/utils/ui/toastStore.js', () => ({
  toastStore: { error: (message: string) => failures.push(message) },
}));
mock.module('@/utils/logger.js', () => ({ logError: () => {} }));
afterAll(() => mock.restore());
addMessages('en', en);
init({ fallbackLocale: 'en', initialLocale: 'en' });
const mounted: unknown[] = [];
afterEach(async () => {
  for (const instance of mounted.splice(0)) await unmountComponent(instance);
  cleanupDom();
  opened.length = 0;
  failures.length = 0;
  rejectOpen = false;
});
async function render(body_html: string) {
  const component = await renderComponent('src/ui/blocks/mail/MessageUnsubscribeBadge.svelte', {
    email: { id: 'message', received_at: 0, body_html },
  });
  mounted.push(component.instance);
  return component.target;
}
test('only messages providing an action get a badge', async () => {
  const target = await render('<a href="https://sender.test/help">Help</a>');
  expect(target.querySelector('button')).toBeNull();
});
test('the native button opens the sender destination and does not claim remote success', async () => {
  const target = await render('<a href="https://sender.test/leave">Unsubscribe</a>');
  const button = target.querySelector<HTMLButtonElement>('button');
  expect(button?.type).toBe('button');
  expect(button?.textContent?.trim()).toBe('Unsubscribe');
  button?.click();
  await Promise.resolve();
  expect(opened).toEqual(['https://sender.test/leave']);
  expect(target.textContent).not.toContain('Unsubscribed');
});
test('navigation failure is visible', async () => {
  rejectOpen = true;
  const target = await render('<a href="https://sender.test/leave">Unsubscribe</a>');
  target.querySelector<HTMLButtonElement>('button')?.click();
  await Promise.resolve();
  expect(failures).toEqual(['Operation failed']);
});
