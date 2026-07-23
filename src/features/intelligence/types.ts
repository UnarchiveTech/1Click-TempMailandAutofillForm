/**
 * Intelligence layer types — local memory only (not a password vault).
 * Site profiles, provider health, inbox lifecycle, notification policy.
 */

export type FormFieldKind =
  | 'email'
  | 'password'
  | 'username'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'phone'
  | 'website'
  | 'dob'
  | 'gender'
  | 'country'
  | 'city'
  | 'state'
  | 'address'
  | 'pin'
  | 'profilePicture'
  | 'terms'
  | 'unknown';

/** Scored field on a form (content-script FormScore pipeline). */
export interface ScoredField {
  kind: FormFieldKind;
  confidence: number; // 0–1
  /** CSS selector or rough path for debugging only */
  hint?: string;
}

export interface FormScore {
  domain: string;
  fields: ScoredField[];
  /** Overall “this looks like a signup form” 0–1 */
  signupLikelihood: number;
  hasEmail: boolean;
  hasPassword: boolean;
  hasTerms: boolean;
  scoredAt: number;
}

/** Per-domain memory of what worked (no passwords stored here). */
export interface SiteProfile {
  domain: string;
  lastIdentityId?: string;
  lastInboxId?: string;
  lastEmail?: string;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  successCount: number;
  failureCount: number;
  /** Field kinds that successfully filled on this domain */
  fieldKindsSeen: FormFieldKind[];
  /** Prefer replay when reusable credential exists */
  preferredMode: 'replay' | 'generate' | 'auto';
  policyUrls?: string[];
  /** Last FormScore snapshot (compact) */
  lastSignupLikelihood?: number;
  updatedAt: number;
}

export interface ProviderHealth {
  providerId: string;
  createAttempts: number;
  createSuccesses: number;
  fetchAttempts: number;
  fetchSuccesses: number;
  /** Rolling latency samples (ms), capped */
  createLatencyMs: number[];
  fetchLatencyMs: number[];
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastError?: string;
  updatedAt: number;
}

export interface InboxLifecycleStats {
  inboxId: string;
  address: string;
  /** Domains this address was used on (autofill / logins) */
  sitesUsed: string[];
  otpCount: number;
  magicLinkCount: number;
  autofillCount: number;
  lastActivityAt: number;
  /** 0–100 higher = more valuable / keep longer */
  valueScore: number;
  updatedAt: number;
}

export type LifecycleSuggestionKind =
  | 'renew_high_value'
  | 'archive_idle'
  | 'create_fresh_for_risk'
  | 'ok';

export interface LifecycleSuggestion {
  kind: LifecycleSuggestionKind;
  inboxId: string;
  address: string;
  reasonKey: string;
  score: number;
}

export interface NotificationIntelligenceSettings {
  /** Only notify for OTP / magic-link mail (skip plain newsletters) */
  otpAndMagicOnly: boolean;
  quietHoursEnabled: boolean;
  /** Local hour 0–23 */
  quietHoursStart: number;
  quietHoursEnd: number;
  /** Sender domains to never notify for */
  mutedSenderDomains: string[];
  /** Bundle multiple notifications into one digest when possible */
  groupDigest: boolean;
}

export const DEFAULT_NOTIFICATION_INTELLIGENCE: NotificationIntelligenceSettings = {
  otpAndMagicOnly: false,
  quietHoursEnabled: false,
  quietHoursStart: 22,
  quietHoursEnd: 8,
  mutedSenderDomains: [],
  groupDigest: true,
};

export interface IdentityRouteResult {
  identityId: string | null;
  reason: 'sticky' | 'domain_hint' | 'selected' | 'default' | 'none';
}

export interface AutofillPlan {
  domain: string;
  formScore: FormScore;
  identityId: string | null;
  identityReason: IdentityRouteResult['reason'];
  useReplay: boolean;
  mode: 'replay' | 'generate';
}

/** Caps for storage hygiene */
export const INTELLIGENCE_CAPS = {
  maxSiteProfiles: 80,
  maxLatencySamples: 12,
  maxSitesPerInbox: 40,
  maxProviderEntries: 40,
} as const;
