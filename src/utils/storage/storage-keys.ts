/**
 * Type-safe storage key definitions and helpers.
 *
 * Provides a single place to read/write the most-accessed storage keys so
 * that callers never have to repeat the cast pattern:
 *   (await browser.storage.local.get(['key'])) as { key?: T }
 */

export {
  addToAutofillBlocklist,
  getAutofillBlocklist,
  isDomainBlocked,
  removeFromAutofillBlocklist,
  setAutofillBlocklist,
  toggleAutofillBlocklist,
} from '@/utils/content/autofill-blocklist.js';

import { browser } from 'wxt/browser';
import { DEFAULT_PROVIDER } from '@/utils/email/email-service.js';
import { logWarn } from '@/utils/logger.js';
import { isLockHeld, LOCKS, withLock } from '@/utils/mutex.js';
import { decrypt, encrypt } from '@/utils/security/crypto.js';
import { toMs } from '@/utils/time/time.js';
import type {
  Address,
  Analytics,
  Email,
  Identity,
  NotificationSettings,
  ProviderInstance,
} from '@/utils/types.js';
// Every write below goes through the retry wrapper: these are the keys a quota
// crunch or a leveldb hiccup hits first (mail bags, the metadata map, the
// address index, analytics), and losing one of them silently drops mail.
import { updateStoredObject } from './rmw.js';
import { writeWithRetry } from './storage-write.js';

/** Current 3.0 storage schema for mailbox email bags. */
export const EMAIL_STORAGE_SCHEMA_VERSION = 1;
const STORED_EMAILS_BY_ADDRESS_PREFIX = 'storedEmailsByAddress_';
const ARCHIVED_EMAILS_BY_ADDRESS_PREFIX = 'archivedEmailsByAddress_';
export const EMAIL_STORAGE_ADDRESS_INDEX_KEY = 'emailStorageAddressIndex';
const EMAIL_STORAGE_METADATA_KEY = 'emailStorageMetadata';

export interface EmailStorageMetadata {
  /** Stored (inbox) bag stats - the unread badge derives exclusively from these. */
  messageCount: number;
  unreadCount: number;
  /** Counts computed with mailbox-scoped read flags; older caches lack this. */
  readStateVersion?: 1;
  latestReceivedAt: number;
  latestOtpAt: number;
  hasMagicLink: boolean;
  /** Archived bag stats, tracked separately so archived writes never clobber the stored counts. */
  archivedMessageCount: number;
  archivedUnreadCount: number;
  archivedLatestReceivedAt: number;
  revision: number;
}

function emptyEmailStorageMetadata(): EmailStorageMetadata {
  return {
    messageCount: 0,
    unreadCount: 0,
    latestReceivedAt: 0,
    latestOtpAt: 0,
    hasMagicLink: false,
    archivedMessageCount: 0,
    archivedUnreadCount: 0,
    archivedLatestReceivedAt: 0,
    revision: 0,
  };
}

export function storedEmailsByAddressKey(addressId: string): string {
  return `${STORED_EMAILS_BY_ADDRESS_PREFIX}${encodeURIComponent(addressId)}`;
}

export function archivedEmailsByAddressKey(addressId: string): string {
  return `${ARCHIVED_EMAILS_BY_ADDRESS_PREFIX}${encodeURIComponent(addressId)}`;
}

/**
 * Dynamic storage key patterns for provider-specific settings
 */
export type ProviderStorageKey =
  | `customInstances_${string}`
  | `selectedInstance_${string}`
  | `disabledInstances_${string}`
  | `defaultDomain_${string}`
  | `domainIndex_${string}_${string}`;

/**
 * All possible storage keys in the application
 */
export type StorageKey =
  | ProviderStorageKey
  | 'selectedProvider'
  | 'sitePrivacySettings_v1'
  | 'addressColorThemeEnabled'
  | 'useCustomPassword'
  | 'customPassword'
  | 'useCustomName'
  | 'customFirstName'
  | 'customLastName'
  | 'autoCopy'
  | 'autoRenew'
  | 'autoRenewScope'
  | 'customColor'
  | 'providerInstances'
  | 'emailRetentionDays'
  | 'showDeveloperSettings'
  | 'enableLogging'
  | 'identities'
  | 'savedSearchFilters'
  | 'storedEmails'
  | `storedEmailsByAddress_${string}`
  | 'archivedEmails'
  | `archivedEmailsByAddress_${string}`
  | 'emailStorageSchemaVersion'
  | 'emailStorageAddressIndex'
  | 'emailStorageMetadata'
  | 'readEmails'
  | 'addresses'
  | 'activeAddressId'
  | 'emailLabels'
  | 'mailboxRuleMatchStats'
  | 'mailboxRules'
  | 'mailboxRulesRecipientPrefilled'
  | 'aiApiKey'
  | 'aiBaseUrl'
  | 'aiDetectionCache'
  | 'aiModel'
  | 'aiRescanProgress'
  | 'analytics'
  | 'gestureTokenSecret'
  | 'autoRefreshInterval'
  | 'emailPollingBaseDeadline'
  | 'emailPollingBackoff'
  | 'automationRules'
  | 'autofillBlocklist'
  | 'autofillBlockSuggestions_v1'
  | 'autofillFailureCounts_v1'
  | 'siteEmailRejections_v1'
  | 'autofillFeatureEnabled'
  | 'autofillWizardSessions_v1'
  | 'emailHistory'
  | 'emailBodyZoom'
  | 'globalZoomEnabled'
  | 'globalZoomScale'
  | 'pageZoomSettings'
  | 'loginInfo'
  | 'policyReviewedMap'
  | 'selectedIdentityId'
  | 'passwordSettings'
  | 'pendingImportUndo'
  | 'nameSettings'
  | 'notificationSettings'
  | 'themeMode'
  | 'contrastLevel'
  | 'developerSettings'
  | 'developer_constant_overrides'
  | 'faviconCaching'
  | 'emailPreviewMode'
  | 'keybindings'
  | 'clipboardPurgeQueue'
  | 'clipboardPrivacy'
  | 'activityEvents'
  | 'activityDailyHistory'
  | 'activityDashboard'
  | 'providerConfigOverrides'
  | 'themeColors'
  | 'vault_security_config'
  | 'vault_security_config_backup'
  | 'vault_unlock_lockout'
  | 'favicon_success_cache'
  | 'favicon_error_cache'
  | 'forceNewSessions'
  | 'storageQuotaWarning'
  | 'connectivityLog'
  | 'siteRuleArchiveSchedule'
  | 'expandedAppState'
  | 'notificationSnoozeByAddress'
  | 'marqueeSelectionEnabled'
  | 'demoMode'
  | 'realModeUserDataSnapshot_v1'
  | 'reloadRequiredTabIds_v1'
  | 'dragHintSeen_savedLoginInfo'
  | 'onboardingComplete'
  | 'customNavOrder'
  | 'navIndicatorModes'
  | 'toolbarButtonVisibility'
  | 'showSearchSlashIcon'
  | 'showStarredOnly'
  | 'voiceSearchEnabled'
  | 'uiDensity'
  | 'dialogPresentationBottomSheet'
  | 'sidebarCollapsed'
  | 'sidebarPosition'
  | 'splitPaneCollapsed'
  | 'splitListWidthPx'
  | 'splitListHeightPx'
  | 'stripsEdgeCollapsed'
  | 'pendingProductTour'
  | 'pendingProductTourAt'
  | 'productTourCompleted'
  | 'productTourVersion'
  | 'locale'
  | 'preferredLanguage'
  | 'preExpiryWindowMinutes'
  | 'starredEmails'
  | 'searchHistoryByScope'
  | 'searchHistoryLimit'
  | 'seenEmailIds'
  | 'lastHardReset'
  | 'lastInstanceFailover'
  | 'lastMessageTimestamps'
  | 'lastProviderFailover'
  | 'latestOtp'
  | 'maxArchivedAddresses'
  | 'minPrimaryItems'
  | 'autoArrangeMore'
  | 'archivedAddressOverflow'
  | 'webdavConfig'
  | 'lastWebDAVSyncAt'
  | 'actionRowCollapsed'
  | 'hideActionRowHintDismissed'
  | 'hideAttachmentBadges'
  | 'hideLabels'
  | 'hideOtpLabels'
  | 'htmlRenderingSettings'
  | 'showFavicons'
  | 'gesturesEnabled'
  | 'githubContributorsCache_v1'
  | 'threadGrouping'
  | 'preferHideVerificationStrip'
  | 'verificationPreferences'
  | 'preferHideOtpStrip'
  | 'preferHideAutofillStrip'
  | 'preferHideMagicStrip'
  | 'otpOptInList'
  | 'otpAutoCopyList'
  | 'webmcpAccessList'
  | 'webmcpSiteDecisions'
  | `webmcpOnce_${string}`
  | 'siteFieldMaps_v1'
  | 'siteRules'
  | 'smartAutofillSettings'
  | 'mailboxTagCatalog'
  | 'emailLabelCatalog'
  | 'emailListPageSize';

