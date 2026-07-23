/**
 * Local site memory — outcomes & profiles without becoming a password vault.
 * Passwords stay only in encrypted loginInfo; this stores routing metadata.
 */

import { uniqueFieldKinds } from './form-score.js';
import { rememberIdentityForDomain } from './identity-router.js';
import { recordInboxAutofill } from './inbox-lifecycle.js';
import { getSiteProfile, normalizeDomain, saveSiteProfile } from './storage.js';
import type { FormFieldKind, FormScore, SiteProfile } from './types.js';

export async function recordAutofillOutcome(opts: {
  domain: string;
  success: boolean;
  identityId?: string | null;
  inboxId?: string | null;
  email?: string | null;
  formScore?: FormScore | null;
  policyUrls?: string[];
  usedReplay?: boolean;
}): Promise<void> {
  const domain = normalizeDomain(opts.domain);
  if (!domain) return;

  const prev = (await getSiteProfile(domain)) || {
    domain,
    successCount: 0,
    failureCount: 0,
    fieldKindsSeen: [] as FormFieldKind[],
    preferredMode: 'auto' as const,
    updatedAt: Date.now(),
  };

  const kinds = opts.formScore ? uniqueFieldKinds(opts.formScore) : prev.fieldKindsSeen;

  const next: SiteProfile = {
    ...prev,
    domain,
    lastIdentityId: opts.identityId || prev.lastIdentityId,
    lastInboxId: opts.inboxId || prev.lastInboxId,
    lastEmail: opts.email || prev.lastEmail,
    successCount: prev.successCount + (opts.success ? 1 : 0),
    failureCount: prev.failureCount + (opts.success ? 0 : 1),
    fieldKindsSeen: [...new Set([...prev.fieldKindsSeen, ...kinds])],
    preferredMode: opts.usedReplay
      ? 'replay'
      : opts.success
        ? prev.preferredMode === 'replay'
          ? 'replay'
          : 'auto'
        : prev.preferredMode,
    policyUrls: opts.policyUrls?.length
      ? [...new Set([...(prev.policyUrls || []), ...opts.policyUrls])].slice(0, 12)
      : prev.policyUrls,
    lastSignupLikelihood: opts.formScore?.signupLikelihood ?? prev.lastSignupLikelihood,
    lastSuccessAt: opts.success ? Date.now() : prev.lastSuccessAt,
    lastFailureAt: opts.success ? prev.lastFailureAt : Date.now(),
    updatedAt: Date.now(),
  };

  await saveSiteProfile(next);

  if (opts.success && opts.identityId) {
    await rememberIdentityForDomain(domain, opts.identityId);
  }
  if (opts.success && opts.inboxId && opts.email) {
    await recordInboxAutofill(opts.inboxId, opts.email, domain);
  }
  // Site rules: schedule auto-archive after N days when configured
  if (opts.success && opts.inboxId) {
    try {
      const { scheduleArchiveFromRule } = await import('./site-rules.js');
      await scheduleArchiveFromRule(domain, opts.inboxId);
    } catch {
      /* optional */
    }
  }
}

/** Whether site memory prefers offering replay when credential exists. */
export async function shouldPreferReplay(domain: string): Promise<boolean> {
  const p = await getSiteProfile(domain);
  if (!p) return true; // default: offer replay when available
  if (p.preferredMode === 'generate') return false;
  if (p.preferredMode === 'replay') return true;
  // auto: prefer replay if it worked before more often
  return p.successCount >= p.failureCount;
}
