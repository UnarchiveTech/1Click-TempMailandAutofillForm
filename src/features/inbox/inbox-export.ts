import type { Browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
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
    setters.setShowToast('Export failed', 'error');
  }
}

/**
 * Show export format dialog
 * @returns Promise that resolves to selected format or null if cancelled
 */
export function showExportFormatDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'fixed inset-0 flex items-center justify-center bg-black/50 z-50';
    dialog.innerHTML = `
        <div class="bg-md-primary-container rounded-2xl shadow-2xl p-5 flex flex-col gap-4 w-96">
          <div>
            <h3 class="font-bold text-base mb-1 text-md-on-surface">Select Export Format</h3>
            <div class="flex flex-col gap-2 mt-4">
              <button class="px-3 py-2 text-sm rounded-xl border border-md-outline-variant bg-transparent text-md-on-surface hover:bg-md-secondary-container transition-colors format-btn" data-format="json" aria-label="Export as JSON">JSON Format</button>
              <button class="px-3 py-2 text-sm rounded-xl border border-md-outline-variant bg-transparent text-md-on-surface hover:bg-md-secondary-container transition-colors format-btn" data-format="eml" aria-label="Export as EML">EML Format</button>
              <button class="px-3 py-2 text-sm rounded-xl border border-md-outline-variant bg-transparent text-md-on-surface hover:bg-md-secondary-container transition-colors format-btn" data-format="mbox" aria-label="Export as MBOX">MBOX Format</button>
            </div>
            <div class="flex gap-2 pt-4 justify-end mt-2">
              <button class="px-4 py-2 text-sm rounded-xl bg-transparent text-md-on-surface/80 hover:bg-md-surface-variant transition-colors cancel-btn" aria-label="Cancel export">Cancel</button>
            </div>
          </div>
        </div>
      `;

    document.body.appendChild(dialog);

    dialog.querySelectorAll('.format-btn').forEach((button) => {
      if (button instanceof HTMLElement) {
        button.addEventListener('click', () => {
          const format = button.getAttribute('data-format');
          document.body.removeChild(dialog);
          resolve(format);
        });
      }
    });

    dialog.querySelector('.cancel-btn')?.addEventListener('click', () => {
      document.body.removeChild(dialog);
      resolve(null);
    });
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
  const date = new Date((message.received_at || Date.now() / 1000) * 1000).toUTCString();
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
    const fromEmail = message.from_name || 'unknown@example.com';
    const subject = message.subject || 'No Subject';
    const date = new Date((message.received_at || Date.now() / 1000) * 1000).toUTCString();
    const body = message.body_html || message.body_plain || 'No content';

    mboxContent += `From ${fromEmail} ${date}\n`;
    mboxContent += `Return-Path: <${fromEmail}>\n`;
    mboxContent += `Delivered-To: ${account.address}\n`;
    mboxContent += `From: ${fromEmail}\n`;
    mboxContent += `To: ${account.address}\n`;
    mboxContent += `Subject: ${subject}\n`;
    mboxContent += `Date: ${date}\n`;
    mboxContent += `Message-ID: <${message.id || Date.now()}-${index}@${account.address}>\n`;
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