/**
 * Sidebar/content density. `expanded` = full labeled sidebar; `minimised` =
 * icon-only rail (labels become tooltips, theme toggle goes vertical, app
 * logo shows the mark only). Legacy `comfortable`/`compact` values stored by
 * older builds normalize to `expanded`.
 */
export type UiDensity = 'expanded' | 'minimised';

export type SidebarPosition = 'left' | 'right';
export const DEFAULT_SIDEBAR_POSITION: SidebarPosition = 'right';

export function normalizeSidebarPosition(raw: unknown): SidebarPosition {
  return raw === 'left' || raw === 'right' ? raw : DEFAULT_SIDEBAR_POSITION;
}

export function normalizeUiDensity(raw: unknown): UiDensity {
  if (raw === 'minimised') return 'minimised';
  return 'expanded';
}

/**
 * Build a typed `defaultDomain_<provider>` storage key.
 */
export function defaultDomainKey(provider: string): `defaultDomain_${string}` {
  return `defaultDomain_${provider}` as `defaultDomain_${string}`;
}

/**
 * Build a typed `domainIndex_<provider>_<username>` storage key.
 */
export function domainIndexKey(
  providerId: string,
  username: string
): `domainIndex_${string}_${string}` {
  return `domainIndex_${providerId}_${username}` as `domainIndex_${string}_${string}`;
}

/**
 * Build a typed `selectedInstance_<provider>` storage key.
 */
export function selectedInstanceKey(provider: string): `selectedInstance_${string}` {
  return `selectedInstance_${provider}` as `selectedInstance_${string}`;
}

/**
 * Build a typed `disabledInstances_<provider>` storage key.
 * Holds the blacklist of instance ids excluded from email generation
 * (all instances enabled when absent/empty).
 */
export function disabledInstancesKey(provider: string): `disabledInstances_${string}` {
  return `disabledInstances_${provider}` as `disabledInstances_${string}`;
}

/**
 * Build a typed `customInstances_<provider>` storage key.
 */
export function customInstancesKey(provider: string): `customInstances_${string}` {
  return `customInstances_${provider}` as `customInstances_${string}`;
}

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
  await writeWithRetry({ [key]: value });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'boolean');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validate the persisted fields required for an address to be usable. */
export function isPersistedAddress(value: unknown): value is Address {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.trim() === '') return false;
  if (typeof value.address !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(value.address)) return false;
  if (typeof value.provider !== 'string' || value.provider.trim() === '') return false;
  if (!isFiniteNumber(value.createdAt) || !isFiniteNumber(value.expiresAt)) return false;
  if (value.token !== undefined && typeof value.token !== 'string') return false;
  if (value.sidToken !== undefined && typeof value.sidToken !== 'string') return false;
  if (
    value.accountStatus !== undefined &&
    value.accountStatus !== 'active' &&
    value.accountStatus !== 'archived' &&
    value.accountStatus !== 'deleted'
  ) {
    return false;
  }
  return true;
}

/** Keep only structurally valid persisted addresses; never mutate valid records. */
export function filterPersistedAddresses(value: unknown): Address[] {
  return Array.isArray(value) ? value.filter(isPersistedAddress) : [];
}

/** Validate the persisted fields required for an identity to be usable. */
export function isPersistedIdentity(value: unknown): value is Identity {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    typeof value.name === 'string' &&
    typeof value.firstNames === 'string' &&
    typeof value.lastNames === 'string' &&
    typeof value.useRandomPassword === 'boolean' &&
    typeof value.isDefault === 'boolean' &&
    isFiniteNumber(value.createdAt)
  );
}

/** Keep only structurally valid persisted identities; never mutate valid records. */
export function filterPersistedIdentities(value: unknown): Identity[] {
  return Array.isArray(value) ? value.filter(isPersistedIdentity) : [];
}

type AddressWithEncryptedAuth = Address & {
  __encryptedToken?: string;
  __encryptedSidToken?: string;
};

// ---------------------------------------------------------------------------
// Common typed helpers - eliminate repeated cast boilerplate across the codebase
// ---------------------------------------------------------------------------

/**
 * Read persisted addresses without decrypting auth tokens. Invalid records are
 * excluded at this boundary so malformed storage cannot enter address logic.
 */
export async function getRawAddresses(): Promise<Address[]> {
  const result = await browser.storage.local.get(['addresses']);
  return filterPersistedAddresses(result.addresses);
}

/** Read validated addresses and decrypt auth tokens when the vault is available. */
export async function getAddresses(): Promise<Address[]> {
  const addresses = await getRawAddresses();

  const decryptedAddresses: Address[] = [];
  for (const record of addresses) {
    const item = { ...record };
    if (item.token?.startsWith('_enc_:')) {
      try {
        item.token = await decrypt(item.token.slice(6));
      } catch {
        // Vault locked or key unavailable: never expose ciphertext as an auth token.
        (item as AddressWithEncryptedAuth).__encryptedToken = item.token;
        item.token = undefined;
      }
    }
    if (item.sidToken?.startsWith('_enc_:')) {
      try {
        item.sidToken = await decrypt(item.sidToken.slice(6));
      } catch {
        // Vault locked or key unavailable: never expose ciphertext as an auth token.
        (item as AddressWithEncryptedAuth).__encryptedSidToken = item.sidToken;
        item.sidToken = undefined;
      }
    }
    decryptedAddresses.push(item);
  }
  return decryptedAddresses;
}

/**
 * Persists the addresses array.
 *
 * Deduplicates by id ONLY. Two records sharing an address case-insensitively
 * (e.g. a backup restore that re-cased Foo@Example.com → foo@example.com)
 * with DIFFERENT ids are both kept: the email-storage read side
 * (getLogicalEmailMaps) explicitly merges case-colliding addresses by message
 * id, so dropping one here would silently lose its token/sidToken credentials
 * and orphan its ID-keyed `storedEmailsByAddress_*` bag. Exact id duplicates
 * are genuine repeats and are skipped.
 */
