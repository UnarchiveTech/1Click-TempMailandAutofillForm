import { loadAllProviderConfigs } from '@/utils/email/email-service.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';
import { logDebug } from '@/utils/logger.js';
import type { Address } from '@/utils/types.js';

export interface FailoverState {
  addressId: string;
  show: boolean;
  otherProvidersOk: boolean;
  nextRetryAt: number;
  failCount: number;
}

export interface FailoverDeps {
  getAllAddresses: () => Address[];
  getAccounts: () => Address[];
  getCurrentAddressId: () => string | undefined;
  getFailoverHint: () => FailoverState | null;
  setFailoverHint: (hint: FailoverState | null) => void;
  openCreateAddressDialog: () => void;
  showWarningToast: (msg: string, actionLabel: string, onAction: () => void) => void;
  getTranslation: TranslateFn;
}

export async function evaluateProviderFailoverAfterRefresh(
  deps: FailoverDeps,
  addressId: string
): Promise<void> {
  try {
    if (deps.getCurrentAddressId() !== addressId) return;
    const allAddr = deps.getAllAddresses();
    const accounts = deps.getAccounts();
    const record =
      allAddr.find((a) => a.id === addressId) || accounts.find((a) => a.id === addressId);
    if (!record?.provider || record.accountStatus === 'deleted') {
      deps.setFailoverHint(null);
      return;
    }

    // Only an actual inbox fetch failure warrants switching providers. A ping
    // can be unreadable, stale, or target a different instance from this inbox.
    if (!record.mailboxRefreshFailure) {
      deps.setFailoverHint(null);
      return;
    }

    const configs = loadAllProviderConfigs();
    const currentCfg = configs[record.provider];
    if (!currentCfg) return;

    // Offer alternatives only when local health history records a success.
    let otherOk = false;
    try {
      const { rankProvidersByHealth } = await import('@/features/intelligence/provider-health.js');
      const ids = Object.keys(configs).filter((id) => id !== record.provider && id !== 'demo');
      const ranked = await rankProvidersByHealth(ids);
      if (
        ranked.some((r) => r.score >= 40 && r.health.fetchSuccesses + r.health.createSuccesses > 0)
      ) {
        otherOk = true;
      }
    } catch {
      /* fall through */
    }

    // Ranking is asynchronous: a successful refresh may have cleared this
    // failure, or the user may have switched inboxes while it was loading.
    const latest = deps.getAllAddresses().find((address) => address.id === addressId);
    if (deps.getCurrentAddressId() !== addressId) return;
    if (!latest?.mailboxRefreshFailure) {
      deps.setFailoverHint(null);
      return;
    }
    const existing = deps.getFailoverHint();
    const now = Date.now();
    if (existing && existing.nextRetryAt > now) return;
    const failCount = (existing?.failCount || 0) + 1;
    const nextRetryAt = now + 5 * 60 * 1000;
    deps.setFailoverHint({
      addressId,
      show: true,
      otherProvidersOk: otherOk,
      nextRetryAt,
      failCount,
    });

    if (otherOk) {
      deps.showWarningToast(
        deps.getTranslation('toasts.providerUnavailable'),
        deps.getTranslation('toasts.createWithOtherProvider'),
        () => deps.openCreateAddressDialog()
      );
    }
  } catch (e) {
    logDebug(`Provider failover eval failed: ${String(e)}`);
  }
}
