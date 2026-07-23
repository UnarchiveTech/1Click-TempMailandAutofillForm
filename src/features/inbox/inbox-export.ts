import type { Browser } from 'wxt/browser';
import { t } from '@/utils/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { toMs } from '@/utils/time.js';
import type { Account, Email } from '@/utils/types.js';

export interface ExportState {
  selectedEmail: string;
}

export interface ExportSetters {
  setShowToast: (message: string, type?: 'success' | 'error' | 'warning') => void;
  loadInboxes: () => Promise<void>;
}

/**
 * Export account emails
 * @param ext - Browser extension API
 * @param account - Account to export emails for
 * @param setters - Export setter functions
 */
export async function exportAccountEmails(ext: Browser, account: Account, setters: ExportSetters) {
  try {
    const response = await ext.runtime.sendMessage({
      type: 'checkEmails',
      inboxId: account.id,
      filters: {},
    });
    const msgs = response?.messages || [];

    // Show export format dialog
    const format = await showExportFormatDialog();
    if (!format) return;

    await exportEmailsWithFormat(account, msgs, format);
  } catch (_e) {
    setters.setShowToast(await t('toasts.exportFailed'), 'error');
  }
}

/**
 * Show export format dialog
 * @returns Promise that resolves to selected format or null if cancelled
 */
export function showExportFormatDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Select export format');
    dialog.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;';

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.style.cssText =
      'position:absolute;inset:0;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);';
    backdrop.addEventListener('click', () => {
      dialog.remove();
      resolve(null);
    });

    // Panel
    const panel = document.createElement('div');
    panel.style.cssText =
      'position:relative;z-index:1;background:var(--md-surface,#fff);border-radius:20px;padding:24px;width:320px;box-shadow:0 24px 48px rgba(0,0,0,0.18);display:flex;flex-direction:column;gap:20px;';

    // Close button (top-right of panel)
    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.cssText =
      'position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;border:none;background:var(--md-surface-variant,#e7e0ec);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--md-on-surface,#1c1b1f);transition:background 0.15s;';
    closeBtn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    closeBtn.addEventListener('click', () => {
      dialog.remove();
      resolve(null);
    });

    // Heading
    const heading = document.createElement('h3');
    heading.style.cssText =
      'margin:0;font-size:16px;font-weight:700;color:var(--md-on-surface,#1c1b1f);padding-right:32px;';
    heading.textContent = 'Select Export Format';

    // Sub-label
    const sub = document.createElement('p');
    sub.style.cssText =
      'margin:0;margin-top:-12px;font-size:12px;color:var(--md-on-surface-variant,#49454f);';
    sub.textContent = 'Choose a format for your exported emails';

    // Format buttons row
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';

    const formats: [string, string, string][] = [
      ['json', 'JSON', 'application/json'],
      ['eml', 'Email', 'message/rfc822'],
      ['mbox', 'MBOX', 'application/mbox'],
    ];

    for (const [format, label] of formats) {
      const btn = document.createElement('button');
      btn.style.cssText =
        'flex:1;padding:10px 4px;font-size:13px;font-weight:600;border-radius:12px;border:1.5px solid var(--md-outline-variant,#cac4d0);background:transparent;color:var(--md-on-surface,#1c1b1f);cursor:pointer;transition:background 0.15s,border-color 0.15s;';
      btn.textContent = label;
      btn.setAttribute('aria-label', `Export as ${label}`);
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'var(--md-secondary-container,#e8def8)';
        btn.style.borderColor = 'var(--md-primary,#6750a4)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = 'transparent';
        btn.style.borderColor = 'var(--md-outline-variant,#cac4d0)';
      });
      btn.addEventListener('click', () => {
        dialog.remove();
        resolve(format);
      });
      row.appendChild(btn);
    }

    panel.append(closeBtn, heading, sub, row);
    dialog.append(backdrop, panel);
    document.body.appendChild(dialog);

    // Close on Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dialog.remove();
        resolve(null);
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  });
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
export async function exportEmailsWithFormat(account: Account, msgs: Email[], format: string) {
  try {
    let content = '';
    let filename = `${account.address.split('@')[0]}-emails`;
    let mimeType = 'text/plain';

    switch (format) {
      case 'json':
        content = JSON.stringify(
          { address: account.address, provider: account.provider, messages: msgs },
          null,
          2
        );
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
    URL.revokeObjectURL(url);
  } catch (e) {
    logError('Error exporting emails', e);
    throw e;
  }
}

export function generateSingleEMLContent(account: Account, message: Email): string {
  const fromEmail = message.from_name || 'unknown@example.com';
  const subject = message.subject || 'No Subject';
  const date = new Date(toMs(message.received_at || Date.now() / 1000)).toUTCString();
  const body = message.body_html || message.body_plain || 'No content';

  let emlContent = '';
  emlContent += `Return-Path: <${fromEmail}>\n`;
  emlContent += `Delivered-To: ${account.address}\n`;
  emlContent += `From: ${fromEmail}\n`;
  emlContent += `To: ${account.address}\n`;
  emlContent += `Subject: ${subject}\n`;
  emlContent += `Date: ${date}\n`;
  emlContent += `Message-ID: <${message.id || Date.now()}@${account.address}>\n`;
  emlContent += `MIME-Version: 1.0\n`;
  emlContent += `Content-Type: text/plain; charset=UTF-8\n`;
  emlContent += `\n`;
  emlContent += `${body}\n`;

  return emlContent;
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
export function generateMBOXContent(account: Account, messages: Email[]): string {
  let mboxContent = '';
  messages.forEach((message, index) => {
    const fromEmail = (message.from || 'unknown@example.com').replace(/[\r\n]/g, ' ');
    const fromName = message.from_name
      ? `"${message.from_name.replace(/"/g, '\\"')}" <${fromEmail}>`
      : fromEmail;
    const subject = message.subject || 'No Subject';
    const date = new Date(toMs(message.received_at || Date.now() / 1000)).toUTCString();
    const isHtml = !!message.body_html;
    let body = message.body_html || message.body_plain || 'No content';
    // Escape lines starting with "From " (mboxrd format)
    body = body.replace(/^From /gm, '>From ');

    mboxContent += `From ${fromEmail} ${date}\n`;
    mboxContent += `Return-Path: <${fromEmail}>\n`;
    mboxContent += `Delivered-To: ${account.address}\n`;
    mboxContent += `From: ${fromName}\n`;
    mboxContent += `To: ${account.address}\n`;
    mboxContent += `Subject: ${subject}\n`;
    mboxContent += `Date: ${date}\n`;
    mboxContent += `Message-ID: <${message.id || Date.now()}-${index}@${account.address}>\n`;
    mboxContent += `MIME-Version: 1.0\n`;
    mboxContent += `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8\n`;
    mboxContent += `Content-Transfer-Encoding: 8bit\n`;
    mboxContent += `\n`;
    mboxContent += `${body}\n`;
    mboxContent += `\n`;
  });
  return mboxContent;
}

export async function exportMultipleEMLAsZip(
  account: Account,
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
    URL.revokeObjectURL(url);
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
    URL.revokeObjectURL(url);
  }
}