export async function setAddresses(addresses: Address[]): Promise<void> {
  const encryptedAddresses: Address[] = [];
  const seenIds = new Set<string>();

  for (const record of addresses) {
    if (!record?.id) continue;
    if (seenIds.has(record.id)) {
      continue; // Skip duplicate records with the same stable id
    }
    seenIds.add(record.id);

    const source = record as AddressWithEncryptedAuth;
    const item = { ...source } as AddressWithEncryptedAuth;
    // `status` is a computed display field set only at the UI boundary
    // (loadAddresses → getLifecycleStatus). NEVER persist it - `accountStatus`
    // (+ expiresAt for the derived 'expired') is the single stored source of
    // truth. A stale persisted `status` caused lifecycle desyncs (e.g. re-auth
    // flipping accountStatus without status, leaving filters/autofill to see
    // the mailbox as dead). Delete it on write so it can never drift again.
    delete (item as { status?: string }).status;
    if (!item.token && source.__encryptedToken?.startsWith('_enc_:')) {
      item.token = source.__encryptedToken;
    }
    if (!item.sidToken && source.__encryptedSidToken?.startsWith('_enc_:')) {
      item.sidToken = source.__encryptedSidToken;
    }
    if (item.token && !item.token.startsWith('_enc_:')) {
      const encrypted = await encrypt(item.token);
      item.token = `_enc_:${encrypted}`;
    }
    if (item.sidToken && !item.sidToken.startsWith('_enc_:')) {
      const encrypted = await encrypt(item.sidToken);
      item.sidToken = `_enc_:${encrypted}`;
    }
    delete item.__encryptedToken;
    delete item.__encryptedSidToken;
    encryptedAddresses.push(item);
  }
  await writeWithRetry({ addresses: encryptedAddresses });
}

/**
 * Serialized read-modify-write of the address list.
 *
 * `setAddresses` REPLACES the whole array, so a flow that reads the list, edits
 * it and writes it back loses whatever landed in between - demo mode's exit
 * (filter the demo inboxes out) and inbox creation (append one) are exactly
 * that shape, and a popup, a sidepanel and the app tab can all be open at once.
 *
 * The read and the write are the module's own accessors, not a raw area round
 * trip: `getAddresses` decrypts auth tokens (restoring the ciphertext into
 * `__encryptedToken` when the vault is locked) and `setAddresses` re-encrypts,
 * drops `status` and dedupes by id - so an update cannot write back a less
 * normalized list than every other writer does.
 *
 * One JS context is serialized (the chain); a genuinely cross-context race on
 * `addresses` needs the background to own the write, which is the larger
 * storage-ownership change this helper does not pretend to be.
 *
 * Returns the updater's value. `setAddresses` may normalize further on the way
 * to storage (id dedupe, the computed `status` strip), so the return is the
 * caller's INTENT, not a re-read of what landed - a caller that must render the
 * persisted list re-reads it instead.
 */
export async function updateAddresses(
  updater: (current: Address[]) => Address[]
): Promise<Address[]> {
  return updateStoredObject<Address[]>('addresses', updater, () => [], {
    read: getAddresses,
    write: setAddresses,
  });
}

/** Returns the currently selected provider (defaults to DEFAULT_PROVIDER). */
export async function getSelectedProvider(): Promise<string> {
  const { selectedProvider = DEFAULT_PROVIDER } = (await browser.storage.local.get([
    'selectedProvider',
  ])) as {
    selectedProvider?: string;
  };
  return selectedProvider;
}

/** Durable per-inbox seen-email-ID set (defaults to {}). Survives bag
 * eviction / retention cleanup so already-processed mail is never treated as
 * new again when the provider still lists it. */
export async function getSeenEmailIds(): Promise<Record<string, string[]>> {
  const { seenEmailIds = {} } = (await browser.storage.local.get(['seenEmailIds'])) as {
    seenEmailIds?: unknown;
  };
  if (!seenEmailIds || typeof seenEmailIds !== 'object' || Array.isArray(seenEmailIds)) return {};
  const out: Record<string, string[]> = {};
  const canonicalKeys = new Map<string, string>();
  for (const [k, v] of Object.entries(seenEmailIds as Record<string, unknown>)) {
    if (!Array.isArray(v) || !v.every((e) => typeof e === 'string')) continue;
    const lower = k.toLowerCase();
    const canonical = canonicalKeys.get(lower);
    if (canonical) {
      const merged = new Set(out[canonical]);
      for (const id of v as string[]) merged.add(String(id));
      out[canonical] = [...merged];
    } else {
      canonicalKeys.set(lower, k);
      out[k] = (v as string[]).map(String);
    }
  }
  return out;
}

/** Returns stored emails map (defaults to {}). */
/**
 * Resolve the storage key holding an inbox's email bag, tolerating a casing
 * drift (provider re-casing, backup restore, account edit): returns the key
 * matching `address` case-insensitively, or the address itself when no
 * bag exists yet. Email addresses are case-insensitive for these providers -
 * a drift must not split a mailbox's emails across two keys, which would
 * silently break dedup, notifications, and OTP broadcasts.
 */
export function resolveBagKey(map: Record<string, unknown>, address: string): string {
  if (!address) return address;
  if (map[address]) return address;
  const lower = address.toLowerCase();
  for (const key of Object.keys(map)) {
    if (key.toLowerCase() === lower) return key;
  }
  return address;
}

/**
 * Write canonical mailbox-scoped flags for the supplied address aliases and
 * clear historical casing variants. Normalize address casing only: provider
 * IDs remain exact, and unscoped legacy flags never authorize a read.
 */
export function setEmailReadState(
  readEmails: Record<string, boolean>,
  emailId: string,
  casings: Array<string | undefined>,
  read: boolean
): void {
  const id = String(emailId);
  const addresses = new Set(casings.filter((c): c is string => !!c).map((c) => c.toLowerCase()));
  const keys = new Set<string>([...addresses].map((address) => `${address}_${id}`));
  const suffix = `_${id}`;
  for (const key of Object.keys(readEmails)) {
    if (key.endsWith(suffix) && addresses.has(key.slice(0, -suffix.length).toLowerCase())) {
      delete readEmails[key];
    }
  }
  // Never write or clear a bare ID: its owner is unknown, and the ID itself
  // could equal another inbox's compound key. Readers ignore unscoped flags.
  for (const key of keys) {
    if (read) readEmails[key] = true;
    else delete readEmails[key];
  }
}

/** Read state is mailbox-scoped; message IDs remain case-sensitive. */
export function isEmailRead(
  readEmails: Record<string, boolean>,
  emailId: string,
  address: string
): boolean {
  if (!address) return false;
  const owner = address.toLowerCase();
  if (readEmails[`${owner}_${emailId}`]) return true;
  const suffix = `_${emailId}`;
  return Object.keys(readEmails).some(
    (key) =>
      key.endsWith(suffix) &&
      key.slice(0, -suffix.length).toLowerCase() === owner &&
      readEmails[key]
  );
}

/** Build once per projection, so unread rows do not repeatedly scan legacy casing. */
export function createEmailReadChecker(
  readEmails: Record<string, boolean>
): (id: string, address: string) => boolean {
  const scoped = new Set<string>();
  for (const [key, read] of Object.entries(readEmails)) {
    if (!read) continue;
    // Consider each separator: both mailbox local parts and provider IDs can
    // contain underscores. Keep the ID's case and normalize only the owner.
    for (let i = key.indexOf('_'); i >= 0; i = key.indexOf('_', i + 1)) {
      scoped.add(`${key.slice(0, i).toLowerCase()}\u0000${key.slice(i + 1)}`);
    }
  }
  return (id, address) => !!address && scoped.has(`${address.toLowerCase()}\u0000${id}`);
}

type EmailBagMap = Record<string, Email[]>;

export function asEmailBag(value: unknown): Email[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (item): item is Email =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).id !== 'undefined'
  ) as Email[];
}

