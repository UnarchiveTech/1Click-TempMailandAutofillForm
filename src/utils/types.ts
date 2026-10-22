/**
 * Shared type definitions for the 1Click: Temp Mail with Autofill extension.
 * Single source of truth - import from here in all entrypoints.
 */
import type { ActivityViewId } from '@/features/types/view-types.js';

export type MailProvider = string;

// ---- API Response Types ----

// Generic API response - provider-specific structures are in JSON configs

// ---- Storage Data Structures ----

export interface StoredEmails {
  [address: string]: Email[];
}

export interface ArchivedEmails {
  [address: string]: Email[];
}

export interface LastMessageTimestamps {
  [addressId: string]: number;
}

export interface SeenEmailIds {
  [address: string]: string[];
}

export interface PasswordSettings {
  useCustom: boolean;
  customPassword?: string;
}

export interface NameSettings {
  useCustom: boolean;
  firstName?: string;
  lastName?: string;
}

export interface DeveloperSettings {
  enableLogging: boolean;
}

export interface Keybinding {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface Keybindings {
  refreshMailbox: Keybinding;
  createAddress: Keybinding;
  copyEmail: Keybinding;
  copyOtp: Keybinding;
  closeDialogs: Keybinding;
  /** Open / focus Addresses management (Alt+Shift+A - avoids browser conflicts) */
  openAddresses: Keybinding;
  /** Open Identities (Alt+Shift+I) */
  openIdentities: Keybinding;
  /** Open Saved logins (Alt+Shift+L) */
  openSavedLogins: Keybinding;
  /** Toggle account selector popup (Alt+Shift+M) */
  toggleAccountSelector: Keybinding;
  /** Focus mailbox search (Alt+Shift+F) */
  focusSearch: Keybinding;
}

export const DEFAULT_KEYBINDINGS: Keybindings = {
  refreshMailbox: { key: 'r', ctrlKey: true, metaKey: true },
  createAddress: { key: 'n', ctrlKey: true, metaKey: true },
  copyEmail: { key: 'c', ctrlKey: true, metaKey: true },
  copyOtp: { key: 'o', ctrlKey: true, metaKey: true },
  closeDialogs: { key: 'Escape' },
  // Alt+Shift combos rarely conflict with browser or site shortcuts
  openAddresses: { key: 'a', altKey: true, shiftKey: true },
  openIdentities: { key: 'i', altKey: true, shiftKey: true },
  openSavedLogins: { key: 'l', altKey: true, shiftKey: true },
  toggleAccountSelector: { key: 'm', altKey: true, shiftKey: true },
  focusSearch: { key: 'f', altKey: true, shiftKey: true },
};

/**
 * Scope of the global auto-renew toggle.
 * - 'all': flipping the global backfills every live address (master override).
 * - 'new': the global is only the default for newly created addresses.
 * - 'ask': flipping the global asks whether to also update existing addresses.
 */
export type AutoRenewScope = 'all' | 'new' | 'ask';

/**
 * How the mailbox list previews a message under the cursor.
 * - 'tooltip': a floating preview card appears next to the row (default).
 * - 'expanded': the row itself grows to show several preview lines inline.
 */
export type EmailPreviewMode = 'tooltip' | 'expanded';

export interface StoredSettings {
  passwordSettings?: PasswordSettings;
  nameSettings?: NameSettings;
  autoCopy?: boolean;
  autoRenew?: boolean;
  selectedProvider?: MailProvider;
  selectedInstance?: string;
  customInstances?: ProviderInstance[];
  notificationSettings?: NotificationSettings;
  keybindings?: Keybindings;
  autoRefreshInterval?: number;
  themeMode?: 'light' | 'dark' | 'system';
  developerSettings?: DeveloperSettings;
  faviconCaching?: 'direct' | 'local';
  emailPreviewMode?: EmailPreviewMode;
  guerrillaDefaultDomain?: string;
}

export interface ProviderInstance {
  id: string;
  name: string;
  displayName: string;
  apiUrl: string;
  isCustom?: boolean;
}

export interface Analytics {
  createdAt?: string | number;
  accountsCreated: number;
  emailsReceived: number;
  otpsDetected: number;
  notificationsSent: number;
  /** Times the extension UI was opened (popup/sidepanel/app mount) */
  extensionOpens?: number;
  /** Times an email was marked read / opened */
  emailsRead?: number;
  /** Per-view visit counts (view id → count) */
  pageVisits?: Record<string, number>;
  // Performance metrics
  performance?: {
    emailFetchTimes: number[]; // Array of fetch times in milliseconds
    providerLatency: Record<string, number[]>; // Provider -> array of latency times in ms
    uiRenderTimes: number[]; // Array of UI render times in milliseconds
  };
  /**
   * Aggregated averages derived by the background (getPerformanceSummary).
   * Computed on demand - never persisted to storage.
   */
  performanceSummary?: PerformanceSummary;
  /**
   * Sampled storage footprint over time. Appended by the background via
   * recordStorageSnapshot (throttled, capped) - cleared only by an analytics
   * hard reset.
   */
  storageTrend?: StorageTrendPoint[];
}

/** One sampled storage footprint: epoch ms, bytes used, stored email count. */
export interface StorageTrendPoint {
  t: number;
  bytes: number;
  emails: number;
}

/** Averages over the recorded performance samples, computed in the background. */
export interface PerformanceSummary {
  avgEmailFetchTime: number;
  avgUIRenderTime: number;
  /** Provider -> average latency in ms */
  avgProviderLatency: Record<string, number>;
}

export type ActivityEventType =
  | 'email_received'
  | 'otp_detected'
  | 'notification_sent'
  | 'address_created'
  | 'account_created' // legacy alias, migrated to 'address_created' on read
  | 'account_deleted'
  | 'auto_fill'
  | 'toast_notification'
  | 'auto_extend'
  | 'hard_reset';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: number;
  data: {
    address?: string;
    emailId?: string;
    otp?: string;
    sender?: string;
    subject?: string;
    website?: string;
    message?: string; // For toast notifications
    toastType?: 'success' | 'error' | 'warning' | 'info'; // For toast notifications
    provider?: string;
    outcome?: 'success' | 'failure';
    errorCode?: string;
  };
}

