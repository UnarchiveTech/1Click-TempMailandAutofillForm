/**
 * Lightweight background messaging bridge for content scripts.
 *
 * Provides thin wrappers around `browser.runtime.sendMessage` for operations
 * that have been offloaded to the background script (crypto, identity
 * generation, clipboard) - keeping heavy modules like `crypto.ts` (~18 KB)
 * and `clipboard.ts` out of the content-script bundle.
 *
 * Extension-context invalidation: when the extension is reloaded, updated or
 * disabled while a tab stays open, its content scripts keep running but every
 * `chrome.*` call starts failing. `browser.runtime.sendMessage` then throws
 * SYNCHRONOUSLY (before a promise exists), so a `.catch()` on the returned
 * promise never runs - fire-and-forget call sites turned that into
 * "Uncaught (in promise) Error: Extension context invalidated." on the host
 * page on every form-watch tick / SPA navigation. Every wrapper therefore
 * sends through `safeSendCall`, which catches the sync throw, flags the dead
 * context once, and afterwards degrades every call to a silent no-op (the
 * script's own teardown cannot recover it - a reload of the tab re-injects a
 * fresh script).
 *
 * The literal `{ type: ... }` payload stays AT each call site (inside the
 * thunk) rather than being funneled through a generic `send(message)`
 * parameter: scripts/check-message-types.ts statically verifies the
 * discriminant and fields of every runtime send, and a generic sink would be
 * unresolvable to it.
 */

import { browser } from 'wxt/browser';
import { detectSignupWizardStep } from '@/features/intelligence/signup-page.js';
import type { SignupAttemptRef, SignupProgress } from '@/features/intelligence/signup-state.js';
import type { FormFieldKind } from '@/features/intelligence/types.js';
import { allowsSiteEmail } from '@/utils/provider/site-email-domains.js';
import type { SitePrivacyFeature, SitePrivacySettings } from './site-privacy-settings.js';

const SITE_PRIVACY_CACHE_TTL_MS = 30_000;
let sitePrivacyCache: SitePrivacySettings | null = null;
let sitePrivacyCacheAt = 0;
let sitePrivacyRequest: Promise<SitePrivacySettings | null> | null = null;
let sitePrivacyCacheGeneration = 0;

export function invalidateSitePrivacySettingsCache(): void {
  sitePrivacyCacheGeneration += 1;
  sitePrivacyCache = null;
  sitePrivacyCacheAt = 0;
  sitePrivacyRequest = null;
}

import { logError } from '@/utils/logger.js';
import {
  PERF_ENABLED,
  perfMark,
  setPerfPageLabel,
  trackBgMessage,
} from '@/utils/perf/perf-marks.js';

/**
 * True once the extension context has been invalidated (extension
 * reloaded/updated/disabled) while this content script stayed alive. Every
 * bridge call becomes a silent no-op afterwards instead of throwing or
 * rejecting - the script's periodic loops would otherwise surface the error
 * on the host page indefinitely.
 */
let contextInvalidated = false;

/** True when the extension context is no longer usable. */
export function isExtensionContextInvalidated(): boolean {
  return contextInvalidated;
}

/**
 * Dev-only: keep the report's page label honest across bfcache restores.
 * Content-script module state (these counters) survives a back/forward-cache
 * restore - the counters then belong to a NEW page instance, so the label
 * gains a load# suffix and the ring gets a point mark. Normal navigation
 * re-runs the script in a fresh document with fresh module state, so nothing
 * is needed there. No-op outside content scripts and in production.
 */
function installPageLoadLabelListener(): void {
  if (!PERF_ENABLED || typeof window === 'undefined' || typeof location === 'undefined') return;
  pageLabel = location.origin;
  setPerfPageLabel(pageLabel);
  window.addEventListener('pageshow', (event) => {
    if (!(event instanceof PageTransitionEvent) || !event.persisted) return;
    perfMark('content.pageRestore');
    setPerfPageLabel(`${pageLabel} · load#${++cacheFlushPageLoads}`);
  });
}

/** Dev-only monotonic count of bfcache-restored page instances. */
let cacheFlushPageLoads = 0;

/** Dev-only page label captured at startup (origin), extended on restores. */
let pageLabel = '';
installPageLoadLabelListener();

/** Test-only: reset the invalidation flag between tests. */
export function resetContentBridgeForTests(): void {
  contextInvalidated = false;
  cacheFlushPageLoads = 0;
}

