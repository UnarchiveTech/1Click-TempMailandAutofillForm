/**
 * Address usage map — sites where a disposable email was used (saved logins + site profiles).
 */

import { browser } from 'wxt/browser';
import type { CredentialsHistoryItem } from '@/utils/types.js';
import { loadSiteProfiles, normalizeDomain } from './storage.js';

export interface AddressUsageSite {
  domain: string;
  lastUsedAt: number;
  loginCount: number;
  /** True if also present in siteProfiles intelligence memory */
  inSiteMemory: boolean;
  lastEmail?: string;
  lastIdentityId?: string;
}

export interface AddressUsageMap {
  address: string;
  sites: AddressUsageSite[];
  totalLogins: number;
}

function emailsMatch(a: string, b: string): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

/**
 * Build usage map for one mailbox address from loginInfo + site profiles.
 */
export async function getAddressUsageMap(
  address: string,
  savedLogins?: CredentialsHistoryItem[]
): Promise<AddressUsageMap> {
  const addr = (address || '').trim();
  let logins = savedLogins;
  if (!logins) {
    const res = (await browser.storage.local.get(['loginInfo'])) as {
      loginInfo?: CredentialsHistoryItem[];
    };
    logins = res.loginInfo || [];
  }

  const byDomain = new Map<string, AddressUsageSite>();

  for (const item of logins) {
    if (!emailsMatch(item.email || '', addr)) continue;
    const domain = normalizeDomain(item.domain || '');
    if (!domain) continue;
    const prev = byDomain.get(domain);
    const ts = item.timestamp || 0;
    if (prev) {
      prev.loginCount += 1;
      prev.lastUsedAt = Math.max(prev.lastUsedAt, ts);
    } else {
      byDomain.set(domain, {
        domain,
        lastUsedAt: ts,
        loginCount: 1,
        inSiteMemory: false,
      });
    }
  }

  // Merge site profiles that mention this email
  try {
    const profiles = await loadSiteProfiles();
    for (const p of Object.values(profiles)) {
      if (!p.lastEmail || !emailsMatch(p.lastEmail, addr)) continue;
      const domain = normalizeDomain(p.domain);
      if (!domain) continue;
      const prev = byDomain.get(domain);
      if (prev) {
        prev.inSiteMemory = true;
        prev.lastUsedAt = Math.max(prev.lastUsedAt, p.lastSuccessAt || p.updatedAt || 0);
        prev.lastIdentityId = p.lastIdentityId || prev.lastIdentityId;
        prev.lastEmail = p.lastEmail;
      } else {
        byDomain.set(domain, {
          domain,
          lastUsedAt: p.lastSuccessAt || p.updatedAt || 0,
          loginCount: 0,
          inSiteMemory: true,
          lastEmail: p.lastEmail,
          lastIdentityId: p.lastIdentityId,
        });
      }
    }
  } catch {
    /* optional */
  }

  const sites = [...byDomain.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return {
    address: addr,
    sites,
    totalLogins: sites.reduce((n, s) => n + s.loginCount, 0),
  };
}

/** Domains only (for compact avatar stacks). */
export async function getAddressUsageDomains(
  address: string,
  savedLogins?: CredentialsHistoryItem[]
): Promise<string[]> {
  const map = await getAddressUsageMap(address, savedLogins);
  return map.sites.map((s) => s.domain);
}
