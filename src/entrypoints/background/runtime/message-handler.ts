/**
 * Runtime message handler - routes incoming messages to the appropriate module functions
 */
import { browser } from 'wxt/browser';
import { applyUserAgentSpoofToTab } from '@/entrypoints/background/apply-user-agent-spoof.js';
import { clearAiDetectionCache } from '@/entrypoints/background/parsing/ai-detection.js';
import { matchKindFromText } from '@/entrypoints/background/parsing/field-text.js';
import {
  generatePassword,
  generatePhoneNumber,
  generateRandomName,
  generateUsername,
  generateWebsiteUrl,
} from '@/entrypoints/content/autofill/generators.js';
import { restoreArchivedOverflowAddress } from '@/features/address/archived-overflow.js';
import {
  type BulkReauthEntry,
  type ReauthBatchOutcome,
  reauthenticateAddressCoreForLockedCaller,
  runReauthBatch,
} from '@/features/address/reauthenticate-address.js';
import { getActiveAddressMeta } from '@/features/intelligence/active-inbox-meta.js';
import {
  recordAutofillFailure,
  recordAutofillSuccess,
} from '@/features/intelligence/blocklist-learn.js';
import { classifyConflictText } from '@/features/intelligence/conflict-regexes.js';
import { resolveDomainFieldOverrides } from '@/features/intelligence/domain-field-overrides.js';
import {
  getFieldMap,
  recordFieldMapHitBySelector,
  setFieldMapCorrectionBySelector,
} from '@/features/intelligence/field-maps.js';
import { pickFreshestIdentity } from '@/features/intelligence/freshness.js';
import { routeIdentityForDomain } from '@/features/intelligence/identity-router.js';
import {
  localeAwareAddressExtras,
  localeAwarePhone,
  localeToCountryHint,
} from '@/features/intelligence/locale-fill.js';
import {
  beginSignupAttempt,
  getSignupAttempt,
  openSignupVerificationLink,
  reportSignupProgress,
  type SignupCaller,
} from '@/features/intelligence/signup-attempts.js';
import type { SignupProgress } from '@/features/intelligence/signup-state.js';
import {
  clearSiteEmailRejections,
  getSiteRejectedEmailDomains,
  recordSiteEmailRejection,
} from '@/features/intelligence/site-email-rejections.js';
import { recordAutofillOutcome, shouldPreferReplay } from '@/features/intelligence/site-memory.js';
import { loadSmartAutofillSettings } from '@/features/intelligence/smart-settings.js';
import { normalizeDomain } from '@/features/intelligence/storage.js';
import type { WizardSession, WizardStep } from '@/features/intelligence/wizard-session.js';
import {
  advanceWizardStep,
  clearWizardSession,
  getWizardSession,
  upsertWizardSession,
} from '@/features/intelligence/wizard-session.js';
import {
  domainMatchesHost,
  findSiteReplayForDomain,
} from '@/features/login-info/saved-login-credentials.js';
import { isActivityViewId, type View } from '@/features/types/view-types.js';
import type { IconSvgName } from '@/ui/components/icons/icon-svg.js';
import { getIconSvg } from '@/ui/components/icons/icon-svg.js';
import { addHardResetEvent } from '@/utils/activity/activity-tracker.js';
import { isLive } from '@/utils/address/address-status.js';
import { type AddressTagEntry, unifyTagColors } from '@/utils/address/address-tags.js';
import {
  copyToClipboardAndSchedulePurge,
  copyToClipboardFromBackground,
} from '@/utils/clipboard/clipboard.js';
import { CONSTANTS } from '@/utils/constants.js';
import {
  normalizeSitePrivacyHost,
  SITE_PRIVACY_SETTINGS_KEY,
  sanitizeSitePrivacySettingsMap,
} from '@/utils/content/site-privacy-settings.js';
import {
  DEFAULT_PROVIDER,
  EmailService,
  getAllProviderConfigs,
  loadProviderConfig,
} from '@/utils/email/email-service.js';
import { getErrorMessage, toResultErrorKey, ValidationError } from '@/utils/errors.js';
import { allowsSiteEmail } from '@/utils/provider/site-email-domains.js';
import { decrypt, encrypt, looksLikeCiphertext } from '@/utils/security/crypto.js';
import { normalizeSavedLoginCredential } from '@/utils/security/login-credential-normalization.js';
import { normalizeFaviconContentType } from '@/utils/ui/favicon-content-type.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';

export { normalizeSavedLoginCredential };

import { runWithConcurrency } from '@/utils/concurrency.js';
import { t } from '@/utils/i18n/i18n-background.js';
import { randomAdultDob } from '@/utils/i18n/locale-profile.js';
import { redactMessageForLog } from '@/utils/log-redaction.js';
import { logDebug, logError, logInfo, logWarn } from '@/utils/logger.js';
import {
  InFlightCoalescer,
  LOCKS,
  TtlReadCache,
  withAddressLock,
  withLock,
} from '@/utils/mutex.js';
import {
  addCustomProviderInstance,
  getProviderInstancesWithCustom,
  getSelectedProviderInstance,
  initializeDefaultProvider,
  removeCustomProviderInstance,
  setDisabledInstances,
  setProviderInstance,
} from '@/utils/provider/instance-manager.js';
import {
  isSafeFetchUrl,
  isSafeFetchUrlWithDns,
  validateCustomInstanceName,
  validateCustomInstanceUrl,
} from '@/utils/provider/instance-validation.js';
import { deriveAddressTiming } from '@/utils/provider/provider-expiry.js';
import {
  filterPersistedAddresses,
  filterPersistedIdentities,
  getAddresses,
  getSelectedProvider,
  getStoredEmailsForAddress,
  setAddresses,
} from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type {
  Address,
  CredentialsHistoryItem,
  Email,
  EmailFilters,
  Identity,
  ProviderInstance,
  RuntimeMessage,
  RuntimeMessageSender,
} from '@/utils/types.js';
import {
  consumePendingGestureToken,
  validateAndConsumeGestureToken,
} from '@/utils/ui/gesture-token.js';

export type { RuntimeMessage } from '@/utils/types.js';

import {
  archiveAddresses,
  checkNewEmails,
  createAddress,
  deleteAddress,
  deleteAddresses,
  ensureBadgeCountdownAlarm,
  renewAddresses,
  setupAddressExpiryCheck,
  setupPeriodicEmailCheck,
  unarchiveAddresses,
} from '../address/address-manager.js';
import {
  getAnalytics,
  getPerformanceSummary,
  recordEmailRead,
  recordExtensionOpen,
  recordPageVisit,
  recordStorageTrend,
  recordUIRenderTime,
  resetAnalyticsData,
} from '../address/analytics.js';
import {
  cleanupOldStoredEmails,
  clearAllOtps,
  clearStoredEmails,
  getArchivedEmails,
  getEmailsToBeDeleted,
  getStorageUsage,
  rescanStoredEmails,
  restoreArchivedEmailsToStored,
  storeNewMessages,
} from '../address/email-storage.js';
import { updateRefreshAlarm } from '../address/periodic-checks.js';
import { handleUpdateSessionCredentials } from '../credentials/session-credentials.js';
import { updatePendingSignupUsername } from '../credentials/username-recovery.js';

/**
 * Discriminated union over the `BackgroundMessage | ContentMessage` catalogue
 * in types.ts (single source of truth - check-message-types.ts verifies every
 * send site against it). Replaces the former `[key: string]: unknown`
 * interface: each handler's `message` parameter narrows to exactly its union
 * member, so field access is compiler-checked at send sites AND in handlers.
 * The runtime boundary cast in `registerMessageHandler` is the only place the
 * union is widened from an unknown browser payload.
 *
 * NOTE: the catalogue mixes `type:`-discriminated members with legacy
 * `action:`-discriminated ones, and no member carries both, so a single
 * discriminant extractor covers the whole union.
 */

/**
 * Every literal discriminant (both `type:` and `action:` members).
 * Distributes over the union so each member contributes its own key.
 */
export type RuntimeMessageKey = RuntimeMessage extends infer M
  ? M extends { type: infer T }
    ? Extract<T, string>
    : M extends { action: infer A }
      ? Extract<A, string>
      : never
  : never;

/**
 * Per-handler signature: `message` narrows to the union member(s) carrying
 * this key via either discriminant, so field access is compiler-checked.
 */
type HandlerMap = {
  [K in RuntimeMessageKey]: (
    message: Extract<RuntimeMessage, { type: K } | { action: K }>,
    sender: RuntimeMessageSender,
    sendResponse: (response: unknown) => void
  ) => Promise<void>;
};

/**
 * Dispatch-site signature - the general shape a handler takes once the
 * runtime boundary has widened an untrusted browser payload back to the
 * union. The cast in registerMessageHandler is the only place that happens.
 */
type HandlerFn = (
  message: RuntimeMessage,
  sender: RuntimeMessageSender,
  sendResponse: (response: unknown) => void
) => Promise<void>;

/**
 * Runtime validation helper. Operates on a plain record - the specific
 * member's literal field types are the compiler's job at the call site;
 * here we only guarantee presence + string-ness of whatever the browser
 * actually delivered.
 */
export function requireString(message: Record<string, unknown>, key: string): string {
  const value = message[key];
  if (typeof value !== 'string' || value.length === 0) {
    // Descriptive English stays in the log; the response payload carries the
    // `errors.*` key so the UI can render a localized message.
    throw new ValidationError(
      `Missing required message field: ${String(key)}`,
      { field: String(key) },
      'errors.invalidRequestFormat'
    );
  }
  return value;
}

export function requireNumber(message: Record<string, unknown>, key: string): number {
  const value = message[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(
      `Missing required message field: ${String(key)}`,
      { field: String(key) },
      'errors.invalidRequestFormat'
    );
  }
  return value;
}

/**
 * Response payload for a handler `catch` block.
 *
 * The `error` field crosses `runtime.sendMessage` and is rendered by the UI -
 * or injected into a host page by a content script - so it must be a stable
 * `errors.*` locale key, never raw English prose. A typed
 * `BaseExtensionError` carries its own mapped key; anything else (a storage or
 * fetch `Error`, a `DOMException`, …) collapses to `fallbackKey`.
 *
 * The raw thrown value is logged here instead: this is the only place it
 * survives once the payload stops carrying prose, so every catch block in this
 * file must route through this helper rather than `getErrorMessage()`.
 */
export function errorPayload(
  error: unknown,
  fallbackKey = 'errors.unknownError'
): { success: false; error: string } {
  logError(`Background handler failed (${fallbackKey}):`, error);
  return { success: false, error: toResultErrorKey(error, fallbackKey) };
}

/** Hostname from a content-script tab sender (null when unavailable). */
export function senderTabHostname(sender: RuntimeMessageSender): string | null {
  const tabUrl = sender.tab?.url;
  if (!tabUrl) return null;
  try {
    return new URL(tabUrl).hostname;
  } catch (e) {
    logDebug('senderTabHostname: invalid tab URL', e);
    return null;
  }
}

/** Rejection policy belongs to the actual document, including cross-origin frames. */
function siteEmailHost(sender: RuntimeMessageSender): string {
  try {
    const url = new URL(sender.url || sender.tab?.url || '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.hostname : '';
  } catch {
    return '';
  }
}

function signupCaller(sender: RuntimeMessageSender): SignupCaller {
  const url = new URL(sender.url || sender.tab?.url || '');
  if (sender.tab?.id === undefined || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('permission-denied');
  }
  return { tabId: sender.tab.id, frameId: sender.frameId ?? 0, host: url.hostname, url: url.href };
}

/** Content scripts must only query credentials for the page they are injected on. */
export function isDomainAllowedForSender(domain: string, sender: RuntimeMessageSender): boolean {
  const host = senderTabHostname(sender);
  if (!host) return false;
  return domainMatchesHost(domain, host);
}

/**
 * Boundary shape guard for page-originated clipboard text (copyToClipboard
 * from content scripts). Legitimate uses are short, structured values - OTP
 * codes (3-8 alphanumeric, the background extractor's cap), emails, usernames,
 * phone numbers. Hostile payloads are URLs / exfiltration strings: they are
 * either too long, contain URL syntax, or carry no digits at all (a real OTP
 * always does). Deliberately lenient (emails, +, spaces, 16-char codes) so it
 * can never reject a genuine copy, and mirrors the content-side
 * isPlausibleOtpCode defense (entrypoints/content/otp/otp-code.ts).
 *
 * Extension-page callers are exempt - the extension UI copies arbitrary
 * user-visible text (addresses, credentials blocks, backup payloads).
 */
export function isPlausibleClipboardText(value: string): boolean {
  if (value.length > 64) return false;
  // A bare email is a legitimate copy target (credential email field) even
  // though its local part may contain dots that resemble a URL path below.
  if (/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value)) return true;
  if (/https?:\/\/|[/\w.-]+\.[a-z]{2,}|javascript:|data:/i.test(value)) return false;
  return /\d/.test(value);
}

function isExtensionSender(sender: RuntimeMessageSender): boolean {
  const senderUrl = sender.url || '';
  return (
    senderUrl.startsWith('chrome-extension://') ||
    senderUrl.startsWith('moz-extension://') ||
    senderUrl.startsWith('safari-web-extension://') ||
    senderUrl.startsWith('extension://')
  );
}

async function readResponseBodyLimited(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) return new ArrayBuffer(0);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ValidationError('Favicon too large', undefined, 'errors.validationError');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}

/**
 * Storage keys content scripts may READ via getStorageViaBg. The set is kept
 * in exact sync with what the extension's own content code actually requests
 * over the bridge (audited against every getStorageViaBg call site), so it
 * cannot rot into a stale grant. Extension-page-only data - preferredLanguage,
 * sessionCredentials, otpAutoCopyList, customEmailSettings, instance_overrides
 * - has no content consumer and is omitted; autofillBlocklist is likewise
 * omitted because content reads it directly through the shared
 * autofill-blocklist.ts module, never via the bridge. Blocks access to
 * sensitive vault/master keys, API keys, or webdav config from web pages.
 */
const CONTENT_SCRIPT_READABLE_STORAGE_KEYS = new Set<string>([
  'activeAddressId',
  'autofillFeatureEnabled',
  'dismissedDisposableDomains',
  'identities',
  'addresses',
  'latestOtp',
  'loginInfo',
  'nameSettings',
  'onboardingComplete',
  'otpOptInList',
  'passwordSettings',
  'preferredDisposableDomains',
  'selectedIdentityId',
  'selectedProvider',
  'themeColors',
]);

/**
 * Storage keys content scripts may WRITE via setStorageViaBg - a strict
 * subset of the readable set, mirroring exactly what the extension's own
 * content code persists. Anything else (addresses, identities,
 * passwordSettings, sessionCredentials, themeColors, …) is deny-by-default:
 * a page-driven content path must never be able to corrupt extension-owned
 * data. Adding a new writable key is an explicit, reviewed decision.
 */
const CONTENT_SCRIPT_WRITABLE_STORAGE_KEYS = new Set<string>([
  'activeAddressId',
  'dismissedDisposableDomains',
  'loginInfo',
  // NOTE: the return-to-form handoff keys (pendingAutofill*) are NOT here -
  // content writes them through the dedicated `flagReturnToForm` handler,
  // which persists them in ephemeral storage.session (the popup's reader),
  // not persistent local. See the handler for the full rationale.
  'preferredDisposableDomains',
  'selectedIdentityId',
]);

function isReadableStorageKeyForContentScript(key: string): boolean {
  if (CONTENT_SCRIPT_READABLE_STORAGE_KEYS.has(key)) return true;
  if (key.startsWith('selectedInstance_') || key.startsWith('defaultDomain_')) return true;
  return false;
}

async function isOtpOptedInForContentSender(sender: RuntimeMessageSender): Promise<boolean> {
  const host = senderTabHostname(sender)
    ?.toLowerCase()
    .replace(/^www\./, '');
  if (!host) return false;
  const { otpOptInList } = (await browser.storage.local.get(['otpOptInList'])) as {
    otpOptInList?: unknown;
  };
  return (
    Array.isArray(otpOptInList) &&
    otpOptInList.some((entry): entry is string => {
      return typeof entry === 'string' && hostMatchesDomainScope(host, entry);
    })
  );
}

function redactContentStorageData(data: Record<string, unknown>): void {
  if (Array.isArray(data.addresses)) {
    data.addresses = filterPersistedAddresses(data.addresses).map((address) => {
      const safeAddress = { ...address };
      delete safeAddress.token;
      delete safeAddress.sidToken;
      return safeAddress;
    });
  }
  if (Array.isArray(data.identities)) {
    data.identities = filterPersistedIdentities(data.identities).map((identity) => {
      const safeIdentity = { ...identity } as Identity & { hasCustomPassword?: boolean };
      delete safeIdentity.customPassword;
      if (typeof identity.customPassword === 'string' && identity.customPassword.length > 0) {
        safeIdentity.hasCustomPassword = true;
      }
      return safeIdentity;
    });
  }
  if (data.passwordSettings && typeof data.passwordSettings === 'object') {
    const settings = data.passwordSettings as Record<string, unknown>;
    const safeSettings = { ...settings };
    delete safeSettings.customPassword;
    data.passwordSettings = {
      ...safeSettings,
      hasCustomPassword:
        typeof settings.customPassword === 'string' && settings.customPassword.length > 0,
    };
  }
  if (Array.isArray(data.loginInfo)) {
    data.loginInfo = data.loginInfo.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const { password: _password, ...safeEntry } = entry as Record<string, unknown>;
      // TOTP seeds are credentials too; content scripts only need the
      // non-secret login metadata for form matching.
      delete safeEntry.totpSecret;
      return safeEntry;
    });
  }
}

