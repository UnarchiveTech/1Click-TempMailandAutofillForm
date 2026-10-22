import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { LOCKS, withLock } from '@/utils/mutex.js';
import type { CredentialsHistoryItem, Email } from '@/utils/types.js';

afterAll(() => {
  mock.restore();
});
const local: Record<string, unknown> = {};
const session: Record<string, unknown> = {};
const notifications: unknown[] = [];
const opened: { id: number; url: string }[] = [];
let messages: Email[] = [];
function area(store: Record<string, unknown>) {
  return {
    get: async (keys: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((k) => [k, structuredClone(store[k])])
      ),
    set: async (items: Record<string, unknown>) => {
      Object.assign(store, structuredClone(items));
    },
  };
}
const localArea = area(local);
mock.module('wxt/browser', () => ({
  browser: {
    storage: { local: localArea, session: area(session) },
    tabs: {
      create: async ({ url }: { url: string }) => {
        const tab = { id: 100 + opened.length, url };
        opened.push(tab);
        return tab;
      },
      update: async (id: number, { url }: { url: string }) => {
        const tab = opened.find((t) => t.id === id);
        if (tab) tab.url = url;
      },
    },
  },
}));
mock.module('@/utils/storage/storage-write.js', () => ({
  writeWithRetry: async (
    items: Record<string, unknown>,
    opts?: { area?: ReturnType<typeof area> }
  ) => {
    await (opts?.area ?? localArea).set(items);
  },
}));
mock.module('@/utils/storage/storage-keys.js', () => ({
  getStoredEmailsForAddress: async () => messages,
}));
mock.module('@/utils/i18n/i18n-background.js', () => ({ tSync: (key: string) => key }));
mock.module('@/utils/notifications/notification-permission.js', () => ({
  createBrowserNotification: (...args: unknown[]) => {
    notifications.push(args);
  },
}));
const {
  beginSignupAttempt,
  getSignupAttempt,
  openSignupVerificationLink,
  reportSignupProgress,
  SIGNUP_ATTEMPT_TTL_MS,
} = await import('@/features/intelligence/signup-attempts.js');
const caller = {
  tabId: 1,
  frameId: 0,
  host: 'accounts.example.com',
  url: 'https://accounts.example.com/signup',
};
function credential(id: string, email = `${id}@inbox.example`): CredentialsHistoryItem {
  return {
    id,
    domain: caller.host,
    email,
    username: id,
    timestamp: Date.now(),
    signupStatus: 'pending_submit',
  } as CredentialsHistoryItem;
}
function records() {
  return local.loginInfo as CredentialsHistoryItem[];
}
async function startAttempt() {
  const attempt = await beginSignupAttempt('A', caller);
  if (!attempt) throw new Error('Expected signup attempt');
  return attempt;
}
beforeEach(() => {
  for (const key of Object.keys(local)) delete local[key];
  for (const key of Object.keys(session)) delete session[key];
  notifications.length = 0;
  opened.length = 0;
  messages = [];
  local.loginInfo = [credential('A'), credential('B')];
});

