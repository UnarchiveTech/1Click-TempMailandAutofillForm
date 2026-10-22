/**
 * Identity routing - sticky domain identity, domain hints, selected/default.
 * Does not store passwords; only picks which Identity profile to use.
 */

import { browser } from 'wxt/browser';
import type { Identity } from '@/utils/types.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';
import {
  getSiteProfile,
  getStickyIdentityForDomain,
  normalizeDomain,
  setStickyIdentityForDomain,
} from './storage.js';
import type { IdentityRouteResult } from './types.js';

/**
 * Pick the best identity for a page domain.
 */
export async function routeIdentityForDomain(
  domain: string,
  identities?: Identity[],
  selectedIdentityId?: string | null
): Promise<IdentityRouteResult & { identity: Identity | null }> {
  const d = normalizeDomain(domain);
  let list = identities;
  let selected = selectedIdentityId;

  if (!list) {
    const res = (await browser.storage.local.get(['identities', 'selectedIdentityId'])) as {
      identities?: Identity[];
      selectedIdentityId?: string;
    };
    list = res.identities || [];
    selected = res.selectedIdentityId ?? null;
  }

  if (!list.length) {
    return { identityId: null, reason: 'none', identity: null };
  }

  // 0) Explicit site rule (power-user): domain → identity
  if (d) {
    try {
      const { resolveRuleIdentityId } = await import('./site-rules.js');
      const ruleId = await resolveRuleIdentityId(d);
      if (ruleId) {
        const fromRule = list.find((i) => i.id === ruleId);
        if (fromRule) {
          return { identityId: fromRule.id, reason: 'domain_hint', identity: fromRule };
        }
      }
    } catch {
      /* rules optional */
    }
  }

  // 1) Sticky per-domain (user previously used this identity on site)
  const stickyId = d ? await getStickyIdentityForDomain(d) : null;
  if (stickyId) {
    const sticky = list.find((i) => i.id === stickyId);
    if (sticky) return { identityId: sticky.id, reason: 'sticky', identity: sticky };
  }

  // 2) Site profile last identity
  if (d) {
    const profile = await getSiteProfile(d);
    if (profile?.lastIdentityId) {
      const fromProfile = list.find((i) => i.id === profile.lastIdentityId);
      if (fromProfile) {
        return { identityId: fromProfile.id, reason: 'sticky', identity: fromProfile };
      }
    }
  }

  // 3) Domain hints & domain field overrides on identity
  if (d) {
    for (const id of list) {
      const hints = id.domainHints || [];
      const overrideDomains = id.domainFieldOverrides ? Object.keys(id.domainFieldOverrides) : [];
      const allDomains = [...hints, ...overrideDomains];
      if (allDomains.some((h) => hostMatchesDomainScope(d, h))) {
        return { identityId: id.id, reason: 'domain_hint', identity: id };
      }
    }
  }

  // 4) Currently selected identity
  if (selected) {
    const sel = list.find((i) => i.id === selected);
    if (sel) return { identityId: sel.id, reason: 'selected', identity: sel };
  }

  // 5) Default identity
  const def = list.find((i) => i.isDefault) || list[0];
  return { identityId: def?.id || null, reason: def ? 'default' : 'none', identity: def || null };
}

/** Persist sticky choice after a successful fill. */
export async function rememberIdentityForDomain(domain: string, identityId: string): Promise<void> {
  await setStickyIdentityForDomain(domain, identityId);
}
