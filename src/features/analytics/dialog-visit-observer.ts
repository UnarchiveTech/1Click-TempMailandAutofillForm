import { trackVisit } from '@/features/analytics/visit-tracker.js';
import { isActivityDialogKey } from '@/features/types/view-types.js';

/**
 * Count each user-visible dialog when it opens. The observer lives at the app
 * shell so it also catches dialogs rendered inside individual views and
 * overlays portaled directly under `document.body`.
 */
export function observeDialogVisits(): () => void {
  if (typeof document === 'undefined' || !document.body) return () => {};

  const openState = new WeakMap<Element, boolean>();
  const pendingDisconnectChecks = new Set<Element>();
  let pendingFrame: number | null = null;

  const isVisibleDialog = (element: Element): boolean => {
    if (!element.isConnected || element.getAttribute('aria-hidden') === 'true') return false;
    if (element.hasAttribute('hidden')) return false;

    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  };

  const scan = () => {
    pendingFrame = null;
    // Portaling moves a live dialog through a brief disconnected state. Only
    // consider it closed if it is still disconnected at the next frame; an
    // immediate reinsert is a move, not a new dialog visit.
    for (const dialog of pendingDisconnectChecks) {
      if (!dialog.isConnected) openState.set(dialog, false);
    }
    pendingDisconnectChecks.clear();

    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      const open = isVisibleDialog(dialog);
      const wasOpen = openState.get(dialog) === true;
      if (open && !wasOpen) {
        const key = dialog.getAttribute('data-activity-dialog-key');
        openState.set(dialog, true);
        void trackVisit(isActivityDialogKey(key) ? key : 'dialog:other');
      } else if (!open && wasOpen) {
        openState.set(dialog, false);
      }
    }
  };

  const scheduleScan = () => {
    if (pendingFrame !== null) return;
    pendingFrame = window.requestAnimationFrame(scan);
  };

  const queueDisconnectCheck = (node: Node): boolean => {
    if (!(node instanceof Element)) return false;
    let foundDialog = false;
    if (node.matches('[role="dialog"]')) {
      pendingDisconnectChecks.add(node);
      foundDialog = true;
    }
    for (const dialog of node.querySelectorAll('[role="dialog"]')) {
      pendingDisconnectChecks.add(dialog);
      foundDialog = true;
    }
    return foundDialog;
  };

  const observer = new MutationObserver((records) => {
    let shouldScan = false;
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of record.removedNodes) {
          if (queueDisconnectCheck(node)) shouldScan = true;
        }
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches('[role="dialog"]') || node.querySelector('[role="dialog"]'))
          ) {
            shouldScan = true;
          }
        }
      } else if (record.target instanceof Element) {
        const target = record.target;
        if (
          target.matches('[role="dialog"]') ||
          target.closest('[role="dialog"]') ||
          target.querySelector('[role="dialog"]')
        ) {
          shouldScan = true;
        }
      }
    }
    if (shouldScan) scheduleScan();
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['aria-hidden', 'class', 'hidden', 'role', 'style'],
    childList: true,
    subtree: true,
  });
  scan();

  return () => {
    observer.disconnect();
    if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
  };
}
