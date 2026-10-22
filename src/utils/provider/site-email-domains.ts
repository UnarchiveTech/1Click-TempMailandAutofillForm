/** Exact website-host scope: a rejection on one tenant never affects its siblings. */
export function emailDomain(email: string): string | null {
  if (typeof email !== 'string' || email.length > 512) return null;
  const parts = email.trim().split('@');
  return parts.length === 2 && parts[0] ? canonicalHost(parts[1]) : null;
}

export function canonicalHost(value: string): string | null {
  if (typeof value !== 'string' || value.length > 253 || !/^[a-z0-9.-]+$/i.test(value)) return null;
  const host = value.toLowerCase();
  return host.includes('.') &&
    host.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))
    ? host
    : null;
}

export const EMAIL_DOMAIN_REJECTION_RE =
  /(?:disposable|temporary|temp[- ]?mail|throwaway).{0,80}(?:not\s+(?:accepted|allowed|supported|permitted)|blocked|banned|reject)|(?:not\s+(?:accepted|allowed|supported|permitted)|block|ban|reject).{0,80}(?:disposable|temporary|temp[- ]?mail|throwaway)|(?:email|e-mail|domain|provider).{0,140}(?:not\s+(?:accepted|allowed|supported|permitted)|blocked|banned|rejected)|(?:不支持|不允许|拒绝).{0,40}(?:邮箱|邮件)|(?:メール|ドメイン).{0,40}(?:拒否|使用できません)|(?:Wegwerf|Einweg).{0,60}(?:nicht|abgelehnt)|(?:jetable|temporaire).{0,60}(?:refus|interdit)|(?:desechable|temporal).{0,60}(?:rechaz|permit)|(?:مؤقت|مؤقتة).{0,60}(?:غير|مرفوض)|(?:ชั่วคราว).{0,60}(?:ไม่|ปฏิเสธ)/i;

/** Learn only a named domain matching the filled email, or an explicit disposable ban. */
export function rejectedEmailDomain(text: string, email: string): string | null {
  const domain = emailDomain(email);
  // Help text such as "disposable emails are not blocked" is not a rejection.
  if (/\b(?:not|never)\s+(?:blocked|banned|rejected|block|ban|reject)\b/i.test(text)) return null;
  if (
    !domain ||
    typeof text !== 'string' ||
    text.length > 600 ||
    !EMAIL_DOMAIN_REJECTION_RE.test(text)
  )
    return null;
  const namedDomains: string[] = text.toLowerCase().match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) || [];
  if (namedDomains.length > 0) return namedDomains.includes(domain) ? domain : null;
  return /disposable|temporary|temp[- ]?mail|throwaway|Wegwerf|Einweg|jetable|temporaire|desechable|temporal|مؤقت|ชั่วคราว/i.test(
    text
  )
    ? domain
    : null;
}

export function allowsSiteEmail(email: string, rejected: readonly string[]): boolean {
  const domain = emailDomain(email);
  return !!domain && !rejected.includes(domain);
}

/** Alternate domains are used only when the provider DSL explicitly offers aliases. */
export function chooseAllowedEmailAlias(
  address: string,
  domains: readonly string[],
  rejected: readonly string[]
): string | null {
  if (allowsSiteEmail(address, rejected)) return address;
  const domain = domains.map(canonicalHost).find((item) => item && !rejected.includes(item));
  return domain && emailDomain(address) ? `${address.split('@')[0]}@${domain}` : null;
}
