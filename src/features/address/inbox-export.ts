import { logError } from '@/utils/logger.js';
import { toMs } from '@/utils/time/time.js';
import type { Address, Email } from '@/utils/types.js';

export interface ExportSetters {
  setShowToast: (message: string, type?: 'success' | 'error' | 'warning') => void;
  loadAddresses: () => Promise<void>;
}

/**
 * Exports emails from an account in the specified format.
 *
 * Supported formats:
 * - json: Exports as a JSON file containing address, provider, and message data
 * - eml: Exports as EML format (single email) or ZIP (multiple emails)
 * - mbox: Exports as MBOX format for email clients
 *
 * @param account - The account containing the email address and provider info
 * @param msgs - Array of email messages to export
 * @param format - The export format ('json', 'eml', or 'mbox')
 * @throws Error if export fails
 */
export async function exportEmailsWithFormat(account: Address, msgs: Email[], format: string) {
  try {
    let content = '';
    // Sanitize the local part for a filesystem-safe download name (same rule as
    // the ZIP path): strip everything except alphanumerics and spaces.
    const localPart = (account.address.split('@')[0] || 'emails')
      .replace(/[^a-zA-Z0-9\s]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    let filename = `${localPart}-emails`;
    let mimeType = 'text/plain';

    switch (format) {
      case 'json':
        content = JSON.stringify(buildJsonExportPayload(account, msgs), null, 2);
        filename += '.json';
        mimeType = 'application/json';
        break;
      case 'eml':
        if (msgs.length === 0) {
          content = '# No emails to export';
          filename += '.eml';
        } else if (msgs.length === 1) {
          content = generateSingleEMLContent(account, msgs[0]);
          filename += '.eml';
        } else {
          // Multiple emails - export as ZIP
          await exportMultipleEMLAsZip(account, msgs, filename);
          return;
        }
        mimeType = 'message/rfc822';
        break;
      case 'mbox':
        content = generateMBOXContent(account, msgs);
        filename += '.mbox';
        mimeType = 'application/mbox';
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Revoke after a short delay - Chromium triggers downloads synchronously,
    // but Firefox/Safari start asynchronously and premature revocation can
    // produce empty or failed downloads.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    logError('Error exporting emails', e);
    throw e;
  }
}

/** Sanitizes values that end up inside MIME headers (filename / mimeType) to
 * prevent header injection from provider-supplied metadata. */
function sanitizeHeaderToken(value: string): string {
  return value.replace(/[\r\n"\\]/g, '_');
}

/**
 * Generates a single EML message. When the email carries attachment metadata
 * (filenames/MIME types), the message is built as `multipart/mixed` with one
 * MIME part per attachment so that metadata survives backup/import - the file
 * data itself was never downloaded, so each attachment part carries a short
 * note instead of bytes. Emails without attachments are a single-part message
 * whose Content-Type honestly reflects the body: `text/html` when an HTML body
 * exists, otherwise `text/plain`. Labeling HTML as text/plain would make every
 * email client render the raw markup as plain text.
 */
export function generateSingleEMLContent(account: Address, message: Email): string {
  // When the provider exposed the untouched raw MIME source (e.g. Guerrilla
  // Mail's `get_email_source`), emit it verbatim - headers, multipart
  // structure, original styling, and all. This is pixel-faithful; the
  // synthesized fallback below only applies to legacy stored emails.
  if (message.raw_source) {
    const source = message.raw_source.endsWith('\n')
      ? message.raw_source
      : `${message.raw_source}\n`;
    return source;
  }

  // Prefer the actual sender address; from_name is a display name and must
  // never stand in for the address in From/Return-Path headers.
  // Every synthesized header value can originate from provider-controlled
  // metadata. Strip CR/LF before interpolation so a hostile subject, sender,
  // address, or message id cannot inject additional MIME headers.
  const fromEmail = sanitizeHeaderToken(message.from || message.from_name || 'unknown@example.com');
  const accountAddress = sanitizeHeaderToken(account.address);
  const subject = sanitizeHeaderToken(message.subject || 'No Subject');
  const date = new Date(toMs(message.received_at || Date.now() / 1000)).toUTCString();
  const messageId = sanitizeHeaderToken(String(message.id || Date.now()));
  const bodyPlain = message.body_plain || message.body || 'No content';
  const bodyHtml = message.body_html;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  const header =
    `Return-Path: <${fromEmail}>\n` +
    `Delivered-To: ${accountAddress}\n` +
    `From: ${fromEmail}\n` +
    `To: ${accountAddress}\n` +
    `Subject: ${subject}\n` +
    `Date: ${date}\n` +
    `Message-ID: <${messageId}@${accountAddress}>\n` +
    `MIME-Version: 1.0\n`;

  if (attachments.length === 0) {
    // Single-part EML. The Content-Type must match the body actually written:
    // HTML bodies labeled text/plain (as the source emails sometimes are) show
    // as raw markup in every email client, so write text/html when we have it.
    const body = bodyHtml || bodyPlain;
    const contentType = bodyHtml ? 'text/html' : 'text/plain';
    return `${header}Content-Type: ${contentType}; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n\n${body}\n`;
  }

  const boundary = `_scout_bnd_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
  const lines: string[] = [];
  lines.push(`${header}Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  // Body part (HTML when available, otherwise plain text)
  lines.push(
    bodyHtml ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8'
  );
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(bodyHtml || bodyPlain);
  // Attachment parts - metadata only (file bytes were not captured)
  for (const att of attachments) {
    const filename = sanitizeHeaderToken(att.filename || 'attachment');
    const mimeType = sanitizeHeaderToken(att.mimeType || 'application/octet-stream');
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${mimeType}; name="${filename}"`);
    lines.push(`Content-Disposition: attachment; filename="${filename}"`);
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(
      `[Attachment metadata preserved from backup export - filename: ${filename}, type: ${mimeType}]`
    );
  }
  lines.push('');
  lines.push(`--${boundary}--`);
  lines.push('');
  return lines.join('\n');
}

/** JSON export payload - embeds an explicit `attachments` manifest (message
 * id + filename + MIME type per file) alongside the full messages so attachment
 * metadata survives backup independent of walking the message array. */
export interface JsonExportPayload {
  address: string;
  provider: string;
  messages: Email[];
  attachments: {
    messageId: string;
    subject: string;
    from: string;
    receivedAt: number;
    filename: string;
    mimeType: string;
    partNumber?: string;
    downloadUrl?: string | null;
  }[];
}

export function buildJsonExportPayload(account: Address, msgs: Email[]): JsonExportPayload {
  const attachments = msgs.flatMap((m) =>
    (Array.isArray(m.attachments) ? m.attachments : []).map((att) => ({
      messageId: m.id,
      subject: m.subject || '',
      from: m.from || '',
      receivedAt: m.received_at,
      filename: att.filename,
      mimeType: att.mimeType,
      partNumber: att.partNumber,
      downloadUrl: att.downloadUrl ?? null,
    }))
  );
  return {
    address: account.address,
    provider: account.provider,
    messages: msgs,
    attachments,
  };
}

/**
 * Generates MBOX format content from an array of email messages.
 * MBOX is a standard format for storing email messages that can be imported by most email clients.
 * Each message is separated by a "From " line followed by the message content.
 *
 * @param account - The account containing the email address
 * @param messages - Array of email messages to convert to MBOX format
 * @returns A string containing the MBOX formatted email data
 */
export function generateMBOXContent(account: Address, messages: Email[]): string {
  const blocks: string[] = [];
  messages.forEach((message) => {
    const fromEmail = (message.from || 'unknown@example.com').replace(/[\r\n]/g, ' ');
    const date = new Date(toMs(message.received_at || Date.now() / 1000)).toUTCString();
    // Reuse the EML builder so attachment metadata (filenames/MIME types)
    // survives MBOX backups too - multipart/mixed when attachments exist.
    const eml = generateSingleEMLContent(account, message);
    // Escape lines starting with "From " anywhere in the message (mboxrd
    // format) so embedded quotes/bodies can't fake the MBOX separator.
    const escaped = eml.replace(/^From /gm, '>From ');
    blocks.push(`From ${fromEmail} ${date}\n${escaped}`);
  });
  // Blocks already end with a newline, so a single '\n' join yields exactly
  // one blank line between messages (MBOX message separation).
  return blocks.join('\n');
}

export async function exportMultipleEMLAsZip(
  account: Address,
  messages: Email[],
  baseFilename: string
) {
  try {
    // Import fflate dynamically
    const { zipSync, strToU8 } = await import('fflate');
    const files: Record<string, Uint8Array> = {};
    let fileIndex = 1;

    messages.forEach((message) => {
      const emlContent = generateSingleEMLContent(account, message);
      const subject = (message.subject || 'No Subject')
        .replace(/[^a-zA-Z0-9\s]/g, '_')
        .substring(0, 50);
      const sanitizedAddress = account.address.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${fileIndex.toString().padStart(3, '0')}_${sanitizedAddress}_${subject}.eml`;
      files[filename] = strToU8(emlContent);
      fileIndex++;
    });

    const zipped = zipSync({ files });
    const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseFilename}_emails.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    logError('Error creating ZIP file', e);
    // Fallback to text format if fflate fails
    let archiveContent = '# EML Archive - Multiple Email Export\n';
    archiveContent += `# Generated on: ${new Date().toISOString()}\n`;
    archiveContent += '# Note: ZIP creation failed, using text format\n\n';

    let fileIndex = 1;
    messages.forEach((message) => {
      const emlContent = generateSingleEMLContent(account, message);
      const subject = (message.subject || 'No Subject')
        .replace(/[^a-zA-Z0-9\s]/g, '_')
        .substring(0, 50);
      const filename = `${fileIndex.toString().padStart(3, '0')}_${account.address}_${subject}.eml`;
      archiveContent += `=== FILE: ${filename} ===\n`;
      archiveContent += emlContent;
      archiveContent += '\n=== END OF FILE ===\n\n';
      fileIndex++;
    });

    const blob = new Blob([archiveContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseFilename}_emails.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