/**
 * Detect a dead-extension-context error. Deliberately narrow: transient
 * failures ("Receiving end does not exist", a sleeping MV3 service worker)
 * must NOT permanently disable the bridge, only genuine invalidation.
 */
function isContextInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /extension context.{0,20}invalidat/i.test(message);
}

/**
 * Classify a send failure. Genuine invalidation flags the context; the
 * background update lifecycle surfaces the reload requirement in the
 * extension UI. Other failures keep the previous `.catch(logError)` behavior.
 * Both paths resolve to `undefined`, the same shape as any other failure.
 */
function handleSendFailure(error: unknown): undefined {
  if (isContextInvalidatedError(error)) {
    contextInvalidated = true;
    // The affected tab's toolbar badge and mailbox notice are recorded by the
    // background on extension update. Avoid a console warning here: this
    // expected, handled lifecycle state belongs in the extension UI, not the
    // host page's console or the browser's Extensions Errors page.
    return undefined;
  }
  logError('Content→background send failed', error);
  return undefined;
}

/**
 * Perform a runtime send without ever throwing or rejecting.
 *
 * The message is passed as a THUNK so the `browser.runtime.sendMessage`
 * call expression itself stays at the wrapper's call site (visible to
 * scripts/check-message-types.ts) while the synchronous throw of an
 * invalidated context - which a `.catch()` on the promise would never see -
 * is caught here. Once invalidated, later calls skip the browser API
 * entirely, so the periodic loops that outlive the extension can never
 * produce an error - unhandled or otherwise.
 */
async function safeSendCall(type: string, send: () => Promise<unknown>): Promise<unknown> {
  if (contextInvalidated) return undefined;
  let pending: Promise<unknown>;
  try {
    pending = send();
  } catch (error: unknown) {
    // A synchronous throw is the extension-context-invalidation signature -
    // a page-load event (context death), not a message the worker received.
    perfMark('content.bgContextDied');
    return handleSendFailure(error);
  }
  // Dev-only page-load accounting: counted only after the message was actually
  // dispatched - a sync throw above means the worker never received anything
  // (that death is recorded as a content.bgContextDied mark instead), and the
  // invalidated-context early return above skips the funnel entirely.
  trackBgMessage(type);
  try {
    return await pending;
  } catch (error: unknown) {
    return handleSendFailure(error);
  }
}

/**
 * Page-domain claim for the crypto handlers. encryptData and
 * decryptStoredCustomPassword are gated in the background by
 * assertCryptoOracleSender: extension pages pass via isExtensionSender, and
 * content scripts must claim the hostname of the page they are actually
 * injected on (verified against sender.tab.url). Falls back to '' in
 * non-DOM contexts (service worker) where the gate's extension-page branch
 * applies anyway.
 */
function cryptoDomainClaim(): string {
  return typeof location !== 'undefined' ? location.hostname : '';
}

/** Encrypt text via background. */
export async function encryptViaBg(text: string): Promise<string> {
  const resp = (await safeSendCall('encryptData', () =>
    browser.runtime.sendMessage({
      type: 'encryptData',
      text,
      domain: cryptoDomainClaim(),
    })
  )) as { success: true; encrypted: string } | undefined;
  return resp?.encrypted ?? '';
}

/**
 * Decrypt one of the extension's stored custom passwords via background.
 *
 * Storage-scoped by design: the message names the value by source and NEVER
 * carries ciphertext - the background loads it from extension storage itself.
 * This replaced the old text-carrying decryptData primitive (the fill flows
 * previously forwarded stored ciphertext through the page context). Throws on
 * failure so content can run its own fallbacks (legacy plaintext, vault-locked
 * chip) - the old bridge silently returned ''. After context invalidation the
 * underlying send resolves `undefined`, which surfaces through this same
 * throw-and-fallback path.
 */
export async function decryptStoredCustomPasswordViaBg(
  source: 'passwordSettings' | 'identity',
  identityId?: string
): Promise<string> {
  const resp = (await safeSendCall('decryptStoredCustomPassword', () =>
    browser.runtime.sendMessage({
      type: 'decryptStoredCustomPassword',
      source,
      identityId,
      domain: cryptoDomainClaim(),
    })
  )) as { success: true; decrypted: string; error?: unknown } | undefined;
  if (resp?.success) {
    return resp.decrypted as string;
  }
  throw new Error(
    typeof resp?.error === 'string' && resp.error ? resp.error : 'Custom password decryption failed'
  );
}

