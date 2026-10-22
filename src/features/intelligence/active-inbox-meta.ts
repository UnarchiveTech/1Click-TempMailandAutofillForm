/**
 * Active inbox metadata resolution - extracted from autofill-plan.ts to keep
 * the content-script bundle clean (the content script uses the
 * getActiveAddressMetaViaBg bridge instead and never calls this directly).
 */

import { browser } from 'wxt/browser';
import { isLive } from '@/utils/address/address-status.js';
import { allowsSiteEmail } from '@/utils/provider/site-email-domains.js';
import type { AddressStatus } from '@/utils/types.js';

export async function getActiveAddressMeta(rejectedDomains: readonly string[] = []): Promise<{
  addressId: string | null;
  address: string | null;
  provider: string | null;
  providerDisplay: string | null;
}> {
  try {
    const { activeAddressId, addresses = [] } = (await browser.storage.local.get([
      'activeAddressId',
      'addresses',
    ])) as {
      activeAddressId?: string;
      addresses?: Array<{
        id: string;
        address: string;
        provider?: string;
        providerName?: string;
        accountStatus?: AddressStatus;
        expiresAt?: number;
      }>;
    };
    // Prefer the active address, then the first live (non-archived, non-deleted, unexpired) address.
    // Never fall back to an archived/deleted/expired mailbox - returning a dead mailbox
    // would cause WebMCP to report or operate against an unusable inbox.
    const usable = addresses.filter(
      (item) =>
        isLive(item) && (!rejectedDomains.length || allowsSiteEmail(item.address, rejectedDomains))
    );
    const active = usable.find((i) => i.id === activeAddressId);
    const record = (active && isLive(active) ? active : null) || usable[0] || null;
    if (!record) {
      return { addressId: null, address: null, provider: null, providerDisplay: null };
    }
    let providerDisplay = record.providerName || null;
    if (!providerDisplay && record.provider) {
      try {
        const response = (await browser.runtime
          .sendMessage({ type: 'getProviderDisplayName', provider: record.provider })
          .catch(() => null)) as { success?: boolean; displayName?: string } | null;
        providerDisplay = response?.success
          ? (response.displayName ?? record.provider)
          : record.provider;
      } catch {
        providerDisplay = record.provider;
      }
    }
    return {
      addressId: record.id || null,
      address: record.address || null,
      provider: record.provider || null,
      providerDisplay,
    };
  } catch {
    /* ignore */
    return { addressId: null, address: null, provider: null, providerDisplay: null };
  }
}
