import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import type { Address } from '@/utils/types.js';

afterAll(() => mock.restore());
let finishRanking: (() => void) | undefined;
let startRanking: (() => void) | undefined;
mock.module('@/utils/email/email-service.js', () => ({
  loadAllProviderConfigs: () => ({ first: { name: 'First' }, second: { name: 'Second' } }),
}));
mock.module('@/features/intelligence/provider-health.js', () => ({
  rankProvidersByHealth: async () => {
    startRanking?.();
    if (finishRanking)
      await new Promise<void>((resolve) => {
        finishRanking = resolve;
      });
    return [{ score: 70, health: { fetchSuccesses: 1, createSuccesses: 0 } }];
  },
}));
const { evaluateProviderFailoverAfterRefresh } = await import(
  '@/features/address/provider-failover.js'
);
let address: Address;
let activeId: string;
const setHint = mock(() => {});
const warn = mock(() => {});
const deps = {
  getAllAddresses: () => [address],
  getAccounts: () => [address],
  getCurrentAddressId: () => activeId,
  getFailoverHint: () => null,
  setFailoverHint: setHint,
  openCreateAddressDialog: () => {},
  showWarningToast: warn,
  getTranslation: (key: string) => key,
};
beforeEach(() => {
  address = { id: 'one', provider: 'first', address: 'one@example.com' } as Address;
  activeId = 'one';
  finishRanking = undefined;
  startRanking = undefined;
  setHint.mockClear();
  warn.mockClear();
});
test('a healthy inbox never produces a provider-switch warning', async () => {
  await evaluateProviderFailoverAfterRefresh(deps, 'one');
  expect(setHint).toHaveBeenLastCalledWith(null);
  expect(warn).not.toHaveBeenCalled();
});
test('an actual fetch failure offers another provider with observed success', async () => {
  address.mailboxRefreshFailure = {
    kind: 'provider',
    failedAt: Date.now(),
    errorKey: 'errors.networkErrorGeneric',
  };
  await evaluateProviderFailoverAfterRefresh(deps, 'one');
  expect(setHint).toHaveBeenLastCalledWith(
    expect.objectContaining({ addressId: 'one', show: true, otherProvidersOk: true })
  );
  expect(warn).toHaveBeenCalledTimes(1);
});
test('recovery during ranking prevents a stale warning', async () => {
  address.mailboxRefreshFailure = {
    kind: 'network',
    failedAt: Date.now(),
    errorKey: 'errors.networkErrorGeneric',
  };
  finishRanking = () => {};
  const started = new Promise<void>((resolve) => {
    startRanking = resolve;
  });
  const pending = evaluateProviderFailoverAfterRefresh(deps, 'one');
  await started;
  delete address.mailboxRefreshFailure;
  finishRanking?.();
  await pending;
  expect(warn).not.toHaveBeenCalled();
  expect(setHint).toHaveBeenLastCalledWith(null);
});
test('a refresh for another inbox cannot replace the current inbox hint', async () => {
  activeId = 'two';
  await evaluateProviderFailoverAfterRefresh(deps, 'one');
  expect(setHint).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
});
