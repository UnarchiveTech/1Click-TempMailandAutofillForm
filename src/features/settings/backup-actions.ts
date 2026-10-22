/**
 * Backup export / import with multi-category selection, expiry policy,
 * merge/replace, optional password encryption, and dry-run preview.
 */

import { LAST_BACKUP_AT_KEY } from '@/features/backup/backup-export-status.js';
import { normalizeRuleDomain, validArchiveDays } from '@/features/intelligence/rule-validation.js';
import {
  type ArchiveScheduleEntry,
  reconcileArchiveScheduleMap,
} from '@/features/intelligence/site-rules.js';
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';
import { canonicalJson } from '@/utils/canonical-json.js';
import { CONSTANTS } from '@/utils/constants.js';
import { loadProviderConfig } from '@/utils/email/email-service.js';
import { BaseExtensionError, ErrorCode, ErrorSeverity } from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import type { EmailStorageMetadata } from '@/utils/storage/storage-keys.js';
import {
  archivedEmailsByAddressKey,
  recomputeEmailStorageMetadata,
  storedEmailsByAddressKey,
} from '@/utils/storage/storage-keys.js';
import { hasLiveExpiry } from '@/utils/storage/storage-shape-guards.js';
import { captureImportUndoSnapshot, IMPORT_UNDO_KEY } from '@/utils/storage/storage-snapshot.js';
import {
  areaOf,
  removeAreaOf,
  removeWithRetry,
  writeWithRetry,
} from '@/utils/storage/storage-write.js';
import { markAddressMutation } from '@/utils/storage/undo-generation.js';
import { localDateStamp } from '@/utils/time/time-format.js';
import type { Address, Email } from '@/utils/types.js';

/**
 * Build a backup error carrying a stable `errors.*` translationKey (via the
 * ErrorCode map). The English `message` is dev/log text only - a UI layer
 * renders the key through `localizedErrorMessageOrFallback()` so users see
 * their own language.
 */
function backupError(
  code: ErrorCode,
  message: string,
  options?: { translationKey: string }
): BaseExtensionError {
  return new BaseExtensionError(
    message,
    code,
    ErrorSeverity.LOW,
    undefined,
    undefined,
    options?.translationKey
  );
}

// Backups accept only the supported, bounded Argon2id profile.
export const MIN_BACKUP_PASSWORD_LENGTH = 12;

/** Imported rules are data only: require explicit review before enabling actions. */
function sanitizeImportedMailboxRules(value: unknown, now: number): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const validFields = new Set([
    'sender',
    'senderOrRecipient',
    'recipient',
    'subject',
    'body',
    'anywhere',
  ]);
  const sanitizeStringList = (input: unknown): string[] | undefined => {
    if (!Array.isArray(input)) return undefined;
    const items = input
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 254))
      .filter(Boolean)
      .slice(0, 50);
    return items.length ? items : undefined;
  };

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const rule = item as Record<string, unknown>;
    if (
      typeof rule.id !== 'string' ||
      !rule.id.trim() ||
      rule.id.length > 128 ||
      typeof rule.contains !== 'string' ||
      !rule.contains.trim() ||
      rule.contains.length > 200
    ) {
      return [];
    }
    const autoArchiveDays = rule.autoArchiveDays;
    const safeArchiveDays =
      typeof autoArchiveDays === 'number' &&
      Number.isInteger(autoArchiveDays) &&
      autoArchiveDays >= 1 &&
      autoArchiveDays <= 365
        ? autoArchiveDays
        : null;
    return [
      {
        id: rule.id.trim(),
        name: typeof rule.name === 'string' ? rule.name.slice(0, 120) : rule.contains.slice(0, 120),
        // Imported automation stays inert until the user reviews and enables it.
        enabled: false,
        field:
          rule.field === 'sender' && rule.matchingVersion !== 2
            ? 'senderOrRecipient'
            : validFields.has(String(rule.field))
              ? rule.field
              : 'sender',
        matchingVersion: 2,
        contains: rule.contains.trim(),
        senderAllowlist: sanitizeStringList(rule.senderAllowlist),
        recipientAllowlist: sanitizeStringList(rule.recipientAllowlist),
        label:
          typeof rule.label === 'string' ? rule.label.trim().slice(0, 64) || undefined : undefined,
        autoArchiveDays: safeArchiveDays,
        silenceNotifications: rule.silenceNotifications === true,
        // Never import actions that copy secrets or initiate outbound mail.
        autoCopyOtp: false,
        createdAt:
          typeof rule.createdAt === 'number' && Number.isFinite(rule.createdAt)
            ? rule.createdAt
            : now,
        updatedAt: now,
      },
    ];
  });
}

function sanitizeImportedSiteRules(value: unknown, now: number): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const rule = item as Record<string, unknown>;
    if (
      typeof rule.id !== 'string' ||
      !rule.id.trim() ||
      rule.id.length > 128 ||
      typeof rule.domainPattern !== 'string'
    )
      return [];
    const domainPattern = normalizeRuleDomain(rule.domainPattern);
    if (!domainPattern) return [];
    return [
      {
        id: rule.id.trim(),
        name: typeof rule.name === 'string' ? rule.name.slice(0, 120) : domainPattern,
        domainPattern,
        includeSubdomains: rule.includeSubdomains !== false,
        enabled: false,
        identityId: typeof rule.identityId === 'string' ? rule.identityId : null,
        providerId: typeof rule.providerId === 'string' ? rule.providerId : null,
        autoArchiveDays: validArchiveDays(rule.autoArchiveDays)
          ? (rule.autoArchiveDays ?? null)
          : null,
        createdAt:
          typeof rule.createdAt === 'number' && Number.isFinite(rule.createdAt)
            ? rule.createdAt
            : now,
        updatedAt: now,
      },
    ];
  });
}

async function deriveBackupKey(
  password: string,
  saltHex: string,
  kdf?: import('@/utils/security/crypto.js').Argon2idKdf
): Promise<CryptoKey> {
  const { deriveKeyFromPassword, ARGON2ID_KDF } = await import('@/utils/security/crypto.js');
  return deriveKeyFromPassword(password, saltHex, kdf ?? ARGON2ID_KDF);
}

// ── Categories ───────────────────────────────────────────────────────────────

export type BackupCategory =
  | 'settings'
  | 'identities'
  | 'savedLogins'
  | 'addresses'
  | 'filters'
  | 'mailboxRules'
  | 'siteRules';

/** How to treat expired inbox sessions on import. */
export type ExpiredAddressMode = 'skip' | 'renewableOnly' | 'all';

/** Merge keeps existing items; replace overwrites selected categories. */
export type ConflictPolicy = 'merge' | 'replace';

export const ALL_BACKUP_CATEGORIES: BackupCategory[] = [
  'settings',
  'identities',
  'savedLogins',
  'addresses',
  'filters',
  'mailboxRules',
  'siteRules',
];

export const BACKUP_CATEGORY_META: Record<BackupCategory, { icon: KnownIconName }> = {
  settings: { icon: 'settings' },
  identities: { icon: 'person' },
  savedLogins: { icon: 'lock' },
  addresses: { icon: 'mail' },
  filters: { icon: 'filter' },
  mailboxRules: { icon: 'threads' },
  siteRules: { icon: 'filter' },
};

export const BACKUP_CATEGORY_KEYS: Record<BackupCategory, readonly string[]> = {
  settings: [
    'verificationPreferences',
    'themeMode',
    'contrastLevel',
    'customColor',
    'autoCopy',
    'autoRenew',
    'autoRenewScope',
    'preExpiryWindowMinutes',
    'selectedProvider',
    'passwordSettings',
    'nameSettings',
    'developerSettings',
    'emailRetentionDays',
    'faviconCaching',
    'providerInstances',
    'toastsEnabled',
    'notificationSettings',
    'keybindings',
    'autoRefreshInterval',
    'preferredLanguage',
    'autofillFeatureEnabled',
    'autofillBlocklist',
    'customEmailSettings',
  ],
  identities: ['identities', 'selectedIdentityId'],
  savedLogins: ['loginInfo', 'emailHistory'],
  addresses: ['addresses', 'activeAddressId', 'storedEmails', 'archivedEmails'],
  filters: ['savedSearchFilters'],
  mailboxRules: ['mailboxRules'],
  siteRules: ['siteRules'],
};

const SETTINGS_IMPORT_KEYS = [
  'verificationPreferences',
  'themeMode',
  'contrastLevel',
  'customColor',
  'autoCopy',
  'autoRenew',
  'preExpiryWindowMinutes',
  'selectedProvider',
  'passwordSettings',
  'nameSettings',
  'developerSettings',
  'emailRetentionDays',
  'faviconCaching',
  'providerInstances',
  'toastsEnabled',
  'notificationSettings',
  'keybindings',
  'autoRefreshInterval',
  'preferredLanguage',
  'autofillFeatureEnabled',
  'autofillBlocklist',
  'customEmailSettings',
] as const;

export interface BackupSelection {
  categories: BackupCategory[];
  /** Import: include stored/archived email bags when importing addresses. Default true. */
  includeEmails?: boolean;
  /**
   * Import: expired inbox policy. Default 'skip'.
   * - skip: drop all expired
   * - renewableOnly: import expired only if provider is renewable
   * - all: import every expired (non-renewable → archived)
   */
  expiredMode?: ExpiredAddressMode;
  /** @deprecated prefer expiredMode - true maps to 'all', false to 'skip' */
  includeExpiredAddresses?: boolean;
  /** Import: merge (default) or replace selected categories. */
  conflictPolicy?: ConflictPolicy;
  /** Export: strip passwords/tokens for a shareable config-only backup. */
  excludeSecrets?: boolean;
  /** Optional password to encrypt (export) or decrypt (handled at parse). */
  password?: string;
}

export interface BackupFileV3 {
  version: string;
  exportDate: string;
  categories?: BackupCategory[] | 'all';
  data: Record<string, unknown>;
  /** True when secrets were stripped at export. */
  secretsExcluded?: boolean;
  /**
   * SHA-256 hex over the canonical JSON of `data` (plain backups only).
   * Detects corruption / tampering on import. Encrypted backups rely on
   * AES-GCM's own integrity instead.
   */
  integrityHash?: string;
  /**
   * SHA-256 hex fingerprint of the device master key used to encrypt the
   * secrets inside `data` (inbox tokens, login passwords, custom passwords).
   * On import, a mismatch against the current install's key is surfaced so
   * restoring over existing data cannot silently mix undecryptable ciphertext
   * with live data. Omitted when `secretsExcluded` is true.
   */
  keyFingerprint?: string;
}

