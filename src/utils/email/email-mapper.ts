import { extractMagicLinks } from '@/entrypoints/background/parsing/magic-link.js';
import { htmlToPlainText } from '@/utils/email/sanitize-html.js';
import { logDebug } from '@/utils/logger.js';
import { classifyEmailCodes } from '@/utils/otp/email-code-evidence.js';
import { isOtpCacheFresh } from '@/utils/otp/otp-cache.js';
import { isRealOtp } from '@/utils/otp/otp-code.js';
import { estimateExpiresAt } from '@/utils/otp/otp-magic-expiry.js';
import { createEmailReadChecker, isEmailRead } from '@/utils/storage/storage-keys.js';
import { timeAgo } from '@/utils/time/time-format.js';
import type { Email, MagicLink } from '@/utils/types.js';

/** Resolve magic links from stored fields or re-scan body (legacy messages). */
function resolveMagicLinks(m: Email): MagicLink[] {
  if (m.magicLinks && m.magicLinks.length > 0) return m.magicLinks;
  if (m.hasMagicLink === false) return [];
  // Lazy re-detect for emails stored before magic-link support
  try {
    return extractMagicLinks(
      m.subject || '',
      m.body_html || '',
      m.body_plain || m.body || '',
      toMsOrUndefined(m.received_at)
    );
  } catch {
    /* ignore */
    return [];
  }
}

