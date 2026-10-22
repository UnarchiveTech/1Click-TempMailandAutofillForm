import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of tools.js ──────────────────
// webmcp/tools.ts imports { browser } from 'wxt/browser' (undefined outside a
// real extension context) and delegates provider/network work to
// address-manager. Both are stubbed below with in-memory fakes.

/** In-memory chrome.storage.local mirror (same key semantics). */
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const mockSendMessage = mock(async () => ({ success: false }));

const fakeBrowser = {
  tabs: {
    get: async (id: number) => ({ url: sessionStore[`webmcpOnce_${id}`], status: 'complete' }),
  },
  runtime: {
    id: 'test-extension',
    sendMessage: mockSendMessage,
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
};

// storage-keys.ts (getAddresses / getStoredEmailsMap / getArchivedEmailsMap)
// references the bare GLOBAL `browser` that WXT installs at extension runtime
// rather than importing it - provide it here too.
Object.assign(globalThis, { browser: fakeBrowser });

mock.module('wxt/browser', () => ({
  browser: fakeBrowser,
}));

// tools.ts imports these via '../address/address-manager.js'. mock.module resolves
// './'-prefixed specifiers relative to THIS test file, so point at the same
// absolute module and stub only the provider/network boundary.
const mockCheckNewEmails = mock(async (): Promise<Email[]> => []);
const mockCreateAddress = mock(async (): Promise<Address> => makeAddress());
const mockDeleteAddress = mock(
  async (): Promise<{ success: boolean; error?: string }> => ({
    success: true,
  })
);

mock.module('../../../../../src/entrypoints/background/address/address-manager.js', () => ({
  checkNewEmails: mockCheckNewEmails,
  createAddress: mockCreateAddress,
  deleteAddress: mockDeleteAddress,
}));

const { handleWebmcpTool, _resetWebmcpRateLimitsForTest } = await import(
  '@/entrypoints/background/webmcp/tools.js'
);
const { archivedEmailsByAddressKey, storedEmailsByAddressKey } = await import(
  '@/utils/storage/storage-keys.js'
);

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Seed ID-keyed email bags through the storage index (3.0 layout). */
function seedMailbox(
  id: string,
  address: string,
  opts: { stored?: Email[]; archived?: Email[] } = {}
): void {
  const index = (store.emailStorageAddressIndex as Record<string, string>) || {};
  index[id] = address;
  store.emailStorageAddressIndex = index;
  if (opts.stored) store[storedEmailsByAddressKey(id)] = opts.stored;
  if (opts.archived) store[archivedEmailsByAddressKey(id)] = opts.archived;
}

const NOW = Date.now();

function makeAddress(
  overrides: Partial<{
    id: string;
    address: string;
    provider: string;
    createdAt: number;
    expiresAt: number;
    accountStatus: 'active' | 'archived' | 'deleted';
    autoExtend?: boolean;
    instanceUrl?: string;
    token?: string;
    sidToken?: string;
  }> = {}
) {
  return {
    id: overrides.id ?? 'inbox-1',
    address: overrides.address ?? 'alpha@test.com',
    provider: overrides.provider ?? 'guerrilla',
    createdAt: overrides.createdAt ?? NOW - 60_000,
    expiresAt: overrides.expiresAt ?? NOW + 60_000,
    accountStatus: overrides.accountStatus ?? ('active' as const),
    autoExtend: overrides.autoExtend,
    instanceUrl: overrides.instanceUrl,
    token: overrides.token,
    sidToken: overrides.sidToken,
  };
}

function makeEmail(
  overrides: Partial<{
    id: string;
    subject: string;
    body: string;
    body_plain: string;
    from: string;
    from_name: string;
    received_at: number;
    otp: string | null;
    local_only?: boolean;
    hasAttachment?: boolean;
    attachments?: { filename: string; mimeType: string }[];
    magicLinks?: { url: string; label?: string; score: number }[];
  }> = {}
) {
  return {
    id: overrides.id ?? 'e1',
    subject: overrides.subject ?? 'Your verification code',
    body: overrides.body ?? 'Code: 123456',
    body_plain: overrides.body_plain ?? 'Code: 123456',
    from: overrides.from ?? 'no-reply@github.com',
    from_name: overrides.from_name ?? 'GitHub',
    received_at: overrides.received_at ?? Math.floor(NOW / 1000) - 10,
    otp: overrides.otp ?? '123456',
    ...overrides,
  };
}

function seedActiveAddress(record = makeAddress()) {
  store.addresses = [record];
  store.activeAddressId = record.id;
  return record;
}

/** All addresses removed → every "active inbox" tool must error cleanly. */
function clearAddresses() {
  delete store.addresses;
  delete store.activeAddressId;
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  _resetWebmcpRateLimitsForTest();
  mockCheckNewEmails.mockClear();
  mockCreateAddress.mockClear();
  mockDeleteAddress.mockClear();
  mockSendMessage.mockClear();
});