/** On-disk format when password-protected. */
export interface EncryptedBackupFile {
  version: string;
  encrypted: true;
  salt: string;
  ciphertext: string; // ivHex:dataHex of JSON BackupFileV3
  exportDate?: string;
  /** Versioned Argon2id profile used to derive the backup key. */
  kdf?: import('@/utils/security/crypto.js').Argon2idKdf;
  /**
   * The exporting device's master key JWK, encrypted with the backup password
   * (ivHex:dataHex, same salt + KDF profile as `ciphertext`). Present only when
   * the backup contains master-key ciphertext (inbox tokens, login passwords,
   * custom passwords). Lets a restore on ANOTHER device unwrap the original
   * key, decrypt the imported secrets, and re-encrypt them with the local key
   * - a true cross-machine restore instead of silently-importable garbage.
   * Without this (plain, un-encrypted backups) the data stays device-bound.
   */
  wrappedMasterKey?: string;
}

export interface BackupInspection {
  presentCategories: BackupCategory[];
  exportDate?: string;
  version?: string;
  secretsExcluded?: boolean;
  approximateBytes?: number;
  counts: {
    identities: number;
    savedLogins: number;
    addressesTotal: number;
    addressesActive: number;
    addressesExpired: number;
    addressesExpiredRenewable: number;
    addressesExpiredNonRenewable: number;
    filters: number;
    mailboxRules: number;
    siteRules: number;
    storedEmailBags: number;
  };
}

export interface ImportPreview {
  newIdentities: number;
  skippedExistingIdentities: number;
  newLogins: number;
  skippedExistingLogins: number;
  newFilters: number;
  skippedExistingFilters: number;
  newRules: number;
  skippedExistingRules: number;
  addressesToImport: number;
  addressesNew: number;
  addressesExisting: number;
  skippedExpiredAddresses: number;
  renewableExpiredToImport: number;
  nonRenewableExpiredToImport: number;
  settingsKeys: number;
  willReplace: boolean;
  /**
   * Number of secret VALUES (tokens/passwords) that would be DROPPED on this
   * device - the backup's key fingerprint differs and its ciphertext cannot be
   * decrypted with the current key (e.g. restoring your own plain backup after
   * a full wipe re-keyed the device). 0 when secrets import intact or the drop
   * path isn't triggered. Counts per value, mirroring `inspectCiphertextStores`
   * (token and sidToken count separately).
   */
  secretsDroppable: number;
  /**
   * True when the import would be BLOCKED before writing anything: the backup
   * was created under a different device key and the current install already
   * holds secret-bearing data, so importing would mix undecryptable keys.
   */
  secretsImportBlocked: boolean;
}

