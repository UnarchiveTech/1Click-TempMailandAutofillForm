/**
 * Inbox lifecycle intelligence — usage value, archive/renew suggestions.
 */

import { browser } from 'wxt/browser';
import type { Account, CredentialsHistoryItem, Email } from '@/utils/types.js';
import { loadInboxLifecycleMap, normalizeDomain, saveInboxLifecycleMap } from './storage.js';
import { INTELLIGENCE_CAPS, type InboxLifecycleStats, type LifecycleSuggestion } from './types.js';

function emptyLifecycle(inboxId: string, address: string): InboxLifecycleStats {
  return {
    inboxId,
    address,
    sitesUsed: [],
    otpCount: 0,
    magicLinkCount: 0,
    autofillCount: 0,
    lastActivityAt: Date.now(),
    valueScore: 0,
    updatedAt: Date.now(),
  };
}

function computeValueScore(s: InboxLifecycleStats, account?: Account): number {
  let score = 0;
  score += Math.min(40, s.sitesUsed.length * 8);
  score += Math.min(25, s.otpCount * 5);
  score += Math.min(15, s.magicLinkCount * 5);
  score += Math.min(20, s.autofillCount * 4);
  // Recent activity boost
  const age = Date.now() - (s.lastActivityAt || 0);
  if (age < 24 * 60 * 60 * 1000) score += 15;
  else if (age < 7 * 24 * 60 * 60 * 1000) score += 8;
  else if (age > 30 * 24 * 60 * 60 * 1000) score -= 10;
  // Live + auto-renew slightly more valuable to keep
  if (account?.autoExtend) score += 5;
  if (account?.accountStatus === 'archived') score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export async function recordInboxAutofill(
  inboxId: string,
  address: string,
  domain: string
): Promise<void> {
  const map = await loadInboxLifecycleMap();
  const cur = map[inboxId] || emptyLifecycle(inboxId, address);
  const d = normalizeDomain(domain);
  const sites = new Set(cur.sitesUsed);
  if (d) sites.add(d);
  const sitesUsed = [...sites].slice(-INTELLIGENCE_CAPS.maxSitesPerInbox);
  const next: InboxLifecycleStats = {
    ...cur,
    address: address || cur.address,
    sitesUsed,
    autofillCount: cur.autofillCount + 1,
    lastActivityAt: Date.now(),
    updatedAt: Date.now(),
    valueScore: 0,
  };
  next.valueScore = computeValueScore(next);
  map[inboxId] = next;
  await saveInboxLifecycleMap(map);
}

export async function recordInboxMailSignals(
  inboxId: string,
  address: string,
  emails: Email[]
): Promise<void> {
  if (!emails.length) return;
  const map = await loadInboxLifecycleMap();
  const cur = map[inboxId] || emptyLifecycle(inboxId, address);
  let otp = 0;
  let magic = 0;
  for (const e of emails) {
    if (e.otp || e.isOtp) otp += 1;
    if (e.hasMagicLink || (e.magicLinks && e.magicLinks.length > 0)) magic += 1;
  }
  const next: InboxLifecycleStats = {
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
    updatedAt: Date.now(),
    valueScore: 0,
  };
  // Also count new OTPs incrementally if bag grew
  if (otp > cur.otpCount) {
    /* already set via max */
  }
  next.valueScore = computeValueScore(next);
  map[inboxId] = next;
  await saveInboxLifecycleMap(map);
}

/** Recompute lifecycle from storage snapshots (loginInfo + stored emails). */
export async function recomputeLifecycleFromStorage(accounts: Account[]): Promise<void> {
  const map = await loadInboxLifecycleMap();
  const { loginInfo = [], storedEmails = {} } = (await browser.storage.local.get([
    'loginInfo',
    'storedEmails',
  ])) as {
    loginInfo?: CredentialsHistoryItem[];
    storedEmails?: Record<string, Email[]>;
  };

  for (const acc of accounts) {
    const cur = map[acc.id] || emptyLifecycle(acc.id, acc.address);
    const sites = new Set(cur.sitesUsed);
    for (const login of loginInfo) {
      if (
        login.inboxId === acc.id ||
        (login.email || '').toLowerCase() === (acc.address || '').toLowerCase()
      ) {
        const d = normalizeDomain(login.domain || '');
        if (d) sites.add(d);
      }
    }
    const bag = storedEmails[acc.address] || [];
    let otp = 0;
    let magic = 0;
    for (const e of bag) {
      if (e.otp || e.isOtp) otp += 1;
      if (e.hasMagicLink || (e.magicLinks && e.magicLinks.length > 0)) magic += 1;
    }
    const next: InboxLifecycleStats = {
      ...cur,
      address: acc.address,
      sitesUsed: [...sites].slice(-INTELLIGENCE_CAPS.maxSitesPerInbox),
      otpCount: Math.max(cur.otpCount, otp),
      magicLinkCount: Math.max(cur.magicLinkCount, magic),
      autofillCount: Math.max(
        cur.autofillCount,
        loginInfo.filter(
          (l) =>
            l.inboxId === acc.id ||
            (l.email || '').toLowerCase() === (acc.address || '').toLowerCase()
        ).length
      ),
      lastActivityAt: cur.lastActivityAt,
      updatedAt: Date.now(),
      valueScore: 0,
    };
    next.valueScore = computeValueScore(next, acc);
    map[acc.id] = next;
  }
  await saveInboxLifecycleMap(map);
}

export async function getLifecycleForInbox(inboxId: string): Promise<InboxLifecycleStats | null> {
  const map = await loadInboxLifecycleMap();
  return map[inboxId] || null;
}

export async function suggestLifecycleActions(accounts: Account[]): Promise<LifecycleSuggestion[]> {
  const map = await loadInboxLifecycleMap();
  const suggestions: LifecycleSuggestion[] = [];
  const now = Date.now();

  for (const acc of accounts) {
    if (acc.accountStatus === 'deleted') continue;
    const stats = map[acc.id] || emptyLifecycle(acc.id, acc.address);
    const score = computeValueScore(stats, acc);
    const idleMs = now - (stats.lastActivityAt || acc.createdAt || now);
    const expired =
      acc.status === 'expired' || (!!acc.expiresAt && acc.expiresAt > 0 && acc.expiresAt <= now);

    if (expired && score >= 40 && acc.accountStatus !== 'archived') {
      suggestions.push({
        kind: 'renew_high_value',
        inboxId: acc.id,
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
        inboxId: acc.id,
        address: acc.address,
        reasonKey: 'intelligence.suggestArchiveIdle',
        score,
      });
      continue;
    }

    // High site count on one burner → suggest fresh for next high-risk use
    if (stats.sitesUsed.length >= 6 && score >= 50) {
      suggestions.push({
        kind: 'create_fresh_for_risk',
        inboxId: acc.id,
        address: acc.address,
        reasonKey: 'intelligence.suggestFreshAddress',
        score,
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, 8);
}