/** Generate a random identity field via background. */
export async function generateIdentityViaBg(fieldType: string): Promise<string> {
  const resp = (await safeSendCall('generateIdentityField', () =>
    browser.runtime.sendMessage({ type: 'generateIdentityField', fieldType })
  )) as { success: true; value: string } | undefined;
  return resp?.value ?? '';
}

/** Copy text to clipboard via background with optional auto-purge. */
export async function copyToClipboardViaBg(text: string, purgeAfterMs?: number): Promise<void> {
  await safeSendCall('copyToClipboard', () =>
    browser.runtime.sendMessage({ type: 'copyToClipboard', text, purgeAfterMs })
  );
}

/** Copy a matching saved login password without exposing it in another content message. */
export async function copySiteCredentialPasswordViaBg(
  domain: string,
  email: string,
  addressId?: string
): Promise<boolean> {
  const response = (await safeSendCall('copySiteLoginPassword', () =>
    browser.runtime.sendMessage({ type: 'copySiteLoginPassword', domain, email, addressId })
  )) as { success?: boolean } | undefined;
  return response?.success === true;
}

/** Generate locale-aware address extras (country, city, pin, dob) via background. */
export async function generateLocaleExtrasViaBg(locale?: string): Promise<{
  country: string;
  city: string;
  pin: string;
  dob: string;
} | null> {
  const resp = (await safeSendCall('generateLocaleExtras', () =>
    browser.runtime.sendMessage({ type: 'generateLocaleExtras', locale })
  )) as { success: true; country: string; city: string; pin: string; dob: string } | undefined;
  if (resp?.success)
    return { country: resp.country, city: resp.city, pin: resp.pin, dob: resp.dob };
  return null;
}

/** Generate a locale-aware phone number via background. */
export async function generateLocalePhoneViaBg(locale?: string): Promise<string> {
  const resp = (await safeSendCall('generateLocaleAwarePhone', () =>
    browser.runtime.sendMessage({ type: 'generateLocaleAwarePhone', locale })
  )) as { success: true; phone: string } | undefined;
  return resp?.success ? resp.phone : '';
}

/** Get an icon SVG via background (keeps icon-svg.ts out of content bundle). */
export async function getIconSvgViaBg(
  name: string,
  opts?: { size?: number; color?: string }
): Promise<string> {
  const resp = (await safeSendCall('getIconSvg', () =>
    browser.runtime.sendMessage({ type: 'getIconSvg', name, ...opts })
  )) as { success: true; svg: string } | undefined;
  if (resp?.success) return resp.svg as string;
  return '';
}

/** Record a successful autofill via background (offloads blocklist-learn.ts). */
export async function recordAutofillSuccessViaBg(domain: string): Promise<void> {
  await safeSendCall('recordAutofillSuccess', () =>
    browser.runtime.sendMessage({ type: 'recordAutofillSuccess', domain })
  );
}

/** Record a failed autofill via background; returns failure tracking info. */
export async function recordAutofillFailureViaBg(domain: string): Promise<{
  count: number;
  shouldSuggestBlock: boolean;
} | null> {
  const resp = (await safeSendCall('recordAutofillFailure', () =>
    browser.runtime.sendMessage({ type: 'recordAutofillFailure', domain })
  )) as { success: true; result: { count: number; shouldSuggestBlock: boolean } } | undefined;
  return resp?.success ? resp.result : null;
}

/** Load smart autofill settings via background (offloads smart-settings.ts + storage.ts). */
export async function loadSmartAutofillSettingsViaBg(): Promise<unknown | null> {
  const resp = (await safeSendCall('loadSmartAutofillSettings', () =>
    browser.runtime.sendMessage({ type: 'loadSmartAutofillSettings' })
  )) as { success: true; settings: unknown } | undefined;
  return resp?.success ? resp.settings : null;
}

/** Route identity for a domain via background (offloads identity-router.ts + storage.ts). */
export async function routeIdentityForDomainViaBg(
  domain: string,
  identities?: unknown,
  selectedIdentityId?: string | null
): Promise<unknown | null> {
  const resp = (await safeSendCall('routeIdentityForDomain', () =>
    browser.runtime.sendMessage({
      type: 'routeIdentityForDomain',
      domain,
      identities,
      selectedIdentityId,
    })
  )) as { success: true; result: unknown } | undefined;
  return resp?.success ? resp.result : null;
}

