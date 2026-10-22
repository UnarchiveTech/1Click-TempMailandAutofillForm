/**
 * Disposable email detection
 *
 * When a user types a "real" email (gmail, outlook, yahoo, etc.) into a signup
 * form, this module shows a small inline suggestion to use their active temp
 * alias instead. If no active inbox exists, it offers to create one.
 */

import {
  getStorageViaBg,
  isSiteEmailAllowedViaBg,
  sendMessageViaBg,
  setStorageViaBg,
} from '@/utils/content/content-bg-bridge.js';
import { NoActiveAddressError } from '@/utils/content/content-errors.js';
import { t } from '@/utils/i18n/content-i18n.js';
import { logError } from '@/utils/logger.js';
import { getBlockedTempMailSite } from '@/utils/provider/blocked-temp-mail-sites.js';
import { trustedClick } from '@/utils/security/dom-guard.js';
import type { AddressStatus } from '@/utils/types.js';
import { CONTENT_Z } from '@/utils/ui/portal-layers.js';
import { positionAtEndOfField, trackElementPosition } from '../dom/positioning.js';
import { getOrCreateShadowRoot } from '../dom/shadow-dom.js';
import {
  isLiveMailboxAddress,
  sanitizeBackgroundInboxResponse,
  sanitizeTimestampMap,
} from '../shared/address-liveness.js';

/**
 * Check if the current site is known to reject disposable email domains.
 * Returns the root domain if it matches, null otherwise.
 */
function getDisposableRejectingDomain(hostname: string): string | null {
  return getBlockedTempMailSite(hostname);
}

/**
 * Build a warning chip (orange/amber) - visually distinct from the green
 * "use temp alias" suggestion chip so users can tell them apart.
 */
function buildWarningChip(text: string): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'disposable-reject-warning-chip';
  chip.style.cssText = `
    position: absolute;
    z-index: ${CONTENT_Z.chip};
    background-color: var(--md-warning);
    color: var(--md-on-warning);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--md-shadow) 15%, transparent);
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: system-ui, sans-serif;
    user-select: none;
    white-space: nowrap;
    max-width: 280px;
    pointer-events: none;
  `;
  chip.textContent = text;
  return chip;
}

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

/** Exact match or subdomain of a known disposable domain. */
const KNOWN_DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'mailinator.net',
  '10minutemail.com',
  '10minutemail.net',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'grr.la',
  'pokemail.net',
  'spam4.me',
  'tempmail.com',
  'tempmail.net',
  'temp-mail.org',
  'temp-mail.io',
  'tempinbox.com',
  'throwawaymail.com',
  'yopmail.com',
  'yopmail.net',
  'mytemp.email',
  'maildrop.cc',
  'mailnesia.com',
  'mintemail.com',
  'dispostable.com',
  'mailcatch.com',
  'getnada.com',
  'nada.email',
  'trashmail.com',
  'trashmail.de',
  'sharklasers.com',
  'emailnator.com',
  'tempail.com',
  'tempail.org',
  'tempr.email',
  'tmail.ws',
  'tmailor.com',
  'mail.tm',
  'spamgourmet.com',
  'mailmetrash.com',
  'fakeinbox.com',
  'fake-mail.net',
  'burnermail.io',
  'mohmal.com',
  'mohmal.in',
  'emailondeck.com',
  'mailsac.com',
  'mailhero.io',
  'inboxkitten.com',
  'dropmail.me',
  'emltmp.com',
  'mailnator.com',
  'tempinbox.me',
  'zippymail.info',
  'cs.email',
  'spambox.us',
  'spam.la',
  'wegwerfmail.de',
  'wegwerfmail.net',
  'einrot.com',
  'einrot.de',
  'fakemailgenerator.com',
]);

function isKnownDisposableDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  for (const known of KNOWN_DISPOSABLE_DOMAINS) {
    if (normalized === known || normalized.endsWith(`.${known}`)) return true;
  }
  return false;
}

// Key names must match CONTENT_SCRIPT_READABLE_STORAGE_KEYS (and the
// CONTENT_SCRIPT_WRITABLE_STORAGE_KEYS subset for writes) in the background
// message handler - setStorageViaBg/getStorageViaBg reject any other key from
// a content script, which silently broke dismissals/preferences before.
const DISMISSED_DOMAINS_KEY = 'dismissedDisposableDomains';
const PREFERRED_DOMAINS_KEY = 'preferredDisposableDomains';
const DISMISS_DURATION_MS = 5 * 60 * 1000;
const INPUT_DEBOUNCE_MS = 350;