export interface ImportSummary {
  imported: Partial<Record<BackupCategory, number>>;
  skippedExpiredAddresses: number;
  importedAddresses: number;
  /** Expired renewable addresses that were imported (for “try renew” CTA). */
  renewableExpiredImported: number;
  conflictPolicy: ConflictPolicy;
  /**
   * True when this replace-mode address import snapshotted the pre-import
   * storage surface (addresses / activeAddressId / emailStorageAddressIndex /
   * archivedAddressOverflow / ID-keyed bags) so the UI can offer a true undo.
   */
  undoAvailable?: boolean;
  /** Revision the offered undo was created under (stale-generation guard). */
  undoRevision?: string;
  /**
   * True when the backup was created under a DIFFERENT device master key and
   * was imported anyway (target categories had no pre-existing data, so no
   * keys were mixed). Encrypted secrets in such a backup may not decrypt on
   * this device - the UI surfaces this as a warning.
   */
  keyFingerprintMismatch?: boolean;
  /**
   * True when the backup's secret fields (tokens, passwords) could NOT be
   * decrypted with the current device key (e.g. restoring your own plain
   * backup after a full wipe re-keyed the device) and were dropped instead of
   * importing known-undecryptable ciphertext. Structure imports; secrets must
   * be re-added / re-authenticated by the user.
   */
  secretsDropped?: boolean;
  /**
   * The addresses that were actually imported WITHOUT their credentials
   * (token/sidToken dropped because they couldn't decrypt on this device).
   * The UI uses this to offer a per-inbox re-authenticate walkthrough instead
   * of leaving the user to rediscover which mailboxes are dead.
   */
  secretsDroppedAddresses?: Array<{
    id: string;
    address: string;
    provider: string;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isProviderRenewable(provider: string): boolean {
  try {
    return loadProviderConfig(provider).expiry?.renewable ?? false;
  } catch {
    /* ignore */
    return false;
  }
}

export function isAddressExpired(account: Pick<Address, 'expiresAt'>, now = Date.now()): boolean {
  // Shared expiry-liveness rule (storage-shape-guards.ts): a PRESENT-but-garbage
  // expiry (string epoch, NaN) is DEAD - `now > exp` on a string compared as NaN
  // returned false and read a dead mailbox as live. expiresAt <= 0 still means
  // "no expiry" / unknown - live.
  return !hasLiveExpiry(account.expiresAt, now);
}

export function resolveExpiredMode(selection: BackupSelection): ExpiredAddressMode {
  if (selection.expiredMode) return selection.expiredMode;
  if (selection.includeExpiredAddresses === true) return 'all';
  return 'skip';
}

/**
 * Normalize an inbox on import.
 * Non-renewable expired active addresses become archived (history only).
 */
export function normalizeImportedAddress(account: Address, now = Date.now()): Address {
  const expired = isAddressExpired(account, now);
  if (!expired) return account;

  const renewable = isProviderRenewable(account.provider);
  if (!renewable && (account.accountStatus === 'active' || !account.accountStatus)) {
    return { ...account, accountStatus: 'archived' };
  }
  return account;
}

/** Whether an expired inbox should be imported under the given mode. */
export function shouldImportExpiredAddress(
  account: Address,
  mode: ExpiredAddressMode,
  now = Date.now()
): boolean {
  if (!isAddressExpired(account, now)) return true;
  if (mode === 'skip') return false;
  if (mode === 'all') return true;
  // renewableOnly
  return isProviderRenewable(account.provider);
}

export function keysForCategories(categories: BackupCategory[]): string[] {
  const keys = new Set<string>();
  for (const cat of categories) {
    for (const k of BACKUP_CATEGORY_KEYS[cat]) keys.add(k);
  }
  return [...keys];
}

type BackupStorage = {
  storage: {
    local: {
      get: (keys: string[] | null) => Promise<Record<string, unknown>>;
      set?: (items: Record<string, unknown>) => Promise<void>;
      remove?: (keys: string | string[]) => Promise<void>;
    };
  };
};

/**
 * Overlay current ID-keyed mailbox bags onto the backup-shaped object.
 */
async function hydrateEmailMapsForBackup(
  ext: BackupStorage,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!Array.isArray(data.addresses)) return data;
  // Clone the live index so we never mutate the storage object in-place, and
  // use it only as a lookup: for each address in the backup, find its bag ID
  // and hydrate. Never pull bags for addresses NOT in this backup - a partial
  // export must not silently include unrelated mailboxes.
  const marker = await ext.storage.local.get(['emailStorageAddressIndex']);
  const liveIndex =
    marker.emailStorageAddressIndex && typeof marker.emailStorageAddressIndex === 'object'
      ? { ...(marker.emailStorageAddressIndex as Record<string, string>) }
      : {};
  const addresses = data.addresses as Array<{ id?: string; address?: string }>;
  // Build a reverse map: address → id for fast lookup
  const addrToId: Record<string, string> = {};
  for (const [id, addr] of Object.entries(liveIndex)) {
    if (addr) addrToId[addr.toLowerCase()] = id;
  }
  // Collect only the IDs referenced by this backup's addresses
  const ids = new Set<string>();
  for (const record of addresses) {
    if (record.id && record.address) ids.add(record.id);
    // Also try to resolve by address for records that have an address but no id
    if (record.address && !record.id) {
      const resolved = addrToId[record.address.toLowerCase()];
      if (resolved) ids.add(resolved);
    }
  }
  // Also add IDs for backup addresses that appear in the live index
  for (const record of addresses) {
    if (record.address) {
      const resolved = addrToId[record.address.toLowerCase()];
      if (resolved) ids.add(resolved);
    }
  }
  if (ids.size === 0) return data;
  const idList = [...ids];
  const keys = idList.flatMap((id) => [
    storedEmailsByAddressKey(id),
    archivedEmailsByAddressKey(id),
  ]);
  const per = await ext.storage.local.get(keys);
  const stored =
    data.storedEmails && typeof data.storedEmails === 'object'
      ? { ...(data.storedEmails as Record<string, unknown>) }
      : {};
  const archived =
    data.archivedEmails && typeof data.archivedEmails === 'object'
      ? { ...(data.archivedEmails as Record<string, unknown>) }
      : {};
  for (const id of idList) {
    const address = liveIndex[id];
    if (!address) continue;
    const storedKey = storedEmailsByAddressKey(id);
    const archivedKey = archivedEmailsByAddressKey(id);
    if (per[storedKey] !== undefined) stored[address] = per[storedKey];
    if (per[archivedKey] !== undefined) archived[address] = per[archivedKey];
  }
  return { ...data, storedEmails: stored, archivedEmails: archived };
}

async function persistImportedEmailBags(
  ext: BackupStorage,
  data: Record<string, unknown>,
  writeBags = true,
  additionalPatch: Record<string, unknown> = {},
  policy: ConflictPolicy = 'replace'
): Promise<void> {
  if (!Array.isArray(data.addresses) || !ext.storage.local.set) return;
  const addresses = data.addresses as Array<{ id?: string; address?: string }>;
  const stored = (data.storedEmails || {}) as Record<string, unknown>;
  const archived = (data.archivedEmails || {}) as Record<string, unknown>;
  // Snapshot the pre-import index so a replace import can later remove the
  // now-orphaned per-address bags instead of leaking them for good.
  const previousIndex = (await ext.storage.local.get(['emailStorageAddressIndex']))
    .emailStorageAddressIndex as Record<string, string> | undefined;
  const index: Record<string, string> =
    writeBags && policy === 'replace' ? {} : { ...(previousIndex || {}) };
  const patch: Record<string, unknown> = {};

  // Recompute metadata for bags that came from THIS backup so a replace
  // import can't leave stale unread counts in the badge fast path, and prune
  // metadata for addresses that left the index (mirroring the orphan-bag
  // sweep below). Addresses whose bags were NOT part of the backup keep their
  // existing metadata - their physical bags are untouched, so it stays valid.
  let metadata: Record<string, unknown> = {};
  let readEmails: Record<string, boolean> = {};
  if (writeBags) {
    const metaResult = await ext.storage.local.get(['emailStorageMetadata', 'readEmails']);
    if (metaResult.emailStorageMetadata && typeof metaResult.emailStorageMetadata === 'object') {
      metadata = {
        ...(metaResult.emailStorageMetadata as Record<string, unknown>),
      };
    }
    if (metaResult.readEmails && typeof metaResult.readEmails === 'object') {
      readEmails = metaResult.readEmails as Record<string, boolean>;
    }
  }

  for (const record of addresses) {
    if (!record.id || !record.address) continue;
    index[record.id] = record.address;
    if (!writeBags) continue;
    const lower = record.address.toLowerCase();
    const storedKey = Object.keys(stored).find((key) => key.toLowerCase() === lower);
    const archivedKey = Object.keys(archived).find((key) => key.toLowerCase() === lower);
    // Only write a bag when the backup explicitly contains that address. This
    // preserves existing mail for addresses omitted from a partial/merge
    // backup instead of replacing it with an empty array.
    if (storedKey !== undefined) {
      patch[storedEmailsByAddressKey(record.id)] = stored[storedKey];
    }
    if (archivedKey !== undefined) {
      patch[archivedEmailsByAddressKey(record.id)] = archived[archivedKey];
    }
    const storedBag =
      storedKey !== undefined && Array.isArray(stored[storedKey]) ? stored[storedKey] : null;
    const archivedBag =
      archivedKey !== undefined && Array.isArray(archived[archivedKey])
        ? archived[archivedKey]
        : null;
    if (storedBag === null && archivedBag === null) continue;
    if (
      storedBag !== null &&
      archivedBag !== null &&
      storedBag.length === 0 &&
      archivedBag.length === 0
    ) {
      // Both bags came from the backup AND are empty - the entry is dead
      // weight for the badge fast path, so prune it.
      delete metadata[record.id];
      continue;
    }
    metadata[record.id] = recomputeEmailStorageMetadata(
      metadata[record.id] as EmailStorageMetadata | undefined,
      storedBag as Email[] | null,
      archivedBag as Email[] | null,
      readEmails,
      record.address
    );
  }

  // Prune metadata entries whose address ID left the new index - unreachable
  // dead weight that would otherwise feed phantom unread counts to the badge.
  const indexedIds = new Set(Object.keys(index));
  for (const id of Object.keys(metadata)) {
    if (!indexedIds.has(id)) delete metadata[id];
  }

  await writeWithRetry(
    {
      ...additionalPatch,
      ...patch,
      // Merge imports retain IDs that were not part of the partial backup. A
      // replace import with emails intentionally rebuilds the index; a replace
      // import without emails leaves all mail bags and their index untouched.
      emailStorageAddressIndex: index,
      emailStorageSchemaVersion: 1,
      // Only write metadata when bags were rewritten - otherwise the object
      // above is empty and must not clobber live metadata.
      ...(writeBags ? { emailStorageMetadata: metadata } : {}),
    },
    // The read above went through the caller's `ext` - the write must land in
    // the same area (see `areaOf`).
    areaOf(ext)
  );

  // H-3: prune bag keys for mailboxes that left the index. A replace import
  // (or expired-mode skip) can drop addresses, and each dropped one otherwise
  // leaves its storedEmailsByAddress_*/archivedEmails_* keys behind forever,
  // eating quota. Merge keeps every existing id (new index ⊇ old), so the
  // diff is empty there and removal is naturally policy-correct.
  if (writeBags && ext.storage.local.remove && previousIndex) {
    const newIds = new Set(Object.keys(index));
    const orphanIds = Object.keys(previousIndex).filter((id) => !newIds.has(id));
    if (orphanIds.length > 0) {
      const orphanKeys: string[] = [];
      for (const id of orphanIds) {
        orphanKeys.push(storedEmailsByAddressKey(id), archivedEmailsByAddressKey(id));
      }
      try {
        // Same retry policy as the write above - this sweep is the only thing
        // that ever deletes these keys, so a transient failure would orphan
        // them for good. Still best-effort: the import itself already
        // succeeded, so a final failure must not surface as an import error.
        await removeWithRetry(orphanKeys, removeAreaOf(ext));
      } catch {
        // best-effort sweep; import itself already succeeded
      }
    }
  }
}

export function inferPresentCategories(data: Record<string, unknown>): BackupCategory[] {
  const present: BackupCategory[] = [];
  for (const cat of ALL_BACKUP_CATEGORIES) {
    if (cat === 'settings') {
      if (BACKUP_CATEGORY_KEYS.settings.some((key) => key in data)) present.push(cat);
      continue;
    }
    if (BACKUP_CATEGORY_KEYS[cat].some((key) => key in data)) present.push(cat);
  }
  return present;
}

function countFromData(data: Record<string, unknown>, now = Date.now()) {
  const addresses = Array.isArray(data.addresses) ? (data.addresses as Address[]) : [];
  let addressesActive = 0;
  let addressesExpired = 0;
  let addressesExpiredRenewable = 0;
  let addressesExpiredNonRenewable = 0;

  for (const record of addresses) {
    if (!record || typeof record !== 'object') continue;
    if (isAddressExpired(record, now)) {
      addressesExpired++;
      if (isProviderRenewable(String(record.provider || ''))) {
        addressesExpiredRenewable++;
      } else {
        addressesExpiredNonRenewable++;
      }
    } else {
      addressesActive++;
    }
  }

  const stored =
    data.storedEmails && typeof data.storedEmails === 'object'
      ? Object.keys(data.storedEmails as object).length
      : 0;
  const archived =
    data.archivedEmails && typeof data.archivedEmails === 'object'
      ? Object.keys(data.archivedEmails as object).length
      : 0;

  return {
    identities: Array.isArray(data.identities) ? data.identities.length : 0,
    savedLogins: Array.isArray(data.loginInfo) ? data.loginInfo.length : 0,
    addressesTotal: addresses.length,
    addressesActive,
    addressesExpired,
    addressesExpiredRenewable,
    addressesExpiredNonRenewable,
    filters: Array.isArray(data.savedSearchFilters) ? data.savedSearchFilters.length : 0,
    mailboxRules: Array.isArray(data.mailboxRules) ? data.mailboxRules.length : 0,
    siteRules: Array.isArray(data.siteRules) ? data.siteRules.length : 0,
    storedEmailBags: stored + archived,
  };
}

export function inspectBackup(
  payload: BackupFileV3,
  now = Date.now(),
  approximateBytes?: number
): BackupInspection {
  const data = payload.data || {};
  return {
    presentCategories: inferPresentCategories(data),
    exportDate: payload.exportDate,
    version: payload.version,
    secretsExcluded: payload.secretsExcluded,
    approximateBytes,
    counts: countFromData(data, now),
  };
}

/** Inspect live storage for export preview (selected categories only). */
export async function inspectLocalForExport(
  ext: {
    storage: {
      local: {
        get: (keys: string[] | null) => Promise<Record<string, unknown>>;
      };
    };
  },
  categories: BackupCategory[],
  now = Date.now()
): Promise<BackupInspection> {
  const keys = keysForCategories(categories.length ? categories : ALL_BACKUP_CATEGORIES);
  const raw = await ext.storage.local.get(keys);
  const data = (categories.length ? categories : ALL_BACKUP_CATEGORIES).includes('addresses')
    ? await hydrateEmailMapsForBackup(ext, { ...raw })
    : raw;
  const payload: BackupFileV3 = {
    version: '3.0',
    exportDate: new Date().toISOString(),
    data,
  };
  return inspectBackup(payload, now);
}

function stripSensitiveFields(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  // NOTE: `passwordSettings.customPassword` is deliberately KEPT here - it is
  // master-key ciphertext (same class as inbox tokens / login passwords), so
  // it ships in plain and encrypted backups alike. That keeps the whole
  // secret-handling pipeline live: `dataContainsSecrets` (key wrapping),
  // `reencryptCiphertextStores` (cross-device restore), and the import
  // key-mixing guard all depend on the field surviving into the payload.
  // `stripSecretsFromData` (Exclude secrets export) still removes it.
  // Profile pictures are large data URLs - never ship in default backup payload size / leak risk
  if (Array.isArray(out.identities)) {
    out.identities = (out.identities as Record<string, unknown>[]).map((item) => {
      const copy = { ...item };
      delete copy.profilePicture;
      return copy;
    });
  }
  return out;
}

/** Stronger strip for “export without secrets” / shareable config. */
export function stripSecretsFromData(data: Record<string, unknown>): Record<string, unknown> {
  const out = stripSensitiveFields(data);

  if (Array.isArray(out.loginInfo)) {
    out.loginInfo = (out.loginInfo as Record<string, unknown>[]).map((item) => {
      const copy = { ...item };
      delete copy.password;
      delete copy.totpSecret;
      return copy;
    });
  }

  if (Array.isArray(out.identities)) {
    out.identities = (out.identities as Record<string, unknown>[]).map((item) => {
      const copy = { ...item };
      delete copy.customPassword;
      delete copy.profilePicture;
      return copy;
    });
  }

  if (Array.isArray(out.addresses)) {
    out.addresses = (out.addresses as Record<string, unknown>[]).map((item) => {
      const copy = { ...item };
      delete copy.token;
      delete copy.sidToken;
      return copy;
    });
  }

  // `stripSensitiveFields` now KEEPS customPassword (master-key ciphertext) in
  // normal exports - exclude-secrets exports must strip it explicitly.
  if (out.passwordSettings && typeof out.passwordSettings === 'object') {
    const ps = { ...(out.passwordSettings as Record<string, unknown>) };
    delete ps.customPassword;
    out.passwordSettings = ps;
  }

  // WebDAV credentials are encrypted at rest, but the ciphertext remains
  // usable with this device's master key. Keep connection metadata while
  // removing both current and legacy plaintext/encrypted credential fields.
  if (out.webdavConfig && typeof out.webdavConfig === 'object') {
    const webdav = { ...(out.webdavConfig as Record<string, unknown>) };
    delete webdav.password;
    delete webdav.passwordEnc;
    delete webdav.backupPassword;
    delete webdav.backupPasswordEnc;
    out.webdavConfig = webdav;
  }

  // Not a password manager - never export vault material or session crypto
  delete out.vaultConfig;
  delete out.masterPasswordHash;
  delete out.sessionEncryptionKey;
  delete out._vault;

  return out;
}

// ── Password encryption ──────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from((hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
}