/** Record an autofill outcome via background (offloads site-memory.ts). */
export async function recordAutofillOutcomeViaBg(opts: {
  domain: string;
  success: boolean;
  identityId?: string | null;
  addressId?: string | null;
  email?: string | null;
  formScore?: unknown;
  policyUrls?: string[];
  usedReplay?: boolean;
}): Promise<void> {
  await safeSendCall('recordAutofillOutcome', () =>
    browser.runtime.sendMessage({ type: 'recordAutofillOutcome', opts })
  );
}

/** Check if replay should be preferred for a domain via background. */
export async function shouldPreferReplayViaBg(domain: string): Promise<boolean> {
  const resp = (await safeSendCall('shouldPreferReplay', () =>
    browser.runtime.sendMessage({ type: 'shouldPreferReplay', domain })
  )) as { success: true; result: boolean } | undefined;
  return resp?.success ? resp.result : false;
}

/** Pick the freshest identity for signup via background (offloads freshness.ts). */
export async function pickFreshestIdentityViaBg(
  domain: string,
  identities?: unknown,
  liveEmails?: string[]
): Promise<unknown | null> {
  const resp = (await safeSendCall('pickFreshestIdentity', () =>
    browser.runtime.sendMessage({ type: 'pickFreshestIdentity', domain, identities, liveEmails })
  )) as { success: true; result: unknown } | undefined;
  return resp?.success ? resp.result : null;
}

/** Get active inbox metadata via background (offloads autofill-plan.ts). */
export async function getActiveAddressMetaViaBg(forSignup = false): Promise<{
  addressId: string | null;
  address: string | null;
  provider: string | null;
  providerDisplay: string | null;
} | null> {
  const resp = (await safeSendCall('getActiveAddressMeta', () =>
    browser.runtime.sendMessage({ type: 'getActiveAddressMeta', forSignup })
  )) as
    | {
        success: true;
        result: {
          addressId: string | null;
          address: string | null;
          provider: string | null;
          providerDisplay: string | null;
        };
      }
    | undefined;
  return resp?.success ? resp.result : null;
}

/** Begin an exact-account signup attempt; all persistence belongs to background. */
export async function beginSignupAttemptViaBg(
  credentialId: string
): Promise<SignupAttemptRef | null> {
  const resp = (await safeSendCall('beginSignupAttempt', () =>
    browser.runtime.sendMessage({ type: 'beginSignupAttempt', credentialId })
  )) as { success?: boolean; attempt?: SignupAttemptRef } | undefined;
  return resp?.success ? (resp.attempt ?? null) : null;
}

export async function getSignupAttemptViaBg(): Promise<SignupAttemptRef | null> {
  const resp = (await safeSendCall('getSignupAttempt', () =>
    browser.runtime.sendMessage({ type: 'getSignupAttempt' })
  )) as { success?: boolean; attempt?: SignupAttemptRef } | undefined;
  return resp?.success ? (resp.attempt ?? null) : null;
}

export async function reportSignupProgressViaBg(
  attemptId: string,
  progress: SignupProgress
): Promise<boolean> {
  const resp = (await safeSendCall('reportSignupProgress', () =>
    browser.runtime.sendMessage({ type: 'reportSignupProgress', attemptId, progress })
  )) as { success?: boolean } | undefined;
  return resp?.success === true;
}

/** Get wizard session for a domain via background (offloads wizard-session.ts storage). */
export async function getWizardSessionViaBg(domain: string): Promise<unknown | null> {
  const resp = (await safeSendCall('getWizardSession', () =>
    browser.runtime.sendMessage({ type: 'getWizardSession', domain })
  )) as { success: true; result: unknown } | undefined;
  return resp?.success ? resp.result : null;
}

/** Upsert a wizard session via background (offloads wizard-session.ts storage). */
export async function upsertWizardSessionViaBg(
  partial: Record<string, unknown> & { domain: string }
): Promise<unknown | null> {
  const resp = (await safeSendCall('upsertWizardSession', () =>
    browser.runtime.sendMessage({ type: 'upsertWizardSession', partial })
  )) as { success: true; result: unknown } | undefined;
  return resp?.success ? resp.result : null;
}