export function isWritableStorageKeyForContentScript(key: string): boolean {
  return CONTENT_SCRIPT_WRITABLE_STORAGE_KEYS.has(key);
}

/**
 * Core inbox-creation logic shared by `createAddress` (extension-page caller)
 * and `createAddressWithGesture` (content-script caller with a valid gesture
 * token). Extracts the provider health-pick + failover + conflict-recovery
 * logic so both entry points stay in sync.
 */
async function createAddressInternal(
  message: RuntimeMessage,
  sendResponse: (response: unknown) => void
): Promise<void> {
  const allIds = getAllProviderConfigs().map((p) => p.id);
  const selected = await getSelectedProvider();
  const msg = message as RuntimeMessage & {
    provider?: string;
    instanceId?: string;
    emailUser?: string;
    domain?: string;
    skipHealthPick?: boolean;
  };
  const rejectedDomains = msg.domain ? await getSiteRejectedEmailDomains(msg.domain) : [];

  // Healthy provider auto-pick (+ site rule) when user didn't pin a provider
  let provider = msg.provider || selected || DEFAULT_PROVIDER;
  let pickReason: string = msg.provider ? 'explicit' : 'prefer';

  if (!msg.skipHealthPick) {
    try {
      const { resolveCreateProvider, getProviderFailoverOrder, recordProviderCreate } =
        await import('@/features/intelligence/provider-health.js');
      const resolved = await resolveCreateProvider({
        providerIds: allIds,
        explicitProviderId: msg.provider || null,
        domain: msg.domain || null,
        preferProviderId: selected || DEFAULT_PROVIDER,
        forceHealthPick: !msg.provider,
      });
      if (resolved.providerId) {
        provider = resolved.providerId;
        pickReason = resolved.reason;
      }

      const order = msg.provider
        ? [provider]
        : [provider, ...(await getProviderFailoverOrder(allIds, [provider])).slice(0, 3)];
      const tried = new Set<string>();
      let lastError: unknown;
      for (const pid of order) {
        if (!pid || tried.has(pid)) continue;
        tried.add(pid);
        const t0 = Date.now();
        try {
          const record = await createAddress(pid, msg.instanceId, msg.emailUser, rejectedDomains);
          void recordProviderCreate(pid, true, Date.now() - t0);
          // Surface provider-level auto-failover to the user: either the health
          // pick deviated from the user's default provider, or the first pick
          // failed and a retry succeeded elsewhere. UI reads `lastProviderFailover`.
          const requestedBase = msg.provider || selected || DEFAULT_PROVIDER;
          if (pid !== requestedBase) {
            const down = pid !== provider ? provider : requestedBase;
            const reason = pid !== provider ? 'retry' : 'health';
            await browser.storage.local
              .set({
                lastProviderFailover: {
                  requested: down,
                  used: pid,
                  at: Date.now(),
                  reason,
                },
              })
              .catch(() => {
                /* ignore */
              });
          }
          sendResponse({
            success: true,
            inbox: record,
            providerId: pid,
            healthPick: pickReason === 'health' || pickReason === 'rule',
            pickReason,
          });
          return;
        } catch (err: unknown) {
          lastError = err;
          // A website's domain policy is not a provider outage.
          if (
            !(
              err instanceof ValidationError && err.translationKey === 'errors.siteEmailUnavailable'
            )
          )
            void recordProviderCreate(pid, false, Date.now() - t0, getErrorMessage(err));
          const e = err as { context?: { reason?: string } };
          if (
            e?.context?.reason === 'duplicate_live' ||
            e?.context?.reason === 'duplicate_inactive'
          ) {
            throw err;
          }
          // Explicit provider: no failover
          if (msg.provider) throw err;
        }
      }
      throw lastError || new Error('All providers failed');
    } catch (healthErr: unknown) {
      // Conflicts always bubble; other errors from health path also bubble
      // (failover already exhausted). Fallback only if intelligence module failed to load.
      const msgText = getErrorMessage(healthErr);
      if (
        (healthErr &&
          typeof healthErr === 'object' &&
          (healthErr as { context?: { reason?: string } }).context?.reason) ||
        !/Cannot find module|Failed to fetch dynamically imported module|Loading chunk .* failed|Importing a module script failed/i.test(
          msgText
        )
      ) {
        throw healthErr;
      }
    }
  }

  const record = await createAddress(provider, msg.instanceId, msg.emailUser, rejectedDomains);
  sendResponse({ success: true, inbox: record, providerId: provider, pickReason });
}

/**
 * Fast field text classification - runs multilingual regex patterns
 * that have been offloaded from the content script bundle (~900 bytes of
 * regex patterns live here instead).
 */
function classifyFieldFast(text: string): {
  isUsername: boolean;
  isEmailish: boolean;
} {
  const t = text.toLowerCase();
  // Multilingual username signals (offloaded from findUsernameField)
  const isUsername =
    /(?:\s|^)(?:user\s*name|username|userid|user_id|user-name|handle|login\s*name|account\s*name|ユーザー名|用户名|nombre\s*de\s*usuario|nom\s*d['']utilisateur|benutzername|ชื่อผู้ใช้|اسم\s*المستخدم)(?:\s|$)/i.test(
      t
    );
  // Multilingual email signals (offloaded from looksLikeEmailField)
  const isEmailish =
    /(?:e-?mail|mail|correo|courriel|メール|邮箱|بريد|e-mail)/i.test(t) ||
    /(?:email|e-mail|correo|courriel).{0,16}(?:or|\/|ou|o|oder|または|或).{0,16}(?:phone|mobile|tel|handy|携帯|手机|هاتف)/i.test(
      t
    ) ||
    /(?:confirm|reenter|re-enter|repeat|verify).{0,30}(?:mail|email|correo)/i.test(t);
  return { isUsername, isEmailish };
}

/**
 * Mint a pending create-address gesture token, but ONLY after the extension
 * UI-open actually reported success. Minting unconditionally (before the open)
 * hands a valid pending token to any caller who merely invokes the handler -
 * even when the open silently failed (e.g. action.openPopup() without a
 * Chrome user gesture) - defeating the "user actually reached the extension
 * UI" property the token is meant to prove. Minting failure after a
 * successful open is non-fatal (the UI still opened; matches previous
 * behavior).
 */
async function issueCreateAddressToken(reason: string, hint: string, tabId: number): Promise<void> {
  let purpose: string | null = null;
  if (reason === 'autofill-create-address' || hint === 'create-address') {
    purpose = 'autofill-create-address';
  } else if (reason === 'burn-inbox' || hint === 'burn-inbox') {
    purpose = 'burn-inbox';
  } else if (reason === 'create-inbox' || hint === 'create-inbox') {
    purpose = 'create-inbox';
  } else {
    return;
  }
  try {
    const { generateGestureToken, storePendingGestureToken } = await import(
      '@/utils/ui/gesture-token.js'
    );
    const gt = await generateGestureToken(purpose, tabId);
    await storePendingGestureToken(gt, purpose, tabId);
  } catch (e) {
    logDebug('gesture token issuance failed - UI will still open', e);
  }
}

/**
 * The handoff payload: what is written to session (or local) storage AND what the
 * `navigateView` message carries to an already-open UI.
 *
 * `openView` is a real `View` here rather than the `unknown` a
 * `Record<string, unknown>` gives every property: this function is the payload's
 * only writer, and every id it writes (`mailbox`, `autofill`) is a catalog id. The
 * untyped record is what forced an `as string` cast at the send site - a cast that
 * told the compiler the value was a string while nothing had checked it, which is
 * exactly what `bun run check-vocabulary-fields` flags. The wire shape itself
 * (`navigateView` in `src/utils/types.ts`) stays `string`: the message is
 * untrusted at the receiver, where `isView()` narrows it.
 */
type OpenExtensionHandoff = {
  openExtensionReason: string;
  openExtensionHint: string;
  openExtensionAt: number;
  openViewAt: number;
  openExtensionTarget?: 'popup';
  openView?: View;
  autofillTab?: string;
  openIdentityCreate?: boolean;
  openIdentityEditId?: string;
};

/**
 * Open the extension UI (popup → sidepanel → app tab) with the view payload.
 *
 * Extracted from the `openExtensionUi` handler so the background can invoke it
 * directly. Chrome MV3 service workers must NOT self-message via
 * `browser.runtime.sendMessage` - the SW never receives its own `onMessage`,
 * so a self-sent `openExtensionUi` would never run, no gesture token would be
 * issued, and the in-page address-creation flow would dead-end. The
 * `createAddressWithGesture` handler calls this directly instead.
 */
export async function openExtensionUiInternal(
  message: RuntimeMessage,
  options: { gestureTabId?: number } = {}
): Promise<{ success: boolean; opened?: string; error?: string }> {
  try {
    const reason = String((message as { reason?: string }).reason || 'setup');
    const hint = String((message as { hint?: string }).hint || '');
    const identityId = String((message as { identityId?: string }).identityId || '');
    const isCreate = reason === 'create-identity' || hint === 'create-identity';
    const isEdit = reason === 'edit-identity' || hint === 'edit-identity';
    const isIdentityHandoff = isCreate || isEdit;

    const viewPayload: OpenExtensionHandoff = {
      openExtensionReason: reason,
      openExtensionHint: hint,
      openExtensionAt: Date.now(),
      openViewAt: Date.now(),
    };
    if (isIdentityHandoff) {
      // Identity editing/creation is deliberately popup-only. The target
      // marker prevents an already-open app tab from consuming this handoff.
      viewPayload.openExtensionTarget = 'popup';
      viewPayload.openView = 'autofill';
      viewPayload.autofillTab = 'profiles';
      viewPayload.openIdentityCreate = isCreate;
      viewPayload.openIdentityEditId = isEdit && identityId ? identityId : '';
    } else if (
      reason === 'setup' ||
      reason === 'expired' ||
      reason === 'no-active' ||
      reason === 'open-inbox'
    ) {
      viewPayload.openView = 'mailbox';
    }

    // SECURITY: A gesture token is ONLY issued after a UI-open attempt
    // actually reported success (see issueCreateAddressToken below). Minting
    // unconditionally here would hand a valid pending token to any caller who
    // merely invokes openExtensionUi - even when the open silently failed
    // (e.g. action.openPopup() without a Chrome user gesture) - defeating the
    // "user actually reached the extension UI" property the token is meant to
    // prove. Ordering: storage handoff FIRST (so a freshly opened UI mounts
    // with correct state), then open, then mint.
    try {
      await browser.storage.session.set(viewPayload);
    } catch (e) {
      // Session storage unavailable (e.g. Firefox pre-115): fall back to local
      // so session-less browsers still receive the handoff. On session-capable
      // browsers the local copy is never written - a local mirror would persist
      // forever as cruft and could replay a stale handoff on a later open.
      try {
        await writeWithRetry(viewPayload);
      } catch (e2) {
        logDebug('openExtension handoff: storage.local.set failed', e2);
      }
      logDebug('openExtension handoff: storage.session.set failed', e);
    }

    // Non-identity handoffs may update an already-open extension UI live.
    // Identity handoffs are popup-only and must not navigate an app/sidepanel.
    if (!isIdentityHandoff) {
      try {
        await browser.runtime.sendMessage({
          type: 'navigateView',
          view: viewPayload.openView || 'autofill',
          openView: viewPayload.openView,
          autofillTab: viewPayload.autofillTab,
          openIdentityCreate: !!viewPayload.openIdentityCreate,
          openIdentityEditId: String(viewPayload.openIdentityEditId || ''),
          openExtensionReason: reason,
        });
      } catch {
        /* no UI listener yet - cold open below */
      }
    }

    const qs = new URLSearchParams();
    if (viewPayload.openView) qs.set('view', String(viewPayload.openView));
    if (viewPayload.autofillTab) qs.set('tab', String(viewPayload.autofillTab));
    if (viewPayload.openIdentityCreate) qs.set('identityCreate', '1');
    if (viewPayload.openIdentityEditId)
      qs.set('identityEdit', String(viewPayload.openIdentityEditId));
    if (reason) qs.set('reason', reason);
    const getURL = (browser.runtime as unknown as { getURL: (p: string) => string }).getURL;
    const appUrl = getURL(`/app.html?${qs.toString()}`);

    // Identity handoffs are popup-only. Do not fall back to an app tab or
    // sidepanel: the caller explicitly requested the compact identity editor.
    if (isIdentityHandoff) {
      const action = (browser as unknown as { action?: { openPopup?: () => Promise<void> } })
        .action;
      if (!action?.openPopup) {
        return { success: false, error: 'errors.unknownError' };
      }
      try {
        await action.openPopup();
        // Identity handoffs never mint a create-address token (mutually
        // exclusive reasons) - nothing to issue here.
        return { success: true, opened: 'popup' };
      } catch (error: unknown) {
        return errorPayload(error);
      }
    }

    try {
      const action = (browser as unknown as { action?: { openPopup?: () => Promise<void> } })
        .action;
      if (action?.openPopup) {
        await action.openPopup();
        if (options.gestureTabId != null) {
          await issueCreateAddressToken(reason, hint, options.gestureTabId);
        }
        return { success: true, opened: 'popup' };
      }
    } catch {
      /* openPopup may be unavailable / no gesture */
    }
    try {
      const anyBrowser = browser as typeof browser & {
        sidePanel?: { open?: (opts: { windowId?: number }) => Promise<void> };
      };
      if (anyBrowser.sidePanel?.open) {
        const win = await browser.windows.getCurrent();
        if (win.id != null) {
          await anyBrowser.sidePanel.open({ windowId: win.id });
          if (options.gestureTabId != null) {
            await issueCreateAddressToken(reason, hint, options.gestureTabId);
          }
          return { success: true, opened: 'sidepanel' };
        }
      }
    } catch {
      /* side panel optional */
    }
    await browser.tabs.create({ url: appUrl });
    // Opening a fallback tab is not evidence of a user gesture. In particular,
    // a WebMCP request can cause this path to open a tab without user action.
    return { success: true, opened: 'tab' };
  } catch (error: unknown) {
    return errorPayload(error);
  }
}

/**
 * Encryption-oracle gate shared by encryptData / decryptStoredCustomPassword
 * (audit item "content encryption oracle"). Generic en/decrypt primitives
 * callable from any page's content script must bind each request to the page
 * the script is actually injected on - mirroring the gate already used by
 * saveLoginCredential / findSiteReplay / copySiteLoginPassword / routeIdentityForDomain:
 *
 * - extension pages (popup, sidepanel, app tab) always pass via
 *   isExtensionSender, so UI code can carry out operations of any kind;
 * - content scripts must claim the page hostname (sent by the
 *   content-bg-bridge cryptoDomainClaim()) and have it verified against the
 *   sender's tab URL - cross-page or privileged-context use is rejected.
 *
 * AES-GCM with fresh random IVs keeps the oracle cryptographically weak
 * (authenticated cipher, no padding oracle, no nonce reuse), so this is
 * defense-in-depth rather than a response to a concrete attack.
 */
export const MAX_CRYPTO_ORACLE_TEXT_LENGTH = 16 * 1024;

export function assertCryptoOracleSender(
  message: { domain?: string },
  sender: RuntimeMessageSender
): void {
  if (isExtensionSender(sender)) return;
  if (typeof message.domain === 'string' && isDomainAllowedForSender(message.domain, sender)) {
    return;
  }
  throw new ValidationError('Domain mismatch', undefined, 'errors.domainMismatch');
}

interface TagUpdateMessage {
  /** Full multi-tag replacement list (takes precedence over single tag). */
  tags?: Array<{ name: string; color: string }>;
  tag?: unknown;
  color?: unknown;
}

/**
 * Pure per-address application of a tag-edit message (single + bulk tag
 * handlers share this so the merge/clear semantics cannot drift).
 */
function applyTagUpdateToRecord(record: Address, message: TagUpdateMessage): Address {
  // Prefer full multi-tag list when provided; otherwise set/clear a single primary tag.
  if (Array.isArray(message.tags)) {
    const cleaned = messageTagList(message);
    const first = cleaned[0];
    return { ...record, tags: cleaned, tag: first?.name, tagColor: first?.color };
  }
  const hasTagField = 'tag' in message;
  const name = message.tag == null ? '' : String(message.tag).trim();
  if (hasTagField && !name) {
    return { ...record, tags: [], tag: undefined, tagColor: undefined };
  }
  if (!name) return record;
  const color = (message.color as string | undefined) || record.tagColor || '#6750a4';
  // Merge into existing multi-tag list (add/update color by name)
  const prev =
    Array.isArray(record.tags) && record.tags.length > 0
      ? [...record.tags]
      : record.tag
        ? [{ name: record.tag, color: record.tagColor || '#6750a4' }]
        : [];
  const idx = prev.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
  const next =
    idx >= 0 ? prev.map((t, j) => (j === idx ? { name, color } : t)) : [...prev, { name, color }];
  const first = next[0];
  return { ...record, tags: next, tag: first?.name, tagColor: first?.color };
}

