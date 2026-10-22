/**
 * On-page "Wait for OTP" panel - live countdown + fill when OTP arrives.
 * Uses closed shadow host (same as autofill buttons).
 */

import { watchOtpFailure } from '@/features/intelligence/conflict-watch.js';
import { detectSignupPage } from '@/features/intelligence/signup-page.js';
import {
  consumeLatestOtpViaBg,
  copyToClipboardViaBg,
  getStorageViaBg,
  sendMessageViaBg,
} from '@/utils/content/content-bg-bridge.js';
import { t } from '@/utils/i18n/content-i18n.js';
import { logDebug } from '@/utils/logger.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { responsiveButtonLayout } from '@/utils/ui/responsive-button-layout.js';
import { BUTTON_CLASS, getOrCreateShadowRoot } from '../dom/shadow-dom.js';
import { clipOtpMetaText, normalizeOtpCode, otpFreshEnough } from './otp-code.js';
import { fillOtp, findOtpInputs } from './otp-handler.js';
import { waitPanelRecipientMatches } from './otp-recipient.js';

const PANEL_ID = 'oc-wait-otp-panel';
/** Codes from many providers stay valid 10-30 min - 15 min beats a 5-min hard cutoff. */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const TICK_MS = 1000;

export interface WaitOtpPanelHandle {
  cleanup: () => void;
  notifyOtp: (
    otp: string,
    meta?: { sender?: string; subject?: string; recipient?: string }
  ) => Promise<boolean>;
}

let activeHandle: WaitOtpPanelHandle | null = null;
let panelRequestGeneration = 0;

function emptyWaitOtpHandle(): WaitOtpPanelHandle {
  return { cleanup: () => {}, notifyOtp: async () => false };
}

function formatMmSs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/**
 * Detect whether current page requests email verification (OTP, Magic Link, Enter Code).
 */
export function isVerificationPage(root: ParentNode = document): boolean {
  try {
    return detectSignupPage(root).emailVerification === 'pending';
  } catch {
    // On DOM access errors, err on the side of caution: assume it is NOT a
    // verification page to avoid unnecessary OTP panel injection.
    return false;
  }
}

/**
 * Show floating Wait-for-OTP / Verification Pending panel. Replaces any existing panel.
 */
