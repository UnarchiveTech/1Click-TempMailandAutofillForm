import { browser } from 'wxt/browser';

import { replaceCurrentLocation } from '@/features/navigation/url-utils.js';
import type { ToastFn } from '@/ui/blocks/layout/use-toast.js';
import { prepareEmailPrintFromStorage, printHtmlDocument } from '@/utils/email/print-email.js';
import { logError } from '@/utils/logger.js';

export async function handlePrintIntent(
  context: string,
  showToastFn: ToastFn,
  translate: (key: string) => string = (key) => key
): Promise<void> {
  if (context !== 'app') return;
  let record = '';
  let messageId = '';
  try {
    const u = new URL(typeof location !== 'undefined' ? location.href : '');
    record = u.searchParams.get('printInbox') || '';
    messageId = u.searchParams.get('printEmail') || '';
    if (record && messageId) {
      for (const k of ['printInbox', 'printEmail']) u.searchParams.delete(k);
      replaceCurrentLocation(u);
    }
  } catch {
    /* ignore URL parse */
  }
  if (!record || !messageId) return;
  let prepared: Awaited<ReturnType<typeof prepareEmailPrintFromStorage>>;
  try {
    prepared = await prepareEmailPrintFromStorage(record, messageId);
  } catch (error) {
    logError('handlePrintIntent: failed to prepare email for printing', error);
    showToastFn(translate('toasts.operationFailed'), 'error');
    return;
  }
  if (!prepared) {
    showToastFn(translate('inbox.printNotFound'), 'info');
    return;
  }
  // The app tab was opened programmatically from the popup/sidepanel, so this
  // print call may not carry a user gesture. printHtmlDocument returns true
  // only when the dialog demonstrably opened, and its onAfterPrint callback
  // runs only in that case.
  const dialogOpened = printHtmlDocument(prepared.html, prepared.title, () => {
    // Dedicated handoff tab: close it once the dialog closes (printed or
    // cancelled) so the user doesn't have to clean up the app tab. Gated by
    // printHtmlDocument on the dialog actually opening - a suppressed print
    // must NOT close the tab (that was the "tab flashes open then vanishes
    // without a print dialog" bug).
    void browser.runtime.sendMessage({ type: 'closePrintTab' }).catch(logError);
  });
  if (!dialogOpened) {
    // Chrome silently ignored the gesture-less print. Keep the tab open (it
    // shows the mailbox) so the user can open the message and print from the
    // app's own button, which carries a real user gesture.
    showToastFn(translate('inbox.printNotOpened'), 'info');
  }
}