/** Advance wizard step via background (offloads wizard-session.ts storage). */
export async function advanceWizardStepViaBg(
  domain: string,
  step: string,
  extra?: Record<string, unknown>
): Promise<void> {
  await safeSendCall('advanceWizardStep', () =>
    browser.runtime.sendMessage({ type: 'advanceWizardStep', domain, step, extra })
  );
}

/** Clear wizard session via background (offloads wizard-session.ts storage). */
export async function clearWizardSessionViaBg(domain: string): Promise<void> {
  await safeSendCall('clearWizardSession', () =>
    browser.runtime.sendMessage({ type: 'clearWizardSession', domain })
  );
}

/** Detect wizard step from current page (must run in content script - needs DOM). */
export function detectWizardStepFromPage(): 'form' | 'otp' | 'profile' | 'done' {
  return detectSignupWizardStep();
}

/** Resolve domain field overrides via background (offloads domain-field-overrides.ts + JSONC config). */
export async function resolveDomainFieldOverridesViaBg(
  identity: unknown,
  domain: string
): Promise<Record<string, unknown>> {
  const resp = (await safeSendCall('resolveDomainFieldOverrides', () =>
    browser.runtime.sendMessage({ type: 'resolveDomainFieldOverrides', identity, domain })
  )) as { success: true; result: Record<string, unknown> } | undefined;
  return resp?.success ? resp.result : {};
}

// Shared with the field-map layer through the dependency-free leaf module, so
// the two copies cannot drift while neither graph pulls the other's imports.
export { buildSelectorHint } from '@/utils/dom/selector-hint.js';

/** Get a field map for a domain via background (offloads field-maps.ts storage). */
export async function getFieldMapViaBg(domain: string): Promise<unknown | null> {
  const resp = (await safeSendCall('getFieldMap', () =>
    browser.runtime.sendMessage({ type: 'getFieldMap', domain })
  )) as { success: true; result: unknown } | undefined;
  return resp?.success ? resp.result : null;
}

/** Record a field map hit via background (offloads field-maps.ts storage). */
export async function recordFieldMapHitViaBg(
  domain: string,
  kind: string,
  selector: string
): Promise<void> {
  await safeSendCall('recordFieldMapHit', () =>
    browser.runtime.sendMessage({ type: 'recordFieldMapHit', domain, kind, selector })
  );
}

/** Persist a user-corrected site selector via the background. */
export async function setFieldMapCorrectionViaBg(
  domain: string,
  kind: FormFieldKind,
  selector: string
): Promise<void> {
  await safeSendCall('setFieldMapCorrection', () =>
    browser.runtime.sendMessage({ type: 'setFieldMapCorrection', domain, kind, selector })
  );
}

/** Test text against multilingual conflict regexes via background.
 * Offloads the ~64K of multilingual regex patterns from conflict-watch.ts. */
export async function testConflictTextViaBg(
  text: string
): Promise<'email' | 'username' | 'otp' | null> {
  const resp = (await safeSendCall('testConflictText', () =>
    browser.runtime.sendMessage({ type: 'testConflictText', text })
  )) as { success: true; result: 'email' | 'username' | 'otp' | null } | undefined;
  return resp?.success ? resp.result : null;
}

/** Classify field text with the worker's local label matcher. */
export async function matchKindFromTextViaBg(
  text: string
): Promise<{ kind: FormFieldKind; confidence: number } | null> {
  const resp = (await safeSendCall('matchKindFromText', () =>
    browser.runtime.sendMessage({ type: 'matchKindFromText', text })
  )) as { success: true; result: { kind: FormFieldKind; confidence: number } | null } | undefined;
  return resp?.success ? resp.result : null;
}

/** Classify field metadata text via background - offloads ~900 bytes of
 * multilingual regex patterns from findUsernameField in form-filler.ts. */
export async function classifyFieldFastViaBg(text: string): Promise<{
  isUsername: boolean;
  isEmailish: boolean;
}> {
  const resp = (await safeSendCall('classifyFieldFast', () =>
    browser.runtime.sendMessage({ type: 'classifyFieldFast', text })
  )) as { success: true; result: { isUsername: boolean; isEmailish: boolean } } | undefined;
  return resp?.success ? resp.result : { isUsername: false, isEmailish: false };
}

