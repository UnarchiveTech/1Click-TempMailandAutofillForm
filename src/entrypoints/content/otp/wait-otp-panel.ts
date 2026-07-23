/**
 * On-page "Wait for OTP" panel — live countdown + fill when OTP arrives.
 * Uses closed shadow host (same as autofill buttons).
 */

import { browser } from 'wxt/browser';
import { t } from '@/utils/i18n-utils.js';
import { logDebug } from '@/utils/logger.js';
import { BUTTON_CLASS, getOrCreateShadowRoot } from '../dom/shadow-dom.js';
import { fillOtp } from './otp-handler.js';

const PANEL_ID = 'oc-wait-otp-panel';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TICK_MS = 1000;

export interface WaitOtpPanelHandle {
  cleanup: () => void;
  notifyOtp: (otp: string, meta?: { sender?: string; subject?: string }) => Promise<void>;
}

let activeHandle: WaitOtpPanelHandle | null = null;

function formatMmSs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Show floating Wait-for-OTP panel. Replaces any existing panel.
 */
export async function showWaitOtpPanel(opts?: {
  email?: string | null;
  timeoutMs?: number;
  autoFill?: boolean;
}): Promise<WaitOtpPanelHandle> {
  if (activeHandle) {
    activeHandle.cleanup();
    activeHandle = null;
  }

  const root = getOrCreateShadowRoot();
  if (!root) {
    return { cleanup: () => {}, notifyOtp: async () => {} };
  }

  const existing = root.getElementById(PANEL_ID);
  existing?.remove();

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const autoFill = opts?.autoFill !== false;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let filledOtp: string | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let storageListener:
    | ((changes: Record<string, { newValue?: unknown }>, area: string) => void)
    | null = null;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'status');
  panel.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483645;
    pointer-events: auto;
    min-width: 260px;
    max-width: min(360px, calc(100vw - 32px));
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--md-surface-container-high, #e8e9de);
    color: var(--md-on-surface, #1a1c16);
    box-shadow: 0 8px 28px rgba(0,0,0,0.22);
    font-family: system-ui, -apple-system, sans-serif;
    border: 1px solid var(--md-outline-variant, #c5c8ba);
  `;

  const title = document.createElement('div');
  title.style.cssText = 'font-size: 13px; font-weight: 700; margin-bottom: 4px;';
  title.textContent = await t('contentAutofill.waitForOtpTitle');

  const emailLine = document.createElement('div');
  emailLine.style.cssText =
    'font-size: 11px; opacity: 0.7; margin-bottom: 8px; word-break: break-all;';
  if (opts?.email) {
    emailLine.textContent = opts.email;
  } else {
    emailLine.style.display = 'none';
  }

  const status = document.createElement('div');
  status.style.cssText = 'font-size: 12px; margin-bottom: 8px;';
  status.textContent = await t('contentAutofill.waitForOtpWaiting');

  const countdown = document.createElement('div');
  countdown.style.cssText =
    'font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; margin-bottom: 10px; color: var(--md-primary, #4c662b);';
  countdown.textContent = formatMmSs(timeoutMs);

  const otpDisplay = document.createElement('div');
  otpDisplay.style.cssText = `
    display: none;
    font-size: 20px;
    font-weight: 800;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.12em;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--md-primary-container, #cdeda3);
    color: var(--md-on-primary-container, #354e16);
    text-align: center;
    margin-bottom: 10px;
    user-select: all;
  `;

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = BUTTON_CLASS;
  copyBtn.style.cssText = `
    flex: 1;
    min-width: 90px;
    padding: 7px 10px;
    border: none;
    border-radius: 10px;
    background: var(--md-primary, #4c662b);
    color: var(--md-on-primary, #fff);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: none;
  `;
  copyBtn.textContent = await t('contentAutofill.waitForOtpCopy');

  const fillBtn = document.createElement('button');
  fillBtn.type = 'button';
  fillBtn.className = BUTTON_CLASS;
  fillBtn.style.cssText = copyBtn.style.cssText;
  fillBtn.textContent = await t('contentAutofill.waitForOtpFill');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = BUTTON_CLASS;
  closeBtn.style.cssText = `
    padding: 7px 10px;
    border: 1px solid var(--md-outline-variant, #c5c8ba);
    border-radius: 10px;
    background: transparent;
    color: var(--md-on-surface, #1a1c16);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  `;
  closeBtn.textContent = await t('contentAutofill.waitForOtpDismiss');

  actions.appendChild(copyBtn);
  actions.appendChild(fillBtn);
  actions.appendChild(closeBtn);
  panel.appendChild(title);
  panel.appendChild(emailLine);
  panel.appendChild(status);
  panel.appendChild(countdown);
  panel.appendChild(otpDisplay);
  panel.appendChild(actions);
  root.appendChild(panel);

  const cleanup = () => {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    if (storageListener) {
      try {
        browser.storage.onChanged.removeListener(storageListener);
      } catch {
        /* ignore */
      }
      storageListener = null;
    }
    panel.remove();
    if (activeHandle?.cleanup === cleanup) activeHandle = null;
  };

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  });

  const applyOtp = async (otp: string, meta?: { sender?: string; subject?: string }) => {
    if (!otp || filledOtp === otp) return;
    filledOtp = otp;
    countdown.style.display = 'none';
    otpDisplay.style.display = 'block';
    otpDisplay.textContent = otp;
    copyBtn.style.display = 'block';
    fillBtn.style.display = 'block';
    status.textContent = await t('contentAutofill.waitForOtpReceived');
    if (meta?.sender) {
      status.textContent += ` · ${meta.sender}`;
    }
    if (autoFill) {
      try {
        await fillOtp(otp);
        status.textContent = await t('contentAutofill.otpFilled');
      } catch (e) {
        logDebug(`Wait OTP auto-fill failed: ${String(e)}`);
      }
    }
  };

  copyBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!filledOtp) return;
    try {
      await navigator.clipboard.writeText(filledOtp);
      copyBtn.textContent = await t('contentAutofill.waitForOtpCopied');
    } catch {
      /* ignore */
    }
  });

  fillBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!filledOtp) return;
    await fillOtp(filledOtp);
    status.textContent = await t('contentAutofill.otpFilled');
  });

  tickTimer = setInterval(async () => {
    if (filledOtp) return;
    const left = deadline - Date.now();
    countdown.textContent = formatMmSs(left);
    if (left <= 0) {
      status.textContent = await t('contentAutofill.waitForOtpTimeout');
      countdown.textContent = '0:00';
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
    }
  }, TICK_MS);

  // Listen for latestOtp storage updates from background
  storageListener = (changes, area) => {
    if (area !== 'local' || !changes.latestOtp) return;
    const v = changes.latestOtp.newValue as
      | { otp?: string; sender?: string; received_at?: number }
      | undefined;
    if (!v?.otp) return;
    // Only accept OTPs received after panel opened
    if (v.received_at && v.received_at * 1000 < startedAt - 5000) return;
    void applyOtp(v.otp, { sender: v.sender });
  };
  try {
    browser.storage.onChanged.addListener(storageListener);
  } catch {
    /* ignore */
  }

  // Also check current latestOtp once (may already be waiting in storage)
  try {
    const { latestOtp } = (await browser.storage.local.get(['latestOtp'])) as {
      latestOtp?: { otp?: string; sender?: string; received_at?: number };
    };
    if (
      latestOtp?.otp &&
      latestOtp.received_at &&
      latestOtp.received_at * 1000 >= startedAt - 2000
    ) {
      void applyOtp(latestOtp.otp, { sender: latestOtp.sender });
    }
  } catch {
    /* ignore */
  }

  // Ask background to refresh mail for active inbox (best-effort)
  try {
    const { activeInboxId } = (await browser.storage.local.get(['activeInboxId'])) as {
      activeInboxId?: string;
    };
    if (activeInboxId) {
      void browser.runtime
        .sendMessage({ type: 'checkEmails', inboxId: activeInboxId })
        .catch(() => {});
    }
  } catch {
    /* ignore */
  }

  const handle: WaitOtpPanelHandle = {
    cleanup,
    notifyOtp: applyOtp,
  };
  activeHandle = handle;
  return handle;
}

export function getActiveWaitOtpPanel(): WaitOtpPanelHandle | null {
  return activeHandle;
}

export function dismissWaitOtpPanel(): void {
  activeHandle?.cleanup();
  activeHandle = null;
}