async function getEmailStorageAddressIndex(): Promise<Record<string, string>> {
  const result = (await browser.storage.local.get([EMAIL_STORAGE_ADDRESS_INDEX_KEY])) as {
    emailStorageAddressIndex?: Record<string, string>;
  };
  return isRecord(result.emailStorageAddressIndex)
    ? Object.fromEntries(
        Object.entries(result.emailStorageAddressIndex).filter(
          ([id, address]) =>
            typeof id === 'string' && typeof address === 'string' && address.length > 0
        )
      )
    : {};
}

/** Read one active mailbox by its stable address id. */
export async function getStoredEmailsForAddress(
  addressId?: string,
  address?: string
): Promise<Email[]> {
  const resolvedId = addressId || (address ? await resolveAddressToId(address) : undefined);
  if (!resolvedId) return [];
  const key = storedEmailsByAddressKey(resolvedId);
  const result = (await browser.storage.local.get([key])) as Record<string, unknown>;
  return asEmailBag(result[key]);
}

/** Read one archived mailbox by its stable address id. */
export async function getArchivedEmailsForAddress(
  addressId?: string,
  address?: string
): Promise<Email[]> {
  const resolvedId = addressId || (address ? await resolveAddressToId(address) : undefined);
  if (!resolvedId) return [];
  const key = archivedEmailsByAddressKey(resolvedId);
  const result = (await browser.storage.local.get([key])) as Record<string, unknown>;
  return asEmailBag(result[key]);
}

/** Look up the address ID for an email address string from the index. */
async function resolveAddressToId(address: string): Promise<string | undefined> {
  const index = await getEmailStorageAddressIndex();
  const lower = address.toLowerCase();
  for (const [id, addr] of Object.entries(index)) {
    if (addr.toLowerCase() === lower) return id;
  }
  return undefined;
}

export async function getEmailStorageMetadata(): Promise<Record<string, EmailStorageMetadata>> {
  const result = await browser.storage.local.get([EMAIL_STORAGE_METADATA_KEY]);
  if (!isRecord(result[EMAIL_STORAGE_METADATA_KEY])) return {};
  const metadata: Record<string, EmailStorageMetadata> = {};
  for (const [id, value] of Object.entries(result[EMAIL_STORAGE_METADATA_KEY])) {
    if (!isRecord(value)) continue;
    const base = emptyEmailStorageMetadata();
    metadata[id] = {
      messageCount:
        typeof value.messageCount === 'number' && value.messageCount >= 0
          ? value.messageCount
          : base.messageCount,
      unreadCount:
        typeof value.unreadCount === 'number' && value.unreadCount >= 0
          ? value.unreadCount
          : base.unreadCount,
      ...(value.readStateVersion === 1 ? { readStateVersion: 1 as const } : {}),
      latestReceivedAt:
        typeof value.latestReceivedAt === 'number' ? value.latestReceivedAt : base.latestReceivedAt,
      latestOtpAt: typeof value.latestOtpAt === 'number' ? value.latestOtpAt : base.latestOtpAt,
      hasMagicLink: value.hasMagicLink === true,
      archivedMessageCount:
        typeof value.archivedMessageCount === 'number' && value.archivedMessageCount >= 0
          ? value.archivedMessageCount
          : base.archivedMessageCount,
      archivedUnreadCount:
        typeof value.archivedUnreadCount === 'number' && value.archivedUnreadCount >= 0
          ? value.archivedUnreadCount
          : base.archivedUnreadCount,
      archivedLatestReceivedAt:
        typeof value.archivedLatestReceivedAt === 'number'
          ? value.archivedLatestReceivedAt
          : base.archivedLatestReceivedAt,
      revision:
        typeof value.revision === 'number' && value.revision >= 0 ? value.revision : base.revision,
    };
  }
  return metadata;
}

/** Scan ONE bag into its raw stats (counts, latest timestamps, magic-link flag). */
function deriveBagStats(
  emails: Email[],
  readEmails: Record<string, boolean>,
  address: string
): {
  messageCount: number;
  unreadCount: number;
  latestReceivedAt: number;
  latestOtpAt: number;
  hasMagicLink: boolean;
} {
  let latestReceivedAt = 0;
  let latestOtpAt = 0;
  let hasMagicLink = false;
  let unreadCount = 0;
  const read = createEmailReadChecker(readEmails);
  for (const email of emails) {
    const receivedAt = typeof email.received_at === 'number' ? email.received_at : 0;
    // Normalize to millis: providers return seconds or ms, and Math.max over a
    // mixed list would otherwise always pick the ms-provider's mail.
    const receivedMs = toMs(receivedAt);
    latestReceivedAt = Math.max(latestReceivedAt, receivedMs);
    if (email.otp) latestOtpAt = Math.max(latestOtpAt, receivedMs);
    if (!read(email.id, email.original_inbox || address)) unreadCount += 1;
    if (email.hasMagicLink || (email.magicLinks?.length ?? 0) > 0) hasMagicLink = true;
  }
  return {
    messageCount: emails.length,
    unreadCount,
    latestReceivedAt,
    latestOtpAt,
    hasMagicLink,
  };
}

/**
 * Recompute one address's metadata entry from its CURRENT bag contents.
 *
 * Pass `null` for a side whose contents are unknown/unchanged to KEEP that
 * side's previous stats; pass an array (even empty) to recompute from it. The
 * stored and archived sides are tracked independently so no writer can clobber
 * the other - the unread badge's fast path always sees stored-derived counts
 * regardless of write order. Bumps the revision by one.
 *
 * Shared by the per-address bag writers (one side), the bulk logical-map
 * writer (both sides), and backup import (conditional sides) so hygiene,
 * archive/restore, and import round trips can never leave stale counts behind.
 */
export function recomputeEmailStorageMetadata(
  previous: EmailStorageMetadata | undefined,
  storedBag: Email[] | null,
  archivedBag: Email[] | null,
  readEmails: Record<string, boolean>,
  address: string
): EmailStorageMetadata {
  const base = previous ?? emptyEmailStorageMetadata();
  const next: EmailStorageMetadata = { ...base, revision: base.revision + 1 };
  if (storedBag !== null) {
    const stats = deriveBagStats(storedBag, readEmails, address);
    next.messageCount = stats.messageCount;
    next.unreadCount = stats.unreadCount;
    next.readStateVersion = 1;
    next.latestReceivedAt = stats.latestReceivedAt;
    next.latestOtpAt = stats.latestOtpAt;
    next.hasMagicLink = stats.hasMagicLink;
  }
  if (archivedBag !== null) {
    const stats = deriveBagStats(archivedBag, readEmails, address);
    next.archivedMessageCount = stats.messageCount;
    next.archivedUnreadCount = stats.unreadCount;
    next.archivedLatestReceivedAt = stats.latestReceivedAt;
  }
  return next;
}

/**
 * Dev/test lock-holder assertion for the per-address bag writers. The three
 * writers below are read-modify-writes over `emailStorageAddressIndex` /
 * `emailStorageMetadata`, so every producer must run inside
 * `emails_storage_lock`. The mutex is non-reentrant, so the writers cannot
 * acquire it themselves and the flow-level callers already do - this assertion
 * turns a future caller forgetting the lock from a silent race into a loud
 * failure. Compiles away in production builds (NODE_ENV === 'production');
 * demo mode (isolated playground data) and low-level storage tests use the
 * explicit `*Unlocked` variants instead.
 */
