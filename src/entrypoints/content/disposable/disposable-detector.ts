/**
 * Disposable email detection
 *
 * When a user types a "real" email (gmail, outlook, yahoo, etc.) into a signup
 * form, this module shows a small inline suggestion to use their active temp
 * alias instead. If no active inbox exists, it offers to create one.
 */

import { browser } from 'wxt/browser';
import { NoActiveInboxError } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { positionAtEndOfField, trackElementPosition } from '../dom/positioning.js';

const REAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'mail.com',
  'gmx.com',
  'gmx.de',
  'fastmail.com',
  'tutanota.com',
]);

const DISMISSED_DOMAINS_KEY = 'disposableHintDismissedDomains';
const DISMISS_DURATION_MS = 5 * 60 * 1000;
const INPUT_DEBOUNCE_MS = 350;

type InboxShape = { id: string; address: string };

interface InboxResponse {
  activeInboxId?: string;
  inboxes?: InboxShape[];
}

interface DismissedDomainsResponse {
  [key: string]: number;
}

function isEmailField(input: HTMLInputElement): boolean {
  if (input.type === 'email') return true;
  if (input.name?.toLowerCase().includes('email')) return true;
  if (input.id?.toLowerCase().includes('email')) return true;
  if (input.placeholder?.toLowerCase().includes('email')) return true;
  if (input.getAttribute('autocomplete') === 'email') return true;
  return false;
}

function getEmailDomain(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.includes('@')) return null;
  const parts = trimmed.split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase().trim();
  if (!domain?.includes('.')) return null;
  return domain;
}

async function loadDismissedDomains(): Promise<Record<string, number>> {
  try {
    return (
      ((await browser.storage.local.get(DISMISSED_DOMAINS_KEY)) as DismissedDomainsResponse) || {}
    );
  } catch {
    return {};
  }
}

async function isDomainDismissed(domain: string): Promise<boolean> {
  const dismissed = await loadDismissedDomains();
  const ts = dismissed[domain];
  if (!ts) return false;
  if (Date.now() - ts > DISMISS_DURATION_MS) return false;
  return true;
}

async function _dismissDomain(domain: string): Promise<void> {
  try {
    const dismissed = await loadDismissedDomains();
    dismissed[domain] = Date.now();
    await browser.storage.local.set({ [DISMISSED_DOMAINS_KEY]: dismissed });
  } catch (error: unknown) {
    logError('Failed to persist dismissed domain', error);
  }
}

async function getActiveInbox(): Promise<InboxShape | null> {
  try {
    const { activeInboxId, inboxes = [] } = (await browser.storage.local.get([
      'activeInboxId',
      'inboxes',
    ])) as InboxResponse;
    if (!activeInboxId || !Array.isArray(inboxes) || inboxes.length === 0) return null;
    return inboxes.find((i) => i.id === activeInboxId) || null;
  } catch (error: unknown) {
    logError('Failed to load active inbox', error);
    return null;
  }
}

async function createTempInbox(): Promise<InboxShape | null> {
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'createInbox',
    })) as { success?: boolean; inbox?: InboxShape; error?: string };
    if (response?.success && response.inbox) return response.inbox;
    return null;
  } catch (error: unknown) {
    logError('Failed to create temp inbox', error);
    return null;
  }
}

function buildChip(text: string, primaryColor: string): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'disposable-suggest-chip';
  chip.style.cssText = `
    position: absolute;
    z-index: 10001;
    background-color: ${primaryColor};
    color: white;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: system-ui, sans-serif;
    transition: opacity 0.2s, transform 0.1s;
    user-select: none;
    white-space: nowrap;
  `;
  chip.textContent = text;
  return chip;
}

const DEFAULT_PRIMARY_COLOR = '#4c662b';
const DEFAULT_PRIMARY_HOVER = '#3a4e20';

async function _getPrimaryColor(): Promise<string> {
  try {
    const result = (await browser.storage.local.get('customColor')) as { customColor?: string };
    return result.customColor || DEFAULT_PRIMARY_COLOR;
  } catch {
    return DEFAULT_PRIMARY_COLOR;
  }
}

