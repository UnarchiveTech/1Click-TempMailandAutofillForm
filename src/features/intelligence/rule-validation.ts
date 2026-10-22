import { isPublicSuffix, normalizeDomain, validateEmail } from '@/utils/validation.js';

export type RuleValidationCode =
  | 'rule-invalid-domain'
  | 'rule-invalid-days'
  | 'rule-invalid-match'
  | 'rule-invalid-forward'
  | 'rule-no-action';

export function validArchiveDays(days: unknown): boolean {
  return (
    days === undefined ||
    days === null ||
    (typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 365)
  );
}

export function hasMailboxRuleAction(rule: {
  label?: string;
  autoArchiveDays?: number | null;
  silenceNotifications?: boolean;
  autoCopyOtp?: boolean;
  forwardTo?: string;
}): boolean {
  return !!(
    rule.label?.trim() ||
    rule.autoArchiveDays ||
    rule.silenceNotifications ||
    rule.autoCopyOtp ||
    rule.forwardTo?.trim()
  );
}

export function hasSiteRuleAction(rule: {
  identityId?: string | null;
  providerId?: string | null;
  autoArchiveDays?: number | null;
}): boolean {
  return !!(rule.identityId || rule.providerId || rule.autoArchiveDays);
}

/** Domain patterns only; URL paths, ports and arbitrary wildcard placement are rejected. */
export function normalizeRuleDomain(pattern: string): string | null {
  const raw = pattern.trim().toLowerCase();
  const wildcard = raw.startsWith('*.');
  const host = wildcard ? raw.slice(2) : raw;
  if (!host || /[\s/@:*?#\\]/.test(host)) return null;
  try {
    const normalized = normalizeDomain(new URL(`https://${host}`).hostname).replace(/\.$/, '');
    if (
      !normalized.includes('.') ||
      isPublicSuffix(normalized) ||
      !normalized.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    ) {
      return null;
    }
    return wildcard ? `*.${normalized}` : normalized;
  } catch {
    return null;
  }
}

export function validateMailboxRuleInput(rule: {
  contains: string;
  field?: string;
  autoArchiveDays?: number | null;
  forwardTo?: string;
}): RuleValidationCode | null {
  if (
    !rule.contains.trim() ||
    rule.contains.length > 200 ||
    (rule.field !== undefined &&
      !['sender', 'senderOrRecipient', 'recipient', 'subject', 'body', 'anywhere'].includes(
        rule.field
      ))
  ) {
    return 'rule-invalid-match';
  }
  if (!validArchiveDays(rule.autoArchiveDays)) return 'rule-invalid-days';
  if (rule.forwardTo && (!validateEmail(rule.forwardTo) || /[\r\n,;]/.test(rule.forwardTo))) {
    return 'rule-invalid-forward';
  }
  return null;
}