function assertEmailsStorageLockHeld(callSite: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (!isLockHeld(LOCKS.EMAILS_STORAGE)) {
    throw new Error(
      `${callSite} must run inside withLock('${LOCKS.EMAILS_STORAGE}', ...) - it is a ` +
        'read-modify-write over emailStorageAddressIndex / emailStorageMetadata. Hold the ' +
        'lock at the flow level, or use the explicit *Unlocked variant for sanctioned ' +
        'unlocked producers (demo mode, low-level tests).'
    );
  }
}

/**
 * Persist one stored mailbox bag and update the address index + metadata.
 *
 * LOCK CONTRACT: the caller MUST hold `emails_storage_lock` (see
 * storeNewMessages / restoreArchivedEmailsToStored / checkNewEmails /
 * deleteInbox in the background address flows). Enforced in dev/test by
 * `assertEmailsStorageLockHeld` - a new caller that forgets the lock fails
 * loudly instead of racing. Demo mode (isolated playground data) and
 * low-level tests use `setStoredEmailsForAddressUnlocked` explicitly.
 */
export async function setStoredEmailsForAddress(
  addressId: string,
  address: string,
  emails: Email[],
  additionalStorageData?: Record<string, unknown>
): Promise<void> {
  assertEmailsStorageLockHeld('setStoredEmailsForAddress');
  await setStoredEmailsForAddressUnlocked(addressId, address, emails, additionalStorageData);
}

/**
 * Lock-exempt implementation of `setStoredEmailsForAddress` - only for
 * sanctioned unlocked producers (demo mode) and low-level storage tests.
 * All production callers must go through the asserting public function.
 */
export async function setStoredEmailsForAddressUnlocked(
  addressId: string,
  address: string,
  emails: Email[],
  additionalStorageData?: Record<string, unknown>
): Promise<void> {
  if (!addressId) throw new Error('Cannot persist mailbox emails without an address id');
  const index = await getEmailStorageAddressIndex();
  const metadata = await getEmailStorageMetadata();
  const readResult = await browser.storage.local.get(['readEmails']);
  const readEmails = isBooleanRecord(readResult.readEmails) ? readResult.readEmails : {};
  metadata[addressId] = recomputeEmailStorageMetadata(
    metadata[addressId],
    emails,
    null, // archived bag unchanged - keep its stats
    readEmails,
    address
  );
  if (emails.length === 0) {
    // Check whether the archived bag is also empty - if both are gone the
    // entry is dead weight.
    const archivedBag = await getArchivedEmailsForAddress(addressId);
    if (archivedBag.length === 0) {
      delete index[addressId];
      // Both bags are gone, so the metadata entry is dead weight for the
      // badge's fast path - prune it alongside the index entry.
      delete metadata[addressId];
    } else {
      index[addressId] = address;
    }
  } else {
    index[addressId] = address;
  }
  const patch: Record<string, unknown> = {
    [EMAIL_STORAGE_ADDRESS_INDEX_KEY]: index,
    [EMAIL_STORAGE_METADATA_KEY]: metadata,
    emailStorageSchemaVersion: EMAIL_STORAGE_SCHEMA_VERSION,
  };
  // Commit the mailbox bag with its metadata and any coupled markers in one
  // write, including an empty bag before its optional physical cleanup.
  patch[storedEmailsByAddressKey(addressId)] = emails;
  Object.assign(patch, additionalStorageData);
  await writeWithRetry(patch);
  if (emails.length === 0) {
    // An emptied bag is a removed bag - reads treat absent bags as empty, so
    // an index-pruned empty address leaves no orphan `[]` key behind for the
    // hygiene sweep to collect later.
    await browser.storage.local.remove(storedEmailsByAddressKey(addressId));
  }
}

/** Persist one archived mailbox bag and update the address index.
 *  When the bag is empty AND the active bag for this address is also empty,
 *  the index entry is removed so empty addresses don't accumulate unnecessary
 *  storage reads on every logical-map rebuild.
 *  LOCK CONTRACT: same as setStoredEmailsForAddress - the caller MUST hold
 *  `emails_storage_lock` (enforced in dev/test via assertEmailsStorageLockHeld;
 *  the mutex is non-reentrant so this cannot wrap). */
export async function setArchivedEmailsForAddress(
  addressId: string,
  address: string,
  emails: Email[]
): Promise<void> {
  assertEmailsStorageLockHeld('setArchivedEmailsForAddress');
  await setArchivedEmailsForAddressUnlocked(addressId, address, emails);
}

/**
 * Lock-exempt implementation of `setArchivedEmailsForAddress` - only for
 * sanctioned unlocked producers (demo mode) and low-level storage tests.
 * All production callers must go through the asserting public function.
 */
export async function setArchivedEmailsForAddressUnlocked(
  addressId: string,
  address: string,
  emails: Email[]
): Promise<void> {
  if (!addressId) throw new Error('Cannot persist archived mailbox emails without an address id');
  const index = await getEmailStorageAddressIndex();
  const metadata = await getEmailStorageMetadata();
  const readResult = await browser.storage.local.get(['readEmails']);
  const readEmails = isBooleanRecord(readResult.readEmails) ? readResult.readEmails : {};
  metadata[addressId] = recomputeEmailStorageMetadata(
    metadata[addressId],
    null, // stored bag unchanged - keep its stats
    emails,
    readEmails,
    address
  );
  if (emails.length === 0) {
    const storedBag = await getStoredEmailsForAddress(addressId);
    if (storedBag.length === 0) {
      delete index[addressId];
      // Both bags are gone, so the metadata entry is dead weight for the
      // badge's fast path - prune it alongside the index entry.
      delete metadata[addressId];
    } else {
      index[addressId] = address;
    }
  } else {
    index[addressId] = address;
  }
  const patch: Record<string, unknown> = {
    [EMAIL_STORAGE_ADDRESS_INDEX_KEY]: index,
    [EMAIL_STORAGE_METADATA_KEY]: metadata,
    emailStorageSchemaVersion: EMAIL_STORAGE_SCHEMA_VERSION,
  };
  // Persist the empty bag with the index update before optional cleanup.
  patch[archivedEmailsByAddressKey(addressId)] = emails;
  await writeWithRetry(patch);
  if (emails.length === 0) {
    // An emptied bag is a removed bag - reads treat absent bags as empty, so
    // an index-pruned empty address leaves no orphan `[]` key behind for the
    // hygiene sweep to collect later.
    await browser.storage.local.remove(archivedEmailsByAddressKey(addressId));
  }
}

/** Remove a single per-address bag while retaining the index for recoverable history. */
export async function removeStoredEmailsForAddress(addressId: string): Promise<void> {
  if (!addressId) return;
  await browser.storage.local.remove(storedEmailsByAddressKey(addressId));
}

export async function removeArchivedEmailsForAddress(addressId: string): Promise<void> {
  if (!addressId) return;
  await browser.storage.local.remove(archivedEmailsByAddressKey(addressId));
}

/** Remove both ID-keyed bags and their index entry for a permanently deleted address.
 *  LOCK CONTRACT: same as setStoredEmailsForAddress - the index delete+write
 *  must not interleave with a bag write, so the caller MUST hold
 *  `emails_storage_lock` (deleteInbox does; enforced in dev/test via
 *  assertEmailsStorageLockHeld). */
export async function removeEmailStorageForAddress(addressId: string): Promise<void> {
  assertEmailsStorageLockHeld('removeEmailStorageForAddress');
  await removeEmailStorageForAddressUnlocked(addressId);
}

/**
 * Lock-exempt implementation of `removeEmailStorageForAddress` - only for
 * sanctioned unlocked producers (demo mode) and low-level storage tests.
 * All production callers must go through the asserting public function.
 */