export async function encryptBackupPayload(
  payload: BackupFileV3,
  password: string
): Promise<EncryptedBackupFile> {
  if (!password || password.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw backupError(
      ErrorCode.BACKUP_PASSWORD_TOO_SHORT,
      `Password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters`
    );
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(CONSTANTS.SALT_LENGTH));
  const salt = bytesToHex(saltBytes);
  const { ARGON2ID_KDF } = await import('@/utils/security/crypto.js');
  const key = await deriveBackupKey(password, salt, ARGON2ID_KDF);
  const iv = crypto.getRandomValues(new Uint8Array(CONSTANTS.ENCRYPTION_IV_LENGTH));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const ciphertext = `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(encrypted))}`;

  // Wrap the device master key into the backup (same password + salt as the
  // data) so a restore on ANOTHER device can unwrap it, decrypt the imported
  // secrets, and re-encrypt them with the local key. Only when the payload
  // actually contains master-key ciphertext.
  let wrappedMasterKey: string | undefined;
  if (!payload.secretsExcluded && dataContainsSecrets(payload.data || {})) {
    try {
      const { encryptMasterKeyWithPassword } = await import('@/utils/security/crypto.js');
      const jwkJson = await getMasterKeyJwkJson();
      if (jwkJson) {
        wrappedMasterKey = await encryptMasterKeyWithPassword(
          jwkJson,
          password,
          salt,
          ARGON2ID_KDF
        );
      }
    } catch {
      /* wrapping is best-effort - an unwrapped backup is still importable on the same device */
    }
  }

  return {
    version: '3.0',
    encrypted: true,
    salt,
    ciphertext,
    exportDate: payload.exportDate,
    kdf: ARGON2ID_KDF,
    wrappedMasterKey,
  };
}

export async function decryptBackupPayload(
  file: EncryptedBackupFile,
  password: string
): Promise<BackupFileV3> {
  if (!password) throw backupError(ErrorCode.BACKUP_PASSWORD_REQUIRED, 'Password required');
  // KDF metadata is mandatory and validated before importing attacker-controlled
  // parameters into Argon2's memory/time costs.
  const [ivHex, dataHex] = file.ciphertext.split(':');
  if (!ivHex || !dataHex) {
    throw backupError(ErrorCode.BACKUP_INVALID_ENCRYPTED_FILE, 'Invalid encrypted backup');
  }
  const { isSupportedArgon2idKdf } = await import('@/utils/security/crypto.js');
  const kdf = file.kdf;
  if (!isSupportedArgon2idKdf(kdf)) {
    throw backupError(ErrorCode.BACKUP_INVALID_ENCRYPTED_FILE, 'Invalid encrypted backup');
  }
  try {
    const key = await deriveBackupKey(password, file.salt, kdf);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(ivHex) as BufferSource },
      key,
      hexToBytes(dataHex) as BufferSource
    );
    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as BackupFileV3;
    if (parsed?.data && typeof parsed.data === 'object') return parsed;
  } catch {
    /* fall through to the decryption-failed error */
  }
  throw backupError(
    ErrorCode.BACKUP_DECRYPTION_FAILED,
    'Incorrect password or corrupted backup file'
  );
}

export function isEncryptedBackup(obj: unknown): obj is EncryptedBackupFile {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return o.encrypted === true && typeof o.salt === 'string' && typeof o.ciphertext === 'string';
}

// ── Integrity + key fingerprint ──────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Export the current device master key as its JWK JSON string, or null when
 * unavailable (vault locked in password/biometrics mode, no crypto, etc.).
 * Used for the backup key fingerprint AND for wrapping the key into
 * password-encrypted backups.
 */
export async function getMasterKeyJwkJson(): Promise<string | null> {
  try {
    const { getOrCreateMasterKey } = await import('@/utils/security/crypto.js');
    const key = await getOrCreateMasterKey();
    const jwk = await crypto.subtle.exportKey('jwk', key);
    return JSON.stringify(jwk);
  } catch {
    return null;
  }
}

/**
 * Non-secret fingerprint of the current device master key (SHA-256 over the
 * exported JWK). Identical on the same install; different across devices or
 * after a full wipe + re-key. Returns null when the key can't be read (e.g.
 * vault locked in password/biometrics mode - export of secrets requires an
 * unlocked vault anyway, so this only affects defensive code paths).
 */
export async function getMasterKeyFingerprint(): Promise<string | null> {
  const jwk = await getMasterKeyJwkJson();
  if (!jwk) return null;
  try {
    return await sha256Hex(jwk);
  } catch {
    return null;
  }
}

/**
 * Whether a backup payload carries master-key ciphertext that is bound to a
 * device key (login passwords, identity custom passwords, inbox tokens, the
 * settings custom password). Only such backups need a wrapped master key.
 */
export function dataContainsSecrets(data: Record<string, unknown>): boolean {
  if (Array.isArray(data.loginInfo) && data.loginInfo.length > 0) return true;
  if (
    Array.isArray(data.identities) &&
    data.identities.some(
      (i) =>
        !!i &&
        typeof i === 'object' &&
        typeof (i as Record<string, unknown>).customPassword === 'string'
    )
  )
    return true;
  if (Array.isArray(data.addresses) && data.addresses.length > 0) return true;
  const ps = data.passwordSettings as { customPassword?: unknown } | undefined;
  if (ps && typeof ps.customPassword === 'string') return true;
  return false;
}

/**
 * Remove every master-key secret field from a payload's data - used when an
 * import is about to persist ciphertext that provably cannot decrypt with the
 * current device key. Structure (inbox records, identities, logins, settings)
 * is kept so the restore is still useful; the user re-adds the secrets.
 */
interface DroppedSecrets {
  data: Record<string, unknown>;
  /** Inboxes whose token/sidToken were stripped - candidates for re-auth. */
  affectedAddresses: Array<{ id: string; address: string; provider: string }>;
}

function dropSecretFields(data: Record<string, unknown>): DroppedSecrets {
  const out = { ...data };
  const affectedAddresses: Array<{
    id: string;
    address: string;
    provider: string;
  }> = [];
  if (Array.isArray(out.loginInfo)) {
    out.loginInfo = (out.loginInfo as Record<string, unknown>[]).map((item) => {
      if (!item || typeof item !== 'object') return item;
      const copy = { ...item };
      delete copy.password;
      delete copy.totpSecret;
      return copy;
    });
  }
  if (Array.isArray(out.identities)) {
    out.identities = (out.identities as Record<string, unknown>[]).map((item) => {
      if (!item || typeof item !== 'object') return item;
      const copy = { ...item };
      delete copy.customPassword;
      return copy;
    });
  }
  if (Array.isArray(out.addresses)) {
    out.addresses = (out.addresses as Record<string, unknown>[]).map((item) => {
      if (!item || typeof item !== 'object') return item;
      const copy = { ...item };
      if (copy.token !== undefined || copy.sidToken !== undefined) {
        affectedAddresses.push({
          id: typeof copy.id === 'string' ? copy.id : '',
          address: typeof copy.address === 'string' ? copy.address : '',
          provider: typeof copy.provider === 'string' ? copy.provider : '',
        });
      }
      delete copy.token;
      delete copy.sidToken;
      return copy;
    });
  }
  if (out.passwordSettings && typeof out.passwordSettings === 'object') {
    const ps = { ...(out.passwordSettings as Record<string, unknown>) };
    delete ps.customPassword;
    out.passwordSettings = ps;
  }
  return { data: out, affectedAddresses };
}

/**
 * Whether every master-key ciphertext value in `data` decrypts with the
 * CURRENT device key. Used on import when the backup's key fingerprint
 * differs and there is nothing to mix into (fresh install / post-wipe): if
 * the values can't decrypt, importing them would persist known-garbage
 * ciphertext, so the caller drops the secrets instead. Returns false when the
 * key is unavailable (vault locked) - unverifiable ciphertext is never
 * imported blindly.
 */
async function verifySecretsDecryptWithLocalKey(data: Record<string, unknown>): Promise<boolean> {
  try {
    const { inspectCiphertextStores, getOrCreateMasterKey } = await import(
      '@/utils/security/crypto.js'
    );
    const key = await getOrCreateMasterKey();
    const { undecryptable } = await inspectCiphertextStores(data, key);
    return undecryptable === 0;
  } catch {
    return false;
  }
}

/**
 * The subset of `data` the import key-compatibility check cares about - the
 * same stores `dropSecretFields` / `inspectCiphertextStores` walk, limited to
 * the user's selected categories (unrelated ciphertext elsewhere in the file
 * must never trigger a block or drop).
 */
function buildSelectedSecretBag(
  data: Record<string, unknown>,
  categories: BackupCategory[]
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  if (categories.includes('savedLogins') && data.loginInfo) {
    bag.loginInfo = data.loginInfo;
  }
  if (categories.includes('identities') && data.identities) {
    bag.identities = data.identities;
  }
  if (categories.includes('addresses') && data.addresses) {
    bag.addresses = data.addresses;
  }
  if (categories.includes('settings') && data.passwordSettings) {
    bag.passwordSettings = data.passwordSettings;
  }
  return bag;
}

/**
 * Count secret VALUES in a data bag (login passwords, identity custom
 * passwords, inbox token + sidToken, settings custom password) - exactly the
 * fields `dropSecretFields` strips. Mirrors the per-value counting of
 * `inspectCiphertextStores`, so an inbox with both token and sidToken counts 2.
 */
function countSecretValues(data: Record<string, unknown>): number {
  let n = 0;
  if (Array.isArray(data.loginInfo)) {
    for (const item of data.loginInfo as Array<Record<string, unknown>>) {
      if (item && typeof item === 'object') {
        if (typeof item.password === 'string') n++;
        if (typeof item.totpSecret === 'string') n++;
      }
    }
  }
  if (Array.isArray(data.identities)) {
    for (const item of data.identities as Array<Record<string, unknown>>) {
      if (item && typeof item === 'object' && typeof item.customPassword === 'string') n++;
    }
  }
  if (Array.isArray(data.addresses)) {
    for (const item of data.addresses as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.token === 'string') n++;
      if (typeof item.sidToken === 'string') n++;
    }
  }
  const ps = data.passwordSettings as { customPassword?: unknown } | undefined;
  if (ps && typeof ps === 'object' && typeof ps.customPassword === 'string') n++;
  return n;
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function buildBackupPayload(
  ext: {
    storage: {
      local: {
        get: (keys: string[] | null) => Promise<Record<string, unknown>>;
      };
    };
  },
  selection: BackupSelection
): Promise<BackupFileV3> {
  const categories =
    selection.categories.length > 0 ? selection.categories : [...ALL_BACKUP_CATEGORIES];
  const keys = keysForCategories(categories);
  const result = await ext.storage.local.get(keys);
  const hydrated = categories.includes('addresses')
    ? await hydrateEmailMapsForBackup(ext, { ...result })
    : result;
  let data = stripSensitiveFields({ ...hydrated });
  if (selection.excludeSecrets) {
    data = stripSecretsFromData(data);
  }

  const allSelected =
    ALL_BACKUP_CATEGORIES.every((c) => categories.includes(c)) &&
    categories.length === ALL_BACKUP_CATEGORIES.length;

  let integrityHash: string | undefined;
  let keyFingerprint: string | undefined;
  try {
    integrityHash = await sha256Hex(canonicalJson(data));
    if (!selection.excludeSecrets) {
      keyFingerprint = (await getMasterKeyFingerprint()) || undefined;
    }
  } catch {
    /* integrity/fingerprint are best-effort - never fail an export over them */
  }

  return {
    version: '3.0',
    exportDate: new Date().toISOString(),
    categories: allSelected ? 'all' : categories,
    data,
    secretsExcluded: selection.excludeSecrets || undefined,
    integrityHash,
    keyFingerprint,
  };
}