// ---- Domain Types ----

/**
 * The PERSISTED lifecycle of an address - what `accountStatus` stores.
 *
 * `expired` is deliberately NOT a member: it is derived from `expiresAt` (see
 * `getLifecycleStatus` in `@/utils/address/address-status.js`), so persisting it
 * would record a fact the clock keeps changing.
 *
 * Written as an `as const` array with the union derived from it, like
 * `KNOWN_ICON_NAMES` and `VIEW_LIST`: `scripts/check-vocabulary-fields` reads
 * that array to decide which lookup tables are keyed by this vocabulary, and a
 * member list written twice is a list that drifts.
 */
export const ADDRESS_STATUSES = ['active', 'archived', 'deleted'] as const;

export type AddressStatus = (typeof ADDRESS_STATUSES)[number];

/**
 * Narrow an untrusted value - storage, a message payload, a URL - to an
 * `AddressStatus`. The vocabulary's boundary: `accountStatus` read out of a
 * record is a `string` until this runs, and every consumer compares it against
 * these three tokens anyway, so an unvalidated value is silently treated as
 * neither archived nor deleted (i.e. live).
 */
export function isAddressStatus(value: unknown): value is AddressStatus {
  return typeof value === 'string' && (ADDRESS_STATUSES as readonly string[]).includes(value);
}