export async function removeEmailStorageForAddressUnlocked(addressId: string): Promise<void> {
  if (!addressId) return;
  const index = await getEmailStorageAddressIndex();
  const metadata = await getEmailStorageMetadata();
  delete index[addressId];
  // Both bags are permanently gone, so the metadata entry is dead weight for
  // the badge's fast path - prune it with the index entry.
  delete metadata[addressId];
  // Clear both bags in the same write that removes their index entry. If
  // physical key cleanup is interrupted, only empty orphan bags remain.
  await writeWithRetry({
    emailStorageAddressIndex: index,
    [EMAIL_STORAGE_METADATA_KEY]: metadata,
    [storedEmailsByAddressKey(addressId)]: [],
    [archivedEmailsByAddressKey(addressId)]: [],
  });
  await browser.storage.local.remove([
    storedEmailsByAddressKey(addressId),
    archivedEmailsByAddressKey(addressId),
  ]);
}

/** Resolve an address id for callers that only have a mailbox address. */
export async function getAddressIdForEmailAddress(address: string): Promise<string | undefined> {
  if (!address) return undefined;
  const records = await getRawAddresses();
  const lower = address.toLowerCase();
  return records.find((record) => record.address?.toLowerCase() === lower)?.id;
}

/**
 * Resolve an address id from the storage index when the record is NOT in the
 * live `addresses` list - evicted-into-overflow mailboxes keep their index
 * entry and ID-keyed bags so their Offline Saved mail stays recoverable.
 */
export async function getAddressIdFromIndex(address: string): Promise<string | undefined> {
  if (!address) return undefined;
  const index = await getEmailStorageAddressIndex();
  const lower = address.toLowerCase();
  for (const [id, addr] of Object.entries(index)) {
    if (addr.toLowerCase() === lower) return id;
  }
  return undefined;
}

/**
 * Persist the current logical maps into stable address-ID bags only.
 *
 * The index is started from the persisted `emailStorageAddressIndex` and
 * RETAINED entries are never pruned here: eviction into
 * `archivedAddressOverflow` removes a mailbox from `addresses` but keeps its
 * index entry + ID-keyed bags so Offline Saved mail stays recoverable
 * (getAddressIdFromIndex / restoreArchivedOverflowAddress). Because the read
 * side (getLogicalEmailMaps) surfaces a bag entry for EVERY index entry
 * (absent = empty), persisting a physical bag only while it holds mail - and
 * REMOVING emptied bags - is the symmetric inverse of the read: a
 * read → mutate → write round trip preserves each retained mailbox's mail as
 * a readable (possibly empty) entry while never leaving dead `[]` keys
 * behind. browser.storage.local is quota-bounded, so emptied bags must not
 * accumulate per retired mailbox; cleanupOldStoredEmails relies on this
 * writer to physically drop mailboxes it emptied. The sole index-prune paths
 * are explicit removeEmailStorageForAddress (permanent delete) and backup
 * replace-import (rebuilds the index from the imported addresses).
 */