export async function showWaitOtpPanel(opts?: {
  email?: string | null;
  timeoutMs?: number;
  autoFill?: boolean;
  skipIfNotVerificationPage?: boolean;
  /** Focus the panel only for a direct, user initiated open. */
  focusOnOpen?: boolean;
}): Promise<WaitOtpPanelHandle> {
  if (opts?.skipIfNotVerificationPage && !isVerificationPage()) {
    // Even if the page text doesn't mention verification, if we detect OTP
    // input fields (e.g. 6-digit digit boxes, autocomplete=one-time-code),
    // still show the panel so the OTP can be auto-filled when it arrives.
    const hasOtpInputs = findOtpInputs().length > 0;
    if (!hasOtpInputs) {
      panelRequestGeneration += 1;
      return emptyWaitOtpHandle();
    }
  }

  if (activeHandle) {
    activeHandle.cleanup();
    activeHandle = null;
  } else {
    // Invalidate any previous async panel setup that has not mounted yet.
    panelRequestGeneration += 1;
  }

  const requestGeneration = ++panelRequestGeneration;
  const isCurrentRequest = () => requestGeneration === panelRequestGeneration;

  const root = getOrCreateShadowRoot();
  if (!root) {
    return emptyWaitOtpHandle();
  }

  const existing = root.getElementById(PANEL_ID);
  existing?.remove();

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const autoFill = opts?.autoFill !== false;
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  /** The address this panel is waiting on - OTPs for OTHER addresses are rejected. */
  const expectedRecipient = (opts?.email || '').trim().toLowerCase();
  let filledOtp: string | null = null;
  let waitExpired = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let stopOtpFailureWatch: (() => void) | null = null;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'status');
  panel.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: ${CONTENT_Z.overlay};
    pointer-events: auto;
    min-width: 260px;
    max-width: min(360px, calc(100vw - 32px));
    padding: 12px 14px;
    border-radius: 14px;
    background: var(--md-surface-container-high);
    color: var(--md-on-surface);
    box-shadow: 0 8px 28px color-mix(in srgb, var(--md-shadow) 22%, transparent);
    font-family: system-ui, -apple-system, sans-serif;
    border: 1px solid var(--md-outline-variant);
  `;

  const title = document.createElement('div');
  title.style.cssText =
    'font-size: var(--md-type-title-medium-size, 16px); line-height: var(--md-type-title-medium-line, 24px); font-weight: 500; margin-bottom: 4px;';
  title.textContent = await t('contentAutofill.waitForOtpTitle');

  const emailLine = document.createElement('div');
  emailLine.style.cssText =
    'font-size: var(--md-type-body-small-size, 12px); line-height: var(--md-type-body-small-line, 16px); color: var(--md-on-surface-variant); margin-bottom: 8px; word-break: break-all;';
  if (opts?.email) {
    emailLine.textContent = opts.email;
  } else {
    emailLine.style.display = 'none';
  }

  const status = document.createElement('div');
  status.style.cssText =
    'font-size: var(--md-type-body-medium-size, 14px); line-height: var(--md-type-body-medium-line, 20px); margin-bottom: 8px;';
  status.textContent = await t('contentAutofill.waitForOtpWaiting');

  const countdown = document.createElement('div');
  countdown.style.cssText =
    'font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; margin-bottom: 10px; color: var(--md-primary);';
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
    background: var(--md-primary-container);
    color: var(--md-on-primary-container);
    text-align: center;
    margin-bottom: 10px;
    user-select: all;
  `;

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 18px; flex-wrap: nowrap; width: 100%;';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = BUTTON_CLASS;
  copyBtn.style.cssText = `
    flex: 1;
    min-width: 90px;
    padding: 7px 10px;
    border: none;
    border-radius: 10px;
    background: var(--md-primary);
    color: var(--md-on-primary);
    font-size: var(--md-type-label-large-size, 14px);
    line-height: var(--md-type-label-large-line, 20px);
    min-height: 40px;
    font-weight: 500;
    cursor: pointer;
    display: none;
  `;
  copyBtn.textContent = await t('common.copy');

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
    border: 1px solid var(--md-outline-variant);
    border-radius: 10px;
    background: transparent;
    color: var(--md-on-surface);
    font-size: var(--md-type-label-large-size, 14px);
    line-height: var(--md-type-label-large-line, 20px);
    min-height: 40px;
    font-weight: 500;
    cursor: pointer;
  `;
  closeBtn.textContent = await t('contentAutofill.waitForOtpDismiss');

  actions.appendChild(copyBtn);
  actions.appendChild(fillBtn);
  actions.appendChild(closeBtn);
  let actionsLayout: ReturnType<typeof responsiveButtonLayout> | null = null;
  panel.appendChild(title);
  panel.appendChild(emailLine);
  panel.appendChild(status);
  panel.appendChild(countdown);
  panel.appendChild(otpDisplay);
  panel.appendChild(actions);
  if (!isCurrentRequest()) return emptyWaitOtpHandle();
  root.appendChild(panel);

  // Keyboard navigation: ArrowLeft/ArrowRight navigate between buttons,
  // Enter/Space activate the focused button, Escape dismisses the panel.
  const focusableButtons = (): HTMLButtonElement[] =>
    [copyBtn, fillBtn, closeBtn].filter(
      (button) =>
        button.isConnected &&
        !button.disabled &&
        getComputedStyle(button).display !== 'none' &&
        getComputedStyle(button).visibility !== 'hidden'
    );
  let focusIndex = 0;

  function focusButton(idx: number): void {
    const availableButtons = focusableButtons();
    if (availableButtons.length === 0) return;
    focusIndex = (idx + availableButtons.length) % availableButtons.length;
    const btn = availableButtons[focusIndex];
    btn?.focus();
  }

  panel.addEventListener('keydown', (e: KeyboardEvent) => {
    // Accept events on the panel itself, on any of its buttons (focus moves to
    // a button once a code arrives, so a panel-only guard would silently kill
    // Escape / arrow navigation exactly when the user needs them), and on
    // document.body (focus not yet moved into the panel).
    const targetInPanel =
      e.target === panel ||
      e.target === document.body ||
      (e.target instanceof Node && panel.contains(e.target));
    if (!targetInPanel) return;
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusButton(focusIndex - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusButton(focusIndex + 1);
        break;
      case 'Enter':
        if (document.activeElement instanceof HTMLElement && e.target === panel) {
          const availableButtons = focusableButtons();
          if (availableButtons.length > 0) {
            e.preventDefault();
            availableButtons[focusIndex % availableButtons.length]?.click();
          }
        }
        break;
    }
  });

  // Focus the first actionable button on mount for keyboard users
  if (opts?.focusOnOpen) {
    if (filledOtp) copyBtn?.focus();
    else closeBtn?.focus();
  }

  const cleanup = () => {
    if (isCurrentRequest()) panelRequestGeneration += 1;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    stopOtpFailureWatch?.();
    stopOtpFailureWatch = null;
    actionsLayout?.destroy();
    panel.remove();
    if (activeHandle?.cleanup === cleanup) activeHandle = null;
  };

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  });

  const applyOtp = async (
    otp: string,
    meta?: { sender?: string; subject?: string; recipient?: string }
  ): Promise<boolean> => {
    if (!isCurrentRequest() || !panel.isConnected || waitExpired || Date.now() >= deadline)
      return false;
    const normalizedOtp = normalizeOtpCode(otp);
    if (!normalizedOtp) {
      logDebug(`Ignoring malformed OTP code (length ${String(otp).length})`);
      return false;
    }
    if (filledOtp === normalizedOtp) return false;
    // Trust boundary: never display, fill, or consume a code that fails the
    // plausible-OTP shape (both extraction paths cap at 3-8 alphanumeric with
    // a digit, so a malformed value here is hostile or corrupted input).
    // Recipient matching: a code addressed to a DIFFERENT inbox must not be
    // auto-filled into this form (two tabs waiting, or two addresses open).
    // Panel messages can arrive from every open tab. Require both sides of the
    // recipient binding; the shared matcher permits missing metadata for older
    // multi-step flows, but an unbound panel must not display or consume a code.
    if (!waitPanelRecipientMatches(expectedRecipient, meta?.recipient)) {
      logDebug(
        `OTP recipient mismatch - skipping ${meta?.recipient || ''} (waiting for ${expectedRecipient})`
      );
      return false;
    }
    filledOtp = normalizedOtp;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    countdown.style.display = 'none';
    otpDisplay.style.display = 'block';
    otpDisplay.textContent = normalizedOtp;
    copyBtn.style.display = 'block';
    fillBtn.style.display = 'block';
    if (actionsLayout) actionsLayout.update();
    else actionsLayout = responsiveButtonLayout(actions, { tier: 'XS' });
    focusIndex = 0;
    if (opts?.focusOnOpen) void copyBtn.focus();
    status.textContent = await t('contentAutofill.waitForOtpReceived');
    if (!isCurrentRequest() || !panel.isConnected) return false;
    if (meta?.sender) {
      // Sender is the email `from` header - attacker-controlled, so cap it in
      // the panel DOM (textContent keeps it inert, but unbounded length would
      // blow the status line layout).
      status.textContent += ` · ${clipOtpMetaText(meta.sender)}`;
    }
    // Consume the cached code so a later panel (or a re-open) cannot reuse a
    // stale OTP that was already shown/filled for this session. Best-effort:
    // the bridge logs failures (a leftover stale code is the worst outcome).
    await consumeLatestOtpViaBg(otp, meta?.recipient || expectedRecipient);
    if (!isCurrentRequest() || !panel.isConnected) return false;
    if (autoFill) {
      try {
        if (waitExpired || Date.now() >= deadline) return false;
        await fillOtp(normalizedOtp);
        if (!isCurrentRequest() || !panel.isConnected) return false;
        status.textContent = await t('contentAutofill.otpFilled');
        // If site rejects the code, prompt user to enter manually
        try {
          stopOtpFailureWatch?.();
          stopOtpFailureWatch = watchOtpFailure(document, () => {
            void (async () => {
              status.textContent = await t('contentAutofill.otpFailedManual');
              fillBtn.style.display = 'block';
              copyBtn.style.display = 'block';
              actionsLayout?.update();
              // Only take focus when the panel was opened directly by the user.
              if (opts?.focusOnOpen) {
                try {
                  const inputs = findOtpInputs();
                  inputs[0]?.focus();
                  inputs[0]?.select?.();
                } catch {
                  /* ignore */
                }
              }
            })();
          });
        } catch {
          /* optional */
        }
      } catch (e) {
        logDebug(`Wait OTP auto-fill failed: ${String(e)}`);
        status.textContent = await t('contentAutofill.otpFailedManual');
      }
    }
    return true;
  };

  copyBtn.addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();
    if (!filledOtp) return;
    try {
      await copyToClipboardViaBg(filledOtp);
      copyBtn.textContent = await t('contentAutofill.waitForOtpCopied');
    } catch {
      /* ignore */
      copyBtn.textContent = await t('contentAutofill.otpCopyFailed');
    }
  });

  fillBtn.addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
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
      waitExpired = true;
      countdown.textContent = '0:00';
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      status.textContent = await t('contentAutofill.waitForOtpTimeout');
    }
  }, TICK_MS);

  // Check current latestOtp once (may already be waiting in storage). Live
  // updates arrive via the background's `fillOTP` runtime broadcast instead.
  try {
    const { latestOtp } = (await getStorageViaBg(['latestOtp'])) as {
      latestOtp?: { otp?: string; sender?: string; recipient?: string; received_at?: number };
    };
    const storedRecipient = (latestOtp?.recipient || '').trim().toLowerCase();
    if (
      latestOtp?.otp &&
      otpFreshEnough(latestOtp.received_at, startedAt) &&
      // Stale-identity guard: only adopt a cached code addressed to THIS inbox.
      (!expectedRecipient || !storedRecipient || storedRecipient === expectedRecipient)
    ) {
      void applyOtp(latestOtp.otp, { sender: latestOtp.sender, recipient: latestOtp.recipient });
    }
  } catch {
    /* ignore */
  }

  // Ask background to refresh mail for active inbox (best-effort - bridge
  // calls log failures internally and never reject, so no local guard).
  // requestInboxCheck runs the checkEmails fetch + store path but returns
  // counts only; `checkEmails` itself is extension-page-only (its response
  // carries full message bodies) and would be rejected for this sender.
  const { activeAddressId } = (await getStorageViaBg(['activeAddressId'])) as {
    activeAddressId?: string;
  };
  if (activeAddressId) {
    const res = (await sendMessageViaBg({
      type: 'requestInboxCheck',
      addressId: activeAddressId,
    })) as { success?: boolean; newMessages?: number } | undefined;
    logDebug('Wait-OTP panel inbox refresh:', {
      ok: res?.success === true,
      newMessages: res?.newMessages ?? 0,
    });
  }

  const handle: WaitOtpPanelHandle = {
    cleanup,
    notifyOtp: applyOtp,
  };
  if (!isCurrentRequest()) {
    cleanup();
    return emptyWaitOtpHandle();
  }
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