type AddressShape = { id: string; address: string };
/** A background response's inbox record after the shared response guard has PROVEN it live. */
type LiveInboxRecord = {
  id?: string;
  address: string;
  accountStatus?: AddressStatus;
  expiresAt?: number;
};

interface AddressResponse {
  activeAddressId?: string;
  addresses?: AddressShape[];
}

import { safeId, safeName, safePlaceholder } from '@/utils/security/dom-safe.js';

function isEmailField(input: HTMLInputElement): boolean {
  if (input.type === 'email') return true;
  if (safeName(input).toLowerCase().includes('email')) return true;
  if (safeId(input).toLowerCase().includes('email')) return true;
  if (safePlaceholder(input).toLowerCase().includes('email')) return true;
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
    // The bridge resolves `{ [KEY]: storedValue }` - unwrap the VALUE first.
    // This cast used to skip the unwrap, so lookups always missed (dismissals
    // never took effect) and every persist re-wrote the wrapper with one more
    // domain key, nesting the stored object a level deeper per accept.
    const result = (await getStorageViaBg(DISMISSED_DOMAINS_KEY)) as {
      [DISMISSED_DOMAINS_KEY]?: unknown;
    };
    // Shape-guard the map: only a plain object of finite-number timestamps is
    // usable. Corrupt values degrade to "no dismissals" so a corrupted write
    // can never be spread back into the next persist (which would canonize it).
    return sanitizeTimestampMap(result?.[DISMISSED_DOMAINS_KEY]);
  } catch {
    /* ignore */
    return {};
  }
}

/** Exposed for unit tests: corrupt dismissed-map values are pinned against this. */
export async function isDomainDismissed(domain: string): Promise<boolean> {
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
    await setStorageViaBg({ [DISMISSED_DOMAINS_KEY]: dismissed });
  } catch (error: unknown) {
    logError('Failed to persist dismissed domain', error);
  }
}

/** Load the set of domains where the user has accepted a temp alias suggestion. */
async function loadPreferredDomains(): Promise<Set<string>> {
  try {
    const result = (await getStorageViaBg(PREFERRED_DOMAINS_KEY)) as {
      [PREFERRED_DOMAINS_KEY]?: string[];
    };
    const arr = result[PREFERRED_DOMAINS_KEY];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    /* ignore */
    return new Set();
  }
}

/** Check if the user has previously accepted a temp alias suggestion on this domain. */
export async function isDomainPreferred(domain: string): Promise<boolean> {
  const preferred = await loadPreferredDomains();
  return preferred.has(domain.toLowerCase());
}

/** Save a domain as preferred (user accepted the temp alias suggestion). */
async function savePreferredDomain(domain: string): Promise<void> {
  try {
    const preferred = await loadPreferredDomains();
    preferred.add(domain.toLowerCase());
    await setStorageViaBg({ [PREFERRED_DOMAINS_KEY]: Array.from(preferred) });
  } catch (error: unknown) {
    logError('Failed to persist preferred domain', error);
  }
}

/** Remove a domain from the preferred list (user explicitly un-pinned). */
export async function removePreferredDomain(domain: string): Promise<void> {
  try {
    const preferred = await loadPreferredDomains();
    preferred.delete(domain.toLowerCase());
    await setStorageViaBg({ [PREFERRED_DOMAINS_KEY]: Array.from(preferred) });
  } catch (error: unknown) {
    logError('Failed to remove preferred domain', error);
  }
}

/** Exposed for unit tests: corrupt-storage degradation is pinned against this. */
export async function getActiveAddress(): Promise<AddressShape | null> {
  try {
    const { activeAddressId, addresses } = (await getStorageViaBg(
      ['activeAddressId', 'addresses'],
      true
    )) as AddressResponse;
    if (!activeAddressId || !Array.isArray(addresses) || addresses.length === 0) return null;
    // Shared liveness rule (address-liveness.ts): a corrupt entry (null /
    // primitive / object without an address) must not become the chip's
    // record - `field.value = record.address` would otherwise write the
    // literal string "undefined" into the host page's input. Dead addresses
    // (archived / deleted / expired) are equally not offerable.
    return (
      addresses.find(
        (i): i is AddressShape => i?.id === activeAddressId && isLiveMailboxAddress(i)
      ) || null
    );
  } catch (error: unknown) {
    logError('Failed to load active inbox', error);
    return null;
  }
}

