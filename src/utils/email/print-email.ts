/**
 * Direct email printing without a popup window.
 *
 * `window.print()` always prints the *current* document, and extension popups
 * close the moment the print dialog steals focus, so printing from popup /
 * sidepanel contexts is routed to the full app page
 * (`app.html?printInbox=..&printEmail=..`). The app tab then prints the message
 * through a same-origin iframe whose `contentWindow.print()` call prints the
 * frame's own document.
 *
 * Gesture handling: Chromium can silently ignore a gesture-less `print()`
 * (e.g. inside a tab that was just opened programmatically) WITHOUT showing a
 * dialog - yet beforeprint/afterprint still fire. Auto-closing the handoff tab
 * on `afterprint` is therefore wrong: it closes the tab while no dialog ever
 * appeared. Instead we detect "dialog really opened" via Chromium's blocking
 * behavior: `print()` blocks the calling frame for the entire time the dialog
 * is open, so a call that returns after a meaningful delay proves the dialog
 * opened (and has now closed). Only then may an auto-close callback run.
 */

import { get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { logError } from '../logger.js';
import { getEmailMaps, resolveBagKey } from '../storage/storage-keys.js';
import { toMs } from '../time/time.js';
import { formatFullDateTime } from '../time/time-format.js';
import type { Email } from '../types.js';
import { escapeHtmlText, initSanitize, sanitizeHtml } from './sanitize-html.js';

const PRINT_CSS = [
  'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #0f172a; line-height: 1.6; }',
  '.print-header { border-bottom: 2px solid #cbd5e1; padding-bottom: 16px; margin-bottom: 24px; }',
  '.print-header h1 { margin: 0 0 10px 0; font-size: 22px; font-weight: 700; color: #0f172a; }',
  '.print-header div { font-size: 13px; color: #475569; margin-top: 4px; }',
  '.print-body { font-size: 14px; }',
  'img { max-width: 100%; height: auto; }',
  'table { border-collapse: collapse; max-width: 100%; }',
  'td, th { border: 1px solid #cbd5e1; padding: 6px 10px; }',
].join('\n');

/** Header (subject / from / date) + sanitized body markup for printing. */
export function buildEmailPrintHtml(msg: Email, bodyHtml: string): string {
  const subject = escapeHtmlText(msg.subject || get(t)('activity.noSubject'));
  const fromLine = escapeHtmlText(msg.from_name || msg.from || '');
  const fromEmail = escapeHtmlText(msg.from || '');
  const dateLine = escapeHtmlText(
    msg.received_at ? formatFullDateTime(toMs(msg.received_at)) : msg.time || ''
  );
  const fromLabel = escapeHtmlText(get(t)('activity.fromLabel'));
  const dateLabel = escapeHtmlText(get(t)('activity.dateLabel'));
  return (
    `<div class="print-header"><h1>${subject}</h1>` +
    `<div><strong>${fromLabel}:</strong> ${fromLine} &lt;${fromEmail}&gt;</div>` +
    `<div><strong>${dateLabel}:</strong> ${dateLine}</div></div>` +
    `<div class="print-body">${bodyHtml}</div>`
  );
}

/**
 * Minimum time (ms) `window.print()` must block before we treat the dialog as
 * having really opened. Chromium blocks the calling frame for the whole time
 * the dialog is open; a suppressed (gesture-less) print returns in a few
 * milliseconds. A real dialog cannot be opened and closed faster than this,
 * even when the user instantly cancels - dialog animation alone takes longer.
 */
const PRINT_DIALOG_BLOCK_THRESHOLD_MS = 250;

/**
 * Open the browser's native print dialog for `html` using a same-origin
 * iframe rendered off-screen at a real page size.
 *
 * TRUSTED-CALLER CONTRACT: `html` must already be sanitized - pass
 * `buildEmailPrintHtml` output (headers entity-escaped, body through
 * `sanitizeHtml`). Sanitizing here would be wrong, not just redundant:
 * `sanitizeHtml`'s entity-decode pass re-interprets the header's deliberately
 * displayed `&lt;email&gt;` entities as markup and DOMPurify would drop the
 * address from the printed output. Call sites own the sanitize step;
 * `tests/unit/utils/print-email.test.ts` pins it.
 *
 * Returns true only when the print dialog demonstrably opened (see module
 * docstring: `print()` blocking for longer than the threshold is the only
 * reliable signal - beforeprint/afterprint fire even for suppressed prints).
 * `onAfterPrint` runs when the dialog opened and has now closed (printed or
 * cancelled); it is deliberately NOT run for a suppressed print, so callers
 * that auto-close a handoff tab cannot kill it while no dialog was shown.
 */
export function printHtmlDocument(html: string, title: string, onAfterPrint?: () => void): boolean {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  // Off-screen but FULLY RENDERED (1024x768). A 0x0 hidden frame can make
  // Chromium treat the print job as empty and round-trip beforeprint/
  // afterprint without ever showing a dialog; a real layout size avoids that
  // and gives the print pipeline actual content to rasterize.
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1024px;height:768px;border:0;margin:0;padding:0;';
  let startedAt: number;
  try {
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      iframe.remove();
      return false;
    }
    doc.title = title;
    const styleEl = doc.createElement('style');
    styleEl.textContent = PRINT_CSS;
    doc.head.appendChild(styleEl);
    const bodyWrap = doc.createElement('div');
    bodyWrap.innerHTML = html;
    doc.body.replaceChildren(bodyWrap);
    win.focus();
    startedAt = performance.now();
    win.print();
  } catch (error) {
    // Some engines throw (e.g. NotAllowedError) instead of silently ignoring
    // a gesture-less print; setup/focus failures share the false result.
    iframe.remove();
    logError('printHtmlDocument: frame setup or printing failed', error);
    return false;
  }
  // print() only returned once the dialog (if any) closed, so the frame can
  // be cleaned up now. Keep the removal on a timer to let any still-pending
  // afterprint / layout work finish first.
  setTimeout(() => {
    iframe.remove();
  }, 0);
  const dialogOpened = performance.now() - startedAt >= PRINT_DIALOG_BLOCK_THRESHOLD_MS;
  if (dialogOpened && onAfterPrint) {
    try {
      onAfterPrint();
    } catch (error) {
      logError('printHtmlDocument: onAfterPrint callback failed', error);
    }
  }
  return dialogOpened;
}

/**
 * Load an email from extension storage (active or archived) and prepare the
 * print-ready HTML. Returns null when the message cannot be found.
 */
export async function prepareEmailPrintFromStorage(
  addr: string,
  messageId: string
): Promise<{ html: string; title: string } | null> {
  await initSanitize();
  const { storedEmails, archivedEmails } = await getEmailMaps();
  const storedKey = resolveBagKey(storedEmails, addr);
  const archivedKey = resolveBagKey(archivedEmails, addr);
  const candidates = [
    ...(Array.isArray(storedEmails[storedKey]) ? storedEmails[storedKey] : []),
    ...(Array.isArray(archivedEmails[archivedKey]) ? archivedEmails[archivedKey] : []),
  ];
  const msg = candidates.find((m) => m.id === messageId || m.id === `${addr}_${messageId}`);
  if (!msg) return null;
  const rawBody = msg.body_html || msg.body || '';
  const bodyContent = sanitizeHtml(rawBody);
  return {
    html: buildEmailPrintHtml(msg, bodyContent),
    title: msg.subject || get(t)('activity.noSubject'),
  };
}
