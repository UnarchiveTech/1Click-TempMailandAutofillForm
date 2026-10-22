import { afterAll, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// notification-permission.ts imports { browser } from wxt/browser; provide an
// in-memory mock so the module loads in the test runner. The getters let each
// test simulate a missing native API or a failing navigation.
const api = {
  getPermissionLevel: undefined as (() => Promise<string>) | undefined,
  contains: async () => true,
  createTab: async (..._args: unknown[]) => ({}),
  createNotification: undefined as ((...args: unknown[]) => Promise<unknown>) | undefined,
};
mock.module('wxt/browser', () => ({
  browser: {
    get notifications() {
      const getPermissionLevel = api.getPermissionLevel;
      const createNotification = api.createNotification;
      return {
        ...(typeof getPermissionLevel === 'function'
          ? { getPermissionLevel: () => getPermissionLevel() }
          : {}),
        ...(typeof createNotification === 'function'
          ? { create: (...args: unknown[]) => createNotification(...args) }
          : {}),
      };
    },
    permissions: {
      contains: () => api.contains(),
    },
    tabs: {
      create: (...args: unknown[]) => api.createTab(...args),
    },
  },
}));

// The helper must swallow rejection and log, never leak. Spy on the logger so
// the test can assert the failure was actually reported. (mock.module is
// process-global in bun, so the mock must expose the module's full export
// surface - sibling test files import the other functions.)
const loggerCalls: unknown[][] = [];
mock.module('@/utils/logger.js', () => ({
  LogLevel: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
  initLogger: async () => {},
  setLoggingEnabled: async () => {},
  setLogLevel: async () => {},
  logDebug: () => {},
  logInfo: () => {},
  logWarn: () => {},
  logError: (...args: unknown[]) => {
    loggerCalls.push(args);
  },
  log: () => {},
}));

const { createBrowserNotification, getNotificationPermissionStatus, openNotificationSettingsPage } =
  await import('@/utils/notifications/notification-permission.js');

describe('getNotificationPermissionStatus', () => {
  test('returns denied when the native API reports denied', async () => {
    api.getPermissionLevel = async () => 'denied';
    expect(await getNotificationPermissionStatus()).toBe('denied');
  });

  test('returns granted when the native API reports granted', async () => {
    api.getPermissionLevel = async () => 'granted';
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });

  test('falls back to the manifest permission when the native API is missing', async () => {
    api.getPermissionLevel = undefined;
    api.contains = async () => true;
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });

  test('reports denied when the manifest permission was revoked', async () => {
    api.getPermissionLevel = undefined;
    api.contains = async () => false;
    expect(await getNotificationPermissionStatus()).toBe('denied');
  });

  test('reports denied via the DOM Notification permission when the native API is missing', async () => {
    api.getPermissionLevel = undefined;
    const globals = globalThis as unknown as { Notification?: { permission: string } };
    const prev = globals.Notification;
    globals.Notification = { permission: 'denied' };
    try {
      expect(await getNotificationPermissionStatus()).toBe('denied');
    } finally {
      if (prev === undefined) delete (globalThis as Record<string, unknown>).Notification;
      else globals.Notification = prev;
    }
  });

  test('tolerates a rejecting native API', async () => {
    api.getPermissionLevel = async () => {
      throw new Error('api unavailable');
    };
    api.contains = async () => true;
    expect(await getNotificationPermissionStatus()).toBe('granted');
  });
});

describe('openNotificationSettingsPage', () => {
  test('opens the chrome notification-settings page and reports success', async () => {
    const calls: unknown[] = [];
    api.createTab = async (args) => {
      calls.push(args);
      return { id: 1 };
    };
    expect(await openNotificationSettingsPage()).toBe(true);
    expect(calls[0]).toEqual({ url: 'chrome://settings/content/notifications', active: true });
  });

  test('reports failure when the browser blocks the navigation', async () => {
    api.createTab = async () => {
      throw new Error('Cannot access a chrome:// URL');
    };
    expect(await openNotificationSettingsPage()).toBe(false);
  });
});

describe('createBrowserNotification', () => {
  const options = { type: 'basic' as const, title: 't', message: 'm', iconUrl: 'icons/icon48.png' };

  test('swallows a rejection (permission denied) and logs it instead of leaking', async () => {
    loggerCalls.length = 0;
    api.createNotification = async () => {
      throw new Error('Not allowed to use notifications API');
    };

    createBrowserNotification('n1', options);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loggerCalls.length).toBe(1);
    expect(loggerCalls[0][0]).toBe('Failed to create notification');
  });

  test('passes the notification id and options through to the API', async () => {
    loggerCalls.length = 0;
    const received: unknown[][] = [];
    api.createNotification = async (...args) => {
      received.push(args);
      return 'n2';
    };

    createBrowserNotification('n2', options);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received[0][0]).toBe('n2');
    expect(received[0][1]).toEqual(options);
    expect(loggerCalls.length).toBe(0); // no failure → no log
  });
});
