import { afterAll, afterEach, expect, mock, test } from 'bun:test';
import { addMessages, init } from 'svelte-i18n';
import en from '@/locales/en.json';
import { cleanupDom, renderComponent, unmountComponent } from '../../helpers/svelte-harness.js';

mock.module('wxt/browser', () => ({ browser: { storage: { local: { get: async () => ({}) } } } }));
afterAll(() => mock.restore());
addMessages('en', en);
init({ fallbackLocale: 'en', initialLocale: 'en' });
const mounted: unknown[] = [];
afterEach(async () => {
  for (const instance of mounted.splice(0)) await unmountComponent(instance);
  cleanupDom();
});

async function render(email: Record<string, unknown>, onCopyOtp = (_code: string) => {}) {
  const component = await renderComponent('src/ui/blocks/mail/MessageCodeBadges.svelte', {
    email: { id: 'message', received_at: 0, ...email },
    onCopyOtp,
  });
  mounted.push(component.instance);
  return component.target;
}

test('uncertain code has a warning glyph and an accessible warning, and keyboard copy fires once', async () => {
  const copies: string[] = [];
  const dom = await render({ otpCandidate: '482901' }, (code) => copies.push(code));
  const badge = dom.querySelector<HTMLElement>('[data-otp-uncertain]');
  expect(badge?.textContent).toContain('OTP: 482901');
  expect(badge?.getAttribute('aria-label')).toContain('Possible OTP');
  expect(badge?.getAttribute('title')).toContain('Manual copy only');
  expect(badge?.querySelector('svg')).not.toBeNull();
  badge?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );
  expect(copies).toEqual(['482901']);
});

test('supported code has no uncertain warning; coupons use the ticket glyph and reminders are labelled', async () => {
  const dom = await render({ otp: '482901', couponCode: 'SAVE20', isReminder: true });
  expect(dom.querySelector('[data-otp-uncertain]')).toBeNull();
  const coupon = dom.querySelector('[data-coupon-badge]');
  expect(coupon?.textContent).toContain('Coupon: SAVE20');
  expect(coupon?.getAttribute('aria-label')).toBe('Copy coupon code SAVE20');
  expect(coupon?.querySelector('svg path')?.getAttribute('d')).toContain('m368-320');
  expect(dom.textContent).toContain('Reminder');
});

test('a deal without a coupon has an independent badge and no OTP', async () => {
  const dom = await render({ isDeal: true });
  expect(dom.querySelector('.message-deal-badge')?.textContent?.trim()).toBe('Deal');
  expect(dom.querySelector('[data-coupon-badge]')).toBeNull();
  expect(dom.querySelector('[data-otp-uncertain]')).toBeNull();
});