// ── Argument validation ──────────────────────────────────────────────────────

describe('argument validation', () => {
  test('rejects non-object args for any tool', async () => {
    const res = await handleWebmcpTool('get_active_email', [1, 2, 3]);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Tool args must be a JSON object.');
  });

  test('rejects unknown tools with the supported list', async () => {
    const res = await handleWebmcpTool('definitely_not_a_tool', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unknown WebMCP tool "definitely_not_a_tool"');
    expect(res.error).toContain('Supported:');
    expect(res.error).toContain('burn_inbox');
  });

  test('get_email requires a string emailId', async () => {
    const missing = await handleWebmcpTool('get_email', {});
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('emailId is required');

    const wrongType = await handleWebmcpTool('get_email', { emailId: 42 });
    expect(wrongType.success).toBe(false);
    expect(wrongType.error).toContain('emailId is required');
  });

  test('get_otp_from requires a string sender', async () => {
    const res = await handleWebmcpTool('get_otp_from', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('sender is required');
  });

  test('uses directional opt-in matching: parent opt-in covers subdomains only', async () => {
    seedActiveAddress();
    store.webmcpAccessList = ['example.com'];
    const child = await handleWebmcpTool(
      'get_active_email',
      {},
      801,
      'https://login.example.com/signup'
    );
    expect(child.success).toBe(true);

    store.webmcpAccessList = ['login.example.com'];
    const parent = await handleWebmcpTool(
      'get_active_email',
      {},
      802,
      'https://example.com/signup'
    );
    expect(parent.success).toBe(false);
    expect(parent.error).toContain('WebMCP access is not enabled');
  });

  test('dispatcher permits a tab grant once and denies other tabs and revoked grants', async () => {
    seedActiveAddress();
    const url = 'https://shop.example.com/signup';
    store.webmcpSiteDecisions = { 'shop.example.com': 'once' };
    sessionStore.webmcpOnce_807 = url;
    expect((await handleWebmcpTool('get_active_email', {}, 807, url)).success).toBe(true);
    expect((await handleWebmcpTool('get_active_email', {}, 808, url)).success).toBe(false);
    delete sessionStore.webmcpOnce_807;
    expect((await handleWebmcpTool('get_active_email', {}, 807, url)).success).toBe(false);
  });

  test('fails closed when a supplied tab URL yields no hostname', async () => {
    seedActiveAddress();

    // A page-supplied URL that parses to NO hostname must be denied, not
    // treated as a trusted internal caller. The opt-in list here is broad, so
    // only the missing host can deny: every case below used to return the
    // mailbox with no consent AND bypass the per-tab rate limit.
    store.webmcpAccessList = ['example.com', 'test.com'];
    for (const hostlessUrl of [
      'not a url',
      'data:text/html,<p>x</p>',
      'about:blank',
      'file:///etc/passwd',
      '',
    ]) {
      const res = await handleWebmcpTool('get_active_email', {}, 901, hostlessUrl);
      expect(res.success).toBe(false);
      expect(res.error).toContain('WebMCP access is not enabled');
    }

    // A mutation tool is denied the same way and never reaches deletion.
    const burn = await handleWebmcpTool('burn_inbox', {}, 902, 'about:blank');
    expect(burn.success).toBe(false);
    expect(burn.error).toContain('WebMCP access is not enabled');
    expect(mockDeleteAddress).not.toHaveBeenCalled();

    // Control: an opted-in host still works, so the guard denies on the
    // underivable host - not merely on the presence of a URL.
    const allowed = await handleWebmcpTool(
      'get_active_email',
      {},
      903,
      'https://example.com/signup'
    );
    expect(allowed.success).toBe(true);

    // And the trusted arm is exactly "no tab URL at all" (the dispatcher
    // refuses context-less page senders), never "a URL we cannot read".
    const internal = await handleWebmcpTool('get_active_email', {});
    expect(internal.success).toBe(true);
  });

  test('get_latest_emails clamps limit to [1, 10] and falls back on garbage', async () => {
    seedActiveAddress();
    const many = Array.from({ length: 30 }, (_, i) =>
      makeEmail({ id: `e${i}`, received_at: Math.floor(NOW / 1000) - i })
    );
    mockCheckNewEmails.mockImplementation(async () => many);

    const capped = await handleWebmcpTool('get_latest_emails', { limit: 999 });
    expect(capped.success).toBe(true);
    expect((capped.result as { count: number }).count).toBe(10);

    const fallback = await handleWebmcpTool('get_latest_emails', { limit: 'garbage' });
    expect(fallback.success).toBe(true);
    expect((fallback.result as { count: number }).count).toBe(5);
  }, 10000);

  test('search_emails coerces hasOtp strings and clamps limit to [1, 20]', async () => {
    seedActiveAddress();
    mockCheckNewEmails.mockImplementation(async () => []);

    const res = await handleWebmcpTool('search_emails', {
      query: 'verify',
      hasOtp: 'true',
      senderDomain: 'github.com',
      recipient: 'alpha@test.com',
      limit: 999,
    });
    expect(res.success).toBe(true);
    expect(mockCheckNewEmails).toHaveBeenCalledWith('inbox-1', {
      searchQuery: 'verify',
      hasOTP: true,
      senderDomain: 'github.com',
      recipient: 'alpha@test.com',
    });
    expect((res.result as { limit?: number }).limit).toBeUndefined(); // limit is not echoed
  });
});

// ── Error paths with no active inbox ─────────────────────────────────────────

describe('error paths when there is no active inbox', () => {
  test('get_active_email errors', async () => {
    clearAddresses();
    const res = await handleWebmcpTool('get_active_email', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('No active temporary inbox');
  });

  test('get_latest_emails errors without reaching the provider', async () => {
    clearAddresses();
    const res = await handleWebmcpTool('get_latest_emails', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('No active temporary inbox');
    expect(mockCheckNewEmails).not.toHaveBeenCalled();
  });

  test('search_emails errors', async () => {
    clearAddresses();
    const res = await handleWebmcpTool('search_emails', { query: 'otp' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No active temporary inbox');
    expect(mockCheckNewEmails).not.toHaveBeenCalled();
  });

  test('burn_inbox errors', async () => {
    clearAddresses();
    const res = await handleWebmcpTool('burn_inbox', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('No active temporary inbox to burn');
    expect(mockDeleteAddress).not.toHaveBeenCalled();
  });

  test('get_latest_otp errors when nothing has arrived', async () => {
    clearAddresses();
    const res = await handleWebmcpTool('get_latest_otp', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('No OTP received yet');
  });

  test('get_otp_from errors when no sender matches', async () => {
    store.storedEmails = {
      'alpha@test.com': [makeEmail({ from: 'billing@stripe.com', from_name: 'Stripe' })],
    };
    const res = await handleWebmcpTool('get_otp_from', { sender: 'github.com' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No OTP found from a sender matching "github.com"');
  });

  test('get_email errors for an unknown id', async () => {
    const res = await handleWebmcpTool('get_email', { emailId: 'nope' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No stored email found with id "nope"');
  });

  test('list_addresses succeeds with an empty list (does not need an inbox)', async () => {
    clearAddresses();
    const res = await handleWebmcpTool('list_addresses', {});
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ count: 0, addresses: [] });
  });
});

// ── Success paths ────────────────────────────────────────────────────────────

describe('get_active_email / list_addresses', () => {
  test('get_active_email returns the active address, expiry, and instance', async () => {
    const record = seedActiveAddress(
      makeAddress({
        id: 'b1',
        address: 'beta@test.com',
        expiresAt: NOW + 5_000,
        instanceUrl: 'https://alphac.qzz.io/api/v2',
        token: 'secret-token',
        sidToken: 'secret-sid',
      })
    );
    const res = await handleWebmcpTool('get_active_email', {});
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({
      address: 'beta@test.com',
      addressId: 'b1',
      provider: 'guerrilla',
      providerDisplay: 'guerrilla', // sendMessage mock returns success:false → fallback
      expiresAt: record.expiresAt,
      accountStatus: 'active',
      instanceUrl: 'https://alphac.qzz.io/api/v2',
    });
    // The MCP surface must expose instance info but never auth tokens.
    expect(res.result).not.toHaveProperty('token');
    expect(res.result).not.toHaveProperty('sidToken');
  });

  test('list_addresses computes status and flags the active inbox', async () => {
    store.addresses = [
      makeAddress({ id: 'live', address: 'a@test.com', autoExtend: true }),
      makeAddress({
        id: 'expired',
        address: 'b@test.com',
        expiresAt: NOW - 1_000,
        accountStatus: 'active',
      }),
      makeAddress({ id: 'arch', address: 'c@test.com', accountStatus: 'archived' }),
      makeAddress({ id: 'gone', address: 'd@test.com', accountStatus: 'deleted' }),
    ];
    store.activeAddressId = 'live';

    const res = await handleWebmcpTool('list_addresses', {});
    expect(res.success).toBe(true);
    const addresses = (res.result as { addresses: Array<Record<string, unknown>> }).addresses;
    expect(addresses.map((i) => [i.id, i.status])).toEqual([
      ['live', 'active'],
      ['expired', 'expired'],
      ['arch', 'archived'],
      ['gone', 'deleted'],
    ]);
    expect(addresses.map((i) => i.isActive)).toEqual([true, false, false, false]);
    expect(addresses[0].autoExtend).toBe(true);
  });

  test('list_addresses exposes the non-sensitive instanceUrl but never tokens', async () => {
    store.addresses = [
      makeAddress({
        id: 'inst',
        address: 'a@burner.kiwi',
        provider: 'burner',
        instanceUrl: 'https://alphac.qzz.io/api/v2',
        token: 'secret-token',
        sidToken: 'secret-sid',
      }),
      makeAddress({ id: 'plain', address: 'b@test.com', instanceUrl: undefined }),
    ];
    store.activeAddressId = 'inst';

    const res = await handleWebmcpTool('list_addresses', {});
    expect(res.success).toBe(true);
    const addresses = (res.result as { addresses: Array<Record<string, unknown>> }).addresses;
    expect(addresses[0].instanceUrl).toBe('https://alphac.qzz.io/api/v2');
    expect(addresses[1].instanceUrl).toBeNull();
    for (const entry of addresses) {
      expect(entry).not.toHaveProperty('token');
      expect(entry).not.toHaveProperty('sidToken');
    }
  });
});

describe('get_otp_from', () => {
  test('returns the newest OTP from the matching sender domain', async () => {
    seedMailbox('inbox-1', 'alpha@test.com', {
      stored: [
        makeEmail({
          id: 'old',
          from: 'no-reply@github.com',
          otp: '111111',
          received_at: Math.floor(NOW / 1000) - 100,
        }),
        makeEmail({
          id: 'new',
          from: 'no-reply@github.com',
          otp: '222222',
          received_at: Math.floor(NOW / 1000) - 10,
        }),
        makeEmail({
          id: 'newest-other',
          from: 'billing@stripe.com',
          otp: '333333',
          received_at: Math.floor(NOW / 1000) - 1,
        }),
      ],
    });

    const res = await handleWebmcpTool('get_otp_from', { sender: 'github.com' });
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({
      otp: '222222',
      sender: 'no-reply@github.com',
      address: 'alpha@test.com',
    });
  });

  test('uses the cached latestOtp fast path when its sender matches', async () => {
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    store.latestOtp = {
      otp: '999999',
      sender: 'no-reply@github.com',
      senderName: 'GitHub',
      received_at: Math.floor(NOW / 1000) - 2,
      recipient: 'alpha@test.com',
    };
    const res = await handleWebmcpTool('get_otp_from', { sender: 'github' });
    expect(res.success).toBe(true);
    expect((res.result as { otp: string }).otp).toBe('999999');
    expect((res.result as { senderName: string }).senderName).toBe('GitHub');
  });

  test('skips a STALE cache and falls through to the sender-matched inbox scan', async () => {
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    seedMailbox('a', 'alpha@test.com', {
      stored: [makeEmail({ id: 'gh1', from: 'no-reply@github.com', otp: '222222' })],
    });
    store.latestOtp = {
      otp: '111111',
      sender: 'no-reply@github.com',
      senderName: 'GitHub',
      received_at: Math.floor(Date.now() / 1000) - 11 * 60,
      recipient: 'alpha@test.com',
    };

    const res = await handleWebmcpTool('get_otp_from', { sender: 'github' });
    expect(res.success).toBe(true);
    expect((res.result as { otp: string }).otp).toBe('222222');
  });

  test('skips a cache record addressed to ANOTHER inbox and scans instead', async () => {
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    seedMailbox('a', 'alpha@test.com', {
      stored: [makeEmail({ id: 'gh2', from: 'no-reply@github.com', otp: '333333' })],
    });
    store.latestOtp = {
      otp: '111111',
      sender: 'no-reply@github.com',
      senderName: 'GitHub',
      received_at: Math.floor(Date.now() / 1000) - 2,
      recipient: 'other@test.com',
    };

    const res = await handleWebmcpTool('get_otp_from', { sender: 'github' });
    expect(res.success).toBe(true);
    expect((res.result as { otp: string }).otp).toBe('333333');
  });

  test('skips the "------" placeholder OTPs', async () => {
    store.storedEmails = {
      'alpha@test.com': [
        makeEmail({ from: 'no-reply@github.com', otp: '------' }),
        makeEmail({ from: 'billing@stripe.com', otp: '888888' }),
      ],
    };
    const res = await handleWebmcpTool('get_otp_from', { sender: 'github.com' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('No OTP found');
  });
});

describe('get_email', () => {
  test('denies unapproved pages before looking up email ids', async () => {
    seedMailbox('inbox-1', 'alpha@test.com', {
      stored: [makeEmail({ id: 'known-id' })],
    });
    const known = await handleWebmcpTool(
      'get_email',
      { emailId: 'known-id' },
      41,
      'https://unapproved.example/'
    );
    const unknown = await handleWebmcpTool(
      'get_email',
      { emailId: 'missing-id' },
      41,
      'https://unapproved.example/'
    );

    expect(known.success).toBe(false);
    expect(unknown.success).toBe(false);
    expect(known.error).toBe(unknown.error);
    expect(known.error).toContain('WebMCP access is not enabled');
  });

  test('returns full body, metadata, attachments, and magic links', async () => {
    seedMailbox('inbox-1', 'alpha@test.com', {
      stored: [
        makeEmail({
          id: 'deep',
          subject: 'Reset your password',
          from: 'security@example.com',
          from_name: 'Example Security',
          body: 'Click here to reset: https://example.com/reset?token=abc',
          body_plain: 'Click here to reset: https://example.com/reset?token=abc',
          otp: null,
          hasAttachment: true,
          attachments: [{ filename: 'receipt.pdf', mimeType: 'application/pdf' }],
          magicLinks: [
            { url: 'https://example.com/reset?token=abc', label: 'Reset password', score: 10 },
          ],
        }),
      ],
    });

    const res = await handleWebmcpTool('get_email', { emailId: 'deep' });
    expect(res.success).toBe(true);
    const r = res.result as Record<string, unknown>;
    expect(r).toMatchObject({
      id: 'deep',
      address: 'alpha@test.com',
      from: 'security@example.com',
      subject: 'Reset your password',
      hasOtp: false,
      otp: undefined,
      hasAttachment: true,
      bodyTruncated: false,
    });
    expect((r.attachments as { filename: string }[])[0].filename).toBe('receipt.pdf');
    expect((r.magicLinks as { url: string }[])[0].url).toContain('/reset?token=abc');
    expect(r.body).toContain('https://example.com/reset?token=abc');
  });

  test('truncates bodies over the 10k cap', async () => {
    seedMailbox('inbox-1', 'alpha@test.com', {
      stored: [makeEmail({ id: 'big', body_plain: 'x'.repeat(12_000) })],
    });
    const res = await handleWebmcpTool('get_email', { emailId: 'big' });
    expect(res.success).toBe(true);
    const r = res.result as { body: string; bodyTruncated: boolean };
    expect(r.bodyTruncated).toBe(true);
    expect(r.body.length).toBe(10_000);
  });

  test('disambiguates by address when ids collide across addresses', async () => {
    store.addresses = [
      makeAddress({ id: 'a', address: 'a@test.com' }),
      makeAddress({ id: 'b', address: 'b@test.com' }),
    ];
    store.activeAddressId = 'a';
    seedMailbox('a', 'a@test.com', {
      stored: [makeEmail({ id: 'dup', subject: 'from-a', otp: null })],
    });
    seedMailbox('b', 'b@test.com', {
      stored: [makeEmail({ id: 'dup', subject: 'from-b', otp: null })],
    });

    // No address → active inbox wins.
    const implicit = await handleWebmcpTool('get_email', { emailId: 'dup' });
    expect((implicit.result as { subject: string }).subject).toBe('from-a');

    // Explicit address overrides.
    const explicit = await handleWebmcpTool('get_email', {
      emailId: 'dup',
      address: 'b@test.com',
    });
    expect((explicit.result as { subject: string }).subject).toBe('from-b');
    expect((explicit.result as { address: string }).address).toBe('b@test.com');
  });

  test('finds emails stored only in the archived bag', async () => {
    seedMailbox('old-1', 'old@test.com', {
      archived: [makeEmail({ id: 'arch1', subject: 'old news', otp: null })],
    });
    const res = await handleWebmcpTool('get_email', { emailId: 'arch1' });
    expect(res.success).toBe(true);
    expect((res.result as { address: string }).address).toBe('old@test.com');
  });
});

describe('get_latest_emails / search_emails', () => {
  test('get_latest_emails persists API messages and sorts newest first', async () => {
    const record = seedActiveAddress();
    mockCheckNewEmails.mockImplementation(async () => [
      makeEmail({ id: 'api1', received_at: Math.floor(NOW / 1000) - 5 }),
      makeEmail({ id: 'api2', received_at: Math.floor(NOW / 1000) - 1 }),
      makeEmail({ id: 'local', received_at: Math.floor(NOW / 1000) - 2, local_only: true }),
    ]);

    const res = await handleWebmcpTool('get_latest_emails', {});
    expect(res.success).toBe(true);
    const emails = (res.result as { emails: Array<{ id: string }> }).emails;
    expect(emails.map((e) => e.id)).toEqual(['api2', 'local', 'api1']);

    // Only non-local API messages were persisted (storeNewMessages path).
    const stored = store[storedEmailsByAddressKey(record.id)] as Array<{ id: string }>;
    expect(stored.map((e) => e.id).sort()).toEqual(['api1', 'api2']);
  });

  test('search_emails passes filters through to checkNewEmails', async () => {
    seedActiveAddress();
    mockCheckNewEmails.mockImplementation(async () => []);

    const res = await handleWebmcpTool('search_emails', {
      query: 'verify',
      senderDomain: 'github.com',
    });
    expect(res.success).toBe(true);
    expect(mockCheckNewEmails).toHaveBeenCalledWith('inbox-1', {
      searchQuery: 'verify',
      senderDomain: 'github.com',
    });
  });

  test('demoMode serves the stored bag and never calls checkNewEmails', async () => {
    const record = seedActiveAddress();
    seedMailbox(record.id, record.address, {
      stored: [makeEmail({ id: 'demo1', otp: '999999' })],
    });
    store.demoMode = true;
    mockCheckNewEmails.mockImplementation(async () => {
      throw new Error('demo mode must never hit providers');
    });

    const latest = await handleWebmcpTool('get_latest_emails', {});
    expect(latest.success).toBe(true);
    expect((latest.result as { emails: Array<{ id: string }> }).emails.map((e) => e.id)).toEqual([
      'demo1',
    ]);
    expect(mockCheckNewEmails).not.toHaveBeenCalled();
    // No API-persistence write for demo mail.
    expect(store[storedEmailsByAddressKey(record.id)]).toEqual([
      expect.objectContaining({ id: 'demo1' }),
    ]);

    const search = await handleWebmcpTool('search_emails', { query: 'verification' });
    expect(search.success).toBe(true);
    expect((search.result as { count: number }).count).toBe(1);
    expect(mockCheckNewEmails).not.toHaveBeenCalled();
  });

  test('a per-address demo inbox serves the stored bag even without global demoMode', async () => {
    const record = seedActiveAddress(makeAddress({ provider: 'demo' }));
    seedMailbox(record.id, record.address, {
      stored: [makeEmail({ id: 'demo2' })],
    });
    mockCheckNewEmails.mockImplementation(async () => {
      throw new Error('demo inbox must never hit providers');
    });

    const res = await handleWebmcpTool('get_latest_emails', {});
    expect(res.success).toBe(true);
    expect((res.result as { emails: Array<{ id: string }> }).emails.map((e) => e.id)).toEqual([
      'demo2',
    ]);
    expect(mockCheckNewEmails).not.toHaveBeenCalled();
  });
});

describe('get_latest_otp', () => {
  test('returns the cached latestOtp when present', async () => {
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    store.latestOtp = {
      otp: '555555',
      sender: 'no-reply@stripe.com',
      senderName: 'Stripe',
      received_at: Math.floor(NOW / 1000) - 3,
      recipient: 'alpha@test.com',
    };
    const res = await handleWebmcpTool('get_latest_otp', {});
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ otp: '555555', sender: 'no-reply@stripe.com' });
  });

  test('falls back to scanning stored emails', async () => {
    seedMailbox('inbox-1', 'alpha@test.com', {
      stored: [makeEmail({ id: 's1', otp: '777777' })],
    });
    const res = await handleWebmcpTool('get_latest_otp', {});
    expect(res.success).toBe(true);
    expect((res.result as { otp: string }).otp).toBe('777777');
  });

  test('refuses a STALE cached code (>10min, message expired/deleted since) and falls back to the inbox scan', async () => {
    // Same staleness guard as the copy-latest-otp shortcut: expiry-archiving,
    // deletion and archived-cap eviction never clear the latestOtp key, so
    // without the age bound the cache path kept serving codes whose message
    // no longer exists.
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    seedMailbox('a', 'alpha@test.com', {
      stored: [makeEmail({ id: 'fresh1', otp: '777777' })],
    });
    store.latestOtp = {
      otp: '111111',
      sender: 'no-reply@stripe.com',
      senderName: 'Stripe',
      received_at: Math.floor(Date.now() / 1000) - 11 * 60,
      recipient: 'alpha@test.com',
    };

    const res = await handleWebmcpTool('get_latest_otp', {});
    expect(res.success).toBe(true);
    expect((res.result as { otp: string }).otp).toBe('777777');
    expect((res.result as { otp: string }).otp).not.toBe('111111');
  });

  test('refuses a cache record without received_at (cannot prove freshness)', async () => {
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    seedMailbox('a', 'alpha@test.com', {
      stored: [makeEmail({ id: 'fresh2', otp: '777777' })],
    });
    store.latestOtp = {
      otp: '111111',
      sender: 'no-reply@stripe.com',
      recipient: 'alpha@test.com',
    };

    const res = await handleWebmcpTool('get_latest_otp', {});
    expect(res.success).toBe(true);
    expect((res.result as { otp: string }).otp).toBe('777777');
  });

  test('refuses a cache record addressed to ANOTHER inbox (recipient guard)', async () => {
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    seedMailbox('a', 'alpha@test.com', {
      stored: [makeEmail({ id: 'own1', otp: '777777' })],
    });
    store.latestOtp = {
      otp: '222222',
      sender: 'no-reply@stripe.com',
      senderName: 'Stripe',
      received_at: Math.floor(Date.now() / 1000) - 3,
      recipient: 'other@test.com',
    };

    const res = await handleWebmcpTool('get_latest_otp', {});
    expect(res.success).toBe(true);
    expect((res.result as { otp: string }).otp).toBe('777777');
  });

  test('errors when the only OTP is a stale cache and nothing fresh is stored', async () => {
    seedActiveAddress(makeAddress({ id: 'a', address: 'alpha@test.com' }));
    store.latestOtp = {
      otp: '111111',
      sender: 'no-reply@stripe.com',
      received_at: Math.floor(Date.now() / 1000) - 11 * 60,
      recipient: 'alpha@test.com',
    };

    const res = await handleWebmcpTool('get_latest_otp', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('No OTP received yet');
  });
});

// ── Side-effecting tools ─────────────────────────────────────────────────────

describe('create_temp_email', () => {
  test('creates an inbox, makes it active, and returns the fresh address', async () => {
    clearAddresses();
    mockCreateAddress.mockImplementation(async () =>
      makeAddress({ id: 'fresh', address: 'fresh@test.com' })
    );

    const res = await handleWebmcpTool('create_temp_email', {});
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ address: 'fresh@test.com', addressId: 'fresh' });
    expect(mockCreateAddress).toHaveBeenCalledTimes(1);
    expect(mockCreateAddress).toHaveBeenCalledWith();
    expect(store.activeAddressId).toBe('fresh');
  });

  test('is rate-limited per tab', async () => {
    mockCreateAddress.mockImplementation(async () =>
      makeAddress({ id: 'x', address: 'x@test.com' })
    );
    const first = await handleWebmcpTool('create_temp_email', {}, 501);
    expect(first.success).toBe(true);

    const second = await handleWebmcpTool('create_temp_email', {}, 501);
    expect(second.success).toBe(false);
    expect(second.error).toContain('Please wait');
  });

  test('propagates provider errors as tool errors', async () => {
    mockCreateAddress.mockImplementation(async () => {
      throw new Error('provider api failed');
    });
    const res = await handleWebmcpTool('create_temp_email', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('provider api failed');
  });

  test('gates page-context creates behind a gesture token (mirrors burn_inbox)', async () => {
    mockCreateAddress.mockImplementation(async () =>
      makeAddress({ id: 'g1', address: 'g1@test.com' })
    );
    // Opt the page in - opt-in alone must NOT authorize mailbox creation.
    store.webmcpAccessList = ['evil.example'];

    const denied = await handleWebmcpTool(
      'create_temp_email',
      {},
      503,
      'https://evil.example/page'
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toContain('requires confirmation');
    expect(mockCreateAddress).not.toHaveBeenCalled();

    // A token minted for the create-inbox purpose authorizes the same call.
    const { generateGestureToken } = await import('@/utils/ui/gesture-token.js');
    const token = await generateGestureToken('create-inbox', 503);
    const allowed = await handleWebmcpTool(
      'create_temp_email',
      { gestureToken: token.token },
      503,
      'https://evil.example/page'
    );
    expect(allowed.success).toBe(true);
    expect(mockCreateAddress).toHaveBeenCalledTimes(1);
    expect(store.activeAddressId).toBe('g1');
  });

  test('rejects a page token minted for a different purpose', async () => {
    mockCreateAddress.mockImplementation(async () => makeAddress());
    store.webmcpAccessList = ['evil.example'];
    const { generateGestureToken } = await import('@/utils/ui/gesture-token.js');
    const wrong = await generateGestureToken('burn-inbox', 504);
    const res = await handleWebmcpTool(
      'create_temp_email',
      { gestureToken: wrong.token },
      504,
      'https://evil.example/page'
    );
    expect(res.success).toBe(false);
    expect(mockCreateAddress).not.toHaveBeenCalled();
  });
});

describe('burn_inbox', () => {
  test('deletes the active inbox and clears the active selection', async () => {
    seedActiveAddress(makeAddress({ id: 'b1', address: 'burn@test.com' }));
    mockDeleteAddress.mockImplementation(async () => ({ success: true }));

    const res = await handleWebmcpTool('burn_inbox', {});
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ address: 'burn@test.com', addressId: 'b1' });
    expect(mockDeleteAddress).toHaveBeenCalledWith('b1', false);
    expect(store.activeAddressId).toBeUndefined();
  });

  test('does not clear a selection that changed while deleting (race guard)', async () => {
    seedActiveAddress(makeAddress({ id: 'b1', address: 'burn@test.com' }));
    mockDeleteAddress.mockImplementation(async () => {
      store.activeAddressId = 'other'; // another path switched the active inbox mid-delete
      return { success: true };
    });

    const res = await handleWebmcpTool('burn_inbox', {});
    expect(res.success).toBe(true);
    expect(store.activeAddressId).toBe('other');
  });

  test('surfaces deleteAddress failures', async () => {
    seedActiveAddress();
    mockDeleteAddress.mockImplementation(async () => ({ success: false, error: 'gone' }));
    const res = await handleWebmcpTool('burn_inbox', {});
    expect(res.success).toBe(false);
    expect(res.error).toBe('gone');
  });

  test('translates deleteAddress locale keys into agent-facing English', async () => {
    seedActiveAddress();
    mockDeleteAddress.mockImplementation(async () => ({
      success: false,
      error: 'errors.addressNotFound',
    }));
    const res = await handleWebmcpTool('burn_inbox', {});
    expect(res.success).toBe(false);
    expect(res.error).toBe('Failed to delete the active inbox.');
  });

  test('is rate-limited per tab', async () => {
    seedActiveAddress();
    mockDeleteAddress.mockImplementation(async () => ({ success: true }));
    const first = await handleWebmcpTool('burn_inbox', {}, 502);
    expect(first.success).toBe(true);

    const second = await handleWebmcpTool('burn_inbox', {}, 502);
    expect(second.success).toBe(false);
    expect(second.error).toContain('Please wait');
  });

  test('checks cooldown BEFORE consuming a single-use gesture token', async () => {
    // Prime the GLOBAL cooldown with an extension-internal call (no tab URL →
    // no gesture gate) so a subsequent page call is inside the 10s window.
    seedActiveAddress();
    mockDeleteAddress.mockImplementation(async () => ({ success: true }));
    const prime = await handleWebmcpTool('burn_inbox', {});
    expect(prime.success).toBe(true);

    // Page caller (tab URL present) so the gesture gate applies; opted in.
    store.webmcpAccessList = ['evil.example'];

    // A page call with a VALID gesture token while the cooldown is active:
    // the cooldown must reject it WITHOUT consuming the single-use token.
    // (Old ordering - gesture gate first - would have consumed the token
    // here and then failed on cooldown, forcing the retry to mint a new one.)
    const { generateGestureToken } = await import('@/utils/ui/gesture-token.js');
    const fresh = await generateGestureToken('burn-inbox', 502);
    const second = await handleWebmcpTool(
      'burn_inbox',
      { gestureToken: fresh.token },
      502,
      'https://evil.example/page'
    );
    expect(second.success).toBe(false);
    expect(second.error).toContain('Please wait');

    // The valid token must still be unconsumed: once the cooldown clears,
    // the SAME token succeeds - proving it was never consumed above.
    _resetWebmcpRateLimitsForTest();
    const third = await handleWebmcpTool(
      'burn_inbox',
      { gestureToken: fresh.token },
      502,
      'https://evil.example/page'
    );
    expect(third.success).toBe(true);
    expect(mockDeleteAddress).toHaveBeenCalledWith('inbox-1', false);
  });
});