export function downloadJson(obj: unknown, filename: string): void {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const triggerDomDownload = () => {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      /* ignore */
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // Prefer extension downloads API (survives popup close better than <a download>)
  try {
    const b = (
      globalThis as {
        browser?: {
          downloads?: { download: (o: unknown) => Promise<unknown> };
        };
      }
    ).browser;
    if (b?.downloads?.download) {
      Promise.resolve(
        b.downloads.download({
          url,
          filename,
          saveAs: true,
        })
      )
        .then(() => {
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
        })
        .catch(() => {
          triggerDomDownload();
        });
      return;
    }
  } catch {
    /* fall through */
  }
  triggerDomDownload();
}

export function downloadBackup(
  payload: BackupFileV3 | EncryptedBackupFile,
  filenamePrefix = '1click-backup'
): void {
  // Local calendar date, not UTC - a late-night export was stamped yesterday.
  const date = localDateStamp();
  const encrypted = isEncryptedBackup(payload);
  const isPartial =
    !encrypted &&
    (payload as BackupFileV3).categories !== 'all' &&
    Array.isArray((payload as BackupFileV3).categories);
  let prefix = isPartial ? '1click-partial' : filenamePrefix;
  if (encrypted) prefix = `${prefix}-encrypted`;
  downloadJson(payload, `${prefix}-${date}.json`);
}

export {
  getLastBackupExportAt,
  LAST_BACKUP_AT_KEY,
} from '@/features/backup/backup-export-status.js';

export async function exportBackup(
  ext: {
    storage: {
      local: {
        get: (keys: string[] | null) => Promise<Record<string, unknown>>;
        set?: (items: Record<string, unknown>) => Promise<void>;
      };
    };
  },
  selection: BackupSelection
): Promise<void> {
  if (!selection.categories.length) {
    throw backupError(ErrorCode.BACKUP_NO_CATEGORIES, 'No categories selected');
  }
  const payload = await buildBackupPayload(ext, selection);
  if (selection.password) {
    const encrypted = await encryptBackupPayload(payload, selection.password);
    downloadBackup(encrypted);
  } else {
    downloadBackup(payload);
  }
  // Record last successful export time for Settings chip
  try {
    await ext.storage.local.set?.({ [LAST_BACKUP_AT_KEY]: Date.now() });
  } catch {
    /* optional on mock storage */
  }
}

// ── Parse ────────────────────────────────────────────────────────────────────

export type ParseBackupResult =
  | { kind: 'plain'; payload: BackupFileV3; bytes: number }
  | { kind: 'encrypted'; encrypted: EncryptedBackupFile; bytes: number };

/** Clone the current 3.0 export data without accepting pre-release aliases. */
function cloneImportDataRoot(obj: Record<string, unknown>): Record<string, unknown> {
  return { ...obj };
}

function looksLikeImportableData(obj: Record<string, unknown>): boolean {
  return (
    Array.isArray(obj.addresses) ||
    Array.isArray(obj.identities) ||
    Array.isArray(obj.loginInfo) ||
    Array.isArray(obj.emailHistory) ||
    Array.isArray(obj.savedSearchFilters) ||
    Array.isArray(obj.mailboxRules) ||
    Array.isArray(obj.siteRules) ||
    obj.selectedProvider != null ||
    obj.storedEmails != null ||
    obj.archivedEmails != null ||
    obj.themeMode != null ||
    obj.autoCopy != null ||
    obj.autoRenew != null ||
    obj.toastsEnabled != null ||
    obj.analytics != null
  );
}

/**
 * Upper bound on a locally-supplied backup (file, paste, or drop) before it is
 * read or parsed. Mirrors the WebDAV download cap (`MAX_WEBDAV_BACKUP_BYTES` in
 * webdav-sync.ts) so both restore paths accept the same backups. Without this,
 * a user-selected multi-gigabyte file would be slurped into memory by
 * `File.text()` and handed to `JSON.parse()` before any semantic check runs.
 */
export const MAX_BACKUP_IMPORT_BYTES = 50 * 1024 * 1024;

/** Count UTF-8 bytes without allocating an encoded copy of untrusted input. */
function exceedsBackupByteLimit(text: string, limit: number): boolean {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        // TextEncoder replaces a lone surrogate with U+FFFD.
        bytes += 3;
      }
    } else {
      // Includes BMP characters and lone low surrogates (encoded as U+FFFD).
      bytes += 3;
    }
    if (bytes > limit) return true;
  }
  return false;
}

export async function parseBackupText(text: string): Promise<ParseBackupResult> {
  // Reject by actual UTF-8 byte size before JSON.parse. The dialog and file
  // paths also gate early, but this is the shared boundary for paste and any
  // programmatic caller; UTF-16 string length undercounts non-ASCII input.
  const input = text ?? '';
  if (
    input.length > MAX_BACKUP_IMPORT_BYTES ||
    exceedsBackupByteLimit(input, MAX_BACKUP_IMPORT_BYTES)
  ) {
    throw backupError(
      ErrorCode.BACKUP_TOO_LARGE,
      'Backup file is too large to import (50 MB maximum)'
    );
  }
  // Strip BOM + whitespace so Windows-saved JSON and clipboard paste still parse
  let trimmed = input.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw backupError(ErrorCode.BACKUP_EMPTY, 'Empty backup content');
  }
  // Some tools wrap the whole file as a JSON string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const unwrapped = JSON.parse(trimmed);
      if (typeof unwrapped === 'string') trimmed = unwrapped.trim();
    } catch {
      /* keep trimmed */
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Light cleanup: trailing commas, // comments, /* */ blocks
    try {
      const cleaned = trimmed
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/"(?:[^"\\]|\\.)*"|,\s*(?=[}\]])/g, (m) => (m.startsWith('"') ? m : ''));
      parsed = JSON.parse(cleaned);
    } catch {
      /* ignore */
      throw backupError(ErrorCode.BACKUP_INVALID_JSON, 'Invalid JSON format');
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw backupError(
      ErrorCode.BACKUP_MISSING_FIELDS,
      'Missing required format fields (version/data)'
    );
  }
  const bytes = new TextEncoder().encode(trimmed).length;
  if (isEncryptedBackup(parsed)) {
    return { kind: 'encrypted', encrypted: parsed, bytes };
  }
  const obj = parsed as Record<string, unknown>;

  // Standard export shape: { version, data: { ... } }
  if (obj.data && typeof obj.data === 'object' && obj.data !== null) {
    // Integrity check (plain backups only - encrypted ones are verified by
    // AES-GCM auth during decryption). Verified against the RAW data before
    // legacy normalization so a v3 export round-trips byte-for-byte.
    if (typeof obj.integrityHash === 'string') {
      const calc = await sha256Hex(canonicalJson(obj.data));
      if (calc !== obj.integrityHash) {
        throw backupError(
          ErrorCode.BACKUP_INTEGRITY_FAILED,
          'Backup integrity check failed - the file is corrupted or was modified after export.'
        );
      }
    }
    const data = cloneImportDataRoot(obj.data as Record<string, unknown>);
    return {
      kind: 'plain',
      payload: {
        version: String(obj.version || '3.0.0'),
        exportDate: typeof obj.exportDate === 'string' ? obj.exportDate : '',
        categories: obj.categories as BackupCategory[] | 'all' | undefined,
        secretsExcluded: obj.secretsExcluded === true,
        integrityHash: typeof obj.integrityHash === 'string' ? obj.integrityHash : undefined,
        keyFingerprint: typeof obj.keyFingerprint === 'string' ? obj.keyFingerprint : undefined,
        data,
      },
      bytes,
    };
  }

  // Nested { backup: { data } } or { export: { ... } }
  for (const wrap of ['backup', 'export', 'payload', 'content']) {
    const nested = obj[wrap];
    if (nested && typeof nested === 'object' && nested !== null) {
      const n = nested as Record<string, unknown>;
      if (n.data && typeof n.data === 'object') {
        return parseBackupText(JSON.stringify(n));
      }
      if (looksLikeImportableData(n)) {
        return {
          kind: 'plain',
          payload: {
            version: '3.0.0',
            exportDate: new Date().toISOString(),
            categories: 'all',
            secretsExcluded: false,
            data: cloneImportDataRoot(n),
          },
          bytes,
        };
      }
    }
  }

  // Accept raw storage dumps / older exports that put keys at the root
  if (looksLikeImportableData(obj)) {
    return {
      kind: 'plain',
      payload: {
        version: '3.0.0',
        exportDate: typeof obj.exportDate === 'string' ? obj.exportDate : new Date().toISOString(),
        categories: 'all',
        secretsExcluded: false,
        data: cloneImportDataRoot(obj),
      },
      bytes,
    };
  }

  throw backupError(
    ErrorCode.BACKUP_MISSING_FIELDS,
    'Missing required format fields (version/data)'
  );
}

export async function parseBackupFile(file: File): Promise<ParseBackupResult> {
  // Reject on the declared size BEFORE `File.text()` reads the whole blob into
  // memory - a huge picked file must never be materialized just to be discarded.
  if (file.size > MAX_BACKUP_IMPORT_BYTES) {
    throw backupError(
      ErrorCode.BACKUP_TOO_LARGE,
      'Backup file is too large to import (50 MB maximum)'
    );
  }
  return parseBackupText(await file.text());
}

/** Resolve plain payload, decrypting if needed. */
export interface ResolvedBackup {
  payload: BackupFileV3;
  /** Master key wrapped by the backup password (password-encrypted backups only). */
  wrappedMasterKey?: string;
  /** Backup file salt - needed to unwrap `wrappedMasterKey`. */
  salt?: string;
  /** Argon2id profile used by the file - needed to unwrap `wrappedMasterKey`. */
  kdf?: import('@/utils/security/crypto.js').Argon2idKdf;
}

export async function resolveBackupPayload(
  parsed: ParseBackupResult,
  password?: string
): Promise<ResolvedBackup> {
  if (parsed.kind === 'plain') {
    return { payload: parsed.payload };
  }
  if (!password) throw backupError(ErrorCode.BACKUP_PASSWORD_REQUIRED, 'Password required');
  const payload = await decryptBackupPayload(parsed.encrypted, password);
  return {
    payload,
    wrappedMasterKey: parsed.encrypted.wrappedMasterKey,
    salt: parsed.encrypted.salt,
    kdf: parsed.encrypted.kdf,
  };
}

