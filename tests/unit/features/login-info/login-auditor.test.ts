import { afterAll, describe, expect, mock, test } from 'bun:test';

import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// login-auditor.ts imports address-status.ts → email-service.ts (providers.jsonc).
// Stub email-service so the module graph loads without the JSONC bundler loader.
mock.module('@/utils/email/email-service.js', () => ({
  loadProviderConfig: () => ({}),
}));

const { auditLoginHealth } = await import('@/features/login-info/login-auditor.js');

const NOW = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

type LoginInput = {
  id?: string;
  domain?: string;
  email?: string;
  password?: string;
  timestamp?: number;
};

function login(overrides: LoginInput = {}): {
  id: string;
  domain: string;
  email: string;
  password: string;
  timestamp: number;
  [key: string]: unknown;
} {
  return {
    id: overrides.id ?? 'login-1',
    domain: overrides.domain ?? 'example.com',
    email: overrides.email ?? 'user@example.com',
    password: overrides.password ?? 'pw-1',
    timestamp: overrides.timestamp ?? NOW,
  };
}
function address(
  overrides: Partial<{
    address: string;
    accountStatus: Address['accountStatus'];
    expiresAt: number;
  }> = {}
): Address {
  return {
    id: 'addr-1',
    address: overrides.address ?? 'user@example.com',
    provider: 'guerrilla',
    accountStatus: overrides.accountStatus ?? 'active',
    createdAt: NOW - DAY_MS,
    expiresAt: overrides.expiresAt ?? NOW + 60_000,
  };
}

describe('auditLoginHealth - clean credentials', () => {
  test('healthy login → score 100 and no issues', () => {
    const report = auditLoginHealth(login(), [login()], [address()]);
    expect(report.score).toBe(100);
    expect(report.issues).toEqual([]);
  });

  test('mailbox that exists but is not part of the login’s address list is not flagged', () => {
    const report = auditLoginHealth(login({ email: 'other@example.com' }), [login()], [address()]);
    expect(report.issues).toEqual([]);
    expect(report.score).toBe(100);
  });
});

describe('auditLoginHealth - expired / deleted temp mailbox (high)', () => {
  test('expired mailbox → high issue, -40', () => {
    const target = login({ email: 'temp@mail.com' });
    const report = auditLoginHealth(
      target,
      [target],
      [address({ address: 'temp@mail.com', expiresAt: NOW - 1000 })]
    );
    expect(report.score).toBe(60);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      kind: 'expired_mailbox',
      severity: 'high',
      messageKey: 'savedLoginInfo.healthExpiredMailbox',
    });
  });

  test('deleted mailbox → high issue', () => {
    const target = login({ email: 'temp@mail.com' });
    const report = auditLoginHealth(
      target,
      [target],
      [address({ address: 'temp@mail.com', accountStatus: 'deleted' })]
    );
    expect(report.issues[0]).toMatchObject({
      kind: 'expired_mailbox',
      severity: 'high',
    });
  });

  test('mailbox match is case-insensitive', () => {
    const target = login({ email: 'Temp@Mail.com' });
    const report = auditLoginHealth(
      target,
      [target],
      [address({ address: 'temp@mail.com', expiresAt: NOW - 1000 })]
    );
    expect(report.issues).toHaveLength(1);
  });
});

describe('auditLoginHealth - password reuse (medium)', () => {
  test('same password on another domain → medium issue, -25', () => {
    const a = login({ id: 'a', domain: 'site-a.com', password: 'shared' });
    const b = login({ id: 'b', domain: 'site-b.com', password: 'shared' });
    const report = auditLoginHealth(a, [a, b], []);
    expect(report.score).toBe(75);
    expect(report.issues[0]).toMatchObject({
      kind: 'reused_password',
      severity: 'medium',
      messageKey: 'savedLoginInfo.healthReusedPassword',
    });
  });

  test('same password on the same domain is not flagged', () => {
    const a = login({ id: 'a', domain: 'site.com', password: 'shared' });
    const b = login({ id: 'b', domain: 'site.com', password: 'shared', email: 'b@site.com' });
    const report = auditLoginHealth(a, [a, b], []);
    expect(report.issues).toEqual([]);
  });

  test('a blank password cannot trigger reuse', () => {
    const a = login({ password: '' });
    const b = login({ id: 'b', domain: 'other.com', password: '' });
    expect(auditLoginHealth(a, [a, b], []).issues).toEqual([]);
  });
});

describe('auditLoginHealth - stale credentials (low)', () => {
  test('older than 180 days → low issue, -15', () => {
    const stale = login({ timestamp: NOW - 181 * DAY_MS });
    const report = auditLoginHealth(stale, [stale], []);
    expect(report.score).toBe(85);
    expect(report.issues[0]).toMatchObject({
      kind: 'stale_login',
      severity: 'low',
      messageKey: 'savedLoginInfo.healthStaleLogin',
    });
  });

  test('fresh login is not stale', () => {
    const fresh = login({ timestamp: NOW - 10 * DAY_MS });
    expect(auditLoginHealth(fresh, [fresh], []).issues).toEqual([]);
  });

  test('missing / zero timestamp is treated as fresh (never stale)', () => {
    expect(auditLoginHealth(login({ timestamp: 0 }), [login({ timestamp: 0 })], []).issues).toEqual(
      []
    );
  });
});

describe('auditLoginHealth - stacking & floor', () => {
  test('expired + reused + stale stack (60 → 35 → 20)', () => {
    const target = login({
      id: 't',
      domain: 'site-a.com',
      email: 'temp@mail.com',
      password: 'shared',
      timestamp: NOW - 181 * DAY_MS,
    });
    const other = login({ id: 'o', domain: 'site-b.com', password: 'shared' });
    const report = auditLoginHealth(
      target,
      [target, other],
      [address({ address: 'temp@mail.com', expiresAt: NOW - 1000 })]
    );
    expect(report.score).toBe(20);
    expect(report.issues.map((i) => i.kind).sort()).toEqual([
      'expired_mailbox',
      'reused_password',
      'stale_login',
    ]);
  });

  test('score never drops below zero', () => {
    const target = login({
      id: 't',
      domain: 'a.com',
      email: 'x@mail.com',
      password: 'pw',
      timestamp: NOW - 200 * DAY_MS,
    });
    // Many other domains reuse the same password - reuse is still a single issue.
    const others = ['b.com', 'c.com', 'd.com', 'e.com'].map((domain, i) =>
      login({ id: `o-${i}`, domain, password: 'pw' })
    );
    const report = auditLoginHealth(
      target,
      [target, ...others],
      [address({ address: 'x@mail.com', accountStatus: 'deleted' })]
    );
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBe(20);
    expect(report.issues.filter((i) => i.kind === 'reused_password')).toHaveLength(1);
  });
});
