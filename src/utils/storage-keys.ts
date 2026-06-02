/**
 * Type-safe storage key definitions and helpers.
 *
 * Provides a single place to read/write the most-accessed storage keys so
 * that callers never have to repeat the cast pattern:
 *   (await browser.storage.local.get(['key'])) as { key?: T }
 */

import { DEFAULT_PROVIDER } from '@/utils/email-service.js';
import type { Account, Analytics, Email, ProviderInstance } from '@/utils/types.js';

/**
 * Dynamic storage key patterns for provider-specific settings
 */
export type ProviderStorageKey = `customInstances_${string}` | `selectedInstance_${string}`;

/**
 * All possible storage keys in the application
 */
export type StorageKey =
  | ProviderStorageKey
  | 'selectedProvider'
  | 'useCustomPassword'
  | 'customPassword'
  | 'useCustomName'
  | 'customFirstName'
  | 'customLastName'
  | 'autoCopy'
  | 'autoRenew'
  | 'customColor'
  | 'providerInstances'
  | 'emailRetentionDays'
  | 'showDeveloperSettings'
  | 'enableLogging'
  | 'identities'
  | 'savedSearchFilters'
  | string; // Fallback for any other string key

/**
 * Type-safe storage get operation (single key, generic value)
 */
export async function getStorage<T>(key: StorageKey): Promise<Record<string, T>> {
  const result = await browser.storage.local.get([key]);
  return result as Record<string, T>;
}

/**
 * Type-safe storage set operation (single key)
 */
export async function setStorage(key: StorageKey, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'boolean');
}

// ---------------------------------------------------------------------------
// Common typed helpers — eliminate repeated cast boilerplate across the codebase
// ---------------------------------------------------------------------------

/** Returns the stored inboxes array (defaults to []). */
export async function getInboxes(): Promise<Account[]> {
  const result = await browser.storage.local.get(['inboxes']);
  return Array.isArray(result.inboxes) ? (result.inboxes as Account[]) : [];
}

/** Persists the inboxes array. */
export async function setInboxes(inboxes: Account[]): Promise<void> {
  await browser.storage.local.set({ inboxes });
}

/** Returns the currently selected provider (defaults to DEFAULT_PROVIDER). */
export async function getSelectedProvider(): Promise<string> {
  const { selectedProvider = DEFAULT_PROVIDER } = (await browser.storage.local.get([
    'selectedProvider',
  ])) as { selectedProvider?: string };
  return selectedProvider;
}

/** Returns stored emails map (defaults to {}). */
export async function getStoredEmailsMap(): Promise<Record<string, Email[]>> {
  const { storedEmails = {} } = (await browser.storage.local.get(['storedEmails'])) as {
    storedEmails?: Record<string, Email[]>;
  };
  return storedEmails;
}

/** Returns the read-state map (defaults to {} when storage is malformed). */
export async function getReadEmailsMap(): Promise<Record<string, boolean>> {
  const result = await browser.storage.local.get(['readEmails']);
  return isBooleanRecord(result.readEmails) ? result.readEmails : {};
}

/** Returns archived emails map (defaults to {}). */
export async function getArchivedEmailsMap(): Promise<Record<string, Email[]>> {
  const { archivedEmails = {} } = (await browser.storage.local.get(['archivedEmails'])) as {
    archivedEmails?: Record<string, Email[]>;
  };
  return archivedEmails;
}

/** Returns both stored and archived emails maps in one storage call. */
export async function getEmailMaps(): Promise<{
  storedEmails: Record<string, Email[]>;
  archivedEmails: Record<string, Email[]>;
}> {
  const { storedEmails = {}, archivedEmails = {} } = (await browser.storage.local.get([
    'storedEmails',
    'archivedEmails',
  ])) as {
    storedEmails?: Record<string, Email[]>;
    archivedEmails?: Record<string, Email[]>;
  };
  return { storedEmails, archivedEmails };
}

/** Default Analytics shape used as fallback across analytics helpers. */
export const DEFAULT_ANALYTICS: Analytics = {
  accountsCreated: 0,
  emailsReceived: 0,
  otpsDetected: 0,
  notificationsSent: 0,
  performance: {
    emailFetchTimes: [],
    providerLatency: {},
    uiRenderTimes: [],
  },
};

/** Returns the analytics object (defaults to DEFAULT_ANALYTICS). */
export async function getAnalyticsRecord(): Promise<Analytics> {
  const { analytics = { ...DEFAULT_ANALYTICS } } = (await browser.storage.local.get([
    'analytics',
  ])) as { analytics?: Analytics };
  return analytics;
}

/** Persists the analytics object. */
export async function setAnalyticsRecord(analytics: Analytics): Promise<void> {
  await browser.storage.local.set({ analytics });
}

/** Returns the email retention days setting (defaults to 30). */
export async function getEmailRetentionDays(): Promise<number> {
  const { emailRetentionDays = 30 } = (await browser.storage.local.get(['emailRetentionDays'])) as {
    emailRetentionDays?: number;
  };
  return emailRetentionDays;
}

/** Returns the emailTags map (emailId -> string[]). */
export async function getEmailTagsMap(): Promise<Record<string, string[]>> {
  const { emailTags = {} } = (await browser.storage.local.get(['emailTags'])) as {
    emailTags?: Record<string, string[]>;
  };
  return emailTags;
}

/** Persists the emailTags map. */
export async function setEmailTagsMap(emailTags: Record<string, string[]>): Promise<void> {
  await browser.storage.local.set({ emailTags });
}

/** Returns the auto-refresh interval in milliseconds (defaults to 30000ms = 30s). 0 means manual only. */
export async function getAutoRefreshInterval(): Promise<number> {
  const { autoRefreshInterval = 30000 } = (await browser.storage.local.get([
    'autoRefreshInterval',
  ])) as {
    autoRefreshInterval?: number;
  };
  return autoRefreshInterval;
}

/** Returns the provider instances list (defaults to []). */
export async function getProviderInstancesList(): Promise<ProviderInstance[]> {
  const { providerInstances = [] } = (await browser.storage.local.get(['providerInstances'])) as {
    providerInstances?: ProviderInstance[];
  };
  return providerInstances;
}

/** Returns the autofill blocklist (list of blocked domain strings). */
export async function getAutofillBlocklist(): Promise<string[]> {
  const { autofillBlocklist = [] } = (await browser.storage.local.get(['autofillBlocklist'])) as {
    autofillBlocklist?: string[];
  };
  return autofillBlocklist;
}

/** Persists the autofill blocklist. */
export async function setAutofillBlocklist(blocklist: string[]): Promise<void> {
  await browser.storage.local.set({ autofillBlocklist: blocklist });
}

/** Check if a domain is in the autofill blocklist. */
export async function isDomainBlocked(domain: string): Promise<boolean> {
  const blocklist = await getAutofillBlocklist();
  return blocklist.includes(domain);
}

/** Add a domain to the autofill blocklist. */
export async function addToAutofillBlocklist(domain: string): Promise<void> {
  const blocklist = await getAutofillBlocklist();
  if (!blocklist.includes(domain)) {
    blocklist.push(domain);
    await setAutofillBlocklist(blocklist);
  }
}

/** Remove a domain from the autofill blocklist. */
export async function removeFromAutofillBlocklist(domain: string): Promise<void> {
  const blocklist = await getAutofillBlocklist();
  const filtered = blocklist.filter((d) => d !== domain);
  await setAutofillBlocklist(filtered);
}