/**
 * The tags a message WRITES, as the name+color pairs the storage shape uses -
 * the same cleaning `applyTagUpdateToRecord` applies, so the color a tag is
 * written with and the color it is propagated with cannot differ (a mismatch
 * there would make the unifying write the thing that splits the tag).
 *
 * A single-tag message is listed only when it NAMES a color: the record-level
 * fallback is not a color the message chose, so there is nothing to fan out.
 */
function messageTagList(message: TagUpdateMessage): AddressTagEntry[] {
  if (Array.isArray(message.tags)) {
    return message.tags
      .filter((t) => t?.name?.trim())
      .map((t) => ({ name: t.name.trim(), color: t.color || '#6750a4' }));
  }
  const name = message.tag == null ? '' : String(message.tag).trim();
  const color = typeof message.color === 'string' ? message.color.trim() : '';
  return name && color ? [{ name, color }] : [];
}

/**
 * The tag-edit write, in one place: the message is applied to the addresses it
 * names, and then every tag in that list takes its color EVERYWHERE it is
 * carried, through `unifyTagColors` - the same walk the hub's one-click color
 * cleanup uses, so the dialog and the button converge on one implementation.
 *
 * A tag is one tag, so the color picked while editing one address is the tag's
 * color, not that address's. Writing it only to the message's own addresses left
 * the tag stored in two colors - and because the chips resolve a tag to ONE
 * color, the user watched their pick get ignored.
 */
export function applyTagEditToAddresses(
  addresses: Address[],
  targets: Set<string>,
  message: TagUpdateMessage
): Address[] {
  const applied = addresses.map((record) =>
    targets.has(record.id) ? applyTagUpdateToRecord(record, message) : record
  );
  return messageTagList(message).reduce(
    (list, entry) => unifyTagColors(list, entry.name, entry.color),
    applied
  );
}

/** Bounded fan-out for batch email checks - same bound as the lifecycle batches. */
const CHECK_BATCH_CONCURRENCY = 3;

export interface CheckEmailsBulkResult {
  addressId: string;
  success: boolean;
  messages?: Email[];
  error?: string;
}

/**
 * Coalescing window for concurrent inbox checks of the SAME address + filter
 * set. Multiple wait-OTP panels opened on the same active inbox (one per tab)
 * and a panel racing the periodic alarm previously each ran a full provider
 * fetch + storage merge; now concurrent duplicates share one run, and a burst
 * arriving within this window after completion shares the retained result -
 * bounded staleness is harmless here because the panel's own countdown and
 * the fillOTP broadcast deliver codes the moment they land, independent of
 * this fetch. Failing runs are coalesced on the same terms, bounding
 * retry storms against a dead provider endpoint.
 */
const INBOX_CHECK_COALESCE_TTL_MS = 3_000;
const CONTENT_INBOX_CHECK_MIN_INTERVAL_MS = 10_000;
const lastContentInboxCheckByAddress = new Map<string, number>();

/** Key for the in-flight map: same inbox AND same filter semantics. */
function inboxCheckKey(addressId: string, filters: EmailFilters | undefined): string {
  return `${addressId}|${filters ? JSON.stringify(filters) : ''}`;
}

/** Test helper - drop retained results so tests don't share them via the TTL. */
export function __clearInboxCheckCoalescerForTests(): void {
  inboxCheckCoalescer.clear();
}

/**
 * Coalescing windows for the other two repeated content→background reads.
 *
 * Unlike the inbox check, these return data the user can CHANGE at runtime, so
 * neither relies on the TTL alone:
 *
 * - `smartSettingsCoalescer` - the burst is real (every autofill path on a
 *   page load reads the settings: undo depth, human-like filling, OTP attach,
 *   locale-aware data - see autofill-buttons.ts / form-filler.ts). The UI's
 *   SettingsView writes the same storage key DIRECTLY from the extension
 *   context, bypassing this module, so the only write signal is a
 *   `storage.onChanged` listener that drops every retained read. Its window
 *   is therefore shorter than the inbox check's (1s): after a change, that's
 *   the longest a content script can see the previous value, and the values
 *   here are behavior toggles, not a fetched inbox.
 * - `wizardSessionCoalescer` - sessions are tab-scoped (`sender.tab?.id` in
 *   the key) and ALL writers flow through this module's upsert/advance/clear
 *   handlers, so every write invalidates the retained read for the exact
 *   session it rewrote. The window is 500ms purely to catch simultaneous
 *   content-script reads at startup; a stale resume snapshot past that would
 *   contradict a step the SAME tab just advanced.
 * - `activeMetaCoalescer` - one key (the active-inbox lookup is global);
 *   autofill flows read it up to four times per interaction. Invalidated by
 *   the storage.onChanged listener below: the user can switch addresses at
 *   any moment, and every caller consumes the address it names.
 * - `storageReadCoalescer` - keyed by sender class (extension pages get
 *   UNREDACTED data, content scripts get redacted copies - never share) plus
 *   the de-duplicated, sorted key list, so `['a','b']` and `['b','a']` are one
 *   read. The window is 250ms: these are the rawest values in the extension
 *   (`latestOtp`, `addresses`, `activeAddressId`), so retention must barely
 *   outlive the request burst it was built for.
 * - `fieldMapCoalescer` - keyed per domain; 1s because learned selectors only
 *   change when a fill succeeds (write-through delete in recordFieldMapHit)
 *   or a backup import rewrites the map (onChanged below).
 */
const SMART_SETTINGS_COALESCE_TTL_MS = 1_000;
const WIZARD_SESSION_COALESCE_TTL_MS = 500;
const ACTIVE_META_COALESCE_TTL_MS = 250;
const STORAGE_READ_COALESCE_TTL_MS = 250;
const FIELD_MAP_COALESCE_TTL_MS = 1_000;
/**
 * - `providerCoalescer` - ONE key; the provider choice is read by every
 *   autofill path on a page load. 250ms because the UI can switch providers
 *   at any moment; the `storage.onChanged` listener below drops the retained
 *   read the instant `selectedProvider` changes (UI, WebMCP, backup import),
 *   so the window only has to outlive the simultaneous startup burst.
 * - `providerDisplayNameCoalescer` - keyed per provider id. `loadProviderConfig`
 *   is synchronous in-memory config (JSON-driven per the provider-config
 *   policy), so its "read" is cheap but is still one message round-trip per
 *   caller; N rows rendering display names previously meant N round-trips.
 *   Invalidated by `providerConfigOverrides` changes (user-edited provider
 *   JSON in settings): display names come from those configs.
 * - `replayCoalescer` - keyed per domain; `shouldPreferReplay` aggregates the
 *   site profile's success/failure counters, which change only via
 *   `recordAutofillOutcome` - that handler invalidates the domain's entry
 *   write-through, and a `siteProfiles` change (backup import) drops all.
 */
const PROVIDER_COALESCE_TTL_MS = 250;
const PROVIDER_DISPLAY_NAME_COALESCE_TTL_MS = 1_000;
const REPLAY_COALESCE_TTL_MS = 500;

/**
 * Shared telemetry for every read cache below. Two mark kinds pair into the
 * Diagnostics hit-rate stat: `bg.readCoalesced` on every SHARE (in-flight or
 * TTL-retained - a saved round-trip) and `bg.readRun` on every cache MISS
 * (the task actually started - the background work that happened). Hits ÷
 * (hits + runs) is the exact hit rate because the coalescer invokes the
 * task only on a fresh run. Dynamic import keeps perf-marks out of the
 * static graph, matching the getPerfReport handler's convention.
 */
function perfMarkReadCache(name: 'bg.readCoalesced' | 'bg.readRun', key: string): void {
  void import('@/utils/perf/perf-marks.js')
    .then(({ perfMark }) => perfMark(name, { key }))
    .catch(() => {
      /* dev telemetry only */
    });
}

function onReadCacheReuse(key: string): void {
  perfMarkReadCache('bg.readCoalesced', key);
}

function onReadCacheRun(key: string): void {
  perfMarkReadCache('bg.readRun', key);
}

/**
 * Shared factory for the keyed read caches below - each is a `TtlReadCache`,
 * so the write-invalidate half of the contract (invalidate/invalidateAll/
 * invalidateWhere) lives on the cache instead of reaching into the raw
 * coalescer, and each key encoding is declared ONCE next to the readers and
 * writers that share it.
 */
function createReadCache<K>(ttlMs: number, encodeKey: (input: K) => string): TtlReadCache<K> {
  return new TtlReadCache<K>(ttlMs, {
    encodeKey,
    onReuse: onReadCacheReuse,
    onRun: onReadCacheRun,
  });
}

const smartSettingsCoalescer = createReadCache<'settings'>(
  SMART_SETTINGS_COALESCE_TTL_MS,
  () => 'settings'
);
const wizardSessionCoalescer = createReadCache<WizardSessionScope>(
  WIZARD_SESSION_COALESCE_TTL_MS,
  ({ domain, tabId }) => `session|${domain}|${tabId ?? ''}`
);
const activeMetaCoalescer = createReadCache<string>(ACTIVE_META_COALESCE_TTL_MS, (key) => key);
const fieldMapCoalescer = createReadCache<string>(
  FIELD_MAP_COALESCE_TTL_MS,
  (domain) => `map|${domain}`
);
const storageReadCoalescer = createReadCache<StorageReadRequest>(
  STORAGE_READ_COALESCE_TTL_MS,
  ({ isExt, keys }) => storageReadKey(isExt, keys)
);
const providerCoalescer = createReadCache<'provider'>(PROVIDER_COALESCE_TTL_MS, () => 'provider');
const providerDisplayNameCoalescer = createReadCache<string>(
  PROVIDER_DISPLAY_NAME_COALESCE_TTL_MS,
  (providerId) => `providerName|${providerId}`
);
const replayCoalescer = createReadCache<string>(
  REPLAY_COALESCE_TTL_MS,
  // Keyed by the NORMALIZED domain: shouldPreferReplay resolves through
  // getSiteProfile(normalizeDomain(domain)), so casing variants of the same
  // host must share one entry - and recordAutofillOutcome's write-through
  // must hit the entry its domain actually rewrote.
  (domain) => `replay|${normalizeDomain(domain)}`
);

/** Wizard-session reads are tab-scoped: the tab id is part of the key. */
interface WizardSessionScope {
  domain: string;
  tabId?: number | null;
}

/** Storage-read cache request: sender class + requested storage keys. */
interface StorageReadRequest {
  isExt: boolean;
  keys: string[];
}

/**
 * Key for the storage-read coalescer: same sender class + same key SET.
 * Order and duplicates are normalized away - `['a','b']` and `['b','a']`
 * return the same record, so they share one run.
 */
function storageReadKey(isExt: boolean, requestedKeys: string[]): string {
  const unique = [...new Set(requestedKeys)].sort();
  return `${isExt ? 'ext' : 'content'}|${unique.join(',')}`;
}

/**
 * Drop every retained storage read whose key set intersects `changedKeys`.
 * Precise on purpose: the OTP detector may write `latestOtp` from the
 * background and the UI/WebMCP switch `activeAddressId` - neither crosses
 * this module's read handlers, and clearing EVERY retained read on ANY write
 * would undo coalescing exactly when several flows are mid-burst.
 */
function invalidateStorageReads(changedKeys: string[]): void {
  const changed = new Set(changedKeys);
  storageReadCoalescer.invalidateWhere((key) => {
    const requested = key.slice(key.indexOf('|') + 1).split(',');
    return requested.some((k) => changed.has(k));
  });
}

/**
 * `storage.onChanged` write-through for reads whose writers DON'T all flow
 * through this module: SettingsView saves smart settings from the extension
 * context, the UI and WebMCP switch `activeAddressId`/rewrite `addresses`, and
 * backup import can rewrite every key at once. This listener is the only
 * signal that a retained read has gone stale for those paths. Invoked once at
 * module load in the real service worker; also exported so tests can re-install
 * it against THEIR browser fake (see read-coalescer.test.ts).
 */
export function installReadInvalidation(): void {
  try {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.smartAutofillSettings) smartSettingsCoalescer.invalidateAll();
      if (changes.activeAddressId || changes.addresses) activeMetaCoalescer.invalidateAll();
      if (changes.siteFieldMaps_v1) fieldMapCoalescer.invalidateAll();
      if (changes.selectedProvider) providerCoalescer.invalidateAll();
      if (changes.providerConfigOverrides) providerDisplayNameCoalescer.invalidateAll();
      if (changes.siteProfiles) replayCoalescer.invalidateAll();
      invalidateStorageReads(Object.keys(changes));
    });
  } catch {
    /* storage.onChanged unavailable in some test/DOM contexts */
  }
}

installReadInvalidation();

/** Test helper - drop the read coalescers so tests don't share stale results. */
export function __clearReadCoalescersForTests(): void {
  smartSettingsCoalescer.invalidateAll();
  wizardSessionCoalescer.invalidateAll();
  activeMetaCoalescer.invalidateAll();
  fieldMapCoalescer.invalidateAll();
  storageReadCoalescer.invalidateAll();
  providerCoalescer.invalidateAll();
  providerDisplayNameCoalescer.invalidateAll();
  replayCoalescer.invalidateAll();
}

const inboxCheckCoalescer = new InFlightCoalescer(INBOX_CHECK_COALESCE_TTL_MS, (key) => {
  // Dev-only telemetry: a reuse event is exactly the duplicate wake the
  // counter evidence predicted. Dynamic import keeps perf-marks out of the
  // static graph, matching the getPerfReport handler's convention.
  void import('@/utils/perf/perf-marks.js')
    .then(({ perfMark }) => perfMark('bg.inboxCheckCoalesced', { key }))
    .catch(() => {
      /* dev telemetry only */
    });
});

/**
 * Per-address body of the checkEmailsBulk handler - an exact mirror of the
 * single checkEmails handler's semantics (demo-mode short-circuit, live fetch
 * + merge via checkNewEmails, storeNewMessages for non-local API mail, and the
 * still-exists re-validation before responding), failure-isolated so one
 * failing inbox can't abort the batch.
 */
async function checkEmailsForBatch(
  addressId: string,
  filters: EmailFilters | undefined
): Promise<CheckEmailsBulkResult> {
  // Coalesce concurrent/TTL-recent duplicates (same inbox + filters) behind
  // one fetch: N OTP panels on one inbox previously meant N provider fetches
  // + N storage merges. Failure-isolation semantics are unchanged - the
  // coalescer returns the shared run's settled result per caller.
  return inboxCheckCoalescer.run(inboxCheckKey(addressId, filters), () =>
    checkEmailsForBatchUncoalesced(addressId, filters)
  );
}

/** The original per-address body, now the coalescer's miss path. */
async function checkEmailsForBatchUncoalesced(
  addressId: string,
  filters: EmailFilters | undefined
): Promise<CheckEmailsBulkResult> {
  try {
    // Demo: return stored bag only, never hit real providers
    const { demoMode, addresses = [] } = (await browser.storage.local.get([
      'demoMode',
      'addresses',
    ])) as {
      demoMode?: boolean;
      addresses?: Address[];
    };
    const demoAddress = addresses.find((i) => i.id === addressId);
    if (demoMode || demoAddress?.provider === 'demo') {
      const addr = demoAddress?.address || '';
      const bag = await getStoredEmailsForAddress(addressId, addr);
      return { addressId, success: true, messages: bag };
    }

    const messages = await checkNewEmails(addressId, filters);

    const liveAddresses = await getAddresses();
    const record = liveAddresses.find((i) => i.id === addressId);
    if (record && messages.length > 0) {
      const apiMsgs = messages.filter((m) => !m.local_only);
      if (apiMsgs.length > 0) {
        await storeNewMessages(record.address, apiMsgs);
      }
    }

    const stillExists = (await getAddresses()).some((item) => item.id === addressId);
    return stillExists
      ? { addressId, success: true, messages }
      : { addressId, ...errorPayload(undefined, 'errors.addressNotFound') };
  } catch (error: unknown) {
    return { addressId, ...errorPayload(error) };
  }
}

