import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { browser } from 'wxt/browser';

mock.module('@/utils/i18n/i18n-utils.js', () => ({
  t: async (key: string) => key,
  tSync: (key: string) => key,
  getCachedLocale: () => 'en',
}));
afterAll(() => {
  mock.restore();
});

const { autofillForm } = await import('@/features/address/address-actions');
let response: unknown;
let sendFails = false;
let queryFails = false;
let noTab = false;
const sent: unknown[] = [];
const notifications: Array<{ message: string; type: string }> = [];
const ext = {
  tabs: {
    query: async () => {
      if (queryFails) throw new Error('Query failed');
      return noTab ? [] : [{ id: 7 }];
    },
    sendMessage: async (_id: number, message: unknown) => {
      sent.push(message);
      if (sendFails) throw new Error('Receiver missing');
      return response;
    },
  },
} as unknown as typeof browser;
beforeEach(() => {
  response = undefined;
  sendFails = false;
  queryFails = false;
  noTab = false;
  sent.length = 0;
  notifications.length = 0;
});
const run = () =>
  autofillForm(ext, 'test@example.com', (message, type) => notifications.push({ message, type }));

describe('popup autofill outcome feedback', () => {
  test('awaits the fill result and sends the explicitly selected address', async () => {
    response = { success: true };
    await run();
    expect(sent).toEqual([{ type: 'startSignup', email: 'test@example.com' }]);
    expect(notifications).toEqual([{ message: 'toasts.autofillStarted', type: 'success' }]);
  });
  test('reports CAPTCHA as an actionable warning', async () => {
    response = { success: false, reason: 'verification_required' };
    await run();
    expect(notifications).toEqual([
      { message: 'contentAutofill.humanVerificationRequired', type: 'warning' },
    ]);
  });
  test('accepts the boundary error code for CAPTCHA too', async () => {
    response = { success: false, error: 'verification_required' };
    await run();
    expect(notifications[0]?.type).toBe('warning');
    expect(notifications[0]?.message).toBe('contentAutofill.humanVerificationRequired');
  });
  test('distinguishes blocked sites and absent forms from a missing script', async () => {
    response = { success: false, error: 'autofill_blocked' };
    await run();
    expect(notifications[0]?.message).toBe('contentAutofill.siteBlocked');
    notifications.length = 0;
    response = { success: false, error: 'no_form' };
    await run();
    expect(notifications[0]?.message).toBe('contentAutofill.noCompatibleFields');
  });
  test('handles missing receivers and real fill failures separately', async () => {
    sendFails = true;
    await run();
    expect(notifications[0]?.message).toBe('toasts.autofillFailedNoContentScript');
    notifications.length = 0;
    sendFails = false;
    response = { success: false, reason: 'fill_error' };
    await run();
    expect(notifications[0]?.message).toBe('toasts.autofillFailed');
  });
  test('does not send without an active tab', async () => {
    noTab = true;
    await run();
    expect(sent).toHaveLength(0);
    expect(notifications[0]?.message).toBe('toasts.noActiveTabFound');
  });
  test('reports failed tab lookup', async () => {
    queryFails = true;
    await run();
    expect(notifications[0]?.message).toBe('toasts.autofillFailed');
  });
});
