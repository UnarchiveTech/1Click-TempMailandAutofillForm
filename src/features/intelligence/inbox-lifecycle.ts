/**
 * Inbox lifecycle intelligence - usage value, archive/renew suggestions.
 */

import { browser } from 'wxt/browser';
import { LOCKS, withLock } from '@/utils/mutex.js';
import { isRealOtp } from '@/utils/otp/otp-code.js';
import { getStoredEmailsMap, resolveBagKey } from '@/utils/storage/storage-keys.js';
import { arrayOrEmpty } from '@/utils/storage/storage-shape-guards.js';
import type { Address, CredentialsHistoryItem, Email } from '@/utils/types.js';
import { loadAddressLifecycleMap, normalizeDomain, saveAddressLifecycleMap } from './storage.js';
import {
  type AddressLifecycleStats,
  INTELLIGENCE_CAPS,
  type LifecycleSuggestion,
} from './types.js';

function emptyLifecycle(addressId: string, address: string): AddressLifecycleStats {
  return {
    addressId,
    address,
    sitesUsed: [],
    otpCount: 0,
    magicLinkCount: 0,
    autofillCount: 0,
    // No observed activity yet. The address's createdAt is the fallback when
    // scoring suggestions; stamping "now" here makes every inbox look new.
    lastActivityAt: 0,
    hasObservedActivity: false,
    valueScore: 0,
    updatedAt: Date.now(),
  };
}

