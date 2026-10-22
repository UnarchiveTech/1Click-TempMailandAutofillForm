import { senderDomainOf } from '@/utils/otp/otp-auto-copy.js';
import { toMs } from '@/utils/time/time.js';
import type { CredentialsHistoryItem, Email } from '@/utils/types.js';
import { domainsShareRegistrableSite, normalizeDomain } from '@/utils/validation.js';

export type RelatedMessageKind = 'verification' | 'receipt' | 'security' | 'other';
export interface RelatedMessage {
  key: string;
  inbox: string;
  message: Email;
  archived: boolean;
  kind: RelatedMessageKind;
}

/** Categories are hints, never authorization or proof that a message is genuine. */
function category(message: Email): RelatedMessageKind {
  if (message.otp || message.hasMagicLink) return 'verification';
  const subject = message.subject ?? '';
  if (
    /security|suspicious|password|new (?:sign.?in|login)|sécurité|seguridad|sicherheit|セキュリティ|安全|ความปลอดภัย|أمان/i.test(
      subject
    )
  )
    return 'security';
  if (
    /receipt|invoice|order|payment|reçu|facture|recibo|factura|rechnung|領収|請求|发票|收据|ใบเสร็จ|فاتورة/i.test(
      subject
    )
  )
    return 'receipt';
  if (/verif|confirm|activation|bestätig|確認|验证|ยืนยัน|تحقق/i.test(subject)) return 'verification';
  return 'other';
}

function linkHost(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname : '';
  } catch {
    return '';
  }
}

/**
 * Only the login's mailbox, then its sender site or an extracted sign-in link.
 * No subject-only association: a site name in unrelated mail is insufficient.
 * Shared-host tenant boundaries use the existing credential scope helper.
 */
export function buildRelatedMessages(
  login: Pick<CredentialsHistoryItem, 'email' | 'domain'>,
  storedEmails: Record<string, Email[]>,
  archivedEmails: Record<string, Email[]>
): RelatedMessage[] {
  const email = login.email?.trim().toLowerCase();
  const domain = normalizeDomain(login.domain);
  if (!email || !domain) return [];
  const messages = new Map<string, RelatedMessage>();
  for (const [bags, archived] of [
    [archivedEmails, true],
    [storedEmails, false],
  ] as const) {
    for (const [inbox, bag] of Object.entries(bags)) {
      if (inbox.trim().toLowerCase() !== email) continue;
      for (const message of bag) {
        const key = JSON.stringify([email, message.id]);
        const previous = messages.get(key);
        const merged = { ...previous?.message, ...message, original_inbox: inbox };
        messages.set(key, {
          key,
          inbox,
          message: merged,
          archived: archived || !!merged.local_archived || !!merged.archived,
          kind: category(merged),
        });
      }
    }
  }
  return [...messages.values()]
    .filter(({ message }) => {
      if (message.local_deleted) return false;
      const sender = senderDomainOf(message.from ?? '');
      return (
        (sender && domainsShareRegistrableSite(sender, domain)) ||
        (message.magicLinks ?? []).some((link) =>
          domainsShareRegistrableSite(linkHost(link.url), domain)
        )
      );
    })
    .sort(
      (a, b) =>
        toMs(b.message.received_at) - toMs(a.message.received_at) || a.key.localeCompare(b.key)
    );
}