// ── Cross-device restore (wrapped master key) ────────────────────────────────

export interface ReencryptResult {
  payload: BackupFileV3;
  /** True when imported secrets were re-encrypted to the LOCAL device key. */
  reencrypted: boolean;
  /** Number of ciphertext values that could not be re-encrypted and were kept as-is. */
  leftUntouched: number;
}

/**
 * Re-encrypt every master-key ciphertext value in an imported payload from the
 * BACKUP's key (unwrapped from `wrappedMasterKey` via the backup password) to
 * the LOCAL device master key.
 *
 * This is what makes a password-encrypted backup a true cross-machine restore:
 * the original key is never persisted - it is derived transiently, used to
 * decrypt each secret, and discarded. The local key stays authoritative, so
 * this works in standard, password, AND biometric vault modes (the local key
 * is stable across unlock/relock).
 *
 * Returns the payload with `keyFingerprint` updated to the LOCAL fingerprint
 * (so the import key-mixing guard passes) or, when no wrapped key / unwrap /
 * local-key failure occurs, the payload unchanged (`reencrypted: false`) -
 * the caller then falls back to the existing mismatch warning/block.
 */
export async function reencryptPayloadToLocalKey(
  payload: BackupFileV3,
  wrappedMasterKey: string | undefined,
  password: string | undefined,
  salt: string | undefined,
  kdf?: import('@/utils/security/crypto.js').Argon2idKdf
): Promise<ReencryptResult> {
  if (!wrappedMasterKey || !password || !salt) {
    return { payload, reencrypted: false, leftUntouched: 0 };
  }
  if (!kdf) return { payload, reencrypted: false, leftUntouched: 0 };
  const { isSupportedArgon2idKdf } = await import('@/utils/security/crypto.js');
  if (!isSupportedArgon2idKdf(kdf)) return { payload, reencrypted: false, leftUntouched: 0 };

  let crypto: {
    reencryptCiphertextStores: (
      data: Record<string, unknown>,
      sourceKey: CryptoKey,
      targetKey: CryptoKey
    ) => Promise<{
      data: Record<string, unknown>;
      swapped: number;
      leftUntouched: number;
    }>;
    getOrCreateMasterKey: () => Promise<CryptoKey>;
    decryptMasterKeyWithPassword: (
      encryptedPayload: string,
      password: string,
      saltHex: string,
      kdf?: import('@/utils/security/crypto.js').Argon2idKdf
    ) => Promise<string | null>;
  };
  try {
    crypto = await import('@/utils/security/crypto.js');
  } catch {
    return { payload, reencrypted: false, leftUntouched: 0 };
  }

  try {
    // 1. Unwrap the backup master key. The wrapped key was encrypted with the
    //    SAME salt + KDF profile as the file's data ciphertext, so honor the
    //    recorded profile. Files without KDF metadata fail
    //    to unwrap and drop their secrets - a legacy-KDF retry path is
    //    unsupported.
    const keyJson = await crypto.decryptMasterKeyWithPassword(
      wrappedMasterKey,
      password,
      salt,
      kdf
    );
    if (!keyJson) return { payload, reencrypted: false, leftUntouched: 0 };
    const backupKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      JSON.parse(keyJson) as JsonWebKey,
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );

    // 2. Local key stays authoritative - swap every store via the SHARED
    //    ciphertext re-encryption utility (same code path as key rotation and
    //    vault re-key).
    const localKey = await crypto.getOrCreateMasterKey();
    const localJwk = await globalThis.crypto.subtle.exportKey('jwk', localKey);
    const localFingerprint = await sha256Hex(JSON.stringify(localJwk));

    const result = await crypto.reencryptCiphertextStores(payload.data || {}, backupKey, localKey);

    // 3. The payload is now encrypted with the LOCAL key - only update fingerprint if everything was successfully re-encrypted
    const allReencrypted = result.leftUntouched === 0;
    return {
      payload: {
        ...payload,
        data: result.data,
        ...(allReencrypted ? { keyFingerprint: localFingerprint } : {}),
      },
      reencrypted: allReencrypted,
      leftUntouched: result.leftUntouched,
    };
  } catch {
    return { payload, reencrypted: false, leftUntouched: 0 };
  }
}

// ── Merge / replace utilities ────────────────────────────────────────────────

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const merged = [...existing];
  for (const item of incoming) {
    if (!item?.id) continue;
    if (!merged.some((e) => e.id === item.id)) merged.push(item);
  }
  return merged;
}

/**
 * Semantic identity of a saved login: domain + email/username, compared
 * case-insensitively. Mirrors the `stableLoginId` identity used when saving
 * credentials (login-actions.ts) and the save-path dedup in message-handler
 * (email+domain), so two accounts on ONE domain (work vs. personal) are
 * distinct logins instead of colliding on the bare domain.
 */
function loginIdentityKey(item: Record<string, unknown>): string {
  const domain = String(item.domain ?? '')
    .trim()
    .toLowerCase();
  const email = String(item.email ?? item.username ?? '')
    .trim()
    .toLowerCase();
  return `${domain}|${email}`;
}

/**
 * Merge saved logins by their semantic identity (domain + email/username)
 * rather than by `domain` alone, so a second login on an already-known domain
 * is imported instead of being silently discarded.
 */
