import { describe, expect, test } from 'bun:test';
import {
  type ReauthDeps,
  reauthenticateAddressCore,
  reauthenticateAddressCoreForLockedCaller,
  resolveReauthOperation,
  runReauthBatch,
} from '@/features/address/reauthenticate-address.js';
import type { ProviderConfig } from '@/utils/email/email-service.js';
import type { Address } from '@/utils/types.js';

const NOW = 1_700_000_000_000;

function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'guerrilla',
    operations: {},
    expiry: {
      renewable: true,
      renewalMethod: 'setEmailUser',
      duration: 3600000,
    },
    ...overrides,
  } as unknown as ProviderConfig;
}

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: 'inbox-1',
    address: 'user@guerrillamail.com',
    provider: 'guerrilla',
    createdAt: NOW - 3600000,
    expiresAt: NOW + 3600000,
    ...overrides,
  };
}

interface Harness {
  deps: ReauthDeps;
  addresses: Address[];
  executeCalls: Array<{ operation: string; context: { variables?: Record<string, unknown> } }>;
  restored: string[];
  executeResult: Record<string, unknown>;
}

function makeHarness(): Harness {
  const addresses = [makeAddress()];
  const executeCalls: Harness['executeCalls'] = [];
  const restored: string[] = [];
  const harness: Harness = {
    deps: {
      getAddresses: async () => [...addresses],
      setAddresses: async (list) => {
        addresses.length = 0;
        addresses.push(...list);
      },
      withLock: async (fn) => fn(),
      executeOperation: async (operation, context) => {
        executeCalls.push({ operation, context });
        return harness.executeResult;
      },
      restoreArchivedEmailsToStored: async (address) => {
        restored.push(address);
      },
      now: () => NOW,
    },
    addresses,
    executeCalls,
    restored,
    executeResult: { token: 'fresh-session', address: 'user@guerrillamail.com' },
  };
  return harness;
}

describe('resolveReauthOperation', () => {
  test('prefers customEmail, falls back to renewalMethod, then selectMailbox', () => {
    expect(
      resolveReauthOperation(
        makeConfig({ customEmail: { supported: true, operation: 'x' }, expiry: undefined })
      )
    ).toBe('x');
    expect(
      resolveReauthOperation(
        makeConfig({
          expiry: { renewable: true, renewalMethod: 'renew' } as ProviderConfig['expiry'],
        })
      )
    ).toBe('renew');
    expect(
      resolveReauthOperation(
        makeConfig({
          expiry: undefined,
          emailFetching: {
            type: 'multi_step',
            selectMailboxOperation: 'selectMailbox',
          } as ProviderConfig['emailFetching'],
        })
      )
    ).toBe('selectMailbox');
    expect(resolveReauthOperation(makeConfig({ expiry: undefined }))).toBeNull();
  });
});