/** Create a fresh inbox address via background (offloads browser.storage + runtime). */
export async function createFreshAddressViaBg(): Promise<string | null> {
  const resp = (await safeSendCall('createAddressWithGesture', () =>
    browser.runtime.sendMessage({ type: 'createAddressWithGesture' })
  )) as { success: true; address?: string; inbox?: { address?: string } } | undefined;
  return resp?.success ? resp.inbox?.address || resp.address || null : null;
}

/**
 * Generic runtime message bridge (offloads browser.runtime from content
 * scripts). Never rejects: failures - including a dead extension context -
 * resolve to `undefined`, so fire-and-forget callers (`void sendMessageViaBg`)
 * and periodic loops cannot produce unhandled rejections on the host page.
 */
export async function sendMessageViaBg<T = unknown>(
  message: Record<string, unknown>
): Promise<T | undefined> {
  // Generic passthrough: the payload's `type` literal is verified at the
  // CALLER's site (every caller passes an object literal - enforced by
  // scripts/check-message-types.ts), so this sink has nothing to re-check.
  // The counter labels the send with the caller-supplied discriminant.
  const sinkType = typeof message.type === 'string' ? message.type : 'unknown';
  return (await safeSendCall(sinkType, () => browser.runtime.sendMessage(message))) as
    | T
    | undefined;
}

/** Re-read at the moment of filling: an open chooser can outlive a newly learned ban. */
export async function isSiteEmailAllowedViaBg(email: string): Promise<boolean> {
  const data = await getStorageViaBg(['addresses'], true);
  if (!Array.isArray(data.addresses)) return false;
  const rejected = Array.isArray(data.siteRejectedEmailDomains)
    ? data.siteRejectedEmailDomains.filter((value): value is string => typeof value === 'string')
    : [];
  return allowsSiteEmail(email, rejected);
}

/** Get storage values via background (offloads browser.storage from content). */
export async function getStorageViaBg(
  keys: string | string[],
  forSignup = false
): Promise<Record<string, unknown>> {
  const resp = (await safeSendCall('getStorageViaBg', () =>
    browser.runtime.sendMessage({ type: 'getStorageViaBg', keys, forSignup })
  )) as { success: true; data?: Record<string, unknown> } | undefined;
  return resp?.data || {};
}

/** Read privacy settings for the sender tab's own hostname. */
export async function getSitePrivacySettingsViaBg(): Promise<SitePrivacySettings | null> {
  if (sitePrivacyCache && Date.now() - sitePrivacyCacheAt < SITE_PRIVACY_CACHE_TTL_MS) {
    return sitePrivacyCache;
  }
  if (sitePrivacyRequest) return sitePrivacyRequest;
  const generation = sitePrivacyCacheGeneration;
  const request = (async () => {
    const response = (await safeSendCall('getSitePrivacySettings', () =>
      browser.runtime.sendMessage({ type: 'getSitePrivacySettings' })
    )) as { success?: boolean; settings?: SitePrivacySettings } | undefined;
    if (!response?.success || !response.settings) return null;
    if (generation === sitePrivacyCacheGeneration) {
      sitePrivacyCache = response.settings;
      sitePrivacyCacheAt = Date.now();
    }
    return response.settings;
  })();
  sitePrivacyRequest = request;
  try {
    return await request;
  } finally {
    if (sitePrivacyRequest === request) sitePrivacyRequest = null;
  }
}

/** Update one privacy control for the sender tab's own hostname. */
export async function setSitePrivacySettingViaBg(
  feature: SitePrivacyFeature,
  enabled: boolean
): Promise<boolean> {
  const response = (await safeSendCall('setSitePrivacySetting', () =>
    browser.runtime.sendMessage({ type: 'setSitePrivacySetting', feature, enabled })
  )) as { success?: boolean } | undefined;
  invalidateSitePrivacySettingsCache();
  return response?.success === true;
}

/** Set storage values via background (offloads browser.storage from content). */
export async function setStorageViaBg(items: Record<string, unknown>): Promise<void> {
  await safeSendCall('setStorageViaBg', () =>
    browser.runtime.sendMessage({ type: 'setStorageViaBg', items })
  );
}

/**
 * Consume the cached `latestOtp` (offloads browser.storage.remove from content).
 * Used after a wait-OTP panel applies a code so a stale code is never reused
 * by a later panel or re-open.
 */
export async function consumeLatestOtpViaBg(otp: string, recipient: string): Promise<void> {
  await safeSendCall('removeLatestOtp', () =>
    browser.runtime.sendMessage({ type: 'removeLatestOtp', otp, recipient })
  );
}
