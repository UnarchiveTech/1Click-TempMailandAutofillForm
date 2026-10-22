import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { CredentialsHistoryItem } from '@/utils/types.js';

let records: CredentialsHistoryItem[] = [];
let session: Record<string, unknown> = {};
let failSession = false;
mock.module('wxt/browser', () => ({
  browser: {
    storage: {
      local: { get: async () => ({ loginInfo: structuredClone(records) }) },
      session: {
        get: async () => ({ sessionCredentials: structuredClone(session) }),
        set: async (data: { sessionCredentials: Record<string, unknown> }) => {
          if (failSession) throw new Error('session unavailable');
          session = data.sessionCredentials;
        },
      },
    },
  },
}));
mock.module('@/utils/storage/storage-keys.js', () => ({
  isRecord: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value),
}));
mock.module('@/utils/storage/storage-write.js', () => ({
  writeWithRetry: async (data: { loginInfo: CredentialsHistoryItem[] }) => {
    records = structuredClone(data.loginInfo);
  },
}));
mock.module('@/utils/logger.js', () => ({ logError: () => {} }));
afterAll(() => {
  mock.restore();
});
const { updatePendingSignupUsername } = await import(
  '@/entrypoints/background/credentials/username-recovery.js'
);
const { normalizeSavedLoginCredential } = await import(
  '@/utils/security/login-credential-normalization.js'
);
const update = {
  credentialId: 'signup-1',
  domain: 'signup.example',
  expectedUsername: 'alice',
  username: 'alice1234',
};
beforeEach(() => {
  failSession = false;
  records = [
    {
      id: 'signup-1',
      domain: 'signup.example',
      timestamp: 1,
      username: 'alice',
      email: 'test@temp.example',
      password: 'encrypted-secret',
      identityId: 'identity-1',
      signupStatus: 'submitted',
      verified: false,
    },
  ];
  session = {
    signupCredentialId: 'signup-1',
    website: 'signup.example',
    username: 'alice',
    password: 'session-secret',
    email: 'test@temp.example',
  };
});
describe('pending signup username updates', () => {
  test('normalization preserves the record ID used for targeted updates', () => {
    expect(normalizeSavedLoginCredential({ ...records[0] })?.id).toBe('signup-1');
  });
  test('changes only username, preserving password, email, identity and outcome', async () => {
    const before = structuredClone(records[0]);
    expect(await updatePendingSignupUsername(update)).toEqual({ success: true });
    expect(records[0]).toEqual({ ...before, username: 'alice1234' });
    expect(session.username).toBe('alice1234');
    expect(session.password).toBe('session-secret');
  });
  test('late and concurrent edits cannot overwrite a newer username', async () => {
    const results = await Promise.all([
      updatePendingSignupUsername(update),
      updatePendingSignupUsername({ ...update, username: 'late-value' }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(records[0]?.username).toBe('alice1234');
  });
  test('record deletion is not undone by a pending update', async () => {
    records = [];
    expect((await updatePendingSignupUsername(update)).success).toBe(false);
    expect(records).toEqual([]);
  });
  test('wrong domain and wrong record ID cannot modify another login', async () => {
    expect(
      (await updatePendingSignupUsername({ ...update, domain: 'other.example' })).success
    ).toBe(false);
    expect(
      (await updatePendingSignupUsername({ ...update, credentialId: 'other-id' })).success
    ).toBe(false);
    expect(records[0]?.username).toBe('alice');
  });
  test('verified and legacy saved logins cannot be modified through recovery', async () => {
    const record = records[0];
    if (!record) throw new Error('Missing fixture login');
    record.verified = true;
    expect((await updatePendingSignupUsername(update)).success).toBe(false);
    record.verified = false;
    record.signupStatus = undefined;
    expect((await updatePendingSignupUsername(update)).success).toBe(false);
  });
  test('another tab session is preserved', async () => {
    session.signupCredentialId = 'another-signup';
    expect((await updatePendingSignupUsername(update)).success).toBe(true);
    expect(session.username).toBe('alice');
  });
  test('a session failure does not report an already saved login as failed', async () => {
    failSession = true;
    expect((await updatePendingSignupUsername(update)).success).toBe(true);
    expect(records[0]?.username).toBe('alice1234');
  });
  test('refuses blank or overlong usernames', async () => {
    for (const username of ['', ' ', 'x'.repeat(513)]) {
      expect((await updatePendingSignupUsername({ ...update, username })).success).toBe(false);
    }
    expect(records[0]?.username).toBe('alice');
  });
});
