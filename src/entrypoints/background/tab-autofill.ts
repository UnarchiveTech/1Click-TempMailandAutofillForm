/**
 * Ensure content script can see / fill the active tab after install or inbox create.
 * Existing tabs often lack the content script until reload — inject or ask for refresh.
 */
import { browser } from 'wxt/browser';
import { logDebug, logError } from '@/utils/logger.js';

export type TabAutofillStatus = 'ready' | 'form' | 'no_form' | 'need_refresh' | 'blocked' | 'skip';

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';

function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return true;
    return false;
  } catch {
    return false;
  }
}

async function pingTab(tabId: number): Promise<boolean> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, { type: 'ping' })) as {
      ok?: boolean;
    } | null;
    return !!res?.ok;
  } catch {
    return false;
  }
}

async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE],
    });
    // Give the script a tick to register listeners
    await new Promise((r) => setTimeout(r, 80));
    return await pingTab(tabId);
  } catch (e) {
    logDebug(`injectContentScript failed for tab ${tabId}`, e);
    return false;
  }
}

export async function checkFormOnTab(tabId: number): Promise<boolean> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, { type: 'checkFormDetected' })) as {
      formDetected?: boolean;
    } | null;
    return !!res?.formDetected;
  } catch {
    return false;
  }
}

/** Inject if needed, rescan forms, update action badge when a form is present. */
export async function ensureTabAutofillReady(
  tabId: number,
  opts?: { notifyIfRefreshNeeded?: boolean }
): Promise<TabAutofillStatus> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!isInjectableUrl(tab.url)) return 'skip';

    let alive = await pingTab(tabId);
    if (!alive) {
      alive = await injectContentScript(tabId);
    }
    if (!alive) {
      if (opts?.notifyIfRefreshNeeded) {
        try {
          await browser.notifications.create(`autofill_refresh_${tabId}`, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Refresh page for autofill',
            message:
              'This page was open before the extension was ready. Refresh the tab, then use Autofill this page.',
          });
        } catch {
          /* notifications optional */
        }
        try {
          await browser.storage.session.set({
            pendingAutofillRefreshTabId: tabId,
            pendingAutofillRefreshAt: Date.now(),
          });
        } catch {
          /* ignore */
        }
      }
      await setFormBadge(tabId, false);
      return 'need_refresh';
    }

    try {
      await browser.tabs.sendMessage(tabId, { type: 'rescanForms' });
    } catch {
      /* ignore */
    }

    const hasForm = await checkFormOnTab(tabId);
    await setFormBadge(tabId, hasForm);
    return hasForm ? 'form' : 'no_form';
  } catch (e) {
    logError('ensureTabAutofillReady', e);
    return 'need_refresh';
  }
}

export async function setFormBadge(tabId: number, hasForm: boolean): Promise<void> {
  try {
    if (hasForm) {
      await browser.action.setBadgeText({ tabId, text: 'AF' });
      await browser.action.setBadgeBackgroundColor({ tabId, color: '#4c662b' });
      await browser.action.setTitle({
        tabId,
        title: '1Click · Signup form detected — open popup or Autofill this page',
      });
    } else {
      // Don't clear global unread badge if we only clear per-tab when empty —
      // set empty text for this tab so unread global can still show without tabId.
      await browser.action.setBadgeText({ tabId, text: '' });
      await browser.action.setTitle({
        tabId,
        title: '1Click: Temp Mail & Autofill Form',
      });
    }
  } catch {
    /* badge APIs may fail on restricted tabs */
  }
}

export async function ensureActiveTabAutofill(opts?: {
  notifyIfRefreshNeeded?: boolean;
}): Promise<TabAutofillStatus> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return 'skip';
  return ensureTabAutofillReady(tab.id, opts);
}

export async function autofillActiveTab(): Promise<{ ok: boolean; reason?: string }> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return { ok: false, reason: 'no_tab' };

  const status = await ensureTabAutofillReady(tab.id, { notifyIfRefreshNeeded: true });
  if (status === 'need_refresh' || status === 'skip') {
    return { ok: false, reason: status };
  }
  if (status === 'no_form') {
    return { ok: false, reason: 'no_form' };
  }

  try {
    await browser.tabs.sendMessage(tab.id, { action: 'startSignup' });
    return { ok: true };
  } catch (e) {
    logError('autofillActiveTab', e);
    return { ok: false, reason: 'send_failed' };
  }
}