async function setLogicalEmailMapsUnlocked(
  storedEmails: Record<string, Email[]>,
  archivedEmails: Record<string, Email[]>,
  addressCommit?: { addresses: Address[]; activeAddressId?: string },
  additionalStorageData?: Record<string, unknown>
): Promise<void> {
  const addresses = addressCommit?.addresses ?? (await getRawAddresses());
  const index = await getEmailStorageAddressIndex();
  for (const record of addresses) {
    if (!record.id || !record.address) continue;
    index[record.id] = record.address;
  }

  // Recompute the per-address metadata from the bags being persisted so
  // hygiene trims / retention cleanup / archive-restore round trips can never
  // leave stale unread counts in the badge fast path. An entry whose bags are
  // BOTH empty - or whose address ID left the index - is dead weight (absent
  // entry = zero badge contribution) and is pruned here.
  const [metadata, readResult] = await Promise.all([
    getEmailStorageMetadata(),
    browser.storage.local.get(['readEmails']),
  ]);
  const readEmails = isBooleanRecord(readResult.readEmails) ? readResult.readEmails : {};

  const patch: Record<string, unknown> = {
    emailStorageSchemaVersion: EMAIL_STORAGE_SCHEMA_VERSION,
  };
  if (addressCommit) {
    // A preferred-domain rename must publish the new address, address index,
    // and its ID-keyed mail bags in the same storage.set transaction.
    patch.addresses = addressCommit.addresses;
    if (addressCommit.activeAddressId) patch.activeAddressId = addressCommit.activeAddressId;
  }
  // Commit empty tombstones with metadata before best-effort removal. If
  // cleanup fails, readers must see the new empty bag rather than old mail.
  // Successful cleanup still removes the unused physical keys.
  const emptyKeys: string[] = [];

  for (const [id, address] of Object.entries(index)) {
    const storedKey = storedEmailsByAddressKey(id);
    const archivedKey = archivedEmailsByAddressKey(id);
    const storedBag = asEmailBag(storedEmails[resolveBagKey(storedEmails, address)]);
    const archivedBag = asEmailBag(archivedEmails[resolveBagKey(archivedEmails, address)]);
    patch[storedKey] = storedBag;
    patch[archivedKey] = archivedBag;
    if (storedBag.length === 0) emptyKeys.push(storedKey);
    if (archivedBag.length === 0) emptyKeys.push(archivedKey);

    if (storedBag.length === 0 && archivedBag.length === 0) {
      // Both bags are gone - the entry is dead weight for the badge fast path.
      delete metadata[id];
      continue;
    }
    metadata[id] = recomputeEmailStorageMetadata(
      metadata[id],
      storedBag,
      archivedBag,
      readEmails,
      address
    );
  }

  // Metadata for address IDs that left the index is unreachable dead weight
  // AND would feed phantom unread counts to the badge fast path - prune it
  // alongside the orphaned bags.
  const indexedIds = new Set(Object.keys(index));
  for (const id of Object.keys(metadata)) {
    if (!indexedIds.has(id)) delete metadata[id];
  }

  patch[EMAIL_STORAGE_ADDRESS_INDEX_KEY] = index;
  patch[EMAIL_STORAGE_METADATA_KEY] = metadata;
  Object.assign(patch, additionalStorageData);
  // This write is the logical commit point. Cleanup only removes empty or
  // legacy bags; failure must not make a caller believe that the address and
  // its mail migration rolled back after the commit already succeeded.
  await writeWithRetry(patch);
  try {
    if (emptyKeys.length > 0) await browser.storage.local.remove(emptyKeys);
    await browser.storage.local.remove(['storedEmails', 'archivedEmails']);
  } catch (error) {
    logWarn('Email storage cleanup deferred after successful commit', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Serialize global email-map mutations with polling and cleanup. Callers that
 * already hold `emails_storage_lock` must use the explicit unlocked helper to
 * avoid recursively acquiring the same non-reentrant mutex.
 */
export async function setLogicalEmailMaps(
  storedEmails: Record<string, Email[]>,
  archivedEmails: Record<string, Email[]>
): Promise<void> {
  await withLock('emails_storage_lock', () =>
    setLogicalEmailMapsUnlocked(storedEmails, archivedEmails)
  );
}

/** Persist a global map mutation while the caller already owns the email lock. */
export async function setLogicalEmailMapsUnlockedForLockedCaller(
  storedEmails: Record<string, Email[]>,
  archivedEmails: Record<string, Email[]>,
  addressCommit?: { addresses: Address[]; activeAddressId?: string },
  additionalStorageData?: Record<string, unknown>
): Promise<void> {
  await setLogicalEmailMapsUnlocked(
    storedEmails,
    archivedEmails,
    addressCommit,
    additionalStorageData
  );
}

/** Read all current 3.0 address-ID bags as logical address-keyed maps. */
async function getLogicalEmailMaps(): Promise<{
  storedEmails: EmailBagMap;
  archivedEmails: EmailBagMap;
}> {
  const index = await getEmailStorageAddressIndex();
  const ids = Object.keys(index);
  if (ids.length === 0) return { storedEmails: {}, archivedEmails: {} };

  const keys = ids.flatMap((id) => [storedEmailsByAddressKey(id), archivedEmailsByAddressKey(id)]);
  const perAddress = (await browser.storage.local.get(keys)) as Record<string, unknown>;
  const storedEmails: EmailBagMap = {};
  const archivedEmails: EmailBagMap = {};
  // Dedup by deduplicated address (case-insensitive): when two index entries
  // point to the same mailbox (casing drift or duplicate import), merge the
  // bags by message ID instead of silently overwriting one address's mail.
  const seenAddrs = new Map<string, string>(); // lower addr → canonical key in the map
  for (const id of ids) {
    const address = index[id];
    const lower = address.toLowerCase();
    const storedKey = storedEmailsByAddressKey(id);
    const archivedKey = archivedEmailsByAddressKey(id);
    const storedBag = asEmailBag(perAddress[storedKey]);
    const archivedBag = asEmailBag(perAddress[archivedKey]);

    const canonical = seenAddrs.get(lower);
    if (canonical) {
      // Merge into the existing canonical bag; keep the first casing so
      // callers always resolve the same key.
      if (storedBag.length > 0) {
        const existing = storedEmails[canonical] || [];
        const existingIds = new Set(existing.map((e) => e.id));
        for (const e of storedBag) {
          if (!existingIds.has(e.id)) {
            existing.push(e);
            existingIds.add(e.id);
          }
        }
        storedEmails[canonical] = existing;
      }
      if (archivedBag.length > 0) {
        const existing = archivedEmails[canonical] || [];
        const existingIds = new Set(existing.map((e) => e.id));
        for (const e of archivedBag) {
          if (!existingIds.has(e.id)) {
            existing.push(e);
            existingIds.add(e.id);
          }
        }
        archivedEmails[canonical] = existing;
      }
    } else {
      seenAddrs.set(lower, address);
      // Surface EVERY indexed mailbox in the logical map - an absent physical
      // bag reads as an empty bag. This is the symmetric inverse of the
      // writers, which persist a physical key only while it holds mail: a
      // retained mailbox with no mail still resolves to `[]` instead of
      // silently vanishing from reads (a lost/migrated bag must never drop a
      // mailbox from the UI).
      storedEmails[address] = storedBag;
      archivedEmails[address] = archivedBag;
    }
  }
  return { storedEmails, archivedEmails };
}

export async function getStoredEmailsMap(): Promise<Record<string, Email[]>> {
  const { storedEmails } = await getLogicalEmailMaps();
  return storedEmails;
}

/** Returns the read-state map (defaults to {} when storage is malformed). */
export async function getReadEmailsMap(): Promise<Record<string, boolean>> {
  const result = await browser.storage.local.get(['readEmails']);
  return isBooleanRecord(result.readEmails) ? result.readEmails : {};
}

/** Recompute one address's compact metadata after a read-state change. */
export async function refreshEmailStorageMetadataForAddress(
  addressId: string,
  address: string,
  readEmails: Record<string, boolean>
): Promise<void> {
  if (!addressId) return;
  await withLock('emails_storage_lock', async () => {
    const [emails, metadata] = await Promise.all([
      getStoredEmailsForAddress(addressId, address),
      getEmailStorageMetadata(),
    ]);
    metadata[addressId] = recomputeEmailStorageMetadata(
      metadata[addressId],
      emails,
      null, // archived bag unchanged - keep its stats
      readEmails,
      address
    );
    await writeWithRetry({ [EMAIL_STORAGE_METADATA_KEY]: metadata });
  });
}

/**
 * Recompute metadata for MANY addresses in ONE locked pass, reading the
 * metadata map once and writing it once. Use for bulk mark-read/unread loops
 * (markAddressesReadUnread) - the per-address variant does a full lease
 * acquire + metadata read/write per call, which amplifies storage writes
 * across large address lists.
 */
export async function refreshEmailStorageMetadataForAddresses(
  readEmails: Record<string, boolean>,
  entries: Array<{ addressId: string; address: string }>
): Promise<void> {
  const targets = entries.filter((entry) => entry.addressId);
  if (targets.length === 0) return;
  await withLock('emails_storage_lock', async () => {
    const metadata = await getEmailStorageMetadata();
    for (const { addressId, address } of targets) {
      const emails = await getStoredEmailsForAddress(addressId, address);
      metadata[addressId] = recomputeEmailStorageMetadata(
        metadata[addressId],
        emails,
        null, // archived bag unchanged - keep its stats
        readEmails,
        address
      );
    }
    await writeWithRetry({ [EMAIL_STORAGE_METADATA_KEY]: metadata });
  });
}

/** Returns archived emails map (defaults to {}). */
export async function getArchivedEmailsMap(): Promise<Record<string, Email[]>> {
  const { archivedEmails } = await getLogicalEmailMaps();
  return archivedEmails;
}

/** Returns both stored and archived logical maps in one explicit global read. */
export async function getEmailMaps(): Promise<{
  storedEmails: Record<string, Email[]>;
  archivedEmails: Record<string, Email[]>;
}> {
  return getLogicalEmailMaps();
}

/** Whether a storage key contains an ID-keyed active or archived email bag. */
export function isEmailStorageBagKey(key: string): boolean {
  return (
    key.startsWith(STORED_EMAILS_BY_ADDRESS_PREFIX) ||
    key.startsWith(ARCHIVED_EMAILS_BY_ADDRESS_PREFIX)
  );
}

/**
 * Find unindexed physical email bags and indexed bags that are empty. Empty
 * bags are equivalent to missing bags for reads and may remain after cleanup
 * is interrupted. A missing or malformed index is treated as unknown.
 */
export function findOrphanedEmailStorageBagKeys(
  storage: Record<string, unknown>,
  index: Record<string, unknown> | null | undefined
): string[] {
  if (
    !isRecord(index) ||
    !Object.entries(index).every(
      ([id, address]) =>
        id.trim().length > 0 && typeof address === 'string' && address.trim().length > 0
    )
  ) {
    return [];
  }
  const indexedKeys = new Set(
    Object.keys(index).flatMap((id) => [
      storedEmailsByAddressKey(id),
      archivedEmailsByAddressKey(id),
    ])
  );
  return Object.keys(storage).filter((key) => {
    if (!isEmailStorageBagKey(key)) return false;
    if (!indexedKeys.has(key)) return true;
    const bag = storage[key];
    return Array.isArray(bag) && bag.length === 0;
  });
}

/** Remove unindexed or empty physical email bags after interrupted cleanup. */
export async function removeOrphanedEmailStorageBags(): Promise<number> {
  return withLock(LOCKS.EMAILS_STORAGE, async () => {
    const storage = (await browser.storage.local.get(null)) as Record<string, unknown>;
    const index = storage[EMAIL_STORAGE_ADDRESS_INDEX_KEY];
    if (!isRecord(index)) return 0;
    const orphanedKeys = findOrphanedEmailStorageBagKeys(storage, index);
    if (orphanedKeys.length > 0) await browser.storage.local.remove(orphanedKeys);
    // Metadata entries for address IDs that left the index are unreachable
    // dead weight AND would feed phantom unread counts to the badge fast
    // path - prune them alongside the orphaned bags (including legacy
    // stragglers whose bags were already swept in an earlier pass).
    const metadata = storage[EMAIL_STORAGE_METADATA_KEY];
    if (isRecord(metadata)) {
      const indexedIds = new Set(Object.keys(index));
      const orphanedMetadataIds = Object.keys(metadata).filter((id) => !indexedIds.has(id));
      if (orphanedMetadataIds.length > 0) {
        for (const id of orphanedMetadataIds) delete metadata[id];
        await writeWithRetry({
          [EMAIL_STORAGE_METADATA_KEY]: metadata,
        });
      }
    }
    return orphanedKeys.length;
  });
}

/**
 * Default notification preferences.
 *
 * One definition for both halves of the key: the readers that need a fallback
 * (`email-storage`'s notification gate, `expiry-manager`) and the parser the
 * writer uses, so materializing defaults on a write can never disagree with
 * what a reader would have assumed.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  soundEnabled: true,
  expiryWarningThreshold: 60 * 60 * 1000,
};

/**
 * Parse a stored notification-settings record, filling absent fields from
 * `DEFAULT_NOTIFICATION_SETTINGS` and dropping values of the wrong type (a
 * corrupt record must not turn the notification gate off silently).
 */
export function parseNotificationSettings(raw: unknown): NotificationSettings {
  const stored = (raw ?? {}) as Partial<NotificationSettings>;
  return {
    enabled:
      typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
    soundEnabled:
      typeof stored.soundEnabled === 'boolean'
        ? stored.soundEnabled
        : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
    expiryWarningThreshold:
      typeof stored.expiryWarningThreshold === 'number' &&
      Number.isFinite(stored.expiryWarningThreshold)
        ? stored.expiryWarningThreshold
        : DEFAULT_NOTIFICATION_SETTINGS.expiryWarningThreshold,
  };
}

/** Default Analytics shape used as fallback across analytics helpers. */
export const DEFAULT_ANALYTICS: Analytics = {
  accountsCreated: 0,
  emailsReceived: 0,
  otpsDetected: 0,
  notificationsSent: 0,
  extensionOpens: 0,
  emailsRead: 0,
  pageVisits: {},
  storageTrend: [],
  performance: {
    emailFetchTimes: [],
    providerLatency: {},
    uiRenderTimes: [],
  },
};

/** Returns the analytics object (defaults to DEFAULT_ANALYTICS). */
export async function getAnalyticsRecord(): Promise<Analytics> {
  const { analytics } = (await browser.storage.local.get(['analytics'])) as {
    analytics?: Analytics;
  };
  if (analytics) return analytics;
  // Deep copy to avoid mutating the DEFAULT_ANALYTICS constant
  return {
    ...DEFAULT_ANALYTICS,
    performance: {
      emailFetchTimes: [...(DEFAULT_ANALYTICS.performance?.emailFetchTimes ?? [])],
      providerLatency: {
        ...(DEFAULT_ANALYTICS.performance?.providerLatency ?? {}),
      },
      uiRenderTimes: [...(DEFAULT_ANALYTICS.performance?.uiRenderTimes ?? [])],
    },
  };
}

/** Persists the analytics object. */
export async function setAnalyticsRecord(analytics: Analytics): Promise<void> {
  await writeWithRetry({ analytics });
}

/** Returns the email retention days setting (defaults to 30). */
export async function getEmailRetentionDays(): Promise<number> {
  const { emailRetentionDays = 30 } = (await browser.storage.local.get(['emailRetentionDays'])) as {
    emailRetentionDays?: unknown;
  };
  if (typeof emailRetentionDays === 'number' && Number.isFinite(emailRetentionDays)) {
    // 0 (or any non-positive value) means "Never delete" - the retention UI's
    // first option (storagePerformance.neverDelete) persists exactly 0, and
    // cleanupOldStoredEmails / use-retention-cleanup treat <= 0 as keep-all.
    // Clamping it to 1 here would make the background delete mail the user
    // asked to keep forever.
    if (emailRetentionDays <= 0) return 0;
    // Positive values clamp to at least 1 day: a fractional value such as 0.4
    // must not round to 0, which cleanup would silently read as "never delete".
    return Math.min(365, Math.max(1, Math.round(emailRetentionDays)));
  }
  return 30;
}

/** Default cap on how many archived inbox records are kept in `addresses` before
 * the oldest are moved to the recoverable overflow list. */
export const DEFAULT_MAX_ARCHIVED_INBOXES = 50;

/**
 * How many archived inbox records to keep before evicting the oldest into
 * `archivedAddressOverflow`. 0 means "keep all" (no eviction).
 */
export async function getMaxArchivedAddresses(): Promise<number> {
  const { maxArchivedAddresses } = (await browser.storage.local.get(['maxArchivedAddresses'])) as {
    maxArchivedAddresses?: number;
  };
  if (typeof maxArchivedAddresses === 'number' && Number.isFinite(maxArchivedAddresses)) {
    return Math.max(0, Math.floor(maxArchivedAddresses));
  }
  return DEFAULT_MAX_ARCHIVED_INBOXES;
}

/** Records evicted from `addresses` past the archived-inbox cap - kept recoverable
 * (address + credentials intact) so the user can restore/renew them later. */
export async function getArchivedAddressOverflow(): Promise<Address[]> {
  const { archivedAddressOverflow = [] } = (await browser.storage.local.get([
    'archivedAddressOverflow',
  ])) as { archivedAddressOverflow?: Address[] };
  return Array.isArray(archivedAddressOverflow) ? archivedAddressOverflow : [];
}

export async function setArchivedAddressOverflow(records: Address[]): Promise<void> {
  await writeWithRetry({ archivedAddressOverflow: records });
}

/** Returns the current per-email label map. */
export async function getEmailLabelsMap(): Promise<Record<string, string[]>> {
  const { emailLabels } = (await browser.storage.local.get(['emailLabels'])) as {
    emailLabels?: unknown;
  };
  if (!emailLabels || typeof emailLabels !== 'object' || Array.isArray(emailLabels)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(emailLabels as Record<string, unknown>)) {
    if (Array.isArray(v) && v.every((e) => typeof e === 'string')) out[k] = v as string[];
  }
  return out;
}

/** Persists the current per-email label map. */
export async function setEmailLabelsMap(emailLabels: Record<string, string[]>): Promise<void> {
  await withLock('email_labels_lock', async () => {
    await writeWithRetry({ emailLabels });
  });
}

/** Atomically read, update, and persist the per-email label map. */
export async function updateEmailLabelsMap(
  updater: (current: Record<string, string[]>) => Record<string, string[]>
): Promise<void> {
  await withLock('email_labels_lock', async () => {
    const current = await getEmailLabelsMap();
    const next = updater(current);
    if (next !== current) await writeWithRetry({ emailLabels: next });
  });
}

/** Returns the auto-refresh interval in milliseconds (defaults to 30000ms = 30s). 0 means manual only. */
export async function getAutoRefreshInterval(): Promise<number> {
  const { autoRefreshInterval = 30000 } = (await browser.storage.local.get([
    'autoRefreshInterval',
  ])) as {
    autoRefreshInterval?: unknown;
  };
  if (typeof autoRefreshInterval === 'number' && Number.isFinite(autoRefreshInterval)) {
    // Clamp: minimum 10s (10_000), maximum 1h (3_600_000), 0 means manual only
    if (autoRefreshInterval === 0) return 0;
    return Math.max(10_000, Math.min(3_600_000, autoRefreshInterval));
  }
  return 30000;
}

/** Returns the provider instances list (defaults to []). */
export async function getProviderInstancesList(): Promise<ProviderInstance[]> {
  const { providerInstances = [] } = (await browser.storage.local.get(['providerInstances'])) as {
    providerInstances?: ProviderInstance[];
  };
  return providerInstances;
}
