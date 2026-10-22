/**
 * Identity + email freshness score - prefer unused pairs for new signups.
 */

import { browser } from 'wxt/browser';
import { arrayOrEmpty } from '@/utils/storage/storage-shape-guards.js';
import type { CredentialsHistoryItem, Identity } from '@/utils/types.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';
import { normalizeDomain } from './storage.js';

export interface FreshnessCandidate {
  identityId: string;
  identity: Identity;
  email: string | null;
  /** Higher = fresher / better for new signup */
  score: number;
  reasons: string[];
}

/**
 * Score identities for a new signup on `domain`.
 * Prefer identities/emails not already used on this site (or anywhere recently).
 */
export async function rankIdentitiesForSignup(
  domain: string,
  identities: Identity[],
  liveEmails: string[]
): Promise<FreshnessCandidate[]> {
  const d = normalizeDomain(domain);
  const { loginInfo: rawLoginInfo } = (await browser.storage.local.get(['loginInfo'])) as {
    loginInfo?: unknown;
  };
  // Shape guard (storage-shape-guards.ts): for..of on a corrupt truthy value throws.
  const loginInfo = arrayOrEmpty<CredentialsHistoryItem>(rawLoginInfo);

  const usedOnDomain = new Set<string>();
  const usedEmailGlobal = new Set<string>();
  const usedIdentityOnDomain = new Set<string>();

  for (const l of loginInfo) {
    const ld = normalizeDomain(l.domain || l.website || '');
    const email = (l.email || '').toLowerCase();
    if (email) usedEmailGlobal.add(email);
    if (ld === d) {
      if (email) usedOnDomain.add(email);
      if (l.identityId) usedIdentityOnDomain.add(l.identityId);
    }
  }

  const candidates: FreshnessCandidate[] = [];
  for (const id of identities) {
    const reasons: string[] = [];
    let score = 50;
    if (id.isDefault) {
      score += 5;
      reasons.push('default');
    }
    if (usedIdentityOnDomain.has(id.id)) {
      score -= 40;
      reasons.push('identity_used_on_site');
    } else {
      score += 15;
      reasons.push('identity_fresh_on_site');
    }

    // Pick preferred or random live email
    let email: string | null = null;
    const pref = (id.preferredEmail || '').trim();
    const preferredLiveEmail = liveEmails.find(
      (candidate) => candidate.toLowerCase() === pref.toLowerCase()
    );
    if (pref && pref !== '__random_active__' && preferredLiveEmail) {
      email = preferredLiveEmail;
    } else if (liveEmails.length) {
      // Prefer live emails not used on this domain
      const unused = liveEmails.filter((e) => !usedOnDomain.has(e.toLowerCase()));
      email = unused[0] || liveEmails[0] || null;
    }

    if (email) {
      const el = email.toLowerCase();
      if (usedOnDomain.has(el)) {
        score -= 35;
        reasons.push('email_used_on_site');
      } else {
        score += 20;
        reasons.push('email_fresh_on_site');
      }
      if (usedEmailGlobal.has(el)) {
        score -= 5;
        reasons.push('email_used_elsewhere');
      }
    } else {
      score -= 10;
      reasons.push('no_email');
    }

    // Domain hints & domain field overrides boost
    const domainMatches = [
      ...(id.domainHints || []),
      ...(id.domainFieldOverrides ? Object.keys(id.domainFieldOverrides) : []),
    ];
    if (domainMatches.some((hint) => hostMatchesDomainScope(d, hint))) {
      score += 10;
      reasons.push('domain_hint');
    }

    candidates.push({ identityId: id.id, identity: id, email, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export async function pickFreshestIdentity(
  domain: string,
  identities: Identity[],
  liveEmails: string[]
): Promise<FreshnessCandidate | null> {
  const ranked = await rankIdentitiesForSignup(domain, identities, liveEmails);
  return ranked[0] || null;
}