export interface Address {
  id: string;
  /** The full email address, e.g. "foo@bar.com" */
  address: string;
  provider: MailProvider;
  token?: string; // Auth token (bearer, session, etc.)
  sidToken?: string; // Session token
  lastSequence?: number; // Sequence tracking for incremental fetching
  createdAt: number; // ms timestamp
  expiresAt: number; // ms timestamp
  expiryNotified?: boolean;
  /** Per-state notification flags - split from legacy `expiryNotified` so an
   * expiring-soon warning can never suppress the expired / renewal-failure
   * notification (the legacy single flag conflated all three states). */
  expiringSoonNotified?: boolean;
  expiredNotified?: boolean;
  autoExtend?: boolean;
  /** Primary/legacy single tag (first of `tags` when multi-tag is used) */
  tag?: string;
  tagColor?: string;
  /** Multiple tags per address (preferred). When set, `tag`/`tagColor` mirror the first entry. */
  tags?: Array<{ name: string; color: string }>;
  accountStatus?: AddressStatus; // Mutually exclusive: active | archived | deleted
  /** Why this address was archived, so the UI can distinguish user action from expiry automation. */
  archiveReason?:
    | 'manual'
    | 'expired'
    | 'auto-renew-failed'
    | 'auto-extend-failed'
    | 'scheduled'
    | 'import-policy';
  /** For a manually archived address, whether successful auto-renewal should restore it to Live. */
  unarchiveAfterRenewal?: boolean;
  /** Monotonic archive transition time; guards in-flight expiry work from overwriting a newer user action. */
  archivedAt?: number;
  instanceUrl?: string; // For multi-instance providers
  // UI-specific properties
  expiry?: string; // Formatted expiry string
  received?: number; // Email count
  lastUsed?: string; // Formatted last used string
  /** Computed display status: active | archived | deleted | expired.
   *  Set ONLY at the UI boundary (loadAddresses → getLifecycleStatus). NEVER
   *  persisted - the persisted source of truth is `accountStatus` (+ expiresAt
   *  for the derived 'expired'). Derive with @/utils/address/address-status helpers. */
  status?: string;
  emailUser?: string;
  /** How many times this inbox was successfully renewed (auto or manual) */
  renewalCount?: number;
  /** Measured renewal latency (ms) - adaptive auto-renew pre-expiry window. */
  renewalLatencyMs?: number;
  /** When the last renewal operation completed (ms epoch). */
  lastRenewalAt?: number;
  /** Start time of the active provider renewal request; UI hides stale markers after interruption. */
  renewalInProgressAt?: number;
  /** Consecutive auto-renew failures (drives the retry backoff + UI status). */
  renewalFailCount?: number;
  /** When the most recent auto-renew failure occurred (ms epoch). Used with
   * `renewalFailCount` so only *recent* failures extend the streak - a stale
   * failure starts a fresh streak and resets the backoff. */
  lastFailureAt?: number;
  /** When the next auto-renew attempt is allowed (ms epoch), set after a
   * failed auto-renew per the exponential retry backoff. While auto-renew is
   * on the address is never archived - it keeps retrying. */
  nextRetryAt?: number;
  /** Last consecutive mailbox fetch failure. Cleared after a successful provider fetch. */
  mailboxRefreshFailure?: {
    kind: 'network' | 'provider' | 'unknown';
    failedAt: number;
    errorKey: string;
  };
}

/** Detected one-click / magic sign-in link on a message */
export interface MagicLink {
  url: string;
  label?: string;
  score: number;
  host?: string;
  /** Estimated expiry (ms epoch) from body heuristics */
  expiresAt?: number;
}