export const handlers: Partial<HandlerMap> = {
  ensureContentRuntime: async (_message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    let senderProtocol = '';
    try {
      senderProtocol = new URL(sender.url || '').protocol;
    } catch {
      /* Invalid or absent sender URLs are rejected below. */
    }
    if (
      sender.id !== browser.runtime.id ||
      typeof tabId !== 'number' ||
      !Number.isInteger(tabId) ||
      tabId < 0 ||
      typeof frameId !== 'number' ||
      !Number.isInteger(frameId) ||
      frameId < 0 ||
      (senderProtocol !== 'http:' && senderProtocol !== 'https:' && senderProtocol !== 'file:')
    ) {
      sendResponse({ success: false });
      return;
    }

    try {
      const { ensureContentRuntimeInFrame } = await import('../tab-autofill.js');
      sendResponse({ success: await ensureContentRuntimeInFrame(tabId, frameId) });
    } catch (error: unknown) {
      logError('Failed to ensure content runtime in requesting frame', error);
      sendResponse({ success: false });
    }
  },

  getSitePrivacySettings: async (_message, sender, sendResponse) => {
    const host = senderTabHostname(sender);
    if (sender.id !== browser.runtime.id || sender.tab?.id == null || !host) {
      sendResponse({ success: false });
      return;
    }
    try {
      const normalizedHost = normalizeSitePrivacyHost(host);
      const stored = (await browser.storage.local.get(SITE_PRIVACY_SETTINGS_KEY))[
        SITE_PRIVACY_SETTINGS_KEY
      ];
      const settingsMap = sanitizeSitePrivacySettingsMap(stored);
      const settings = settingsMap[normalizedHost] || {};
      sendResponse({
        success: true,
        settings: {
          otpDetection: settings.otpDetection !== false,
          formScanning: settings.formScanning !== false,
        },
      });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  setSitePrivacySetting: async (message, sender, sendResponse) => {
    const host = senderTabHostname(sender);
    if (
      sender.id !== browser.runtime.id ||
      sender.tab?.id == null ||
      !host ||
      !['otpDetection', 'formScanning'].includes(message.feature) ||
      typeof message.enabled !== 'boolean'
    ) {
      sendResponse({ success: false });
      return;
    }
    const normalizedHost = normalizeSitePrivacyHost(host);
    try {
      await withLock('background_storage_write_lock', async () => {
        const stored = (await browser.storage.local.get(SITE_PRIVACY_SETTINGS_KEY))[
          SITE_PRIVACY_SETTINGS_KEY
        ];
        const settingsMap = sanitizeSitePrivacySettingsMap(stored);
        const siteSettings = { ...settingsMap[normalizedHost] };
        if (message.enabled) delete siteSettings[message.feature];
        else siteSettings[message.feature] = false;
        if (Object.keys(siteSettings).length > 0) settingsMap[normalizedHost] = siteSettings;
        else delete settingsMap[normalizedHost];
        await writeWithRetry({ [SITE_PRIVACY_SETTINGS_KEY]: settingsMap });
      });
      try {
        const tabs = await browser.tabs.query({});
        await Promise.all(
          tabs
            .filter((tab) => {
              if (typeof tab.id !== 'number' || !tab.url) return false;
              try {
                return normalizeSitePrivacyHost(new URL(tab.url).hostname) === normalizedHost;
              } catch {
                return false;
              }
            })
            .map((tab) =>
              browser.tabs
                .sendMessage(tab.id as number, { type: 'sitePrivacySettingsChanged' })
                .catch(() => undefined)
            )
        );
      } catch {
        /* settings remain persisted and are refreshed the next time the page scans */
      }
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /**
   * Open extension UI from content script (setup / renew / identity create-edit).
   *
   * Identity handoffs persist a popup-targeted payload and open only the
   * browser action popup. They never create an app tab or navigate another
   * extension page.
   */
  openExtensionUi: async (message, sender, sendResponse) => {
    const res = await openExtensionUiInternal(message, {
      gestureTabId: sender.tab?.id,
    });
    sendResponse(res);
  },

  /**
   * Content-script handoff: remember that the user was mid-autofill when the
   * extension was opened for setup, so the popup can toast “return to form”
   * once an address exists (AppLayout consumes + clears these keys).
   *
   * This lives in ephemeral storage.session by design - the handoff is a
   * same-browser-session reminder, and content scripts cannot reach
   * storage.session directly (no setAccessLevel call opens it to them), so a
   * dedicated handler is required. The previous setStorageViaBg write landed
   * in persistent storage.local while the popup reads session - the flag
   * never arrived, so the toast never fired. No sender gate needed: a page
   * can only make the popup show a cosmetic “return to form” toast.
   */
  flagReturnToForm: async (message, _sender, sendResponse) => {
    try {
      const url = String((message as { url?: unknown }).url || '');
      await browser.storage.session.set({
        pendingAutofillReturn: true,
        pendingAutofillUrl: url,
        pendingAutofillAt: Date.now(),
      });
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /**
   * Content-script fallback for the User-Agent spoof (see
   * `apply-user-agent-spoof.ts`): the page's CSP refused the inline override, so
   * install it in the page's MAIN world instead. The target is the SENDER's tab -
   * never a tab id from the payload - and the User-Agent comes from storage
   * rather than from the message, so a page that reaches the content script
   * cannot choose what the browser claims to be.
   */
  applyUserAgentSpoof: async (_message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ success: false, error: 'errors.unknownError' });
      return;
    }
    sendResponse({ success: await applyUserAgentSpoofToTab(tabId) });
  },

  createAddress: async (message, _sender, sendResponse) => {
    try {
      // Demo mode is fully client-side - refuse real provider creates
      const { demoMode } = (await browser.storage.local.get(['demoMode'])) as {
        demoMode?: boolean;
      };
      if (demoMode) {
        sendResponse({
          success: false,
          error: 'errors.unknownError',
        });
        return;
      }

      await createAddressInternal(message, sendResponse);
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  adoptOnboardingAddress: async (message, _sender, sendResponse) => {
    try {
      const msg = message as Extract<RuntimeMessage, { type: 'adoptOnboardingAddress' }>;
      const { adoptOnboardingAddress } = await import('../address/onboarding-preparation.js');
      const record = await adoptOnboardingAddress(msg.sessionId, msg.provider);
      sendResponse(
        record ? { success: true, address: record.address } : { success: false, unavailable: true }
      );
    } catch (error) {
      sendResponse(errorPayload(error));
    }
  },

  /**
   * createAddressWithGesture - security-hardened variant of createAddress.
   *
   * Content scripts (injected on every web page) are NO LONGER allowed to
   * call `createAddress` directly. Instead they must present a signed gesture
   * token that was issued by the extension UI (popup / sidepanel / app tab)
   * when the user explicitly interacted with it.
   *
   * The token is:
   *   • HMAC-SHA256 signed with a key derived from the extension runtime ID
   *   • Single-use (nonce tracked in session storage)
   *   • Time-limited (5-second expiry window)
   *
   * If no valid token is present the handler falls back to opening the
   * extension UI so the user can interact with it, then signals the content
   * script to retry.
   *
   * SECURITY: Tokens are signed with the extension's private random key and
   * include the requesting tab id. The page cannot read the key or replay a
   * token issued for a different tab.
   */
  createAddressWithGesture: async (message, sender, sendResponse) => {
    try {
      // Demo mode is fully client-side - never hit real providers. Content
      // flows (in-field "Generate New Email") must still work in demo mode:
      // route them to the offline demo creator so the showcase stays fully
      // exercisable without the extension UI being open.
      const { demoMode } = (await browser.storage.local.get(['demoMode'])) as {
        demoMode?: boolean;
      };
      if (demoMode) {
        const { createDemoAddress } = await import('@/features/demo/demo-mode.js');
        const addr = await createDemoAddress(browser);
        if (addr) {
          sendResponse({ success: true, address: addr });
        } else {
          sendResponse({
            success: false,
            error: 'errors.demoAddressLimitReached',
          });
        }
        return;
      }

      const msg = message as RuntimeMessage & {
        provider?: string;
        instanceId?: string;
        emailUser?: string;
        domain?: string;
        gestureToken?: string;
        skipHealthPick?: boolean;
      };
      // The website context belongs to the sender, never a page-supplied claim.
      if (!isExtensionSender(sender)) msg.domain = siteEmailHost(sender) || undefined;

      // 1) If caller presents a valid gesture token → proceed directly
      if (msg.gestureToken) {
        const ok = await validateAndConsumeGestureToken(
          msg.gestureToken,
          'autofill-create-address',
          sender.tab?.id ?? -1
        );
        if (!ok) {
          sendResponse({
            success: false,
            error: 'errors.gestureTokenInvalid',
            needsUserInteraction: true,
          });
          return;
        }
        // Valid token - delegate to the internal createAddress logic
        await createAddressInternal(msg, sendResponse);
        return;
      }

      // 2) No token - try consuming a pending token from session storage
      //    (set when the extension UI was opened with reason autofill-create-address)
      const tabId = sender.tab?.id;
      const pendingToken =
        tabId == null ? null : await consumePendingGestureToken('autofill-create-address', tabId);
      if (pendingToken && tabId != null) {
        const ok = await validateAndConsumeGestureToken(
          pendingToken,
          'autofill-create-address',
          tabId
        );
        if (ok) {
          await createAddressInternal(msg, sendResponse);
          return;
        }
      }

      // 3) No valid token - open extension UI so user can interact.
      // NOTE: call the internal function directly - a Chrome MV3 service
      // worker never receives its own browser.runtime.sendMessage (onMessage
      // fires in every frame except the sender's), so self-messaging would
      // silently drop openExtensionUi: no token, no UI, dead-end flow.
      try {
        const res = await openExtensionUiInternal(
          {
            type: 'openExtensionUi',
            reason: 'autofill-create-address',
            hint: 'create-address',
          },
          { gestureTabId: sender.tab?.id }
        );
        sendResponse({
          success: false,
          error: 'errors.unknownError',
          needsUserInteraction: true,
          opened: !!res.success,
        });
      } catch (openErr) {
        sendResponse({ ...errorPayload(openErr), needsUserInteraction: true });
      }
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getStorageViaBg: async (message, sender, sendResponse) => {
    try {
      const { keys } = message as RuntimeMessage & { keys: string | string[] };
      const isExt = isExtensionSender(sender);
      let requestedKeys: string[];
      if (typeof keys === 'string') {
        requestedKeys = [keys];
      } else if (Array.isArray(keys)) {
        requestedKeys = keys;
      } else {
        sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
        return;
      }

      if (!isExt) {
        const disallowed = requestedKeys.filter((k) => !isReadableStorageKeyForContentScript(k));
        if (disallowed.length > 0) {
          logWarn('getStorageViaBg denied unreadable content-script keys', { disallowed });
          sendResponse({ success: false, error: 'errors.storageAccessDenied' });
          return;
        }
      }

      if (
        !isExt &&
        requestedKeys.includes('latestOtp') &&
        !(await isOtpOptedInForContentSender(sender))
      ) {
        sendResponse({ success: false, error: 'errors.otpAccessNotEnabled' });
        return;
      }

      // Coalesce concurrent/250ms-recent duplicates behind one storage read.
      // Every caller above was authorized INDIVIDUALLY; the key includes the
      // sender class because extension pages get UNREDACTED data while content
      // scripts get redacted copies - those two must never share a retained
      // result. Redaction stays inside the shared task so the retained payload
      // is already shaped for its audience.
      const data = await storageReadCoalescer.run({ isExt, keys: requestedKeys }, () =>
        (async () => {
          const raw = (await browser.storage.local.get(requestedKeys)) as Record<string, unknown>;
          if (!isExt) redactContentStorageData(raw);
          return raw;
        })()
      );
      // Filter a fresh copy AFTER coalescing: retained reads are shared between
      // sites, but exclusions are exact-host scoped and must never leak across them.
      const scopedData = { ...data };
      if (!isExt && Array.isArray(data.addresses)) {
        const rejected = await getSiteRejectedEmailDomains(siteEmailHost(sender));
        if (rejected.length) {
          scopedData.siteRejectedEmailDomains = rejected;
          scopedData.addresses = data.addresses.filter(
            (item) =>
              item && typeof item.address === 'string' && allowsSiteEmail(item.address, rejected)
          );
          const addresses = scopedData.addresses as Array<{
            id: string;
            accountStatus?: import('@/utils/types.js').AddressStatus;
            expiresAt?: number;
          }>;
          if (!addresses.some((item) => item.id === scopedData.activeAddressId))
            scopedData.activeAddressId = addresses.find((item) => isLive(item))?.id || '';
        }
      }
      sendResponse({ success: true, data: scopedData });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  setStorageViaBg: async (message, sender, sendResponse) => {
    try {
      const { items } = message as RuntimeMessage & { items: Record<string, unknown> };
      if (!items || typeof items !== 'object' || Array.isArray(items)) {
        sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
        return;
      }
      const isExt = isExtensionSender(sender);
      if (!isExt) {
        const itemKeys = Object.keys(items);
        const disallowed = itemKeys.filter((k) => !isWritableStorageKeyForContentScript(k));
        if (disallowed.length > 0) {
          logWarn('setStorageViaBg denied unwritable content-script keys', { disallowed });
          sendResponse({
            success: false,
            error: 'errors.storageAccessDenied',
          });
          return;
        }
      }
      const writeItems = () =>
        withLock('background_storage_write_lock', async () => {
          const readKeys = [...Object.keys(items)];
          if (!isExt && 'loginInfo' in items) readKeys.push('addresses');
          if (!isExt && 'activeAddressId' in items) readKeys.push('addresses');
          if (!isExt && 'selectedIdentityId' in items) readKeys.push('identities');
          const current = (await browser.storage.local.get([...new Set(readKeys)])) as Record<
            string,
            unknown
          >;
          const next = { ...current, ...items };
          if (!isExt && 'loginInfo' in items) {
            const rawEntries = items.loginInfo;
            const senderHost = senderTabHostname(sender);
            if (!Array.isArray(rawEntries) || rawEntries.length !== 1 || !senderHost) {
              throw new ValidationError(
                'Invalid content login write',
                undefined,
                'errors.domainMismatch'
              );
            }
            const incoming = normalizeSavedLoginCredential(
              rawEntries[0] && typeof rawEntries[0] === 'object' && !Array.isArray(rawEntries[0])
                ? (rawEntries[0] as Record<string, unknown>)
                : {}
            );
            if (
              !incoming ||
              !isDomainAllowedForSender(incoming.domain, sender) ||
              (incoming.password && !looksLikeCiphertext(incoming.password))
            ) {
              throw new ValidationError(
                'Invalid content login write',
                undefined,
                'errors.domainMismatch'
              );
            }
            const existing = Array.isArray(current.loginInfo)
              ? (current.loginInfo as Record<string, unknown>[])
              : [];
            const loginKey = (item: unknown) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
              const normalized = normalizeSavedLoginCredential(item as Record<string, unknown>);
              const account = (normalized?.email || normalized?.username || '').toLowerCase();
              return normalized && account ? `${normalized.domain}\n${account}` : '';
            };
            const incomingKey = loginKey(incoming as unknown as Record<string, unknown>);
            next.loginInfo = [
              incoming,
              ...existing.filter((item) => loginKey(item) !== incomingKey),
            ].slice(0, 50);
          }
          if (next.addresses !== undefined) {
            next.addresses = filterPersistedAddresses(next.addresses);
          }
          if (next.identities !== undefined) {
            next.identities = filterPersistedIdentities(next.identities);
          }
          if (
            typeof next.activeAddressId !== 'undefined' &&
            typeof next.activeAddressId !== 'string'
          ) {
            delete next.activeAddressId;
          }
          if (!isExt && 'activeAddressId' in items) {
            const validAddress = Array.isArray(current.addresses)
              ? current.addresses.some(
                  (address) =>
                    !!address &&
                    typeof address === 'object' &&
                    (address as { id?: unknown }).id === items.activeAddressId
                )
              : false;
            if (typeof items.activeAddressId !== 'string' || !validAddress) {
              throw new ValidationError(
                'Invalid active address selection',
                undefined,
                'errors.storageAccessDenied'
              );
            }
          }
          if (
            typeof next.selectedIdentityId !== 'undefined' &&
            typeof next.selectedIdentityId !== 'string'
          ) {
            delete next.selectedIdentityId;
          }
          if (!isExt && 'selectedIdentityId' in items) {
            const validIdentity = Array.isArray(current.identities)
              ? current.identities.some(
                  (identity) =>
                    !!identity &&
                    typeof identity === 'object' &&
                    (identity as { id?: unknown }).id === items.selectedIdentityId
                )
              : false;
            if (typeof items.selectedIdentityId !== 'string' || !validIdentity) {
              throw new ValidationError(
                'Invalid identity selection',
                undefined,
                'errors.storageAccessDenied'
              );
            }
          }
          // `addresses` and `identities` were read only to validate identifiers;
          // do not include those validation-only snapshots in the storage write.
          for (const key of readKeys) {
            if (!(key in items)) delete next[key];
          }
          await writeWithRetry(next);
        });
      if (!isExt && 'loginInfo' in items) {
        // Share the credential-list lock with saveLoginCredential and UI
        // reorder/delete operations; the broader storage lock alone does not
        // serialize those read/modify/write transactions.
        await withLock('login_info_lock', writeItems);
      } else {
        await writeItems();
      }
      // Write-through: any of the keys just written may sit in a retained
      // storage read. Precise invalidation - only reads whose key set
      // intersects the write are dropped (same logic as the onChanged path).
      invalidateStorageReads(Object.keys(items));
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /** Content scripts: remove the cached latestOtp after a wait-OTP panel applies it. */
  removeLatestOtp: async (message, sender, sendResponse) => {
    try {
      if (!isExtensionSender(sender) && !(await isOtpOptedInForContentSender(sender))) {
        sendResponse({ success: false, error: 'errors.otpAccessNotEnabled' });
        return;
      }
      const recipient = requireString(message, 'recipient').trim().toLowerCase();
      const otp = requireString(message, 'otp');
      let removed = false;
      await withLock('latest_otp_lock', async () => {
        const current = (await browser.storage.local.get('latestOtp')) as {
          latestOtp?: { otp?: string; recipient?: string; received_at?: number };
        };
        // latestOtp is a single global slot. A panel may consume only the exact
        // code/address pair it applied; another address's code, or a newer code
        // that arrived while this panel was handling an older one, must survive.
        if (
          current.latestOtp?.otp === otp &&
          current.latestOtp.recipient?.trim().toLowerCase() === recipient
        ) {
          await browser.storage.local.remove('latestOtp');
          removed = true;
        }
      });
      sendResponse({ success: true, removed });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /** Re-run OTP/magic-link detection over already-stored emails (AI batch or local). */
  rescanEmailsForDetection: async (message, _sender, sendResponse) => {
    try {
      const summary = await rescanStoredEmails(message.address, message.includeArchived === true);
      sendResponse({ success: true, ...summary });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /** Remove the persisted AI detection result cache. */
  clearAiDetectionCache: async (_message, _sender, sendResponse) => {
    try {
      const cleared = await clearAiDetectionCache();
      sendResponse({ success: true, cleared });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /**
   * Print handoff: close the dedicated app tab once printing finished
   * (printed or cancelled). Extension-pages only - a web page's content
   * script must never be able to close the user's tab, so senders whose
   * frame URL is not an extension page are rejected outright.
   */
  closePrintTab: async (_message, sender, sendResponse) => {
    try {
      if (!isExtensionSender(sender)) {
        sendResponse({ success: false, error: 'errors.permissionDenied' });
        return;
      }
      if (sender.tab?.id != null) {
        await browser.tabs.remove(sender.tab.id);
      }
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  checkEmails: async (message, _sender, sendResponse) => {
    try {
      const addressId = requireString(message, 'addressId');
      // Demo: return stored bag only, never hit real providers
      const { demoMode, addresses = [] } = (await browser.storage.local.get([
        'demoMode',
        'addresses',
      ])) as {
        demoMode?: boolean;
        addresses?: import('@/utils/types.js').Address[];
      };
      const demoAddress = addresses.find((i) => i.id === addressId);
      if (demoMode || demoAddress?.provider === 'demo') {
        const addr = demoAddress?.address || '';
        const bag = await getStoredEmailsForAddress(addressId, addr);
        sendResponse({ success: true, messages: bag });
        return;
      }

      const messages = await checkNewEmails(addressId, message.filters);

      const liveAddresses = await getAddresses();
      const record = liveAddresses.find((i) => i.id === addressId);
      if (record && messages.length > 0) {
        const apiMsgs = messages.filter((m) => !m.local_only);
        if (apiMsgs.length > 0) {
          await storeNewMessages(record.address, apiMsgs);
        }
      }

      const stillExists = (await getAddresses()).some((item) => item.id === addressId);
      sendResponse(
        stillExists
          ? { success: true, messages }
          : errorPayload(undefined, 'errors.addressNotFound')
      );
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  // Bulk variant for the export wizard (multi-inbox export): ONE round-trip
  // instead of N serial checkEmails messages. Per-address semantics mirror the
  // single handler exactly (demo short-circuit, live fetch + merge, local-only
  // persistence, still-exists re-validation); the network-bound checks fan out
  // with bounded concurrency and per-address failures are isolated so one
  // missing/hanging inbox can't abort the export of the rest.
  /**
   * Content-script-safe inbox refresh trigger (wait-OTP panel "fetch now").
   * Runs the exact checkEmails fetch + store path via checkEmailsForBatch but
   * responds with counts only - NEVER message content. `checkEmails` itself
   * stays extension-page-only because its response carries full Email objects
   * (bodies included), which the content-script storage bridge deliberately
   * withholds (storedEmailsByAddress_* is not in
   * CONTENT_SCRIPT_READABLE_STORAGE_KEYS).
   */
  requestInboxCheck: async (message, sender, sendResponse) => {
    try {
      if (!isExtensionSender(sender) && !(await isOtpOptedInForContentSender(sender))) {
        sendResponse({ success: false, error: 'errors.otpAccessNotEnabled' });
        return;
      }
      const addressId = requireString(message, 'addressId');
      if (!isExtensionSender(sender)) {
        const { activeAddressId } = (await browser.storage.local.get('activeAddressId')) as {
          activeAddressId?: string;
        };
        // Content scripts may refresh only the inbox the extension currently
        // selected for the wait-OTP flow, never another address ID supplied by
        // the page context.
        if (!activeAddressId || addressId !== activeAddressId) {
          sendResponse({ success: false, error: 'errors.otpAccessNotEnabled' });
          return;
        }
        const now = Date.now();
        for (const [id, at] of lastContentInboxCheckByAddress) {
          if (now - at >= 60_000) lastContentInboxCheckByAddress.delete(id);
        }
        const lastCheckedAt = lastContentInboxCheckByAddress.get(addressId) ?? 0;
        if (now - lastCheckedAt < CONTENT_INBOX_CHECK_MIN_INTERVAL_MS) {
          sendResponse({ success: true, newMessages: 0, throttled: true });
          return;
        }
        if (lastContentInboxCheckByAddress.size >= 512) {
          const oldestId = lastContentInboxCheckByAddress.keys().next().value;
          if (oldestId !== undefined) lastContentInboxCheckByAddress.delete(oldestId);
        }
        lastContentInboxCheckByAddress.set(addressId, now);
      }
      const result = await checkEmailsForBatch(
        addressId,
        (message as { filters?: EmailFilters }).filters
      );
      sendResponse({
        success: result.success,
        newMessages: result.success ? (result.messages?.length ?? 0) : 0,
        ...(result.success ? {} : { error: result.error }),
      });
    } catch (error: unknown) {
      sendResponse({ newMessages: 0, ...errorPayload(error) });
    }
  },
  checkEmailsBulk: async (message, _sender, sendResponse) => {
    const addressIds = Array.isArray(message.addressIds)
      ? message.addressIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    try {
      if (addressIds.length === 0) {
        sendResponse({ results: [] });
        return;
      }
      const results = await runWithConcurrency(addressIds, CHECK_BATCH_CONCURRENCY, (addressId) =>
        checkEmailsForBatch(addressId, message.filters)
      );
      sendResponse({ results });
    } catch (error: unknown) {
      // Results are positional (results[i] ↔ addressIds[i]); on a whole-batch
      // failure every requested id must get its own error entry, mirroring
      // the other bulk handlers (deleteAddresses, archiveAddresses, …).
      const payload = errorPayload(error);
      sendResponse({
        results: addressIds.map((addressId) => ({ addressId, ...payload })),
      });
    }
  },

  deleteAddress: async (message, _sender, sendResponse) => {
    try {
      const result = await deleteAddress(
        requireString(message, 'addressId'),
        message.preserveEmails ?? false
      );
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  // Bulk variant: one locked pass over every requested inbox (see the
  // deleteAddresses docstring in address-manager) so N selections no longer
  // perform N full-list read-modify-writes. Per-address outcomes let the UI
  // keep its partial-failure reporting and per-id undo eligibility.
  deleteAddresses: async (message, _sender, sendResponse) => {
    try {
      const addressIds = Array.isArray(message.addressIds)
        ? message.addressIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const result = await deleteAddresses(addressIds, message.preserveEmails ?? false);
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse({ results: [errorPayload(error)] });
    }
  },

  // Bulk lifecycle variants (cross-tab drag prompts): ONE locked pass per
  // batch instead of N serial per-id RPCs, each of which re-read and re-wrote
  // the whole address list. Per-address outcomes map back over request order.
  archiveAddresses: async (message, _sender, sendResponse) => {
    try {
      const addressIds = Array.isArray(message.addressIds)
        ? message.addressIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const result = await archiveAddresses(addressIds);
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse({ results: [errorPayload(error)] });
    }
  },

  unarchiveAddresses: async (message, _sender, sendResponse) => {
    try {
      const addressIds = Array.isArray(message.addressIds)
        ? message.addressIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const result = await unarchiveAddresses(addressIds);
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse({ results: [errorPayload(error)] });
    }
  },

  renewAddresses: async (message, _sender, sendResponse) => {
    try {
      const addressIds = Array.isArray(message.addressIds)
        ? message.addressIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const result = await renewAddresses(addressIds);
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse({ results: [errorPayload(error)] });
    }
  },

  restoreAddress: async (message, _sender, sendResponse) => {
    try {
      // Guarded by the inbox lock like every other lifecycle handler
      // (archive/unarchive/delete) so restore can't race a concurrent
      // archive/delete of the same inbox.
      await withAddressLock(async () => {
        const addresses = await getAddresses();
        const record = addresses.find((i) => i.id === message.addressId);
        if (!record) {
          sendResponse({ success: false, error: 'errors.addressNotFound' });
          return;
        }
        await restoreArchivedEmailsToStored(record.address);
        await setAddresses(
          addresses.map((i) => {
            if (i.id !== message.addressId) return i;
            const address = { ...i };
            delete address.archiveReason;
            return { ...address, accountStatus: 'active' as const };
          })
        );
        sendResponse({ success: true });
      });
    } catch (e) {
      logError('restoreAddress error:', e);
      sendResponse({ success: false, error: 'errors.unknownError' });
    }
  },

  getAddresses: async (_message, sender, sendResponse) => {
    try {
      const addresses = await getAddresses();
      if (!isExtensionSender(sender)) {
        const rejected = await getSiteRejectedEmailDomains(siteEmailHost(sender));
        sendResponse({
          success: true,
          addresses: addresses
            .filter((address) => !rejected.length || allowsSiteEmail(address.address, rejected))
            .map((address) => {
              const safeAddress = { ...address };
              delete safeAddress.token;
              delete safeAddress.sidToken;
              return safeAddress;
            }),
        });
        return;
      }
      sendResponse({ success: true, addresses });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  setProvider: async (message, _sender, sendResponse) => {
    try {
      const provider = String(message.provider || '').trim();
      if (!provider || !getAllProviderConfigs().some((item) => item.id === provider)) {
        throw new Error('Invalid provider');
      }
      await withLock('background_storage_write_lock', () =>
        writeWithRetry({ selectedProvider: provider })
      );
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  updateAddressTag: async (message, _sender, sendResponse) => {
    try {
      await withAddressLock(async () => {
        const addresses = await getAddresses();
        const addressIndex = addresses.findIndex((i) => i.id === message.addressId);
        if (addressIndex === -1) {
          sendResponse({ success: false, error: 'errors.addressNotFound' });
          return;
        }
        await setAddresses(
          applyTagEditToAddresses(addresses, new Set([String(message.addressId)]), message)
        );
        sendResponse({ success: true });
      });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  // Bulk tag-apply (tag-dialog multi-select): ONE locked pass for N inboxes -
  // the address list is read and written once instead of N full-list
  // read-modify-writes. Missing (deleted) inboxes surface the same 'Inbox not
  // found' rejection the single handler uses, which TagDialog translates into
  // keep-open + error toast.
  updateAddressesTag: async (message, _sender, sendResponse) => {
    try {
      const addressIds = Array.isArray(message.addressIds)
        ? message.addressIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      await withAddressLock(async () => {
        const addresses = await getAddresses();
        const present = new Set(addresses.map((i) => i.id));
        const missing = addressIds.filter((id) => !present.has(id));
        const targets = new Set(addressIds);
        const next = applyTagEditToAddresses(addresses, targets, message);
        // The fan-out can change addresses the message never named, so the write is
        // guarded by comparing the whole list rather than only the targets.
        const changed = next.some((record, index) => record !== addresses[index]);
        if (changed) await setAddresses(next);
        if (missing.length > 0) {
          sendResponse({ success: false, error: 'errors.addressNotFound', missing });
          return;
        }
        sendResponse({ success: true });
      });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  archiveAddress: async (message, _sender, sendResponse) => {
    try {
      await withAddressLock(async () => {
        const addresses = await getAddresses();
        const record = addresses.find((i) => i.id === message.addressId);
        if (!record) {
          sendResponse({ success: false, error: 'errors.addressNotFound' });
          return;
        }
        await clearStoredEmails(record.address);
        await setAddresses(
          addresses.map((i) =>
            i.id === message.addressId
              ? {
                  ...i,
                  accountStatus: 'archived' as const,
                  archiveReason: 'manual' as const,
                  archivedAt: Math.max(Date.now(), (i.archivedAt ?? 0) + 1),
                  autoExtend: false,
                  unarchiveAfterRenewal: undefined,
                }
              : i
          )
        );
        sendResponse({ success: true, previousAutoExtend: record.autoExtend === true });
      });
    } catch (e) {
      logError('archiveAddress error:', e);
      sendResponse({ success: false, error: 'errors.unknownError' });
    }
  },

  unarchiveAddress: async (message, _sender, sendResponse) => {
    try {
      await withAddressLock(async () => {
        const addresses = await getAddresses();
        const record = addresses.find((i) => i.id === message.addressId);
        if (!record) {
          sendResponse({ success: false, error: 'errors.addressNotFound' });
          return;
        }
        // Bring Offline Saved history back into the live bag before marking active
        await restoreArchivedEmailsToStored(record.address);
        await setAddresses(
          addresses.map((i) => {
            if (i.id !== message.addressId) return i;
            const address = {
              ...i,
              accountStatus: 'active' as const,
              ...(typeof message.restoreAutoExtend === 'boolean'
                ? { autoExtend: message.restoreAutoExtend }
                : {}),
            };
            delete address.archiveReason;
            delete address.archivedAt;
            delete address.unarchiveAfterRenewal;
            return address;
          })
        );
        sendResponse({ success: true });
      });
    } catch (e) {
      logError('unarchiveAddress error:', e);
      sendResponse({ success: false, error: 'errors.unknownError' });
    }
  },

  restoreArchivedOverflowAddress: async (message, _sender, sendResponse) => {
    try {
      const addressId = requireString(message, 'addressId');
      const restored = await restoreArchivedOverflowAddress(addressId);
      if (!restored) {
        sendResponse({ success: false, error: 'errors.addressNotFound' });
        return;
      }
      sendResponse({ success: true });
    } catch (e) {
      logError('restoreArchivedOverflowAddress error:', e);
      sendResponse({ success: false, error: 'errors.unknownError' });
    }
  },

  getProvider: async (_message, _sender, sendResponse) => {
    try {
      // One keyed cache: every autofill path on a page load asks for the
      // selected provider. A `selectedProvider` change (UI switch, WebMCP,
      // backup import) drops the retained read via storage.onChanged above -
      // NOT a staleness cache.
      const selectedProvider = await providerCoalescer.run('provider', () => getSelectedProvider());
      sendResponse({ success: true, provider: selectedProvider });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  // Deliberately ungated: it only REMOVES stored secrets, so a hostile page
  // can at worst clear its own pending autofill state - no data leaves.
  clearSessionCredentials: async (_message, _sender, sendResponse) => {
    try {
      await browser.storage.session.remove('sessionCredentials');
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  updateSessionCredentials: async (message, sender, sendResponse) => {
    try {
      // Session credentials are persisted and (with autoCopy) written to the
      // clipboard, so a hostile page must not be able to plant arbitrary
      // values (e.g. attacker-controlled email/password pairs) via the
      // content-script bridge. Legitimate content-script callers only ever
      // send an `email` for the page they are on, so a website claim that is
      // not this tab's own domain is rejected: extension pages pass freely,
      // content scripts may only pin `website` to their own (or a registrable
      // parent of their) domain, and unclaimed `website` stays tab-scoped -
      // it is derived from the page itself at consumption time.
      const credentials = message.credentials;
      if (
        !isExtensionSender(sender) &&
        credentials &&
        typeof credentials === 'object' &&
        typeof (credentials as Record<string, unknown>).website === 'string' &&
        ((credentials as Record<string, unknown>).website as string).length > 0 &&
        !isDomainAllowedForSender(
          (credentials as Record<string, unknown>).website as string,
          sender
        )
      ) {
        sendResponse({ success: false, error: 'errors.domainMismatch' });
        return;
      }
      const result = await handleUpdateSessionCredentials(
        {
          type: 'updateSessionCredentials',
          credentials: credentials ?? {},
        },
        sender
      );
      sendResponse(result);
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /** Persist a filled signup credential from the content script */
  saveLoginCredential: async (message, sender, sendResponse) => {
    try {
      const raw = message.credential as Record<string, unknown> | undefined;
      if (!raw || typeof raw !== 'object') {
        sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
        return;
      }
      const credential = normalizeSavedLoginCredential(raw);
      if (!credential) {
        sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
        return;
      }
      if (!isExtensionSender(sender) && !isDomainAllowedForSender(credential.domain, sender)) {
        sendResponse({ success: false, error: 'errors.domainMismatch' });
        return;
      }
      await withLock('login_info_lock', async () => {
        const result = (await browser.storage.local.get(['loginInfo'])) as {
          loginInfo?: CredentialsHistoryItem[];
        };
        let loginInfo = Array.isArray(result.loginInfo) ? [...result.loginInfo] : [];
        const credEmail = (credential.email || credential.username || '').toLowerCase();
        const credDomain = credential.domain.toLowerCase();
        if (credEmail && credDomain) {
          loginInfo = loginInfo.filter((item) => {
            const itemEmail = (item.email || item.username || '').toString().toLowerCase();
            const itemDomain = (item.domain || '').toString().toLowerCase();
            return !(itemEmail === credEmail && itemDomain === credDomain);
          });
        }
        loginInfo.unshift(credential);
        if (loginInfo.length > 50) loginInfo.length = 50;
        await writeWithRetry({ loginInfo });
        sendResponse({ success: true, count: loginInfo.length });
      });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  updatePendingSignupUsername: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      // Bind this patch to the actual sending frame; an unrelated iframe must
      // not inherit the top-level tab's authority over a pending signup.
      const scopedSender = sender.url
        ? { ...sender, tab: { ...sender.tab, url: sender.url } }
        : sender;
      if (!isExtensionSender(sender) && !isDomainAllowedForSender(domain, scopedSender)) {
        sendResponse({ success: false, error: 'errors.domainMismatch' });
        return;
      }
      sendResponse(
        await updatePendingSignupUsername({
          domain,
          credentialId: requireString(message, 'credentialId'),
          expectedUsername: requireString(message, 'expectedUsername'),
          username: requireString(message, 'username'),
        })
      );
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getAnalytics: async (_message, _sender, sendResponse) => {
    try {
      const analytics = await getAnalytics();
      const performanceSummary = await getPerformanceSummary();
      sendResponse({ success: true, analytics, performanceSummary });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  resetAnalytics: async (_message, _sender, sendResponse) => {
    try {
      await resetAnalyticsData();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  recordExtensionOpen: async (_message, _sender, sendResponse) => {
    try {
      await recordExtensionOpen();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  recordPageVisit: async (message, _sender, sendResponse) => {
    try {
      // The wire value is `unknown` until the activity vocabulary's own validator
      // narrows it: only an id the catalog knows is counted, so the stored visit
      // record cannot gain a key no label table can render.
      const raw = (message as { viewId?: unknown }).viewId;
      const viewId = typeof raw === 'string' && isActivityViewId(raw) ? raw : null;
      if (viewId) await recordPageVisit(viewId);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  recordEmailRead: async (_message, _sender, sendResponse) => {
    try {
      await recordEmailRead();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  recordUIRenderTime: async (message, _sender, sendResponse) => {
    try {
      await recordUIRenderTime(requireNumber(message, 'renderTime'));
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  recordStorageSnapshot: async (message, _sender, sendResponse) => {
    try {
      await recordStorageTrend(requireNumber(message, 'bytes'), requireNumber(message, 'emails'));
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getArchivedEmails: async (message, _sender, sendResponse) => {
    try {
      const archivedEmails = await getArchivedEmails(message.address);
      sendResponse({ success: true, archivedEmails });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getStorageUsage: async (_message, _sender, sendResponse) => {
    try {
      const usage = await getStorageUsage();
      sendResponse({ success: true, usage });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getEmailsToBeDeleted: async (message, _sender, sendResponse) => {
    try {
      // 0 is the "never delete" sentinel and must pass through (the callee
      // reports zero deletions); only a malformed/non-numeric value falls back
      // to the 30-day default - treating 0 as invalid would delete mail the
      // user asked to keep forever.
      const retentionDays =
        typeof message.retentionDays === 'number' && Number.isFinite(message.retentionDays)
          ? message.retentionDays
          : 30;
      const count = await getEmailsToBeDeleted(retentionDays);
      sendResponse({ success: true, count });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  cleanupOldStoredEmails: async (message, _sender, sendResponse) => {
    try {
      // Same contract: 0 = "never delete" passes through (cleanupOldStoredEmails
      // no-ops keep-all windows); malformed values default to 30/90 as before.
      let activeRetentionDays =
        typeof message.activeRetentionDays === 'number' &&
        Number.isFinite(message.activeRetentionDays)
          ? message.activeRetentionDays
          : 30;
      let archivedRetentionDays =
        typeof message.archivedRetentionDays === 'number' &&
        Number.isFinite(message.archivedRetentionDays)
          ? message.archivedRetentionDays
          : 90;
      // A negative value must NEVER reach cleanup: it would compute a future
      // threshold and delete every email. Coerce to the default with a trace.
      if (activeRetentionDays < 0) {
        logWarn('cleanupOldStoredEmails received a negative active retention; using default', {
          received: message.activeRetentionDays,
        });
        activeRetentionDays = 30;
      }
      if (archivedRetentionDays < 0) {
        logWarn('cleanupOldStoredEmails received a negative archived retention; using default', {
          received: message.archivedRetentionDays,
        });
        archivedRetentionDays = 90;
      }
      await cleanupOldStoredEmails(activeRetentionDays, archivedRetentionDays);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  hardReset: async (_message, _sender, sendResponse) => {
    try {
      try {
        await browser.alarms.clearAll();
      } catch (alarmErr) {
        logWarn('Non-fatal error clearing alarms during hard reset:', alarmErr);
      }
      await browser.storage.session.clear();
      try {
        if (self.caches) {
          const cacheNames = await self.caches.keys();
          for (const cacheName of cacheNames) {
            await self.caches.delete(cacheName);
          }
        }
      } catch {
        /* non-critical */
      }
      const hardResetAt = Date.now();
      await writeWithRetry({ lastHardReset: hardResetAt, forceNewSessions: true });
      setTimeout(async () => {
        try {
          // Only clear the flag if this is still the most recent hard reset.
          // A rapid second hardReset re-arms the flag with a NEW lastHardReset;
          // this (now-stale) timer must not cut the second reset's invalidation
          // window short. The second reset's own timer (snapshotting ITS
          // lastHardReset) is the only one allowed to clear the flag.
          if (!(await isLatestHardReset(hardResetAt))) return;
          await browser.storage.local.remove('forceNewSessions');
        } catch {
          // Ignore clear errors (e.g. storage closed).
          // The consumer-side expiry guard (address-manager checkNewEmails
          // ages out the flag past FORCE_NEW_SESSIONS_AUTO_CLEAR_MS) covers
          // this failure path.
        }
      }, CONSTANTS.FORCE_NEW_SESSIONS_AUTO_CLEAR_MS);
      setupPeriodicEmailCheck(checkNewEmails);
      setupAddressExpiryCheck();
      // hardReset cleared all alarms - restore the near-expiry badge countdown.
      await ensureBadgeCountdownAlarm();
      await addHardResetEvent();
      // The settings page clears local storage after this response. Return the
      // marker so it can restore the session-invalidation flag instead of
      // deleting the reset signal immediately.
      sendResponse({ success: true, lastHardReset: hardResetAt, forceNewSessions: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getProviderInstances: async (message, _sender, sendResponse) => {
    try {
      const provider = message.provider || DEFAULT_PROVIDER;
      const instances = await getProviderInstancesWithCustom(provider);
      sendResponse({ success: true, instances });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  translate: async (message, _sender, sendResponse) => {
    try {
      const key = requireString(message, 'key');
      const vars = message.vars as Record<string, string | number> | undefined;
      const result = await t(key, vars);
      sendResponse({ success: true, translated: result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  reauthenticateAddress: async (message, _sender, sendResponse) => {
    try {
      const addressId = requireString(message, 'addressId');
      // TOCTOU guard: read → network → apply all inside ONE withAddressLock
      // (mirrors renewAddress / deleteAddress), so a concurrent deleteAddress
      // or re-authenticateAddress can't race a stale record. The record read
      // here is the one actually in storage at network time, and the apply
      // can't be clobbered by an interleaved lifecycle write.
      await withAddressLock(async () => {
        const addresses = await getAddresses();
        const record = addresses.find((i) => i.id === addressId);
        if (!record) {
          // Keyed payload: the reauth walkthrough renders it through
          // translateResultMessage, so it must stay an `errors.*` code.
          sendResponse({ success: false, error: 'errors.addressNotFound' });
          return;
        }
        const config = loadProviderConfig(record.provider);
        const service = new EmailService(config, browser);
        // Locked-caller variant: the core must NOT re-acquire the lock it was
        // invoked under (non-reentrant mutex).
        const outcome = await reauthenticateAddressCoreForLockedCaller(config, record, {
          getAddresses,
          setAddresses,
          withLock: withAddressLock,
          executeOperation: (op, ctx) => service.executeOperation(op, ctx),
          restoreArchivedEmailsToStored,
        });
        if (!outcome.ok) {
          sendResponse({ success: false, error: outcome.error ?? 'errors.reauthFailed' });
          return;
        }
        sendResponse({
          success: true,
          addressId,
          address: outcome.address,
          expiresAt: outcome.expiresAt,
        });
      });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  // Batch re-auth (backup-import reauth walkthrough): ONE locked pass - the
  // address list is read once and written once regardless of N, while each
  // inbox's network probe stays isolated (one failing provider can't abort
  // the rest). Not-found ids are reported as per-id outcomes.
  reauthenticateAddresses: async (message, _sender, sendResponse) => {
    try {
      const addressIds = Array.isArray(message.addressIds)
        ? message.addressIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      await withAddressLock(async () => {
        const addresses = await getAddresses();
        const outcomes: ReauthBatchOutcome[] = [];
        const entries: BulkReauthEntry[] = [];
        for (const id of addressIds) {
          const record = addresses.find((i) => i.id === id);
          if (!record) {
            outcomes.push({ addressId: id, success: false, error: 'errors.addressNotFound' });
            continue;
          }
          const config = loadProviderConfig(record.provider);
          const service = new EmailService(config, browser);
          entries.push({
            addressId: id,
            record,
            config,
            executeOperation: (op, ctx) => service.executeOperation(op, ctx),
          });
        }
        const { next, outcomes: batchOutcomes } = await runReauthBatch(addresses, entries, {
          now: () => Date.now(),
        });
        outcomes.push(...batchOutcomes);
        await setAddresses(next);
        // Same as the single path - make sure offline history is in the live bag.
        for (const outcome of outcomes) {
          if (!outcome.success || !outcome.address) continue;
          try {
            await restoreArchivedEmailsToStored(outcome.address);
          } catch {
            /* best-effort */
          }
        }
        // Re-map outcomes back over the REQUEST order (missing probes can lag).
        const byId = new Map(outcomes.map((o) => [o.addressId, o]));
        const ordered = addressIds
          .map((id) => byId.get(id))
          .filter((o): o is ReauthBatchOutcome => o !== undefined);
        sendResponse({ success: ordered.every((o) => o.success), results: ordered });
      });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  renewAddress: async (message, _sender, sendResponse) => {
    let progressMarker: { addressId: string; startedAt: number } | null = null;
    // Assignment happens inside the awaited lock callback. Read through an
    // explicit return type so TS does not narrow the outer variable to its
    // initial null value when checking the failure-cleanup branch.
    const readProgressMarker = (): { addressId: string; startedAt: number } | null =>
      progressMarker;
    try {
      const addressId = requireString(message, 'addressId');
      // TOCTOU guard: the whole renew runs as ONE critical section - read →
      // network → apply - under withAddressLock, so a concurrent
      // deleteAddress / reauthenticateAddress can't renew with a stale token /
      // instanceUrl or write a renewal back over a deleted record. The network
      // call lives inside the lock deliberately (checkNewEmails already does
      // this with executeOperation).
      await withAddressLock(async () => {
        const currentAddresses = await getAddresses();
        const record = currentAddresses.find((i) => i.id === addressId);
        if (!record) {
          sendResponse({ success: false, error: 'errors.addressNotFound' });
          return;
        }
        const providerConfig = loadProviderConfig(record.provider);
        const renewalMethod = providerConfig.expiry?.renewalMethod;
        const supportsRenewal =
          providerConfig.expiry?.renewable === true ||
          providerConfig.capabilities?.supportsRenew === true;
        if (!supportsRenewal || !renewalMethod) {
          sendResponse({
            success: false,
            error: 'errors.renewUnsupported',
          });
          return;
        }
        const config = providerConfig;
        const service = new EmailService(config, browser);
        const token = record.token || record.sidToken;
        if (!token) {
          sendResponse({ success: false, error: 'errors.renewNoToken' });
          return;
        }
        const currentUser = record.emailUser || record.address.split('@')[0];
        const renewalStartedAt = Date.now();
        const renewalAddressIndex = currentAddresses.findIndex(
          (address) => address.id === record.id
        );
        if (renewalAddressIndex < 0) {
          sendResponse({ success: false, error: 'errors.renewAddressGone' });
          return;
        }
        currentAddresses[renewalAddressIndex] = {
          ...currentAddresses[renewalAddressIndex],
          renewalInProgressAt: renewalStartedAt,
        };
        progressMarker = { addressId: record.id, startedAt: renewalStartedAt };
        await setAddresses(currentAddresses);
        // Measure actual renewal latency for the adaptive auto-renew window.
        const renewalStart = Date.now();
        const renewalResponse = await service.executeOperation(renewalMethod, {
          auth: { token },
          variables: { emailUser: currentUser },
          // Keep renewal on the instance that owns this mailbox.
          ...(record.instanceUrl ? { instanceUrl: record.instanceUrl } : {}),
        });
        const measuredLatencyMs = Date.now() - renewalStart;
        // `addresses` above is lock-fresh (read inside the critical section
        // and only writable from inside it), so the apply can use it directly.
        const addressIndex = currentAddresses.findIndex((i: Address) => i.id === record.id);
        if (addressIndex !== -1) {
          const shouldReactivateAfterRenewal =
            record.accountStatus !== 'archived' ||
            record.archiveReason !== 'manual' ||
            record.unarchiveAfterRenewal === true;
          // Auto-archived addresses recover to Live after success. A manually
          // archived address follows the explicit choice made when enabling
          // auto-renew; keeping it archived must also keep its mail in archive.
          if (shouldReactivateAfterRenewal) {
            await restoreArchivedEmailsToStored(record.address);
          }

          // NOTE: We do NOT eagerly mark stored messages as `local_only` here -
          // for providers that keep messages on renewal (e.g. Guerrilla Mail's
          // set_email_user with the same username), those messages are still live.
          // The `checkNewEmails` merge logic marks a message `local_only` only when
          // its ID is absent from the latest API response, which is correct for both
          // Model 2 (independent retention) and Model 3 (post-expiry renewal reset).

          const expiryConfig = providerConfig;
          const capturedCookieToken =
            config.auth.type === 'cookie' && config.auth.cookieName
              ? service.getSessionCookies()[config.auth.cookieName]
              : undefined;
          const newSidToken =
            typeof renewalResponse.token === 'string' && renewalResponse.token.trim()
              ? renewalResponse.token
              : capturedCookieToken ||
                currentAddresses[addressIndex].token ||
                currentAddresses[addressIndex].sidToken ||
                token;
          // BUG FIX: force renewal base to now so the new window is always future.
          const timing = deriveAddressTiming(renewalResponse, expiryConfig, Date.now(), {
            renewalBaseNow: true,
          });
          const prevCount = currentAddresses[addressIndex].renewalCount ?? 0;
          const renewedAddress: Address = {
            ...currentAddresses[addressIndex],
            token: newSidToken,
            sidToken: newSidToken,
            emailUser: currentUser,
            expiresAt: timing.expiresAt,
            expiryNotified: false,
            expiringSoonNotified: false,
            expiredNotified: false,
            renewalCount: prevCount + 1,
            renewalLatencyMs: measuredLatencyMs,
            lastRenewalAt: Date.now(),
            renewalFailCount: 0,
            lastFailureAt: undefined,
            nextRetryAt: undefined,
            accountStatus: shouldReactivateAfterRenewal ? 'active' : 'archived',
          };
          if (shouldReactivateAfterRenewal) {
            delete renewedAddress.archiveReason;
            delete renewedAddress.archivedAt;
          }
          delete renewedAddress.unarchiveAfterRenewal;
          delete renewedAddress.renewalInProgressAt;
          currentAddresses[addressIndex] = renewedAddress;
          await setAddresses(currentAddresses);
          progressMarker = null;
          sendResponse({ success: true, renewalCount: prevCount + 1 });
        } else {
          sendResponse({ success: false, error: 'errors.renewAddressGone' });
        }
      });
    } catch (error: unknown) {
      const marker = readProgressMarker();
      if (marker) {
        try {
          await withAddressLock(async () => {
            const addresses = await getAddresses();
            const index = addresses.findIndex((address) => address.id === marker.addressId);
            const address = addresses[index];
            if (index < 0 || address.renewalInProgressAt !== marker.startedAt) return;
            const updated = { ...address };
            delete updated.renewalInProgressAt;
            addresses[index] = updated;
            await setAddresses(addresses);
          });
        } catch (cleanupError) {
          logError('Failed to clear renewal progress state', cleanupError);
        }
      }
      sendResponse(errorPayload(error));
    }
  },

  addCustomInstance: async (message, _sender, sendResponse) => {
    try {
      const instance = message.instance as Omit<ProviderInstance, 'id' | 'isCustom'>;
      validateCustomInstanceName(instance.name);
      await validateCustomInstanceUrl(instance.apiUrl);
      const provider = await getSelectedProvider();
      await addCustomProviderInstance(provider, instance);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  removeCustomInstance: async (message, _sender, sendResponse) => {
    try {
      const provider = await getSelectedProvider();
      await removeCustomProviderInstance(provider, message.instanceId as string);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getSelectedInstance: async (_message, _sender, sendResponse) => {
    try {
      const provider = await getSelectedProvider();
      const instance = await getSelectedProviderInstance(provider);
      sendResponse({ success: true, instance });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  setSelectedInstance: async (message, _sender, sendResponse) => {
    try {
      const provider = await getSelectedProvider();
      // Legacy single-pin API - backed by the enabled/disabled pool:
      // 'random' clears the blacklist (all enabled); an id pins only that one.
      await setProviderInstance(provider, message.instanceId as string);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  setDisabledInstances: async (message, _sender, sendResponse) => {
    try {
      const provider = message.provider as string;
      if (!provider) {
        throw new ValidationError(
          'Missing required message field: provider',
          { field: 'provider' },
          'errors.invalidRequestFormat'
        );
      }
      const disabled = Array.isArray(message.disabledInstances)
        ? (message.disabledInstances as string[])
        : [];
      await setDisabledInstances(provider, disabled);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  initializeDefaultProvider: async (_message, _sender, sendResponse) => {
    try {
      await initializeDefaultProvider();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  providerApiCall: async (message, _sender, sendResponse) => {
    try {
      const config = loadProviderConfig(requireString(message, 'provider'));
      const service = new EmailService(config, browser);
      const data = await service.executeOperation(requireString(message, 'func'), {
        auth: message.sidToken ? { token: message.sidToken } : undefined,
        variables: message.params || {},
      });
      sendResponse({ success: true, data });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  fetchFavicon: async (message, _sender, sendResponse) => {
    try {
      const { url } = message as { url: string };
      logInfo('fetchFavicon requested', { url });

      const parsedUrl = new URL(url);
      // SECURITY: validate the start URL including a DNS re-resolution guard
      // (a hostname that currently resolves to a private address - DNS
      // rebinding - must be rejected before the request is issued). Never
      // follow redirects: a public URL could 302 to an internal host, and
      // `redirect: 'manual'` hides the Location header in service workers so
      // each hop cannot be re-validated. `redirect: 'error'` fails the fetch
      // on any redirect instead; callers fall back to the Google favicon proxy.
      const safeUrl = await isSafeFetchUrlWithDns(parsedUrl.toString());
      // `safeUrl.error` is an `errors.*` key (SSRF guard); ValidationError
      // adopts it as its translationKey so the payload stays renderable.
      if (!safeUrl.ok) throw new ValidationError(safeUrl.error || 'errors.invalidUrl');

      const controller = new AbortController();
      // 10s cap - 60s left a slow favicon host occupying the service worker
      // for a full minute; anything slower isn't worth having the icon.
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      let response: Response;
      let buffer: ArrayBuffer;
      try {
        response = await fetch(parsedUrl.toString(), {
          signal: controller.signal,
          redirect: 'error',
        });
        // Defense-in-depth: the final response URL must still pass the same
        // static checks (only differs from the start URL if something rewrote it).
        const finalSafe = isSafeFetchUrl(response.url);
        if (!finalSafe.ok) {
          sendResponse({ success: false, error: finalSafe.error || 'errors.invalidUrl' });
          return;
        }

        logInfo('fetchFavicon response status', { status: response.status });
        if (!response.ok) {
          // The status is already logged above; the payload must stay keyable.
          sendResponse(errorPayload(undefined, 'errors.networkErrorGeneric'));
          return;
        }
        const contentLength = response.headers.get('content-length');
        const declaredLength = contentLength ? Number(contentLength) : Number.NaN;
        if (Number.isFinite(declaredLength) && declaredLength > 5 * 1024 * 1024) {
          throw new ValidationError('Favicon too large', undefined, 'errors.validationError');
        }
        buffer = await readResponseBodyLimited(response, 5 * 1024 * 1024);
      } finally {
        // Keep the deadline active through body consumption as well as headers.
        clearTimeout(timeoutId);
      }
      const uint8 = new Uint8Array(buffer);
      logInfo('fetchFavicon buffer size', { size: uint8.length });
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      let binary = '';
      const CHUNK_SIZE = 0x8000;
      for (let i = 0; i < uint8.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, Array.from(uint8.subarray(i, i + CHUNK_SIZE)));
      }
      const base64 = btoa(binary);
      // The response's Content-Type is attacker-influenced (the favicon host
      // picks it) and becomes a `data:<type>;base64,…` URL in the UI, so only an
      // actual image type is accepted; anything else falls back to the generic
      // icon type instead of caching non-image bytes under a foreign MIME.
      const contentType = normalizeFaviconContentType(response.headers.get('content-type'));
      logInfo('fetchFavicon success, sending response');
      sendResponse({ success: true, base64, contentType, hash });
    } catch (error: unknown) {
      logError('fetchFavicon error', error);
      sendResponse(errorPayload(error, 'errors.networkErrorGeneric'));
    }
  },

  updateRefreshInterval: async (message, _sender, sendResponse) => {
    try {
      const ms = message.intervalMs as number;
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 3600000) {
        throw new Error('Refresh interval must be between 0 and 1hr');
      }
      await updateRefreshAlarm(ms);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  findReusableIdentity: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      if (!isExtensionSender(sender) && !isDomainAllowedForSender(domain, sender)) {
        sendResponse({ found: false, error: 'errors.domainMismatch' });
        return;
      }
      const addressId =
        typeof (message as { addressId?: string }).addressId === 'string'
          ? (message as { addressId: string }).addressId
          : '';
      const replay = await findSiteReplayForDomain(domain, addressId || null);
      sendResponse({
        found: !!replay.credential,
        credential: replay.credential,
        lastEmail: replay.lastEmail,
        lastAddressId: replay.lastAddressId,
        lastIdentityId: replay.lastIdentityId,
        fromSiteProfile: replay.fromSiteProfile,
      });
    } catch (error: unknown) {
      sendResponse({ found: false, error: errorPayload(error).error });
    }
  },

  findSiteReplay: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      if (!isExtensionSender(sender) && !isDomainAllowedForSender(domain, sender)) {
        sendResponse({ success: false, found: false, error: 'errors.domainMismatch' });
        return;
      }
      const addressId =
        typeof (message as { addressId?: string }).addressId === 'string'
          ? (message as { addressId: string }).addressId
          : null;
      const replay = await findSiteReplayForDomain(domain, addressId);
      sendResponse({ success: true, ...replay, found: !!replay.credential });
    } catch (error: unknown) {
      sendResponse({ success: false, found: false, error: errorPayload(error).error });
    }
  },

  copySiteLoginPassword: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      const email = requireString(message, 'email');
      const addressId =
        typeof (message as { addressId?: string }).addressId === 'string'
          ? (message as { addressId: string }).addressId
          : null;
      if (!isDomainAllowedForSender(domain, sender)) {
        sendResponse({ success: false, error: 'errors.domainMismatch' });
        return;
      }
      const replay = await findSiteReplayForDomain(domain, addressId);
      const credential = replay.credential;
      if (!credential?.password || credential.email.toLowerCase() !== email.toLowerCase()) {
        sendResponse({ success: false });
        return;
      }
      const success = await copyToClipboardFromBackground(credential.password);
      sendResponse({ success });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  clearAllOtps: async (_message, _sender, sendResponse) => {
    try {
      await clearAllOtps();
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /** UI/content: ensure active tab has content script + form scan (post-install / after create). */
  ensureActiveTabAutofill: async (_message, _sender, sendResponse) => {
    try {
      const { ensureActiveTabAutofill } = await import('../tab-autofill.js');
      const status = await ensureActiveTabAutofill({ notifyIfRefreshNeeded: true });
      sendResponse({ success: true, status });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  getPerfReport: async (_message, sender, sendResponse) => {
    try {
      const { getPerfReport } = await import('@/utils/perf/perf-marks.js');
      // Collect the active tab's content-script ring in the same pass so the
      // report merges every context. Best-effort: no tab / no listener → skip.
      const tabMarks: Array<{ context: string; mark: unknown }> = [];
      let tabCounts: unknown = null;
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && tab.url && /^https?:/i.test(tab.url)) {
          const res = (await browser.tabs.sendMessage(tab.id, {
            type: 'collectPerfMarks',
          })) as { ok?: boolean; marks?: unknown[]; counts?: unknown } | undefined;
          if (res?.ok) {
            if (Array.isArray(res.marks)) {
              for (const mark of res.marks) tabMarks.push({ context: 'content', mark });
            }
            tabCounts = res.counts ?? null;
          }
        }
      } catch {
        /* no content script on the active tab - SW marks alone are still useful */
      }
      sendResponse({
        success: true,
        swMarks: getPerfReport(),
        tabMarks,
        tabCounts,
        isDevBuild: process.env.NODE_ENV !== 'production',
      });
      void sender;
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  formPresence: async (message, sender, sendResponse) => {
    try {
      const detected = !!(message as { formDetected?: boolean }).formDetected;
      const tabId = sender.tab?.id;
      if (typeof tabId === 'number') {
        const { setFormBadge } = await import('../tab-autofill.js');
        await setFormBadge(tabId, detected);
      }
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  generateIdentityField: async (message, _sender, sendResponse) => {
    try {
      const fieldType = requireString(message, 'fieldType');
      const locale = message.locale as string | undefined;
      let value = '';
      switch (fieldType) {
        case 'phoneNumber':
          value = generatePhoneNumber(locale);
          break;
        case 'username':
          value = generateUsername();
          break;
        case 'websiteUrl':
          value = generateWebsiteUrl();
          break;
        case 'randomName':
          value = generateRandomName();
          break;
        case 'smartPassword':
          value = generatePassword();
          break;
        default:
          throw new ValidationError(
            `Unknown fieldType: ${fieldType}`,
            { fieldType },
            'errors.invalidRequestFormat'
          );
      }
      sendResponse({ success: true, value });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  encryptData: async (message, sender, sendResponse) => {
    try {
      assertCryptoOracleSender(message, sender);
      const text = requireString(message, 'text');
      if (text.length > MAX_CRYPTO_ORACLE_TEXT_LENGTH) {
        throw new ValidationError('Crypto text too large', undefined, 'errors.validationError');
      }
      const encrypted = await encrypt(text);
      sendResponse({ success: true, encrypted });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  /**
   * Storage-scoped custom-password decryption - replacement for the raw
   * text-carrying decryptData primitive. The background loads the ciphertext
   * itself from extension storage (global passwordSettings or a saved identity
   * by id), so a page-originated message never carries ciphertext and cannot
   * use the background as a chosen-ciphertext oracle. The sender gate still
   * binds content-script calls to the page they are injected on.
   */
  decryptStoredCustomPassword: async (message, sender, sendResponse) => {
    try {
      assertCryptoOracleSender(message, sender);
      const source = requireString(message, 'source');
      let ciphertext: string | null = null;
      if (source === 'passwordSettings') {
        const { passwordSettings } = (await browser.storage.local.get('passwordSettings')) as {
          passwordSettings?: { customPassword?: string };
        };
        ciphertext = passwordSettings?.customPassword ?? null;
      } else if (source === 'identity') {
        const identityId = requireString(message, 'identityId');
        const domain = requireString(message, 'domain');
        const { identities = [] } = (await browser.storage.local.get('identities')) as {
          identities?: Identity[];
        };
        const identity = identities.find((i) => i.id === identityId);
        if (!identity) {
          throw new ValidationError(
            'Custom password unavailable',
            undefined,
            'errors.validationError'
          );
        }
        const overrides = resolveDomainFieldOverrides(identity, domain);
        const effectivePassword = overrides.customPassword ?? identity.customPassword;
        if (typeof effectivePassword !== 'string' || !effectivePassword) {
          if (identity.useRandomPassword && overrides.customPassword === undefined) {
            throw new ValidationError(
              'Custom password unavailable',
              undefined,
              'errors.validationError'
            );
          }
          throw new ValidationError(
            'Custom password unavailable',
            undefined,
            'errors.validationError'
          );
        }
        ciphertext = effectivePassword;
      } else {
        throw new ValidationError(
          `Unknown decrypt source: ${source}`,
          { source },
          'errors.invalidRequestFormat'
        );
      }
      if (!ciphertext) {
        throw new ValidationError('Custom password not set', { source }, 'errors.validationError');
      }
      if (ciphertext.length > MAX_CRYPTO_ORACLE_TEXT_LENGTH) {
        throw new ValidationError(
          'Custom password too large',
          { source },
          'errors.validationError'
        );
      }
      // Legacy plaintext (saved before the vault encrypted these stores) is
      // returned unchanged - decrypt() only understands real ciphertext, and
      // content must never guess a value's shape or fall back to the raw
      // storage read. Ciphertext-shaped values go through real decryption; a
      // locked vault / key change throws so content surfaces the vault-locked
      // path instead of ever filling the raw blob into a page.
      if (!looksLikeCiphertext(ciphertext)) {
        sendResponse({ success: true, decrypted: ciphertext });
        return;
      }
      const decrypted = await decrypt(ciphertext);
      sendResponse({ success: true, decrypted });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  copyToClipboard: async (message, sender, sendResponse) => {
    try {
      const text = requireString(message, 'text');
      // Content scripts run on <all_urls>: a hostile page can otherwise drive
      // the bridge to plant arbitrary attacker text in the system clipboard
      // (paste-target prompt injection / exfil-URL planting). Extension pages
      // are exempt - the UI copies arbitrary user-visible text. Legit content
      // flows only ever copy OTP codes (see isPlausibleClipboardText).
      if (!isExtensionSender(sender) && !isPlausibleClipboardText(text)) {
        sendResponse({ success: false, error: 'errors.permissionDenied' });
        return;
      }
      const purgeAfterMs = message.purgeAfterMs ? Number(message.purgeAfterMs) : undefined;
      await copyToClipboardAndSchedulePurge(text, purgeAfterMs);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  getProviderDisplayName: async (message, _sender, sendResponse) => {
    try {
      const provider = requireString(message, 'provider');
      // Per-provider-id cache: N rows rendering display names for the same
      // provider share one in-memory config resolution. A
      // `providerConfigOverrides` change (user-edited provider JSON) drops
      // every retained name via storage.onChanged above.
      const displayName = await providerDisplayNameCoalescer.run(provider, async () => {
        const config = loadProviderConfig(provider);
        return config?.displayName ?? provider;
      });
      sendResponse({ success: true, displayName });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  generateLocaleExtras: async (message, _sender, sendResponse) => {
    try {
      const locale = (message as { locale?: string }).locale || undefined;
      let country = localeToCountryHint(locale || 'en');
      const extras = localeAwareAddressExtras(locale);
      country = extras.country;
      const dob = randomAdultDob(21, 55);
      sendResponse({ success: true, country, city: extras.city, pin: extras.pin, dob });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  generateLocaleAwarePhone: async (message, _sender, sendResponse) => {
    try {
      const locale = (message as { locale?: string }).locale || undefined;
      const phone = localeAwarePhone(locale);
      sendResponse({ success: true, phone });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  getIconSvg: async (message, _sender, sendResponse) => {
    try {
      const name = requireString(message, 'name') as string;
      const opts = message as { size?: number; color?: string };
      const svg = getIconSvg(name as IconSvgName, { size: opts.size, color: opts.color });
      sendResponse({ success: true, svg });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  recordAutofillSuccess: async (message, _sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      await recordAutofillSuccess(domain);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  recordAutofillFailure: async (message, _sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      const result = await recordAutofillFailure(domain);
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  loadSmartAutofillSettings: async (_message, _sender, sendResponse) => {
    try {
      // Coalesce concurrent (and 1s-recent) reads: N content callers on one
      // page load previously meant N storage round-trips. NOT a staleness
      // cache - a write to the underlying key (SettingsView save, backup
      // import) drops every retained read via storage.onChanged above.
      const settings = await smartSettingsCoalescer.run('settings', () =>
        loadSmartAutofillSettings()
      );
      sendResponse({ success: true, settings });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  routeIdentityForDomain: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      if (!isExtensionSender(sender) && !isDomainAllowedForSender(domain, sender)) {
        throw new ValidationError('Domain mismatch', undefined, 'errors.domainMismatch');
      }
      const msg = message as { identities?: unknown; selectedIdentityId?: string | null };
      const result = await routeIdentityForDomain(
        domain,
        msg.identities as Parameters<typeof routeIdentityForDomain>[1],
        msg.selectedIdentityId
      );
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  recordAutofillOutcome: async (message, _sender, sendResponse) => {
    try {
      const opts = (message as { opts?: Record<string, unknown> }).opts || {};
      await recordAutofillOutcome(opts as Parameters<typeof recordAutofillOutcome>[0]);
      // Write-through: the outcome just rewrote the profile shouldPreferReplay
      // aggregates. Keyed through the same normalized encoding so casing
      // variants of the domain hit the entry they rewrote.
      const domain = typeof opts.domain === 'string' ? opts.domain : '';
      if (domain) replayCoalescer.invalidate(domain);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  shouldPreferReplay: async (message, _sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      // Per-domain cache keyed on the NORMALIZED domain (see replayCoalescer
      // above). The profile it aggregates only changes via
      // recordAutofillOutcome (write-through invalidate below) or a backup
      // import (onChanged for siteProfiles above) - not a staleness cache.
      const result = await replayCoalescer.run(domain, () => shouldPreferReplay(domain));
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  pickFreshestIdentity: async (message, _sender, sendResponse) => {
    try {
      const opts = message as { domain?: string; identities?: unknown; liveEmails?: string[] };
      const result = await pickFreshestIdentity(
        opts.domain || '',
        (opts.identities || []) as Parameters<typeof pickFreshestIdentity>[1],
        opts.liveEmails || []
      );
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  getActiveAddressMeta: async (_message, sender, sendResponse) => {
    try {
      // Exact-host policy is part of the key: concurrent site previews must
      // never share a mailbox selected under another website's exclusions.
      // Invalidated on activeAddressId/addresses changes via the onChanged
      // listener - the user can switch addresses at any moment.
      const host = isExtensionSender(sender) ? '' : siteEmailHost(sender);
      const rejected = host ? await getSiteRejectedEmailDomains(host) : [];
      const result = await activeMetaCoalescer.run(JSON.stringify([host, rejected]), () =>
        getActiveAddressMeta(rejected)
      );
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  beginSignupAttempt: async (message, sender, sendResponse) => {
    try {
      const attempt = await beginSignupAttempt(
        requireString(message, 'credentialId'),
        signupCaller(sender)
      );
      sendResponse({ success: true, attempt });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  getSignupAttempt: async (_message, sender, sendResponse) => {
    try {
      sendResponse({ success: true, attempt: await getSignupAttempt(signupCaller(sender)) });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  reportSignupProgress: async (message, sender, sendResponse) => {
    try {
      const progress = requireString(message, 'progress');
      if (
        !['submitted', 'created', 'verification_pending', 'email_confirmed', 'failed'].includes(
          progress
        )
      ) {
        sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
        return;
      }
      sendResponse({
        success: await reportSignupProgress(
          requireString(message, 'attemptId'),
          progress as SignupProgress,
          signupCaller(sender)
        ),
      });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  openSignupVerificationLink: async (message, sender, sendResponse) => {
    try {
      if (!isExtensionSender(sender)) {
        sendResponse({ success: false, error: 'errors.permissionDenied' });
        return;
      }
      const addressId = typeof message.addressId === 'string' ? message.addressId : undefined;
      await openSignupVerificationLink(requireString(message, 'url'), addressId);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  getWizardSession: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      // Tab-scoped: a content script only ever sees ITS OWN tab's session.
      // The tab id is part of the coalesce key for the same reason - two tabs
      // on one domain must never share a session read. Writes invalidate the
      // retained entry for the exact session they rewrote (see the
      // upsert/advance/clear handlers).
      const tabId = sender.tab?.id;
      const result = await wizardSessionCoalescer.run({ domain, tabId }, () =>
        getWizardSession(domain, tabId)
      );
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  upsertWizardSession: async (message, sender, sendResponse) => {
    try {
      const partial = (message as { partial?: unknown }).partial;
      const scoped = {
        ...(partial as Record<string, unknown>),
        // Inject the owning tab so same-domain tabs don't overwrite each other.
        tabId: sender.tab?.id,
      } as Record<string, unknown>;
      const result = await upsertWizardSession(
        scoped as Partial<WizardSession> & { domain: string }
      );
      const scopedDomain = typeof scoped.domain === 'string' ? scoped.domain : '';
      wizardSessionCoalescer.invalidate({ domain: scopedDomain, tabId: sender.tab?.id });
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  advanceWizardStep: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      const step = requireString(message, 'step');
      const extra = (message as { extra?: unknown }).extra;
      const result = await advanceWizardStep(
        domain,
        step as WizardStep,
        extra as Partial<WizardSession>,
        sender.tab?.id
      );
      // Write-through: a getWizardSession for THIS tab must not share a
      // pre-write snapshot (e.g. the resume flow advancing to 'otp' then
      // re-reading for smartOtpAttach).
      wizardSessionCoalescer.invalidate({ domain, tabId: sender.tab?.id });
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  clearWizardSession: async (message, sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      await clearWizardSession(domain, sender.tab?.id);
      // Invalidate THIS tab's retained read; a tab-less clear hits every
      // session of the domain, so drop all retained reads outright.
      if (sender.tab?.id != null) {
        wizardSessionCoalescer.invalidate({ domain, tabId: sender.tab.id });
      } else {
        wizardSessionCoalescer.invalidateAll();
      }
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  recordSiteEmailDomainRejection: async (message, sender, sendResponse) => {
    try {
      const host = siteEmailHost(sender);
      const email = requireString(message, 'email');
      const text = requireString(message, 'text');
      if (!host || email.length > 512 || text.length > 600) {
        sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
        return;
      }
      // A page may report only an address owned by this extension. It cannot
      // poison exclusions for another host or for arbitrary third-party mail.
      const { addresses } = await browser.storage.local.get('addresses');
      if (
        !Array.isArray(addresses) ||
        !addresses.some(
          (item) =>
            typeof item?.address === 'string' && item.address.toLowerCase() === email.toLowerCase()
        )
      ) {
        sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
        return;
      }
      const recorded = await recordSiteEmailRejection(host, email, text);
      sendResponse({ success: recorded });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  clearSiteEmailDomainRejections: async (message, sender, sendResponse) => {
    try {
      if (!isExtensionSender(sender)) {
        sendResponse({ success: false, error: 'errors.storageAccessDenied' });
        return;
      }
      await clearSiteEmailRejections(requireString(message, 'domain'));
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  testConflictText: async (message, _sender, sendResponse) => {
    try {
      const text = requireString(message, 'text');
      const result = classifyConflictText(text);
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  resolveDomainFieldOverrides: async (message, _sender, sendResponse) => {
    try {
      const identity = (message as { identity?: unknown }).identity;
      const domain = requireString(message, 'domain');
      const result = resolveDomainFieldOverrides(
        identity as Parameters<typeof resolveDomainFieldOverrides>[0],
        domain
      );
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  getFieldMap: async (message, _sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      // Per-domain retained read; recordFieldMapHit (write-through, below) and
      // the onChanged listener for siteFieldMaps_v1 drop stale entries. Keyed
      // by the raw request domain - casing variants merely split keys (an
      // extra read), never share a wrong map, since getFieldMap normalizes.
      const result = await fieldMapCoalescer.run(domain, () => getFieldMap(domain));
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  recordFieldMapHit: async (message, _sender, sendResponse) => {
    try {
      const domain = requireString(message, 'domain');
      const kind = requireString(message, 'kind');
      const selector = requireString(message, 'selector');
      await recordFieldMapHitBySelector(domain, kind, selector);
      // Write-through: the hit just rewrote this domain's map.
      fieldMapCoalescer.invalidate(domain);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  setFieldMapCorrection: async (message, sender, sendResponse) => {
    try {
      const domain = normalizeDomain(requireString(message, 'domain'));
      const pageHost = normalizeDomain(new URL(sender.url || '').hostname);
      const kind = requireString(message, 'kind');
      const selector = requireString(message, 'selector');
      const allowedKinds = new Set([
        'email',
        'password',
        'username',
        'firstName',
        'lastName',
        'fullName',
        'phone',
        'website',
      ]);
      if (
        sender.id !== browser.runtime.id ||
        !sender.tab ||
        !pageHost ||
        pageHost !== domain ||
        !allowedKinds.has(kind) ||
        selector.length > 512
      ) {
        throw new Error('Invalid field map correction');
      }
      await setFieldMapCorrectionBySelector(
        domain,
        kind as import('@/features/intelligence/types.js').FormFieldKind,
        selector
      );
      fieldMapCoalescer.invalidate(domain);
      sendResponse({ success: true });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  matchKindFromText: async (message, _sender, sendResponse) => {
    try {
      const text = requireString(message, 'text');
      const result = await matchKindFromText(text);
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },
  classifyFieldFast: async (message, _sender, sendResponse) => {
    try {
      const text = requireString(message, 'text');
      const result = classifyFieldFast(text);
      sendResponse({ success: true, result });
    } catch (error: unknown) {
      sendResponse(errorPayload(error));
    }
  },

  /**
   * WebMCP tool dispatch - called by the webmcp-bridge content script on
   * behalf of the MAIN-world page script (webmcp-page.unlisted.ts).
   *
   * The page script CANNOT call chrome.* APIs, so every WebMCP tool invocation
   * lands here. The tool name + args are validated again in webmcp/tools.ts;
   * read-only tools are exposed via readOnlyHint and side-effecting ones
   * (create_temp_email) are rate-limited per tab.
   */
  webmcpTool: async (message, sender, sendResponse) => {
    try {
      // WebMCP is a page-facing protocol: every tool request must originate
      // from a content script on a real web page. Context-less senders
      // (popup/sidepanel/app-tab pages, background-internal calls) would
      // otherwise skip the per-site authorization (webmcpAccessList) AND the
      // per-tab rate limiting inside webmcp/tools.ts - deny them at the door.
      // The content bridge always runs on http(s) tabs, so tab.url is present.
      const tabId = sender.tab?.id;
      const tabUrl = sender.tab?.url;
      if (typeof tabId !== 'number' || typeof tabUrl !== 'string') {
        sendResponse({ success: false, error: 'WebMCP requires a page context' });
        return;
      }
      const { handleWebmcpTool } = await import('../webmcp/tools.js');
      const tool = String((message as { tool?: string }).tool || '');
      const args = (message as { args?: unknown }).args;
      const result = await handleWebmcpTool(tool, args, tabId, tabUrl);
      sendResponse(result);
    } catch (error: unknown) {
      // Deliberately NOT an `errors.*` code: this payload is forwarded by
      // webmcp-bridge.content.ts to the page's model context, i.e. it is read
      // by an agent, not rendered by the extension UI. The English detail is
      // the useful part there (webmcp/tools.ts follows the same rule), so only
      // the raw value is logged here.
      logError('webmcpTool dispatch failed:', error);
      sendResponse({ success: false, error: 'The extension could not complete this request.' });
    }
  },
};
export const HANDLER_KEYS = Object.keys(handlers);

/**
 * Handlers callable from content scripts (injected on web pages).
 * Extension pages may call any handler. When adding a handler, decide explicitly.
 */
export const CONTENT_SCRIPT_ALLOWED_HANDLERS = new Set<string>([
  // The requesting frame is derived from the browser sender; the message
  // carries no tab, frame, URL, or script path supplied by page code.
  'ensureContentRuntime',
  'createAddressWithGesture',
  'openExtensionUi',
  'flagReturnToForm',
  'updateSessionCredentials',
  'clearSessionCredentials',
  'getAddresses',
  'getProvider',
  'recordPageVisit',
  'recordEmailRead',
  'recordExtensionOpen',
  'translate',
  'saveLoginCredential',
  'updatePendingSignupUsername',
  'findSiteReplay',
  'copySiteLoginPassword',
  'findReusableIdentity',
  'getProviderDisplayName',
  'generateLocaleExtras',
  'generateLocaleAwarePhone',
  'getIconSvg',
  'recordAutofillSuccess',
  'recordAutofillFailure',
  'loadSmartAutofillSettings',
  'routeIdentityForDomain',
  'recordAutofillOutcome',
  'shouldPreferReplay',
  'pickFreshestIdentity',
  'getActiveAddressMeta',
  'beginSignupAttempt',
  'getSignupAttempt',
  'reportSignupProgress',
  'getWizardSession',
  'upsertWizardSession',
  'advanceWizardStep',
  'clearWizardSession',
  'testConflictText',
  'recordSiteEmailDomainRejection',
  'resolveDomainFieldOverrides',
  'getFieldMap',
  'recordFieldMapHit',
  'setFieldMapCorrection',
  'matchKindFromText',
  'classifyFieldFast',
  // Field-generation / form-badge / clipboard / crypto handlers - called by
  // content scripts through content-bg-bridge (generateIdentityViaBg,
  // formPresence badge pings, copyToClipboardViaBg, encryptViaBg, and the
  // storage-scoped decryptStoredCustomPasswordViaBg).
  // encryptData / decryptStoredCustomPassword are further gated by
  // assertCryptoOracleSender, which binds each request to the sender's page
  // domain (mirrors the saveLoginCredential / findSiteReplay / copySiteLoginPassword gates). The raw
  // text-carrying decryptData primitive was removed - the scoped decrypt
  // never accepts ciphertext in the message.
  'generateIdentityField',
  'formPresence',
  // Dev-only perf report: read-only ring-buffer dump, no sensitive payload.
  'getPerfReport',
  'copyToClipboard',
  'encryptData',
  'decryptStoredCustomPassword',
  'getStorageViaBg',
  'setStorageViaBg',
  'getSitePrivacySettings',
  'setSitePrivacySetting',
  'removeLatestOtp',
  'webmcpTool',
  // requestInboxCheck triggers the checkEmails fetch + store path but responds
  // with counts only (no message content) - safe for page-injected callers.
  'requestInboxCheck',
]);

export function resolveHandlerKey(message: Record<string, unknown>): string | undefined {
  const type = typeof message.type === 'string' ? message.type : undefined;
  if (type && Object.getOwnPropertyDescriptor(handlers, type)) return type;
  const action = typeof message.action === 'string' ? message.action : undefined;
  if (action && Object.getOwnPropertyDescriptor(handlers, action)) return action;
  return undefined;
}

/**
 * True only when `resetAt` is still the most recent hard reset. Used by the
 * `hardReset` auto-clear timer so a stale timer from an earlier reset can't
 * remove the `forceNewSessions` flag re-armed by a newer reset (the newer
 * reset's own timer is the only one that may clear it).
 */
export async function isLatestHardReset(resetAt: number): Promise<boolean> {
  const { lastHardReset } = (await browser.storage.local.get('lastHardReset')) as {
    lastHardReset?: number;
  };
  return lastHardReset === resetAt;
}

export function registerMessageHandler(): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: RuntimeMessageSender, sendResponse: (response: unknown) => void) => {
      if (sender.id !== browser.runtime.id) {
        logWarn('Rejected message from unauthorized sender:', { senderId: sender.id });
        return false;
      }

      if (typeof message !== 'object' || message === null) return false;
      const runtimeMessage = message as RuntimeMessage;
      // Blank secret-bearing payload fields before logging (see the helper for
      // why the logger's own key redaction is not sufficient here).
      logInfo('Received message:', { message: redactMessageForLog(runtimeMessage) });
      if (isExtensionSender(sender)) {
        void withLock(LOCKS.VAULT_ACTIVITY, async () => {
          await browser.storage.session.set({ _last_vault_activity: Date.now() });
        }).catch((error: unknown) =>
          logError('Failed to record runtime-message vault activity', error)
        );
      }

      const handlerKey = resolveHandlerKey(runtimeMessage as Record<string, unknown>);
      if (handlerKey) {
        // SECURITY: Allowlist model - ONLY the handlers listed below are
        // callable from content scripts (injected on web pages). ALL other
        // handlers require the message to originate from an extension page
        // (popup, sidepanel, app tab - i.e. a chrome-extension:// URL).
        //
        // RATIONALE: The old blocklist (hardReset + updateRefreshInterval) left
        // deleteAddress, createAddress, saveLoginCredential, resetAnalytics, etc.
        // callable from content scripts, which run on every web page.
        //
        // When adding a new handler, explicitly decide whether it belongs in
        // this allowlist. If in doubt, do NOT add it - extension-page-only is
        // the safe default.
        const isExtensionContext = isExtensionSender(sender);

        if (!isExtensionContext && !CONTENT_SCRIPT_ALLOWED_HANDLERS.has(handlerKey)) {
          logWarn('Blocked restricted message call from content script:', {
            handlerKey,
            senderUrl: sender.url || '',
          });
          sendResponse({ success: false, error: 'errors.permissionDenied' });
          return true;
        }
        // ResolveHandlerKey already proved membership - the narrowed member
        // type is recovered by casting the handler to the general HandlerFn.
        const handler = handlers[handlerKey as keyof typeof handlers] as HandlerFn | undefined;
        handler?.(runtimeMessage, sender, sendResponse);
        return true;
      }

      const unknownMsg = message as { type?: unknown; action?: unknown };
      logWarn('Unknown message type', {
        type: typeof unknownMsg.type === 'string' ? unknownMsg.type : undefined,
        action: typeof unknownMsg.action === 'string' ? unknownMsg.action : undefined,
      });
      sendResponse({ success: false, error: 'errors.invalidRequestFormat' });
      return false;
    }
  );

  browser.commands.onCommand.addListener(async (command: string) => {
    if (command === 'autofill-form') {
      try {
        const { autofillActiveTab } = await import('../tab-autofill.js');
        await autofillActiveTab();
      } catch (error: unknown) {
        logError(
          'Error executing autofill command:',
          undefined,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  });
}