describe('reauthenticateAddressCore', () => {
  test('obtains a fresh session token without auth and writes it back', async () => {
    const h = makeHarness();
    const outcome = await reauthenticateAddressCore(
      makeConfig({ customEmail: { supported: true, operation: 'setEmailUser' } }),
      h.addresses[0],
      h.deps
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.address).toBe('user@guerrillamail.com');
    expect(outcome.expiresAt).toBe(NOW + 3600000);

    // Auth-less call - the whole point of re-authentication.
    expect(h.executeCalls).toEqual([
      { operation: 'setEmailUser', context: { variables: { emailUser: 'user' } } },
    ]);

    const updated = h.addresses[0];
    expect(updated.token).toBe('fresh-session');
    expect(updated.sidToken).toBe('fresh-session');
    expect(updated.emailUser).toBe('user');
    expect(updated.expiresAt).toBe(NOW + 3600000);
    expect(updated.expiryNotified).toBe(false);
    expect(updated.expiringSoonNotified).toBe(false);
    expect(updated.expiredNotified).toBe(false);
    expect(updated.renewalFailCount).toBe(0);
    expect(updated.lastFailureAt).toBeUndefined();
    expect(updated.accountStatus).toBe('active');
    // `status` is a computed display field, never persisted - a stale stored
    // value must not survive a lifecycle flip.
    expect(updated.status).toBeUndefined();
    expect(h.restored).toEqual(['user@guerrillamail.com']);
  });

  test('locked-caller variant never re-acquires the address lock (deadlock pin)', async () => {
    const h = makeHarness();
    let lockCalls = 0;
    const deps = {
      ...h.deps,
      withLock: async <T>(fn: () => Promise<T>): Promise<T> => {
        lockCalls += 1;
        return fn();
      },
    };

    // The message-handler already holds withAddressLock around the whole
    // read → network → apply; if this variant touched deps.withLock it would
    // deadlock the non-reentrant mutex.
    const outcome = await reauthenticateAddressCoreForLockedCaller(
      makeConfig({ customEmail: { supported: true, operation: 'setEmailUser' } }),
      h.addresses[0],
      deps
    );

    expect(outcome.ok).toBe(true);
    expect(lockCalls).toBe(0);
    // The session write still happens despite the skipped lock.
    expect(h.addresses[0].token).toBe('fresh-session');
    expect(h.addresses[0].accountStatus).toBe('active');
    expect(h.restored).toEqual(['user@guerrillamail.com']);
  });

  test('self-locking variant acquires the lock exactly once', async () => {
    const h = makeHarness();
    let lockCalls = 0;
    const deps = {
      ...h.deps,
      withLock: async <T>(fn: () => Promise<T>): Promise<T> => {
        lockCalls += 1;
        return fn();
      },
    };

    const outcome = await reauthenticateAddressCore(
      makeConfig({ customEmail: { supported: true, operation: 'setEmailUser' } }),
      h.addresses[0],
      deps
    );

    expect(outcome.ok).toBe(true);
    expect(lockCalls).toBe(1);
    expect(h.addresses[0].token).toBe('fresh-session');
  });

  test('re-activates a previously archived/expired mailbox (accountStatus)', async () => {
    const h = makeHarness();
    h.addresses[0] = makeAddress({
      status: 'archived', // legacy stale field - must be ignored/cleared
      accountStatus: 'archived',
      expiresAt: NOW - 1000, // expired window
    });

    const outcome = await reauthenticateAddressCore(
      makeConfig({ customEmail: { supported: true, operation: 'setEmailUser' } }),
      h.addresses[0],
      h.deps
    );

    expect(outcome.ok).toBe(true);
    // The persisted lifecycle source flips back to 'active'. The legacy
    // `status` field is a display-only cache ignored by all lifecycle logic
    // and stripped by the persistence layer (setAddresses) on write.
    expect(h.addresses[0].accountStatus).toBe('active');
  });

  test('provider without a re-auth operation fails without calling the network', async () => {
    const h = makeHarness();
    const outcome = await reauthenticateAddressCore(
      makeConfig({ expiry: undefined }),
      h.addresses[0],
      h.deps
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('errors.reauthUnsupported');
    expect(h.executeCalls).toEqual([]);
    expect(h.addresses[0].token).toBeUndefined();
  });

  test('provider returning no token fails and writes nothing', async () => {
    const h = makeHarness();
    h.executeResult = { address: 'user@guerrillamail.com' }; // no token
    const outcome = await reauthenticateAddressCore(
      makeConfig({ customEmail: { supported: true, operation: 'setEmailUser' } }),
      h.addresses[0],
      h.deps
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('errors.reauthNoToken');
    expect(h.addresses[0].token).toBeUndefined();
    expect(h.restored).toEqual([]);
  });

  test('preserves the stored address when the provider returns a different one', async () => {
    const h = makeHarness();
    h.addresses[0] = makeAddress({ address: 'user@sharklasers.com' });
    h.executeResult = { token: 'fresh', address: 'user@guerrillamail.com' };
    const outcome = await reauthenticateAddressCore(
      makeConfig({ customEmail: { supported: true, operation: 'setEmailUser' } }),
      h.addresses[0],
      h.deps
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.address).toBe('user@sharklasers.com');
    expect(h.addresses[0].address).toBe('user@sharklasers.com');
    expect(h.addresses[0].token).toBe('fresh');
  });

  test('a provider throw collapses to a stable key instead of leaking its message', async () => {
    const h = makeHarness();
    h.deps.executeOperation = async () => {
      throw new Error('HTTP 500');
    };
    const outcome = await reauthenticateAddressCore(
      makeConfig({ customEmail: { supported: true, operation: 'setEmailUser' } }),
      h.addresses[0],
      h.deps
    );

    expect(outcome.ok).toBe(false);
    // The import dialog renders this value through translateResultMessage(),
    // so a raw provider message would be English in all eight locales.
    expect(outcome.error).toBe('errors.reauthFailed');
    expect(outcome.error).not.toContain('HTTP 500');
    expect(h.addresses[0].token).toBeUndefined();
  });
});

describe('runReauthBatch (single locked pass, per-id isolation)', () => {
  function threeAccounts() {
    return [
      makeAddress({ id: 'a1', address: 'one@x.test' }),
      makeAddress({ id: 'a2', address: 'two@x.test' }),
      makeAddress({ id: 'a3', address: 'three@x.test' }),
    ];
  }

  function entriesFor(addresses: Address[], executeOperation: ReauthDeps['executeOperation']) {
    return addresses.map((record) => ({
      addressId: record.id,
      record,
      config: makeConfig({
        expiry: { renewable: true, renewalMethod: 'setEmailUser', duration: 3600000 },
      }),
      executeOperation,
    }));
  }

  test('applies every successful probe to ONE list and reports per-id outcomes', async () => {
    const addresses = threeAccounts();
    const executeOperation: ReauthDeps['executeOperation'] = async (_op, context) => ({
      token: `fresh-${String(context.variables?.emailUser)}`,
    });

    const { next, outcomes } = await runReauthBatch(
      addresses,
      entriesFor(addresses, executeOperation),
      { now: () => NOW }
    );

    expect(outcomes.map((o) => o.addressId)).toEqual(['a1', 'a2', 'a3']);
    expect(outcomes.every((o) => o.success)).toBe(true);
    expect(next.map((a) => a.sidToken)).toEqual(['fresh-one', 'fresh-two', 'fresh-three']);
    expect(
      next.every(
        (a) =>
          a.expiredNotified === false &&
          a.renewalFailCount === 0 &&
          a.lastFailureAt === undefined &&
          a.accountStatus === 'active'
      )
    ).toBe(true);
    // The caller's list is untouched - the batch result is the single new
    // snapshot the handler writes back ONCE (no per-id full-list writes).
    expect(addresses[0]?.sidToken).toBeUndefined();
  });

  test('a failing provider is isolated - its siblings still apply', async () => {
    const addresses = threeAccounts();
    const executeOperation: ReauthDeps['executeOperation'] = async (_op, context) => {
      const user = String(context.variables?.emailUser);
      if (user === 'two') throw new Error('provider exploded');
      return { token: `fresh-${user}` };
    };

    const { next, outcomes } = await runReauthBatch(
      addresses,
      entriesFor(addresses, executeOperation),
      { now: () => NOW }
    );

    expect(outcomes).toEqual([
      { addressId: 'a1', success: true, address: 'one@x.test', expiresAt: expect.any(Number) },
      { addressId: 'a2', success: false, error: 'errors.reauthFailed' },
      { addressId: 'a3', success: true, address: 'three@x.test', expiresAt: expect.any(Number) },
    ]);
    expect(next.map((a) => a.sidToken)).toEqual(['fresh-one', undefined, 'fresh-three']);
  });

  test('a probe that returns no token is a per-id failure, not an abort', async () => {
    const addresses = threeAccounts();
    const executeOperation: ReauthDeps['executeOperation'] = async () => ({ token: '' });

    const { next, outcomes } = await runReauthBatch(
      addresses,
      entriesFor(addresses, executeOperation),
      { now: () => NOW }
    );

    expect(outcomes.every((o) => !o.success)).toBe(true);
    expect(outcomes[0]).toMatchObject({
      addressId: 'a1',
      error: 'errors.reauthNoToken',
    });
    expect(next.map((a) => a.sidToken)).toEqual([undefined, undefined, undefined]);
  });
});