export interface Email {
  id: string;
  subject?: string;
  body?: string;
  body_html?: string;
  body_plain?: string;
  /** Untouched raw MIME source of the message, when the provider exposes it
   * (e.g. GuerrillaMail's `get_email_source`). Preserves the original
   * styling/structure that server-filtered `mail_body` responses strip out. */
  raw_source?: string;
  from?: string;
  from_name?: string;
  received_at: number; // Unix seconds
  otp?: string | null;
  /** Possible code without recognized verification context; manual copy only. */
  otpCandidate?: string | null;
  /** Explicitly labelled promotional/coupon code, separate from verification. */
  couponCode?: string | null;
  /** Heuristic reminder classification; does not schedule a notification. */
  isReminder?: boolean;
  /** Heuristic promotional offer classification, independent of coupon codes. */
  isDeal?: boolean;
  /** Estimated OTP validity end (ms epoch) from body heuristics */
  otpExpiresAt?: number;
  /** Server message availability expiry (ms epoch) derived from arrival + messageRetentionDuration */
  messageExpiresAt?: number;
  /** Ranked magic / sign-in links extracted from the body */
  magicLinks?: MagicLink[];
  /** True when at least one magic link was detected */
  hasMagicLink?: boolean;
  /** True when the provider's list response flagged this message as having
   * attachments (e.g. Guerrilla `att: "1"`) - known before the manifest is
   * fetched, and survives providers that only expose the flag. */
  hasAttachment?: boolean;
  attachments?: {
    filename: string;
    mimeType: string;
    partNumber?: string;
    downloadUrl?: string | null;
  }[];
  archived?: boolean;
  archived_at?: number;
  stored_at?: number; // ms timestamp (when we stored it)
  original_inbox?: string;
  local_only?: boolean; // Email only exists locally, not in API
  /** ms epoch when we first detected this message is no longer on the server */
  local_only_since?: number;
  // Local-only soft archive/delete (separate from `archived` which is server-side)
  local_archived?: boolean;
  local_archived_at?: number;
  local_deleted?: boolean;
  local_deleted_at?: number;
  // UI-specific properties
  time?: string; // Formatted time string
  isOtp?: boolean;
  unread?: boolean;
  date?: string; // Formatted date string
  tags?: string[]; // Custom user-defined labels
}

export interface SavedLogin {
  id: string;
  website: string;
  email: string;
  password: string;
  otp?: string;
}

export interface Identity {
  id: string;
  name: string;
  firstNames: string;
  lastNames: string;
  /**
   * Preferred username for signup forms. Empty = generate at fill time.
   * When a site rejects “username taken”, autofill regenerates a new one.
   */
  username?: string | null;
  useRandomPassword: boolean;
  customPassword?: string;
  phone?: string;
  pin?: string;
  domainHints?: string[];
  /**
   * Mailbox address to prefer when autofilling.
   * - Empty / undefined = use the currently selected (active) inbox.
   * - `__random_active__` = pick any random live (active) mailbox at fill time.
   * - Otherwise must match an existing inbox address.
   */
  preferredEmail?: string | null;
  /** Optional form-fill profile extras */
  gender?: 'male' | 'female' | 'other' | 'prefer_not' | null;
  /** ISO date YYYY-MM-DD */
  dateOfBirth?: string | null;
  /** ISO country code e.g. US, DE */
  country?: string | null;
  /** City for autofill (optional) */
  city?: string | null;
  /** State / province / region */
  state?: string | null;
  /** Street address line */
  address?: string | null;
  /** Profile picture as data URL (optional, for future auto-account flows) */
  profilePicture?: string | null;
  isDefault: boolean;
  createdAt: number;
  /** Last successful save timestamp (ms) */
  updatedAt?: number;
  /** Chronological edit history (newest last, capped) */
  updateHistory?: { at: number; summary?: string }[];
  userAgent?: string | null;
  /**
   * Per-domain field overrides (user-defined).
   * Maps domain or domain suffix → partial field values that override the
   * identity's defaults when autofilling on that domain.
   *
   * Example: { "linkedin.com": { "firstNames": "John", "lastNames": "Smith" } }
   */
  domainFieldOverrides?: Record<
    string,
    Partial<
      Pick<
        Identity,
        'firstNames' | 'lastNames' | 'username' | 'phone' | 'preferredEmail' | 'customPassword'
      >
    >
  >;
}