/** Exposed for unit tests: malformed background responses are pinned against this. */
export async function createTempAddress(): Promise<{
  inbox: LiveInboxRecord | null;
  needsUserInteraction?: boolean;
}> {
  try {
    // Response-shape guard (shared/address-liveness.ts): a malformed background
    // answer must not hand a record without an address to the fill path (same
    // "undefined" hazard as corrupt storage). Degrades to `inbox: null`, which
    // the caller renders as its createFailed tooltip; a valid gesture token
    // (`needsUserInteraction`) survives the guard - that's a REAL flow, not a
    // failure.
    return sanitizeBackgroundInboxResponse(
      await sendMessageViaBg({
        type: 'createAddressWithGesture',
      })
    );
  } catch (error: unknown) {
    logError('Failed to create temp inbox', error);
    return { inbox: null };
  }
}

function buildChip(text: string): HTMLElement {
  const chip = document.createElement('div');
  chip.className = 'disposable-suggest-chip';
  chip.style.cssText = `
    position: absolute;
    z-index: ${CONTENT_Z.chip};
    background-color: var(--md-primary);
    color: var(--md-on-primary);
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--md-shadow) 15%, transparent);
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: system-ui, sans-serif;
    transition: opacity 0.2s, transform 0.1s;
    user-select: none;
    white-space: nowrap;
    /* Inside the shadow host (which is pointer-events:none) the clickable
       chip must re-enable pointer events for itself. */
    pointer-events: auto;
  `;
  chip.textContent = text;
  return chip;
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

  // Dynamic colors handled via CSS variables on shadow DOM host

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let currentChip: HTMLElement | null = null;
  let currentDomain: string | null = null;
  let currentAddress: AddressShape | null = null;

  let warningChip: HTMLElement | null = null;
  const rejectingDomain = getDisposableRejectingDomain(window.location.hostname);

  async function refreshChip(): Promise<void> {
    const value = field.value;
    const domain = getEmailDomain(value);

    // ── Disposable-rejection warning ──────────────────────────────────
    // Never suggest a temporary alias on a site known to reject them. Only
    // show the rejection warning when the address the user typed is itself a
    // known disposable domain; a Gmail address should not be mislabeled.
    if (rejectingDomain) {
      hideChip();
      if (domain && isKnownDisposableDomain(domain)) {
        await showWarningChip();
      } else {
        hideWarningChip();
      }
      return;
    }
    hideWarningChip();

    if (!domain || !REAL_EMAIL_DOMAINS.has(domain)) {
      hideChip();
      return;
    }
    if (await isDomainDismissed(domain)) {
      // Preferred domains always show the suggestion - skip dismissal
      if (!(await isDomainPreferred(domain))) {
        hideChip();
        return;
      }
    }

    currentDomain = domain;
    currentAddress = await getActiveAddress();
    await showChip();
  }

  function hideChip(): void {
    if (currentChip?.parentNode) {
      currentChip.parentNode.removeChild(currentChip);
    }
    currentChip = null;
    currentDomain = null;
  }

  async function showWarningChip(): Promise<void> {
    if (warningChip) return; // already showing
    const text = await t('disposable.rejectWarning', { domain: rejectingDomain || '' });
    const chip = buildWarningChip(text);
    positionChip(chip, field, updatePositionListeners);
    getOrCreateShadowRoot()?.appendChild(chip);
    warningChip = chip;
  }

  function hideWarningChip(): void {
    if (warningChip?.parentNode) {
      warningChip.parentNode.removeChild(warningChip);
    }
    warningChip = null;
  }

  async function showChip(): Promise<void> {
    const isPreferred = await isDomainPreferred(currentDomain || '');
    const text = currentAddress
      ? await t('disposable.useAddressInstead', { address: currentAddress.address })
      : await t('disposable.createAliasInstead');

    if (currentChip) {
      currentChip.textContent = isPreferred
        ? `${text} · ${await t('disposable.preferredDomain')}`
        : text;
      return;
    }

    const chip = buildChip(text);
    if (isPreferred) {
      chip.style.backgroundColor = 'var(--md-primary)';
      chip.style.boxShadow =
        '0 0 0 2px var(--md-on-primary), 0 2px 8px color-mix(in srgb, var(--md-shadow) 15%, transparent)';
    }
    chip.onmouseover = () => {
      chip.style.filter = 'brightness(0.9)';
    };
    chip.onmouseout = () => {
      chip.style.filter = 'none';
    };
    chip.onmousedown = (event) => {
      // Keep focus on the input until the click handler runs. Otherwise blur's
      // delayed hide can remove this chip during a slow press.
      event.preventDefault();
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      chip.style.transform = 'scale(0.97)';
    };
    chip.onmouseup = () => {
      chip.style.transform = 'scale(1)';
    };

    chip.addEventListener(
      'click',
      trustedClick(async (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        await acceptChip();
      })
    );

    positionChip(chip, field, updatePositionListeners);
    getOrCreateShadowRoot()?.appendChild(chip);
    currentChip = chip;
  }

  async function acceptChip(): Promise<void> {
    if (!currentDomain) return;
    const domainToDismiss = currentDomain;
    try {
      // Both proven shapes carry `address: string` - the only field the fill
      // reads - so the union is sound here.
      let record: AddressShape | LiveInboxRecord | null =
        currentAddress || (await getActiveAddress());
      if (!record) {
        const created = await createTempAddress();
        if (created.needsUserInteraction) {
          await showErrorTooltip(currentChip, await t('disposable.openExtensionToCreate'));
          return;
        }
        if (!created.inbox) {
          await showErrorTooltip(currentChip, await t('disposable.createFailed'));
          return;
        }
        record = created.inbox;
      }
      if (!field.isConnected || field.disabled || field.readOnly) {
        await showErrorTooltip(currentChip, await t('disposable.fillFailed'));
        return;
      }
      if (!(await isSiteEmailAllowedViaBg(record.address))) {
        await showErrorTooltip(currentChip, await t('errors.siteEmailUnavailable'));
        return;
      }
      field.value = record.address;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      await _dismissDomain(domainToDismiss);
      // Remember this domain as preferred so the chip shows again in future
      await savePreferredDomain(domainToDismiss);
      if (currentChip?.parentNode) {
        currentChip.parentNode.removeChild(currentChip);
      }
      currentChip = null;
    } catch (error: unknown) {
      if (error instanceof NoActiveAddressError) {
        await showErrorTooltip(currentChip, await t('disposable.noActiveAlias'));
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

  let blurTimer: ReturnType<typeof setTimeout> | null = null;

  function onBlur(): void {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      hideChip();
      hideWarningChip();
    }, 150);
  }

  field.addEventListener('input', onInput);
  field.addEventListener('blur', onBlur);

  return {
    cleanup: () => {
      field.removeEventListener('input', onInput);
      field.removeEventListener('blur', onBlur);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (blurTimer) clearTimeout(blurTimer);
      hideChip();
      hideWarningChip();
      delete field.dataset.disposableHintAttached;
    },
  };
}

let _errorTooltipTimer: ReturnType<typeof setTimeout> | null = null;

async function showErrorTooltip(chip: HTMLElement | null, message: string): Promise<void> {
  if (!chip) return;
  // Cancel any pending reset from a previous call so timers don't overlap
  if (_errorTooltipTimer !== null) {
    clearTimeout(_errorTooltipTimer);
    _errorTooltipTimer = null;
  }
  const originalText = chip.textContent;
  const originalBg = chip.style.backgroundColor;
  const originalColor = chip.style.color;
  chip.textContent = message;
  chip.style.backgroundColor = 'var(--md-error)';
  chip.style.color = 'var(--md-on-error)';
  _errorTooltipTimer = setTimeout(() => {
    _errorTooltipTimer = null;
    chip.textContent = originalText;
    // Restore the chip's own original color rather than assuming DEFAULT_PRIMARY_COLOR
    chip.style.backgroundColor = originalBg;
    chip.style.color = originalColor;
  }, 1500);
}

function positionChip(
  chip: HTMLElement,
  field: HTMLElement,
  updatePositionListeners: Array<() => void>
): void {
  trackElementPosition(chip, field, positionAtEndOfField, updatePositionListeners);
}
