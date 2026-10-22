import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
const queryTabs = mock(async () => [{ id: 11 }, { id: undefined }, { id: 22 }]);
const sendTabMessage = mock(async (_tabId?: number) => undefined);

mock.module('wxt/browser', () => ({
  browser: {
    tabs: {
      query: queryTabs,
      sendMessage: sendTabMessage,
    },
  },
}));

const { broadcastOtpToTabs } = await import('@/entrypoints/background/address/otp-broadcast.js');

describe('broadcastOtpToTabs', () => {
  beforeEach(() => {
    queryTabs.mockReset();
    queryTabs.mockImplementation(async () => [{ id: 11 }, { id: undefined }, { id: 22 }]);
    sendTabMessage.mockReset();
    sendTabMessage.mockImplementation(async () => undefined);
  });

  test('sends fillOTP to every tab with a numeric id', async () => {
    await broadcastOtpToTabs({
      otp: '482901',
      sender: 'security@example.com',
      senderName: 'Security',
      subject: 'Verification code',
      recipient: 'user@example.com',
    });

    expect(queryTabs).toHaveBeenCalledWith({ url: ['http://*/*', 'https://*/*'] });
    expect(sendTabMessage).toHaveBeenCalledTimes(2);
    expect(sendTabMessage).toHaveBeenNthCalledWith(1, 11, {
      type: 'fillOTP',
      otp: '482901',
      sender: 'security@example.com',
      senderName: 'Security',
      subject: 'Verification code',
      recipient: 'user@example.com',
    });
    expect(sendTabMessage).toHaveBeenNthCalledWith(2, 22, {
      type: 'fillOTP',
      otp: '482901',
      sender: 'security@example.com',
      senderName: 'Security',
      subject: 'Verification code',
      recipient: 'user@example.com',
    });
  });

  test('does not reject when a tab has no content-script listener', async () => {
    sendTabMessage.mockImplementation(async (tabId?: number) => {
      if (tabId === 11) throw new Error('Receiving end does not exist');
    });

    await expect(broadcastOtpToTabs({ otp: '123456' })).resolves.toBeUndefined();
    expect(sendTabMessage).toHaveBeenCalledTimes(2);
  });

  test('does not reject when tab enumeration is unavailable', async () => {
    queryTabs.mockImplementation(async () => {
      throw new Error('tabs permission unavailable');
    });

    await expect(broadcastOtpToTabs({ otp: '123456' })).resolves.toBeUndefined();
    expect(sendTabMessage).not.toHaveBeenCalled();
  });
});
