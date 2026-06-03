import { logDebug } from '@/utils/logger.js';
import { initSanitize, sanitizeHtml } from '@/utils/sanitize-html.js';
import { timeAgo } from '@/utils/time.js';
import type { Email } from '@/utils/types.js';

// Preload DOMPurify so sanitizeHtml() is ready when emails arrive.
initSanitize();

export function mapEmailForDisplay(
  m: Email,
  readEmails: Record<string, boolean>,
  addr: string = ''
): Email {
  return {
    id: m.id,
    from:
      (m as Email & { from_address?: string }).from_address || m.from || m.from_name || 'Unknown',
    from_name: m.from_name || (m as Email & { from_address?: string }).from_address || m.from || '',
    subject: m.subject || 'No Subject',
    time: timeAgo(m.received_at),
    isOtp: !!m.otp,
    otp: m.otp || null,
    body: m.body_plain || (m.body_html || '').replace(/<[^>]*>/g, ''),
    body_html: m.body_html ? sanitizeHtml(m.body_html) : m.body_html,
    unread: !readEmails[`${m.original_inbox || addr}_${m.id}`] && !readEmails[m.id],
    received_at: m.received_at,
    local_only: m.local_only,
    original_inbox: m.original_inbox,
    local_archived: m.local_archived,
    local_archived_at: m.local_archived_at,
    local_deleted: m.local_deleted,
    local_deleted_at: m.local_deleted_at,
  } as Email;
}

export function mapEmailsForDisplay(
  msgs: Email[],
  readEmails: Record<string, boolean>,
  addr: string = ''
): Email[] {
  return msgs.map((m) => mapEmailForDisplay(m, readEmails, addr));
}

export interface OtpExtractionResult {
  otp: string;
  sender: string;
  senderName: string;
  context: string;
}

export function extractLatestOtp(
  storedEmails: Record<string, Email[]>,
  context: string = ''
): OtpExtractionResult | null {
  const allOtps: Email[] = [];
  for (const inboxEmails of Object.values(storedEmails)) {
    for (const m of inboxEmails) {
      if (m.otp) allOtps.push(m);
    }
  }
  const latestOtpMsg = allOtps.sort((a: Email, b: Email) => b.received_at - a.received_at)[0];
  logDebug(`[${context}] latestOtpMsg: ${JSON.stringify(latestOtpMsg)}`);
  if (latestOtpMsg?.otp) {
    logDebug(
      `[${context}] Set OTP sender - from: ${latestOtpMsg.from}, from_name: ${latestOtpMsg.from_name}`
    );
    return {
      otp: latestOtpMsg.otp,
      sender: latestOtpMsg.from || '',
      senderName: latestOtpMsg.from_name || '',
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
  for (const [addr, msgs] of Object.entries(storedEmails)) {
    unreadCounts[addr] = (msgs as Email[]).filter((m) => {
      const key = `${m.original_inbox || addr}_${m.id}`;
      return !readEmails[key] && !readEmails[m.id];
    }).length;
  }
  return unreadCounts;
}