interface DisposableTracker {
  cleanup: () => void;
}

export function attachDisposableHint(
  field: HTMLInputElement,
  updatePositionListeners: Array<() => void>
): DisposableTracker | null {
  if (!isEmailField(field)) return null;
  if (field.dataset.disposableHintAttached === '1') return null;
  field.dataset.disposableHintAttached = '1';

  const primaryColor = DEFAULT_PRIMARY_COLOR;
  const primaryHover = DEFAULT_PRIMARY_HOVER;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let currentChip: HTMLElement | null = null;
  let currentDomain: string | null = null;
  let currentInbox: InboxShape | null = null;
  let _isDismissedForDomain = false;

  async function refreshChip(): Promise<void> {
    const value = field.value;
    const domain = getEmailDomain(value);

    if (!domain || !REAL_EMAIL_DOMAINS.has(domain)) {
      hideChip();
      return;
    }
    if (await isDomainDismissed(domain)) {
      _isDismissedForDomain = true;
      hideChip();
      return;
    }
    _isDismissedForDomain = false;

    currentDomain = domain;
    currentInbox = await getActiveInbox();
    showChip();
  }

  function hideChip(): void {
    if (currentChip?.parentNode) {
      currentChip.parentNode.removeChild(currentChip);
    }
    currentChip = null;
    currentDomain = null;
  }

  function showChip(): void {
    if (currentChip) {
      const text = currentInbox
        ? `Use ${currentInbox.address} instead?`
        : 'Create temp alias instead?';
      currentChip.textContent = text;
      return;
    }

    const text = currentInbox
      ? `Use ${currentInbox.address} instead?`
      : 'Create temp alias instead?';
    const chip = buildChip(text, primaryColor);
    chip.onmouseover = () => {
      chip.style.backgroundColor = primaryHover;
    };
    chip.onmouseout = () => {
      chip.style.backgroundColor = primaryColor;
    };
    chip.onmousedown = () => {
      chip.style.transform = 'scale(0.97)';
    };
    chip.onmouseup = () => {
      chip.style.transform = 'scale(1)';
    };

    chip.addEventListener('click', async (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      await acceptChip();
    });

    positionChip(chip, field, updatePositionListeners);
    document.body.appendChild(chip);
    currentChip = chip;
  }

  async function acceptChip(): Promise<void> {
    if (!currentDomain) return;
    try {
      let inbox = currentInbox || (await getActiveInbox());
      if (!inbox) {
        inbox = await createTempInbox();
        if (!inbox) {
          await showErrorTooltip(currentChip, 'Could not create temp alias');
          return;
        }
      }
      field.value = inbox.address;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      if (currentChip?.parentNode) {
        currentChip.parentNode.removeChild(currentChip);
      }
      currentChip = null;
    } catch (error: unknown) {
      if (error instanceof NoActiveInboxError) {
        await showErrorTooltip(currentChip, 'No active temp alias');
      } else {
        logError('Failed to fill with temp alias', error);
      }
    }
  }

  function onInput(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void refreshChip();
    }, INPUT_DEBOUNCE_MS);
  }

  function onBlur(): void {
    setTimeout(() => {
      hideChip();
    }, 150);
  }

  field.addEventListener('input', onInput);
  field.addEventListener('blur', onBlur);

  return {
    cleanup: () => {
      field.removeEventListener('input', onInput);
      field.removeEventListener('blur', onBlur);
      if (debounceTimer) clearTimeout(debounceTimer);
      hideChip();
      delete field.dataset.disposableHintAttached;
    },
  };
}

async function showErrorTooltip(chip: HTMLElement | null, message: string): Promise<void> {
  if (!chip) return;
  const originalText = chip.textContent;
  chip.textContent = message;
  chip.style.backgroundColor = '#b3261e';
  setTimeout(() => {
    chip.textContent = originalText;
    chip.style.backgroundColor = DEFAULT_PRIMARY_COLOR;
  }, 1500);
}

function positionChip(
  chip: HTMLElement,
  field: HTMLElement,
  updatePositionListeners: Array<() => void>
): void {
  trackElementPosition(chip, field, positionAtEndOfField, updatePositionListeners);
}