describe('background-owned exact signup attempts', () => {
  test('updates A, never newest same-site B', async () => {
    const attempt = await startAttempt();
    expect(await reportSignupProgress(attempt.id, 'created', caller)).toBe(false);
    await reportSignupProgress(attempt.id, 'submitted', caller);
    await reportSignupProgress(attempt.id, 'created', caller);
    expect(records()[0].verified).toBe(true);
    expect(records()[1].verified).toBeUndefined();
    expect(records()[0].emailVerificationStatus).toBeUndefined();
    expect(notifications).toHaveLength(0);
  });
  test('rejects another tab, frame or domain and resumes the original attempt', async () => {
    const attempt = await startAttempt();
    for (const stranger of [
      { ...caller, tabId: 2 },
      { ...caller, frameId: 1 },
      { ...caller, host: 'other.example.net' },
    ]) {
      expect(await getSignupAttempt(stranger)).toBeNull();
      expect(await reportSignupProgress(attempt.id, 'submitted', stranger)).toBe(false);
    }
    expect((await getSignupAttempt(caller))?.id).toBe(attempt?.id);
    expect(attempt.expiresAt - Date.now()).toBeGreaterThan(90_000);
    expect(attempt.expiresAt - Date.now()).toBeLessThanOrEqual(SIGNUP_ATTEMPT_TTL_MS);
  });
  test('saved-login replay does not reset existing success', async () => {
    records()[0].verified = true;
    records()[0].signupStatus = 'verified';
    expect(await beginSignupAttempt('A', caller)).toBeNull();
    expect(records()[0].signupStatus).toBe('verified');
  });
  test('a several-minute CAPTCHA wait resumes with the same account and attempt', async () => {
    const attempt = await startAttempt();
    const saved = session.signupAttempts_v1 as { startedAt: number; expiresAt: number }[];
    saved[0].startedAt -= 4 * 60_000;
    saved[0].expiresAt -= 4 * 60_000;
    expect((await getSignupAttempt(caller))?.id).toBe(attempt.id);
    expect(await reportSignupProgress(attempt.id, 'submitted', caller)).toBe(true);
    expect(records()[0].signupStatus).toBe('submitted');
  });
  test('records email-pending, confirms once, preserves timestamps and notification preference', async () => {
    const attempt = await startAttempt();
    await reportSignupProgress(attempt.id, 'submitted', caller);
    await reportSignupProgress(attempt.id, 'verification_pending', caller);
    expect(records()[0].emailVerificationStatus).toBe('pending');
    await reportSignupProgress(attempt.id, 'email_confirmed', caller);
    const confirmed = structuredClone(records()[0]);
    await reportSignupProgress(attempt.id, 'email_confirmed', caller);
    await reportSignupProgress(attempt.id, 'verification_pending', caller);
    await reportSignupProgress(attempt.id, 'failed', caller);
    expect(records()[0]).toEqual(confirmed);
    expect(notifications).toHaveLength(1);
  });
  test('disabled notifications stay disabled', async () => {
    local.notificationSettings = { enabled: false };
    const attempt = await startAttempt();
    await reportSignupProgress(attempt.id, 'submitted', caller);
    await reportSignupProgress(attempt.id, 'email_confirmed', caller);
    expect(records()[0].emailVerificationStatus).toBe('confirmed');
    expect(notifications).toHaveLength(0);
  });
  test('deleted/replaced credentials and expired attempts cannot be resurrected', async () => {
    const attempt = await startAttempt();
    records()[0].signupAttemptId = 'newer-attempt';
    expect(await reportSignupProgress(attempt.id, 'submitted', caller)).toBe(false);
    expect(await getSignupAttempt(caller)).toBeNull();
    const stored = session.signupAttempts_v1 as { expiresAt: number }[];
    stored[0].expiresAt = Date.now() - 1;
    expect(await getSignupAttempt(caller)).toBeNull();
  });
  test('the shared login lock preserves concurrent unrelated edits', async () => {
    const attempt = await startAttempt();
    await Promise.all([
      reportSignupProgress(attempt.id, 'submitted', caller),
      withLock(LOCKS.LOGIN_INFO, async () => {
        const snapshot = await localArea.get('loginInfo');
        const values = snapshot.loginInfo as CredentialsHistoryItem[];
        values[1].username = 'edited B';
        await localArea.set({ loginInfo: values });
      }),
    ]);
    expect(records()[0].signupStatus).toBe('submitted');
    expect(records()[1].username).toBe('edited B');
  });
  test('only the exact freshly stored confirmation link can bind a new tab', async () => {
    const attempt = await startAttempt();
    await reportSignupProgress(attempt.id, 'submitted', caller);
    local.addresses = [{ id: 'inbox-A', address: 'A@inbox.example' }];
    messages = [
      {
        id: 'mail-A',
        from: 'Support <mail@example.com>',
        received_at: Date.now(),
        body_plain: 'Hello A',
        magicLinks: [{ url: 'https://verify.example.com/confirm?token=test' }],
      },
    ] as Email[];
    await openSignupVerificationLink('https://verify.example.com/confirm?token=other', 'inbox-A');
    expect(
      await getSignupAttempt({
        tabId: 100,
        frameId: 0,
        host: 'verify.example.com',
        url: opened[0].url,
      })
    ).toBeNull();
    await openSignupVerificationLink('https://verify.example.com/confirm?token=test', 'inbox-A');
    const bound = { tabId: 101, frameId: 0, host: 'verify.example.com', url: opened[1].url };
    expect((await getSignupAttempt(bound))?.id).toBe(attempt.id);
    expect(
      await reportSignupProgress(attempt.id, 'email_confirmed', {
        ...bound,
        url: 'https://verify.example.com/unrelated',
      })
    ).toBe(false);
    expect(await reportSignupProgress(attempt.id, 'email_confirmed', bound)).toBe(true);
  });
  test('stale mail cannot bind a new tab and forbidden URL schemes are rejected', async () => {
    const attempt = await startAttempt();
    await reportSignupProgress(attempt.id, 'submitted', caller);
    local.addresses = [{ id: 'inbox-A', address: 'A@inbox.example' }];
    messages = [
      {
        id: 'old',
        from: 'mail@example.com',
        received_at: Date.now() - 3_600_000,
        magicLinks: [{ url: 'https://verify.example.com/old' }],
      },
    ] as Email[];
    await openSignupVerificationLink('https://verify.example.com/old', 'inbox-A');
    expect(
      await getSignupAttempt({
        tabId: 100,
        frameId: 0,
        host: 'verify.example.com',
        url: opened[0].url,
      })
    ).toBeNull();
    await expect(openSignupVerificationLink('javascript:alert(1)')).rejects.toThrow('invalid-url');
  });
});