/** Normalize seconds-or-milliseconds timestamps; undefined when absent/invalid. */
function toMsOrUndefined(t: unknown): number | undefined {
  const n = typeof t === 'number' ? t : Number(t);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

/**
 * The display stand-ins a caller must supply for missing sender / subject, and
 * for a record that is not a message at all.
 *
 * They are REQUIRED - never defaulted here - because this module is reachable
 * from the background graph (webmcp tools import it), so it may not import the
 * full-dictionary i18n module the UI uses. A hardcoded English default would
 * therefore silently win over the locale key at every render site; requiring
 * them puts the `t()` lookup in the UI caller that knows the active locale.
 */
export interface DisplayLabels {
  unknownSender: string;
  noSubject: string;
  invalidMessage: string;
}

export interface DisplayMapOptions {
  labels: DisplayLabels;
  /** Provider retention window; falls back to 1 hour for legacy records. */
  messageRetentionMs?: number;
}

export function mapEmailForDisplay(
  m: Email,
  readEmails: Record<string, boolean>,
  addr: string = '',
  opts: DisplayMapOptions,
  readLookup?: (id: string, address: string) => boolean
): Email {
  const { labels } = opts;
  if (!m || typeof m !== 'object') {
    return {
      id: '',
      from: labels.unknownSender,
      from_name: '',
      subject: labels.invalidMessage,
      time: '',
      isOtp: false,
      otp: null,
      body: '',
      body_html: '',
      unread: false,
      received_at: 0,
      original_inbox: '',
    } as Email;
  }
  const bodyPlain = m.body_plain || htmlToPlainText(m.body_html || m.body || '');
  const codeClassification = classifyEmailCodes(
    m.subject,
    m.body_html || bodyPlain,
    m.otp || m.otpCandidate
  );
  // received_at is the only ground truth for age. When a provider omits it (or
  // sends 0), never substitute Date.now() here - that would fabricate a fresh
  // age on EVERY display rebuild, so a legacy message would show "expires in
  // retention" forever and its OTP/magic-link estimates could never age out.
  const receivedMs = m.received_at > 1e12 ? m.received_at : (m.received_at || 0) * 1000;
  const hasReceivedAt = receivedMs > 0;
  let magicLinks = resolveMagicLinks(m);
  const otpExpiresAt =
    m.otpExpiresAt ||
    (isRealOtp(m.otp) && hasReceivedAt
      ? estimateExpiresAt(receivedMs, m.subject || '', bodyPlain) || undefined
      : undefined);
  if (magicLinks.length > 0) {
    magicLinks = magicLinks.map((link) => ({
      ...link,
      expiresAt:
        link.expiresAt ||
        (hasReceivedAt
          ? estimateExpiresAt(receivedMs, m.subject || '', `${bodyPlain}\n${link.url}`) || undefined
          : undefined),
    }));
  }
  // Retention window comes from the provider config (pass it in) so the display
  // layer never drifts from the configured messageRetentionDuration. Fall back
  // to 1 hour for legacy messages that predate the config. Unknown age → no
  // computed expiry (the UI treats an absent messageExpiresAt as live, not as
  // expired, so nothing is ever wrongly deleted or counted down).
  const retentionMs = opts.messageRetentionMs ?? 60 * 60 * 1000;
  const messageExpiresAt =
    m.messageExpiresAt || (hasReceivedAt ? receivedMs + retentionMs : undefined);
  return {
    id: m.id,
    from:
      (m as Email & { from_address?: string }).from_address ||
      m.from ||
      m.from_name ||
      labels.unknownSender,
    from_name: m.from_name || (m as Email & { from_address?: string }).from_address || m.from || '',
    subject: m.subject || labels.noSubject,
    time: timeAgo(m.received_at),
    ...codeClassification,
    isOtp: isRealOtp(codeClassification.otp),
    otpExpiresAt,
    messageExpiresAt,
    magicLinks: magicLinks.length > 0 ? magicLinks : undefined,
    hasMagicLink: magicLinks.length > 0,
    body: bodyPlain,
    body_html: m.body_html,
    raw_source: m.raw_source,
    unread: !(readLookup
      ? readLookup(m.id, m.original_inbox || addr)
      : isEmailRead(readEmails, m.id, m.original_inbox || addr)),
    received_at: m.received_at,
    local_only: m.local_only,
    local_only_since: m.local_only_since,
    original_inbox: m.original_inbox,
    local_archived: m.local_archived,
    local_archived_at: m.local_archived_at,
    local_deleted: m.local_deleted,
    local_deleted_at: m.local_deleted_at,
    stored_at: m.stored_at,
    attachments: Array.isArray(m.attachments) ? m.attachments : undefined,
  } as Email;
}

export function mapEmailsForDisplay(
  msgs: Email[],
  readEmails: Record<string, boolean>,
  addr: string = '',
  opts: DisplayMapOptions
): Email[] {
  if (!Array.isArray(msgs)) return [];
  const read = createEmailReadChecker(readEmails);
  return msgs.map((m) => mapEmailForDisplay(m, readEmails, addr, opts, read));
}

export interface OtpExtractionResult {
  otp: string;
  sender: string;
  senderName: string;
  context: string;
  recipient?: string;
}

export function extractLatestOtp(
  storedEmails: Record<string, Email[]>,
  context: string = ''
): OtpExtractionResult | null {
  // A single pass avoids allocating and sorting an array containing every OTP.
  // This runs during mailbox hydration and refresh, where large histories make
  // the previous O(n log n) work unnecessarily visible.
  let latestOtpMsg: Email | undefined;
  let latestOtpRecipient = '';
  for (const [address, addressEmails] of Object.entries(storedEmails ?? {})) {
    if (!Array.isArray(addressEmails)) continue;
    for (const message of addressEmails) {
      if (
        isRealOtp(message?.otp) &&
        isOtpCacheFresh({ received_at: message.received_at }) &&
        !(typeof message.otpExpiresAt === 'number' && message.otpExpiresAt <= Date.now()) &&
        (!latestOtpMsg || (message.received_at || 0) > (latestOtpMsg.received_at || 0))
      ) {
        latestOtpMsg = message;
        latestOtpRecipient = address || message.original_inbox || '';
      }
    }
  }
  if (latestOtpMsg) {
    const redactedMsg = { ...latestOtpMsg, otp: latestOtpMsg.otp ? '****' : null };
    logDebug(`[${context}] latestOtpMsg: ${JSON.stringify(redactedMsg)}`);
  }
  if (latestOtpMsg && isRealOtp(latestOtpMsg.otp)) {
    logDebug(
      `[${context}] Set OTP sender - from: ${latestOtpMsg.from}, from_name: ${latestOtpMsg.from_name}`
    );
    return {
      otp: latestOtpMsg.otp,
      sender: latestOtpMsg.from || '',
      senderName: latestOtpMsg.from_name || '',
      recipient: latestOtpRecipient,
      context: [
        latestOtpMsg.from_name ? `From: ${latestOtpMsg.from_name}` : '',
        timeAgo(latestOtpMsg.received_at),
      ]
        .filter(Boolean)
        .join(' | '),
    };
  }
  return null;
}

export function computeUnreadCounts(
  storedEmails: Record<string, Email[]>,
  readEmails: Record<string, boolean>
): Record<string, number> {
  const unreadCounts: Record<string, number> = {};
  const read = createEmailReadChecker(readEmails);
  for (const [addr, msgs] of Object.entries(storedEmails ?? {})) {
    if (!Array.isArray(msgs)) continue;
    unreadCounts[addr] = msgs.filter((m) => {
      return !read(m.id, m.original_inbox || addr);
    }).length;
  }
  return unreadCounts;
}