function mergeByLoginIdentity<T extends Record<string, unknown>>(
  existing: T[],
  incoming: T[]
): T[] {
  const merged = [...existing];
  const seen = new Set(merged.map(loginIdentityKey));
  for (const item of incoming) {
    if (item == null) continue;
    const key = loginIdentityKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/**
 * `mergeByKey` with case-insensitive scalar comparison - `emailHistory` is one
 * record per generated address, so case variants of the same email
 * (Foo@x.com vs foo@x.com) must merge instead of duplicating the entry.
 */
function mergeByKeyCI<T extends Record<string, unknown>>(
  existing: T[],
  incoming: T[],
  key: keyof T
): T[] {
  const normalize = (item: T): string =>
    String(item?.[key] ?? '')
      .trim()
      .toLowerCase();
  const merged = [...existing];
  const seen = new Set(merged.map(normalize));
  for (const item of incoming) {
    if (item == null) continue;
    const k = normalize(item);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(item);
  }
  return merged;
}

/**
 * Merge two email lists by email `id`, keeping the first occurrence of each
 * id. Items without an id are always kept (nothing to dedup on). Shared by
 * `mergeEmailBags` and the replace-mode `filterBags` collision path so case
 * variants of the same address cannot duplicate mail in either policy.
 */
function mergeEmailLists(existingEmails: unknown[], incomingEmails: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  const push = (item: unknown) => {
    const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
    if (id != null) {
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(item);
  };
  for (const item of existingEmails) push(item);
  for (const item of incomingEmails) push(item);
  return out;
}

/**
 * Merge per-address email bags (storedEmails / archivedEmails) LIST-wise under
 * merge policy: for every address present in both, the lists are concatenated
 * and deduped by email `id` instead of the incoming bag being dropped
 * wholesale (which is what `mergeRecord` would do - the old behavior silently
 * discarded the entire imported bag for any address that already had mail).
 */
function mergeEmailBags(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [addr, emails] of Object.entries(incoming)) {
    const existingEmails = merged[addr];
    if (Array.isArray(existingEmails) && Array.isArray(emails)) {
      merged[addr] = mergeEmailLists(existingEmails, emails);
    } else if (Array.isArray(existingEmails)) {
      // Incoming value for an existing address is malformed - keep what we have.
    } else {
      // New address, or both sides malformed - take the imported value.
      merged[addr] = emails;
    }
  }
  return merged;
}

function replaceById<T extends { id: string }>(incoming: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of incoming) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// ── Filter addresses by expiry mode ────────────────────────────────────────────

export function filterAddressesForImport(
  rawAddresses: Address[],
  mode: ExpiredAddressMode,
  now = Date.now()
): {
  accepted: Address[];
  skippedExpired: number;
  renewableExpired: number;
  nonRenewableExpired: number;
} {
  const accepted: Address[] = [];
  let skippedExpired = 0;
  let renewableExpired = 0;
  let nonRenewableExpired = 0;

  for (const record of rawAddresses) {
    if (!record?.id) continue;
    const expired = isAddressExpired(record, now);
    if (expired) {
      const renewable = isProviderRenewable(String(record.provider || ''));
      if (!shouldImportExpiredAddress(record, mode, now)) {
        skippedExpired++;
        continue;
      }
      if (renewable) renewableExpired++;
      else nonRenewableExpired++;
    }
    accepted.push(normalizeImportedAddress(record, now));
  }

  return { accepted, skippedExpired, renewableExpired, nonRenewableExpired };
}

// ── Dry-run preview ──────────────────────────────────────────────────────────

type StorageLike = {
  storage: {
    local: {
      get: (keys: string[] | null) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
};

export async function previewImport(
  ext: StorageLike,
  payload: BackupFileV3,
  selection: BackupSelection,
  now = Date.now()
): Promise<ImportPreview> {
  const policy = selection.conflictPolicy ?? 'merge';
  const mode = resolveExpiredMode(selection);
  const data = payload.data || {};
  const existing = await ext.storage.local.get([
    'addresses',
    'emailHistory',
    'loginInfo',
    'identities',
    'savedSearchFilters',
    'mailboxRules',
    'siteRules',
    'passwordSettings',
  ]);

  const preview: ImportPreview = {
    newIdentities: 0,
    skippedExistingIdentities: 0,
    newLogins: 0,
    skippedExistingLogins: 0,
    newFilters: 0,
    skippedExistingFilters: 0,
    newRules: 0,
    skippedExistingRules: 0,
    addressesToImport: 0,
    addressesNew: 0,
    addressesExisting: 0,
    skippedExpiredAddresses: 0,
    renewableExpiredToImport: 0,
    nonRenewableExpiredToImport: 0,
    settingsKeys: 0,
    willReplace: policy === 'replace',
    secretsDroppable: 0,
    secretsImportBlocked: false,
  };

  if (selection.categories.includes('settings')) {
    for (const key of SETTINGS_IMPORT_KEYS) {
      if (key in data) preview.settingsKeys++;
    }
  }

  if (selection.categories.includes('identities') && Array.isArray(data.identities)) {
    const existingIds = new Set(((existing.identities as { id: string }[]) || []).map((i) => i.id));
    for (const item of data.identities as { id: string }[]) {
      if (!item?.id) continue;
      if (policy === 'replace' || !existingIds.has(item.id)) preview.newIdentities++;
      else preview.skippedExistingIdentities++;
    }
  }

  if (selection.categories.includes('savedLogins') && Array.isArray(data.loginInfo)) {
    // Identity key must match the merge in importBackup (domain + email/username),
    // not the bare domain, or the preview would miscount same-domain logins.
    const existingIdentities = new Set(
      ((existing.loginInfo as Record<string, unknown>[]) || []).map(loginIdentityKey)
    );
    for (const item of data.loginInfo as Record<string, unknown>[]) {
      if (!item?.domain) continue;
      if (policy === 'replace' || !existingIdentities.has(loginIdentityKey(item))) {
        preview.newLogins++;
      } else {
        preview.skippedExistingLogins++;
      }
    }
  }

  if (selection.categories.includes('filters') && Array.isArray(data.savedSearchFilters)) {
    const existingIds = new Set(
      ((existing.savedSearchFilters as { id: string }[]) || []).map((i) => i.id)
    );
    for (const item of data.savedSearchFilters as { id: string }[]) {
      if (!item?.id) continue;
      if (policy === 'replace' || !existingIds.has(item.id)) preview.newFilters++;
      else preview.skippedExistingFilters++;
    }
  }

  if (selection.categories.includes('mailboxRules') && Array.isArray(data.mailboxRules)) {
    const existingIds = new Set(
      ((existing.mailboxRules as { id: string }[]) || []).map((i) => i.id)
    );
    for (const item of data.mailboxRules as { id: string }[]) {
      if (!item?.id) continue;
      if (policy === 'replace' || !existingIds.has(item.id)) preview.newRules++;
      else preview.skippedExistingRules++;
    }
  }
  if (selection.categories.includes('siteRules') && Array.isArray(data.siteRules)) {
    const existingIds = new Set(
      ((existing.siteRules as { id: string }[]) || []).map((rule) => rule.id)
    );
    for (const item of sanitizeImportedSiteRules(data.siteRules, now)) {
      if (policy === 'replace' || !existingIds.has(item.id as string)) preview.newRules++;
      else preview.skippedExistingRules++;
    }
  }

  if (selection.categories.includes('addresses')) {
    const raw = Array.isArray(data.addresses) ? (data.addresses as Address[]) : [];
    const { accepted, skippedExpired, renewableExpired, nonRenewableExpired } =
      filterAddressesForImport(raw, mode, now);
    preview.addressesToImport = accepted.length;
    preview.skippedExpiredAddresses = skippedExpired;
    preview.renewableExpiredToImport = renewableExpired;
    preview.nonRenewableExpiredToImport = nonRenewableExpired;
    const existingIds = new Set(((existing.addresses as Address[]) || []).map((i) => i.id));
    for (const record of accepted) {
      if (policy === 'replace' || !existingIds.has(record.id)) preview.addressesNew++;
      else preview.addressesExisting++;
    }
  }

  // ── Device-key compatibility (mirrors importBackup's decision tree) ───────
  // The dry run must warn BEFORE the user confirms: a foreign-key backup that
  // lands on this device either (a) gets blocked when there are existing
  // secrets to mix into, or (b) drops every secret value in the selected
  // stores when its ciphertext can't decrypt with the current key.
  if (typeof payload.keyFingerprint === 'string') {
    const currentFingerprint = await getMasterKeyFingerprint();
    if (currentFingerprint && currentFingerprint !== payload.keyFingerprint) {
      const importingSecrets = selection.categories.some(
        (c) =>
          c === 'savedLogins' ||
          c === 'identities' ||
          c === 'addresses' ||
          (c === 'settings' &&
            !!(data.passwordSettings as { customPassword?: string } | undefined)?.customPassword)
      );
      if (importingSecrets) {
        const hasExistingSecrets =
          Array.isArray(existing.loginInfo) && existing.loginInfo.length > 0
            ? true
            : Array.isArray(existing.identities) && existing.identities.length > 0
              ? true
              : Array.isArray(existing.addresses) && existing.addresses.length > 0
                ? true
                : !!(existing.passwordSettings as { customPassword?: string } | undefined)
                    ?.customPassword;
        if (hasExistingSecrets) {
          preview.secretsImportBlocked = true;
        } else {
          const selectedSecretBag = buildSelectedSecretBag(data, selection.categories);
          const decryptable = await verifySecretsDecryptWithLocalKey(selectedSecretBag);
          if (!decryptable) {
            preview.secretsDroppable = countSecretValues(selectedSecretBag);
          }
        }
      }
    }
  }

  return preview;
}

// ── Import ───────────────────────────────────────────────────────────────────

export async function importBackup(
  ext: StorageLike,
  payload: BackupFileV3,
  selection: BackupSelection,
  loadAddresses: () => Promise<void>,
  now = Date.now()
): Promise<ImportSummary> {
  if (!selection.categories.length) {
    throw backupError(ErrorCode.BACKUP_NO_CATEGORIES, 'No categories selected');
  }

  const includeEmails = selection.includeEmails !== false;
  const mode = resolveExpiredMode(selection);
  const policy = selection.conflictPolicy ?? 'merge';
  // `payload` is held in `$state` by the import dialog, so `payload.data` is a
  // deeply reactive Svelte proxy. Writing those proxies to chrome.storage
  // corrupts proxied arrays into plain objects ({0: email, 1: email, …}), which
  // silently turns every `storedEmails` bag into a non-array and leaves the
  // mailbox showing "Inbox is empty". Snapshot to plain JSON first (the data
  // was parsed from a JSON backup, so the round-trip is lossless).
  let importedDict: Record<string, unknown> = JSON.parse(
    JSON.stringify(payload.data || {})
  ) as Record<string, unknown>;
  const summary: ImportSummary = {
    imported: {},
    skippedExpiredAddresses: 0,
    importedAddresses: 0,
    renewableExpiredImported: 0,
    conflictPolicy: policy,
  };
  // Inboxes from the raw file whose tokens were stripped by the drop path -
  // intersected with the actually-imported list later (expiry-mode filtering
  // may have skipped some of them).
  let droppedAddresses: Array<{
    id: string;
    address: string;
    provider: string;
  }> = [];

  const existingRaw = await ext.storage.local.get([
    'addresses',
    'emailHistory',
    'loginInfo',
    'identities',
    'savedSearchFilters',
    'mailboxRules',
    'siteRules',
    'activeAddressId',
    'passwordSettings',
    'emailStorageAddressIndex',
  ]);
  const existing = await hydrateEmailMapsForBackup(ext, existingRaw);

  // ── Device-key compatibility ───────────────────────────────────────────
  // Secrets inside a backup are encrypted with the EXPORTING device's master
  // key. Restoring them over an install that already holds data encrypted
  // with a different key silently mixes keys - half the vault becomes
  // undecryptable with no warning. Detect that up front:
  //   • fingerprint matches (or is unknown) → safe, proceed
  //   • mismatch + existing secret-bearing data → block (would mix keys)
  //   • mismatch + nothing to mix into → verify the imported ciphertext can
  //     actually decrypt with the CURRENT key; if not (own backup restored
  //     after a full wipe re-keyed the device, or a plain cross-device
  //     restore) drop the secret fields instead of importing known-garbage
  //     ciphertext, and flag the drop for the UI.
  if (typeof payload.keyFingerprint === 'string') {
    const currentFingerprint = await getMasterKeyFingerprint();
    if (currentFingerprint && currentFingerprint !== payload.keyFingerprint) {
      const importingSecrets = selection.categories.some(
        (c) =>
          c === 'savedLogins' ||
          c === 'identities' ||
          c === 'addresses' ||
          (c === 'settings' &&
            !!(importedDict.passwordSettings as { customPassword?: string } | undefined)
              ?.customPassword)
      );
      const hasExistingSecrets =
        Array.isArray(existing.loginInfo) && existing.loginInfo.length > 0
          ? true
          : Array.isArray(existing.identities) && existing.identities.length > 0
            ? true
            : Array.isArray(existing.addresses) && existing.addresses.length > 0
              ? true
              : !!(existing.passwordSettings as { customPassword?: string } | undefined)
                  ?.customPassword;
      summary.keyFingerprintMismatch = true;
      if (importingSecrets && hasExistingSecrets) {
        throw backupError(
          ErrorCode.BACKUP_KEY_MISMATCH,
          'This backup was created on a different device key. Importing its saved ' +
            'credentials over existing data would make them unreadable. Restore it on ' +
            'the original device, or export from there with “Exclude secrets” enabled.'
        );
      }
      if (importingSecrets && !hasExistingSecrets) {
        // Only the SELECTED categories' secret stores matter for the check -
        // unrelated ciphertext elsewhere in the file must not trigger a drop.
        const selectedSecretBag = buildSelectedSecretBag(importedDict, selection.categories);
        const decryptable = await verifySecretsDecryptWithLocalKey(selectedSecretBag);
        if (!decryptable) {
          const dropped = dropSecretFields(importedDict);
          importedDict = dropped.data;
          droppedAddresses = dropped.affectedAddresses;
          summary.secretsDropped = true;
        }
      }
    }
  }

  const toSet: Record<string, unknown> = {};

  // ── Replace-mode address import undo ────────────────────────────────────
  // A replace import rebuilds emailStorageAddressIndex from ONLY the imported
  // addresses, permanently dropping the index entries AND the ID-keyed bags
  // of every mailbox that leaves it - including evicted archived-overflow
  // mailboxes, whose Offline Saved mail would otherwise vanish for good with
  // no way back. Snapshot the affected surface BEFORE any write so the UI can
  // offer a true one-shot undo. Merge imports never prune, so they get none.
  if (policy === 'replace' && selection.categories.includes('addresses')) {
    try {
      const undo = await captureImportUndoSnapshot(ext);
      await writeWithRetry({ [IMPORT_UNDO_KEY]: undo }, areaOf(ext));
      summary.undoAvailable = true;
    } catch (e) {
      // Best-effort: undo is a convenience, never a hard requirement.
      logError('Failed to capture import undo snapshot', e);
    }
  }

  if (selection.categories.includes('settings')) {
    let count = 0;
    for (const key of SETTINGS_IMPORT_KEYS) {
      if (key in importedDict) {
        toSet[key] = importedDict[key];
        count++;
      }
    }
    if (
      importedDict.passwordSettings &&
      typeof importedDict.passwordSettings === 'object' &&
      importedDict.passwordSettings !== null
    ) {
      // customPassword is master-key ciphertext and survives exports (see
      // stripSensitiveFields); restore it as-is - the key-mixing guard above
      // (and the secrets-drop path) already decided whether it is usable here.
      toSet.passwordSettings = {
        ...(importedDict.passwordSettings as Record<string, unknown>),
      };
      count++;
    }
    if (count > 0) summary.imported.settings = count;
  }

  if (selection.categories.includes('identities')) {
    if (Array.isArray(importedDict.identities)) {
      const incoming = importedDict.identities as { id: string }[];
      if (policy === 'replace') {
        toSet.identities = replaceById(incoming);
      } else {
        toSet.identities = mergeById((existing.identities as { id: string }[]) || [], incoming);
      }
      summary.imported.identities = incoming.length;
    }
    if (typeof importedDict.selectedIdentityId === 'string') {
      toSet.selectedIdentityId = importedDict.selectedIdentityId;
    }
  }

  if (selection.categories.includes('savedLogins')) {
    if (Array.isArray(importedDict.emailHistory)) {
      toSet.emailHistory =
        policy === 'replace'
          ? importedDict.emailHistory
          : mergeByKeyCI(
              (existing.emailHistory as Record<string, unknown>[]) || [],
              importedDict.emailHistory as Record<string, unknown>[],
              'email'
            );
    }
    if (Array.isArray(importedDict.loginInfo)) {
      toSet.loginInfo =
        policy === 'replace'
          ? importedDict.loginInfo
          : mergeByLoginIdentity(
              (existing.loginInfo as Record<string, unknown>[]) || [],
              importedDict.loginInfo as Record<string, unknown>[]
            );
      summary.imported.savedLogins = (importedDict.loginInfo as unknown[]).length;
    }
  }

  if (selection.categories.includes('filters')) {
    if (Array.isArray(importedDict.savedSearchFilters)) {
      const incoming = importedDict.savedSearchFilters as { id: string }[];
      toSet.savedSearchFilters =
        policy === 'replace'
          ? replaceById(incoming)
          : mergeById((existing.savedSearchFilters as { id: string }[]) || [], incoming);
      summary.imported.filters = incoming.length;
    }
  }

  if (selection.categories.includes('mailboxRules')) {
    if (Array.isArray(importedDict.mailboxRules)) {
      const incoming = sanitizeImportedMailboxRules(importedDict.mailboxRules, now) as {
        id: string;
      }[];
      toSet.mailboxRules =
        policy === 'replace'
          ? replaceById(incoming)
          : mergeById((existing.mailboxRules as { id: string }[]) || [], incoming);
      summary.imported.mailboxRules = incoming.length;
    }
  }
  if (selection.categories.includes('siteRules') && Array.isArray(importedDict.siteRules)) {
    const incoming = sanitizeImportedSiteRules(importedDict.siteRules, now) as { id: string }[];
    toSet.siteRules =
      policy === 'replace'
        ? replaceById(incoming)
        : mergeById((existing.siteRules as { id: string }[]) || [], incoming);
    summary.imported.siteRules = incoming.length;
  }

  if (selection.categories.includes('addresses')) {
    const rawAddresses = Array.isArray(importedDict.addresses)
      ? (importedDict.addresses as Address[])
      : [];
    const { accepted, skippedExpired, renewableExpired } = filterAddressesForImport(
      rawAddresses,
      mode,
      now
    );
    summary.skippedExpiredAddresses = skippedExpired;
    summary.renewableExpiredImported = renewableExpired;

    // Which of the dropped-secrets addresses actually made it into storage -
    // these are the ones the re-authenticate walkthrough must cover.
    if (summary.secretsDropped && droppedAddresses.length > 0) {
      const acceptedIds = new Set(accepted.map((a) => a.id));
      const acceptedByAddress = new Map(
        accepted
          .map((a) => [a.address, a.id] as const)
          .filter(([addr]) => typeof addr === 'string' && !!addr)
          .map(([addr, id]) => [addr.toLowerCase(), id] as const)
      );
      summary.secretsDroppedAddresses = droppedAddresses.filter((d) => {
        if (acceptedIds.has(d.id)) return true;
        return !!d.address && acceptedByAddress.has(d.address.toLowerCase());
      });
    }

    if (policy === 'replace') {
      toSet.addresses = accepted;
    } else {
      toSet.addresses = mergeById((existing.addresses as Address[]) || [], accepted);
    }
    summary.importedAddresses = accepted.length;
    summary.imported.addresses = accepted.length;

    // Always resolve a usable activeAddressId so post-hard-reset import isn't stuck on onboarding
    {
      const list = toSet.addresses as Address[];
      const candidateId =
        typeof importedDict.activeAddressId === 'string' ? importedDict.activeAddressId : '';
      const candidate = candidateId ? list.find((i) => i.id === candidateId) : undefined;
      const existingActive =
        typeof existing.activeAddressId === 'string' ? existing.activeAddressId : '';
      const existingStillValid =
        policy !== 'replace' &&
        existingActive &&
        list.some((i) => i.id === existingActive && !isAddressExpired(i, now));

      if (candidate && !isAddressExpired(candidate, now)) {
        toSet.activeAddressId = candidate.id;
      } else if (existingStillValid) {
        // keep existing live selection on merge when import candidate is invalid
        toSet.activeAddressId = existingActive;
      } else {
        const firstLive = list.find((i) => !isAddressExpired(i, now));
        const firstAny = list[0];
        const pick = firstLive || firstAny;
        if (pick) toSet.activeAddressId = pick.id;
      }
    }

    if (includeEmails) {
      const allowedAddresses = new Set(
        accepted.map((a) => a.address).filter((a): a is string => typeof a === 'string' && !!a)
      );
      const allowedLower = new Map([...allowedAddresses].map((a) => [a.toLowerCase(), a] as const));
      // Multi-domain: bags may be under user@other.domain while inbox is user@canonical
      const byLocalPart = new Map<string, string>();
      for (const a of allowedAddresses) {
        const local = a.split('@')[0]?.toLowerCase();
        if (local && !byLocalPart.has(local)) byLocalPart.set(local, a);
      }

      const filterBags = (bags: Record<string, unknown>) => {
        const filtered: Record<string, unknown> = {};
        for (const [addr, emails] of Object.entries(bags)) {
          const canon = allowedAddresses.has(addr)
            ? addr
            : allowedLower.get(addr.toLowerCase()) ||
              byLocalPart.get(addr.split('@')[0]?.toLowerCase() || '');
          if (!canon) continue;
          const existing = filtered[canon];
          if (Array.isArray(existing) && Array.isArray(emails)) {
            // Case-variant / multi-domain keys can collide on one canonical
            // address - dedup by email id exactly like mergeEmailBags so
            // replace mode can't duplicate mail (inflating unreads and
            // re-triggering notifications).
            filtered[canon] = mergeEmailLists(existing, emails);
          } else {
            filtered[canon] = emails;
          }
        }
        return filtered;
      };

      if (
        importedDict.storedEmails &&
        typeof importedDict.storedEmails === 'object' &&
        importedDict.storedEmails !== null
      ) {
        const filtered = filterBags(importedDict.storedEmails as Record<string, unknown>);
        toSet.storedEmails =
          policy === 'replace'
            ? filtered
            : mergeEmailBags((existing.storedEmails as Record<string, unknown>) || {}, filtered);
      }
      if (
        importedDict.archivedEmails &&
        typeof importedDict.archivedEmails === 'object' &&
        importedDict.archivedEmails !== null
      ) {
        const filtered = filterBags(importedDict.archivedEmails as Record<string, unknown>);
        toSet.archivedEmails =
          policy === 'replace'
            ? filtered
            : mergeEmailBags((existing.archivedEmails as Record<string, unknown>) || {}, filtered);
      }
    } else if (policy === 'replace') {
      // replace mode without emails: leave email bags alone (don't wipe)
    }
  }

  const importedEmailMaps = {
    storedEmails: toSet.storedEmails,
    archivedEmails: toSet.archivedEmails,
  };
  delete toSet.storedEmails;
  delete toSet.archivedEmails;

  const commitImport = async () => {
    if ('mailboxRules' in toSet || 'siteRules' in toSet) {
      // Re-read inside the rule/schedule locks: an edit in another extension
      // window during the import preview must not be overwritten by a stale merge.
      const latest = await ext.storage.local.get([
        'mailboxRules',
        'siteRules',
        'siteRuleArchiveSchedule',
      ]);
      let schedule = (latest.siteRuleArchiveSchedule || {}) as Record<string, ArchiveScheduleEntry>;
      for (const kind of ['mailbox', 'site'] as const) {
        const key = kind === 'mailbox' ? 'mailboxRules' : 'siteRules';
        if (!(key in toSet)) continue;
        const previous = Array.isArray(latest[key])
          ? (latest[key] as { id: string; enabled: boolean; autoArchiveDays?: number | null }[])
          : [];
        const incoming = (
          kind === 'mailbox' ? sanitizeImportedMailboxRules : sanitizeImportedSiteRules
        )(importedDict[key], now) as typeof previous;
        const next = policy === 'replace' ? replaceById(incoming) : mergeById(previous, incoming);
        if (next.length > 40) {
          throw backupError(ErrorCode.VALIDATION_ERROR, 'rule-limit-exceeded', {
            translationKey: 'automation.ruleLimit',
          });
        }
        toSet[key] = next;
        schedule = reconcileArchiveScheduleMap(schedule, previous, next, kind);
      }
      toSet.siteRuleArchiveSchedule = schedule;
    }
    let emailBagsPersisted = false;
    if (selection.categories.includes('addresses')) {
      // Only touch the ID-keyed email surface when email bags were included.
      // Settings/address-only replace imports must not prune or rewrite mail.
      if (includeEmails) {
        // Commit imported settings, addresses, and mailbox bags together.
        await persistImportedEmailBags(
          ext,
          { ...toSet, ...importedEmailMaps },
          true,
          toSet,
          policy
        );
        emailBagsPersisted = true;
      }
    }
    if (!emailBagsPersisted && Object.keys(toSet).length > 0) {
      await writeWithRetry(toSet, areaOf(ext));
    }
  };
  if ('mailboxRules' in toSet || 'siteRules' in toSet) {
    await withLock('site_rules_lock', () =>
      withLock('mailbox_rules_lock', () => withLock('archive_schedule_lock', commitImport))
    );
  } else await commitImport();
  // The import landed: this is a surface-level mutation, so every undo offered
  // before it (a delete-undo still counting down, a domain-switch undo) is now
  // stale - its snapshot describes the pre-import surface, and running it
  // would walk the imported state back. The same single revision is what the
  // undo THIS import offered carries (summary.undoRevision), mirroring the
  // delete flow: one mark at landing kills the older undos and stamps the new
  // one as current.
  summary.undoRevision = await markAddressMutation(areaOf(ext).area);
  await loadAddresses();
  return summary;
}

/**
 * Format byte size for UI. Re-export of the single localized implementation
 * in storageMonitor - the previous hand-rolled copy here drifted from it
 * (toFixed(1) vs toFixed(2) for MB) and shipped hardcoded English units.
 */
export { formatBytes } from '@/utils/storage/storageMonitor.js';