function computeValueScore(s: AddressLifecycleStats, account?: Address): number {
  let score = 0;
  score += Math.min(40, s.sitesUsed.length * 8);
  score += Math.min(25, s.otpCount * 5);
  score += Math.min(15, s.magicLinkCount * 5);
  score += Math.min(20, s.autofillCount * 4);
  // Recent activity boost
  const hasActivity =
    s.hasObservedActivity ||
    s.sitesUsed.length > 0 ||
    s.otpCount > 0 ||
    s.magicLinkCount > 0 ||
    s.autofillCount > 0;
  const activityAt = (hasActivity ? s.lastActivityAt : 0) || account?.createdAt || 0;
  if (activityAt > 0) {
    const age = Date.now() - activityAt;
    if (age < 24 * 60 * 60 * 1000) score += 15;
    else if (age < 7 * 24 * 60 * 60 * 1000) score += 8;
    else if (age > 30 * 24 * 60 * 60 * 1000) score -= 10;
  }
  // Live + auto-renew slightly more valuable to keep
  if (account?.autoExtend) score += 5;
  if (account?.accountStatus === 'archived') score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function recordAddressAutofill(
  addressId: string,
  address: string,
  domain: string
): Promise<void> {
  // Serialize the load→mutate→set so concurrent autofill signals don't clobber
  // each other's autofillCount / sitesUsed.
  await withLock(LOCKS.ADDRESS_LIFECYCLE, async () => {
    const map = await loadAddressLifecycleMap();
    const cur = map[addressId] || emptyLifecycle(addressId, address);
    const d = normalizeDomain(domain);
    const sites = new Set(cur.sitesUsed);
    if (d) sites.add(d);
    const sitesUsed = [...sites].slice(-INTELLIGENCE_CAPS.maxSitesPerAddress);
    const next: AddressLifecycleStats = {
      ...cur,
      address: address || cur.address,
      sitesUsed,
      autofillCount: cur.autofillCount + 1,
      lastActivityAt: Date.now(),
      hasObservedActivity: true,
      updatedAt: Date.now(),
      valueScore: 0,
    };
    next.valueScore = computeValueScore(next);
    map[addressId] = next;
    await saveAddressLifecycleMap(map);
  });
}

export async function recordAddressMailSignals(
  addressId: string,
  address: string,
  emails: Email[]
): Promise<void> {
  if (!emails.length) return;
  await withLock(LOCKS.ADDRESS_LIFECYCLE, async () => {
    const map = await loadAddressLifecycleMap();
    const cur = map[addressId] || emptyLifecycle(addressId, address);
    let otp = 0;
    let magic = 0;
    for (const e of emails) {
      if (isRealOtp(e.otp) || e.isOtp) otp += 1;
      if (e.hasMagicLink || (e.magicLinks && e.magicLinks.length > 0)) magic += 1;
    }
    const next: AddressLifecycleStats = {
      ...cur,
      address: address || cur.address,
      otpCount: Math.max(cur.otpCount, otp), // prefer cumulative max from bag
      magicLinkCount: Math.max(cur.magicLinkCount, magic),
      lastActivityAt: Math.max(
        cur.lastActivityAt,
        ...emails.map((e) => {
          const t = e.received_at || 0;
          return t > 1e12 ? t : t * 1000;
        }),
        0
      ),
      hasObservedActivity: true,
      updatedAt: Date.now(),
      valueScore: 0,
    };
    // Also count new OTPs incrementally if bag grew
    if (otp > cur.otpCount) {
      /* already set via max */
    }
    next.valueScore = computeValueScore(next);
    map[addressId] = next;
    await saveAddressLifecycleMap(map);
  });
}

/** Recompute lifecycle from storage snapshots (loginInfo + stored emails). */
export async function recomputeLifecycleFromStorage(accounts: Address[]): Promise<void> {
  await withLock(LOCKS.ADDRESS_LIFECYCLE, async () => {
    const map = await loadAddressLifecycleMap();
    const { loginInfo: rawLoginInfo } = (await browser.storage.local.get(['loginInfo'])) as {
      loginInfo?: unknown;
    };
    // Shape guard (storage-shape-guards.ts): for..of on a corrupt truthy value throws.
    const loginInfo = arrayOrEmpty<CredentialsHistoryItem>(rawLoginInfo);
    const storedEmails = await getStoredEmailsMap();

    for (const acc of accounts) {
      const cur = map[acc.id] || emptyLifecycle(acc.id, acc.address);
      const sites = new Set(cur.sitesUsed);
      for (const login of loginInfo) {
        if (
          login.addressId === acc.id ||
          (login.email || '').toLowerCase() === (acc.address || '').toLowerCase()
        ) {
          const d = normalizeDomain(login.domain || '');
          if (d) sites.add(d);
        }
      }
      // Resolve the bag key case-insensitively: a casing drift (provider
      // re-casing, backup restore, account edit) must not zero out the OTP /
      // magic-link counts for an inbox that still has mail.
      const bag = storedEmails[resolveBagKey(storedEmails, acc.address)] || [];
      const hasRecordedActivity =
        cur.hasObservedActivity ||
        cur.sitesUsed.length > 0 ||
        cur.otpCount > 0 ||
        cur.magicLinkCount > 0 ||
        cur.autofillCount > 0;
      const latestMailActivityAt = bag.reduce((latest, email) => {
        const receivedAt = email.received_at || 0;
        const receivedMs = receivedAt > 1e12 ? receivedAt : receivedAt * 1000;
        return Math.max(latest, receivedMs);
      }, 0);
      let otp = 0;
      let magic = 0;
      for (const e of bag) {
        if (isRealOtp(e.otp) || e.isOtp) otp += 1;
        if (e.hasMagicLink || (e.magicLinks && e.magicLinks.length > 0)) magic += 1;
      }
      const next: AddressLifecycleStats = {
        ...cur,
        address: acc.address,
        sitesUsed: [...sites].slice(-INTELLIGENCE_CAPS.maxSitesPerAddress),
        otpCount: Math.max(cur.otpCount, otp),
        magicLinkCount: Math.max(cur.magicLinkCount, magic),
        autofillCount: Math.max(
          cur.autofillCount,
          loginInfo.filter(
            (l) =>
              l.addressId === acc.id ||
              (l.email || '').toLowerCase() === (acc.address || '').toLowerCase()
          ).length
        ),
        // Older versions initialized an empty stats record with Date.now().
        // Ignore that synthetic value unless other observed usage backs it up;
        // persisted mail timestamps restore genuine mail activity.
        lastActivityAt: Math.max(
          hasRecordedActivity ? cur.lastActivityAt : 0,
          latestMailActivityAt
        ),
        hasObservedActivity: hasRecordedActivity || bag.length > 0,
        updatedAt: Date.now(),
        valueScore: 0,
      };
      next.valueScore = computeValueScore(next, acc);
      map[acc.id] = next;
    }
    await saveAddressLifecycleMap(map);
  });
}

export async function getLifecycleForAddress(
  addressId: string
): Promise<AddressLifecycleStats | null> {
  const map = await loadAddressLifecycleMap();
  return map[addressId] || null;
}

export async function suggestLifecycleActions(accounts: Address[]): Promise<LifecycleSuggestion[]> {
  const map = await loadAddressLifecycleMap();
  const suggestions: LifecycleSuggestion[] = [];
  const now = Date.now();

  for (const acc of accounts) {
    if (acc.accountStatus === 'deleted') continue;
    const stats = map[acc.id] || emptyLifecycle(acc.id, acc.address);
    const score = computeValueScore(stats, acc);
    const hasActivity =
      stats.hasObservedActivity ||
      stats.sitesUsed.length > 0 ||
      stats.otpCount > 0 ||
      stats.magicLinkCount > 0 ||
      stats.autofillCount > 0;
    const activityAt = (hasActivity ? stats.lastActivityAt : 0) || acc.createdAt || 0;
    const idleMs = activityAt > 0 ? now - activityAt : 0;
    const expired = !!acc.expiresAt && acc.expiresAt > 0 && acc.expiresAt <= now;

    if (expired && score >= 40 && acc.accountStatus !== 'archived') {
      suggestions.push({
        kind: 'renew_high_value',
        addressId: acc.id,
        address: acc.address,
        reasonKey: 'intelligence.suggestRenewHighValue',
        score,
      });
      continue;
    }

    if (
      acc.accountStatus !== 'archived' &&
      idleMs > 21 * 24 * 60 * 60 * 1000 &&
      score < 25 &&
      stats.sitesUsed.length === 0
    ) {
      suggestions.push({
        kind: 'archive_idle',
        addressId: acc.id,
        address: acc.address,
        reasonKey: 'intelligence.suggestArchiveIdle',
        score,
      });
      continue;
    }

    // High site count on one burner → suggest fresh for next high-risk use
    if (acc.accountStatus !== 'archived' && stats.sitesUsed.length >= 6 && score >= 50) {
      suggestions.push({
        kind: 'create_fresh_for_risk',
        addressId: acc.id,
        address: acc.address,
        reasonKey: 'intelligence.suggestFreshAddress',
        score,
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, 8);
}
