/**
 * Saved Logins Health & Expiry Auditor for 1Click Temp Mail.
 * Evaluates saved credentials for account health indicators:
 * - Expired/deleted temp mailbox usage
 * - Password reuse across domains
 * - Stale credentials (> 180 days)
 */
import { isDeleted, isTimeExpired } from '@/utils/address/address-status.js';
import type { Address, CredentialsHistoryItem } from '@/utils/types.js';

export type LoginHealthIssueKind = 'expired_mailbox' | 'reused_password' | 'stale_login';

export type LoginHealthSeverity = 'high' | 'medium' | 'low';

export type LoginHealthIssue = {
  kind: LoginHealthIssueKind;
  severity: LoginHealthSeverity;
  messageKey: string;
};

export type LoginHealthReport = {
  score: number; // 0 - 100 health score
  issues: LoginHealthIssue[];
};

export function auditLoginHealth(
  login: CredentialsHistoryItem,
  allLogins: CredentialsHistoryItem[],
  allAddresses: Address[]
): LoginHealthReport {
  const issues: LoginHealthIssue[] = [];
  let score = 100;

  // 1. Check if associated email belongs to an expired or deleted temp mailbox
  if (login.email) {
    const matchedAddress = allAddresses.find(
      (a) => a.address?.toLowerCase() === login.email?.toLowerCase()
    );
    if (matchedAddress) {
      if (isDeleted(matchedAddress) || isTimeExpired(matchedAddress)) {
        issues.push({
          kind: 'expired_mailbox',
          severity: 'high',
          messageKey: 'savedLoginInfo.healthExpiredMailbox',
        });
        score -= 40;
      }
    }
  }

  // 2. Check for duplicate password reuse across domains
  if (login.password && login.password.length > 0) {
    const samePasswordCount = allLogins.filter(
      (l) => l.password === login.password && l.domain !== login.domain
    ).length;
    if (samePasswordCount > 0) {
      issues.push({
        kind: 'reused_password',
        severity: 'medium',
        messageKey: 'savedLoginInfo.healthReusedPassword',
      });
      score -= 25;
    }
  }

  // 3. Check for stale credential age (> 180 days)
  const ts = typeof login.timestamp === 'number' ? login.timestamp : 0;
  const ageMs = ts > 0 ? Date.now() - ts : 0;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > 180) {
    issues.push({
      kind: 'stale_login',
      severity: 'low',
      messageKey: 'savedLoginInfo.healthStaleLogin',
    });
    score -= 15;
  }

  return {
    score: Math.max(0, score),
    issues,
  };
}