export interface NotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  expiryWarningThreshold: number; // in milliseconds (default: 1 hour)
}

export interface SessionCredentials {
  /** Links a generated signup session to its exact saved-login record. */
  signupCredentialId?: string;
  website?: string;
  email?: string;
  username?: string;
  password?: string;
  name?: string;
  phone?: string;
}

export interface EmailFilters {
  searchQuery?: string;
  hasOTP?: boolean;
  senderDomain?: string;
  recipient?: string;
  dateFrom?: string | number;
  dateTo?: string | number;
}

export interface SavedSearchFilter {
  id: string;
  name: string;
  searchQuery: string;
  hasOTP: boolean;
  /** When true, only emails with attachments match this filter. */
  hasAttachment?: boolean;
  /** When true, only unread emails match this filter. */
  unreadOnly?: boolean;
  senderDomain: string;
  /** Exact sender email filter, separate from free-text search. */
  senderEmail?: string;
  selectedSenders?: string[];
  dateFrom: string;
  dateTo: string;
  sortBy?: string;
  recipient?: string;
  /** Subject text filter (subject:text) */
  subject?: string;
  /** Exclude emails from this sender domain (!from:domain) */
  notSenderDomain?: string;
  /** Exclude emails from this sender email (!from:email) */
  notSenderEmail?: string;
  /** Exclude emails to this recipient (!to:address) */
  notRecipient?: string;
  /** Exclude emails whose subject contains this text (!subject:text) */
  notSubject?: string;
  createdAt: number;
}

// ---- Export / Import ----

export interface EmailHistoryItem {
  email: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface CredentialsHistoryItem {
  id?: string;
  domain: string;
  timestamp: number;
  email?: string | null;
  username?: string | null;
  name?: string | null;
  phone?: string | null;
  website?: string | null;
  password?: string;
  totpSecret?: string | null;
  totp?: string | null;
  otp?: string | null;
  addressId?: string;
  identityId?: string;
  /** Privacy / terms / policy URLs captured from the signup form */
  policyUrls?: string[];
  /**
   * Which form fields were actually filled during autofill
   * (e.g. email, password, firstName, phone, country).
   */
  filledFields?: string[];
  /** Set when creation of this exact account was detected after submission. */
  verified?: boolean;
  verifiedAt?: number;
  /**
   * Signup outcome tracking (do not treat autofill alone as success):
   * pending_submit → submission has not been observed
   * submitted → a validated submit/continue action was observed
   * verified → explicit account-created or email-confirmed evidence after submit
   * undetected → could not confirm signup
   * failed → site showed failure after submit
   */
  signupStatus?: 'pending_submit' | 'submitted' | 'verified' | 'undetected' | 'failed';
  submittedAt?: number;
  /** Background-owned exact signup attempt and separately observed email state. */
  signupAttemptId?: string;
  emailVerificationStatus?: 'unknown' | 'pending' | 'confirmed';
  emailVerifiedAt?: number;
  /** Notification handled once; OS delivery is not guaranteed. */
  verificationNotifiedAt?: number;
  [key: string]: unknown;
}

export interface ExportData {
  version: string;
  exportDate: string;
  data: {
    emailHistory: EmailHistoryItem[];
    loginInfo: CredentialsHistoryItem[];
    settings: {
      darkMode: boolean;
      activeAccountId?: string;
    };
    accounts: Address[];
  };
}

export interface ExportResult {
  success: boolean;
  error?: string;
}

export interface ImportResult {
  success: boolean;
  error?: string;
}

export interface DataManager {
  exportData: () => Promise<ExportResult>;
  importData: (file: File) => Promise<ImportResult>;
}

// ---- Background message shapes ----

export type BackgroundMessage =
  | {
      type: 'createAddress';
      provider?: MailProvider;
      user?: string;
      instanceId?: string;
      emailUser?: string;
      /** Page domain for site-rule provider pick */
      domain?: string;
      /** Skip health/rule auto-pick and failover */
      skipHealthPick?: boolean;
    }
  | { type: 'checkEmails'; addressId: string; filters?: EmailFilters }
  | { type: 'checkEmailsBulk'; addressIds: string[]; filters?: EmailFilters }
  | {
      type: 'requestInboxCheck';
      addressId: string;
      filters?: EmailFilters;
    }
  | { type: 'deleteAddress'; addressId: string; preserveEmails?: boolean }
  | { type: 'deleteAddresses'; addressIds: string[]; preserveEmails?: boolean }
  | { type: 'restoreAddress'; addressId: string }
  | { type: 'getAddresses' }
  | { type: 'setProvider'; provider: MailProvider }
  | {
      type: 'updateAddressTag';
      addressId: string;
      tag: string;
      color?: string | null;
      /** Full multi-tag replacement list (takes precedence over single tag). */
      tags?: Array<{ name: string; color: string }>;
    }
  | {
      type: 'updateAddressesTag';
      addressIds: string[];
      tag: string;
      color?: string | null;
      /** Full multi-tag replacement list (takes precedence over single tag). */
      tags?: Array<{ name: string; color: string }>;
    }
  | { type: 'archiveAddress'; addressId: string }
  | { type: 'archiveAddresses'; addressIds: string[] }
  | { type: 'unarchiveAddress'; addressId: string; restoreAutoExtend?: boolean }
  | { type: 'unarchiveAddresses'; addressIds: string[] }
  | { type: 'restoreArchivedOverflowAddress'; addressId: string }
  | { type: 'getProvider' }
  | { type: 'clearSessionCredentials' }
  | {
      type: 'updateSessionCredentials';
      credentials: Partial<SessionCredentials>;
    }
  | { type: 'saveLoginCredential'; credential: Partial<CredentialsHistoryItem> }
  | {
      type: 'updatePendingSignupUsername';
      credentialId: string;
      domain: string;
      expectedUsername: string;
      username: string;
    }
  | {
      type: 'openExtensionUi';
      reason?: string;
      hint?: string;
      identityId?: string;
    }
  | { type: 'flagReturnToForm'; url?: string }
  | { type: 'getAnalytics' }
  | { type: 'resetAnalytics' }
  | { type: 'recordExtensionOpen' }
  | { type: 'recordPageVisit'; viewId: ActivityViewId }
  | { type: 'recordEmailRead' }
  | { type: 'renewAddress'; addressId: string }
  | { type: 'renewAddresses'; addressIds: string[] }
  | { type: 'reauthenticateAddress'; addressId: string }
  | { type: 'reauthenticateAddresses'; addressIds: string[] }
  | { type: 'fetchFavicon'; url: string }
  | { action: 'hardReset' }
  | { action: 'getProviderInstances'; provider?: string }
  | {
      action: 'addCustomInstance';
      instance: Omit<ProviderInstance, 'id' | 'isCustom'>;
    }
  | { action: 'removeCustomInstance'; instanceId: string }
  | { action: 'getSelectedInstance' }
  | { action: 'setSelectedInstance'; instanceId: string }
  | {
      type: 'setDisabledInstances';
      provider: string;
      /** Disabled-instance blacklist (all instances enabled when empty). */
      disabledInstances: string[];
    }
  | { action: 'initializeDefaultProvider' }
  | {
      action: 'providerApiCall';
      provider: string;
      func: string;
      params?: Record<string, unknown>;
      sidToken?: string;
    }
  | { action: 'getArchivedEmails'; address?: string }
  | { action: 'getStorageUsage' }
  | { action: 'getEmailsToBeDeleted'; retentionDays?: number }
  | {
      action: 'cleanupOldStoredEmails';
      activeRetentionDays?: number;
      archivedRetentionDays?: number;
    }
  | { type: 'findReusableIdentity'; domain: string; addressId?: string }
  | { type: 'findSiteReplay'; domain: string; addressId?: string }
  | { type: 'copySiteLoginPassword'; domain: string; email: string; addressId?: string }
  | { type: 'recordUIRenderTime'; renderTime: number }
  | { type: 'recordStorageSnapshot'; bytes: number; emails: number }
  | { type: 'encryptData'; text: string; domain?: string }
  | {
      type: 'decryptStoredCustomPassword';
      /** Which stored custom password to decrypt: the global settings one or a saved identity's. */
      source: 'passwordSettings' | 'identity';
      /** Required when source is 'identity'. */
      identityId?: string;
      /** Page-domain claim, verified against the sender's tab URL. */
      domain?: string;
    }
  | { type: 'generateIdentityField'; fieldType: string; locale?: string }
  | { type: 'copyToClipboard'; text: string; purgeAfterMs?: number }
  | { type: 'translate'; key: string; vars?: Record<string, unknown> }
  | { type: 'getProviderDisplayName'; provider: string }
  | { type: 'adoptOnboardingAddress'; sessionId: string; provider: string }
  | { type: 'generateLocaleExtras'; locale?: string }
  | { type: 'generateLocaleAwarePhone'; locale?: string }
  | { type: 'getIconSvg'; name: string; size?: number; color?: string }
  | { type: 'recordAutofillSuccess'; domain: string }
  | { type: 'recordAutofillFailure'; domain: string }
  | { type: 'loadSmartAutofillSettings' }
  | {
      type: 'routeIdentityForDomain';
      domain: string;
      identities?: Identity[];
      selectedIdentityId?: string;
    }
  | {
      type: 'recordAutofillOutcome';
      opts: {
        domain: string;
        success: boolean;
        identityId?: string | null;
        addressId?: string | null;
        email?: string | null;
        formScore?: unknown;
        policyUrls?: string[];
        usedReplay?: boolean;
      };
    }
  | { type: 'shouldPreferReplay'; domain: string }
  | {
      type: 'pickFreshestIdentity';
      domain?: string;
      identities?: unknown;
      liveEmails?: string[];
    }
  | { type: 'getActiveAddressMeta'; forSignup?: boolean }
  | { type: 'beginSignupAttempt'; credentialId: string }
  | { type: 'getSignupAttempt' }
  | {
      type: 'reportSignupProgress';
      attemptId: string;
      progress: import('@/features/intelligence/signup-state.js').SignupProgress;
    }
  | { type: 'openSignupVerificationLink'; url: string; addressId?: string }
  | { type: 'matchKindFromText'; text: string }
  | { type: 'getStorageViaBg'; keys: string | string[]; forSignup?: boolean }
  | { type: 'setStorageViaBg'; items: Record<string, unknown> }
  | { type: 'getSitePrivacySettings' }
  | {
      type: 'setSitePrivacySetting';
      feature: 'otpDetection' | 'formScanning';
      enabled: boolean;
    }
  | { type: 'removeLatestOtp'; otp: string; recipient: string }
  | {
      type: 'rescanEmailsForDetection';
      includeArchived?: boolean;
      /** Restrict the re-scan to a single inbox address (optional). */
      address?: string;
    }
  | {
      /** Remove the persisted AI detection result cache. */
      type: 'clearAiDetectionCache';
    }
  | { type: 'classifyFieldFast'; text: string }
  | {
      type: 'navigateView';
      view: string;
      openView?: string;
      autofillTab?: string;
      openIdentityCreate?: boolean;
      openIdentityEditId?: string;
      openExtensionReason?: string;
      [key: string]: unknown;
    }
  | { type: 'otpCopied'; ok: boolean }
  | { type: 'otpAutoCopied'; ok: boolean }
  | { type: 'playNotificationSound' }
  | { type: 'updateRefreshInterval'; intervalMs: number }
  | { type: 'clearAllOtps' }
  | { type: 'ensureActiveTabAutofill' }
  | { type: 'createAddressWithGesture'; provider?: MailProvider }
  | { type: 'formPresence'; formDetected: boolean }
  /** Dev-only: service worker answers with its perf ring + collects tab marks. */
  | { type: 'getPerfReport' }
  /**
   * Dev-only: background asks a tab's content script for its perf ring and
   * its per-type content→background message counters (page-load scope).
   */
  | { type: 'collectPerfMarks' }
  | { type: 'webmcpTool'; tool: string; args?: Record<string, unknown> }
  | { type: 'getWizardSession'; domain: string }
  | {
      type: 'upsertWizardSession';
      partial: Record<string, unknown> & { domain: string };
    }
  | {
      type: 'advanceWizardStep';
      domain: string;
      step: string;
      extra?: Record<string, unknown>;
    }
  | { type: 'clearWizardSession'; domain: string }
  | { type: 'resolveDomainFieldOverrides'; identity: unknown; domain: string }
  | { type: 'getFieldMap'; domain: string }
  | {
      type: 'recordFieldMapHit';
      domain: string;
      kind: string;
      selector: string;
    }
  | {
      type: 'setFieldMapCorrection';
      domain: string;
      kind: string;
      selector: string;
    }
  | { type: 'testConflictText'; text: string }
  | { type: 'recordSiteEmailDomainRejection'; email: string; text: string }
  | { type: 'clearSiteEmailDomainRejections'; domain: string }
  | { type: 'vaultLocked' }
  | {
      /**
       * Print handoff: the dedicated app tab requests its own closure once
       * the print dialog has finished (printed or cancelled). Only honored
       * for extension-page senders - see the closePrintTab handler gate.
       */
      type: 'closePrintTab';
    }
  | {
      /**
       * Content-script fallback for the identity User-Agent spoof: the page's
       * CSP refused the inline override (`securitypolicyviolation`), so run the
       * same override through `scripting.executeScript({ world: 'MAIN' })`,
       * which no page CSP can block. Carries no payload on purpose - the
       * background reads and validates the active identity itself, so the
       * content script (which a page can reach) is never the authority on the
       * spoofed User-Agent. See
       * `src/entrypoints/background/apply-user-agent-spoof.ts`.
       */
      type: 'applyUserAgentSpoof';
    };

// ---- Content script message shapes ----

export type ContentMessage =
  | { type: 'ensureContentRuntime' }
  | { type: 'clearSessionCredentials' }
  | {
      type: 'updateSessionCredentials';
      credentials: Partial<SessionCredentials>;
    }
  | {
      type: 'fillOTP';
      otp: string;
      sender?: string;
      senderName?: string;
      subject?: string;
      recipient?: string;
    }
  | { type: 'checkFormDetected'; gateProbe?: boolean }
  | { type: 'startSignup'; email?: string }
  | { type: 'ping' }
  | { type: 'rescanForms' }
  | { type: 'autofillBlocklistChanged' }
  | { type: 'sitePrivacySettingsChanged' }
  | {
      type: 'refillSavedLogin';
      credential: {
        email?: string;
        password?: string;
        username?: string;
        name?: string;
        phone?: string;
      };
    };

// ---- Combined message type for runtime ----

export type RuntimeMessage = BackgroundMessage | ContentMessage;

// ---- Browser Runtime Types ----

export interface RuntimeMessageSender {
  id?: string;
  url?: string;
  tab?: {
    // Chrome delivers `tab.id` as optional (`undefined` for e.g. extension-page
    // senders), so consumers must null-check rather than assume presence.
    id?: number;
    url?: string;
  };
  frameId?: number;
}

export type MessageResponse = unknown;

export interface Alarm {
  name: string;
  scheduledTime: number;
  periodInMinutes?: number;
}

export interface Tab {
  id: number;
  url?: string;
  title?: string;
}
