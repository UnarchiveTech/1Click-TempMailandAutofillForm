/**
 * Backup export / import with multi-category selection, expiry policy,
 * merge/replace, optional password encryption, and dry-run preview.
 */

import {
  ENCRYPTION_IV_LENGTH as IV_LEN,
  PBKDF2_ITERATIONS,
  SALT_LENGTH as SALT_LEN,
} from '@/utils/constants.js';
import { loadProviderConfig } from '@/utils/email-service.js';
import type { Account } from '@/utils/types.js';

// ── Categories ───────────────────────────────────────────────────────────────

export type BackupCategory = 'settings' | 'identities' | 'savedLogins' | 'inboxes' | 'filters';

/** How to treat expired inbox sessions on import. */
export type ExpiredInboxMode = 'skip' | 'renewableOnly' | 'all';

/** Merge keeps existing items; replace overwrites selected categories. */
export type ConflictPolicy = 'merge' | 'replace';

export const ALL_BACKUP_CATEGORIES: BackupCategory[] = [
  'settings',
  'identities',
  'savedLogins',
  'inboxes',
  'filters',
];

export const BACKUP_CATEGORY_KEYS: Record<BackupCategory, readonly string[]> = {
  settings: [
    'themeMode',
    'contrastLevel',
    'customColor',
    'autoCopy',
    'autoRenew',
    'selectedProvider',
    'passwordSettings',
    'nameSettings',
    'developerSettings',
    'emailRetentionDays',
    'faviconCaching',
    'providerInstances',
  ],
  identities: ['identities', 'selectedIdentityId'],
  savedLogins: ['loginInfo', 'emailHistory'],
  inboxes: ['inboxes', 'activeInboxId', 'storedEmails', 'archivedEmails'],
  filters: ['savedSearchFilters'],
};

const SETTINGS_IMPORT_KEYS = [
  'themeMode',
  'contrastLevel',
  'customColor',
  'autoCopy',
  'autoRenew',
  'selectedProvider',
  'nameSettings',
  'developerSettings',
  'emailRetentionDays',
  'faviconCaching',
  'providerInstances',
] as const;

export interface BackupSelection {
  categories: BackupCategory[];
  /** Import: include stored/archived email bags when importing inboxes. Default true. */
  includeEmails?: boolean;
  /**
   * Import: expired inbox policy. Default 'skip'.
   * - skip: drop all expired
   * - renewableOnly: import expired only if provider is renewable
   * - all: import every expired (non-renewable → archived)
   */
  expiredMode?: ExpiredInboxMode;
  /** @deprecated prefer expiredMode - true maps to 'all', false to 'skip' */
  includeExpiredInboxes?: boolean;
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
}

/** On-disk format when password-protected. */
export interface EncryptedBackupFile {
  version: string;
  encrypted: true;
  salt: string;
  ciphertext: string; // ivHex:dataHex of JSON BackupFileV3
  exportDate?: string;
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
    inboxesTotal: number;
    inboxesActive: number;
    inboxesExpired: number;
    inboxesExpiredRenewable: number;
    inboxesExpiredNonRenewable: number;
    filters: number;
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
  inboxesToImport: number;
  inboxesNew: number;
  inboxesExisting: number;
  skippedExpiredInboxes: number;
  renewableExpiredToImport: number;
  nonRenewableExpiredToImport: number;
  settingsKeys: number;
  willReplace: boolean;
}

export interface ImportSummary {
  imported: Partial<Record<BackupCategory, number>>;
  skippedExpiredInboxes: number;
  importedInboxes: number;
  /** Expired renewable inboxes that were imported (for “try renew” CTA). */
  renewableExpiredImported: number;
  conflictPolicy: ConflictPolicy;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isProviderRenewable(provider: string): boolean {
  try {
    return loadProviderConfig(provider).expiry?.renewable ?? false;
  } catch {
    return false;
  }
}

export function isInboxExpired(account: Pick<Account, 'expiresAt'>, now = Date.now()): boolean {
  // expiresAt <= 0 means "no expiry" / unknown - treat as live, not expired
  const exp = account.expiresAt ?? 0;
  if (exp <= 0) return false;
  return now > exp;
}

export function resolveExpiredMode(selection: BackupSelection): ExpiredInboxMode {
  if (selection.expiredMode) return selection.expiredMode;
  if (selection.includeExpiredInboxes === true) return 'all';
  return 'skip';
}

/**
 * Normalize an inbox on import.
 * Non-renewable expired active inboxes become archived (history only).
 */
export function normalizeImportedInbox(account: Account, now = Date.now()): Account {
  const expired = isInboxExpired(account, now);
  if (!expired) return account;

  const renewable = isProviderRenewable(account.provider);
  if (!renewable && (account.accountStatus === 'active' || !account.accountStatus)) {
    return { ...account, accountStatus: 'archived' };
  }
  return account;
}

/** Whether an expired inbox should be imported under the given mode. */
export function shouldImportExpiredInbox(
  account: Account,
  mode: ExpiredInboxMode,
  now = Date.now()
): boolean {
  if (!isInboxExpired(account, now)) return true;
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
  const inboxes = Array.isArray(data.inboxes) ? (data.inboxes as Account[]) : [];
  let inboxesActive = 0;
  let inboxesExpired = 0;
  let inboxesExpiredRenewable = 0;
  let inboxesExpiredNonRenewable = 0;

  for (const inbox of inboxes) {
    if (!inbox || typeof inbox !== 'object') continue;
    if (isInboxExpired(inbox, now)) {
      inboxesExpired++;
      if (isProviderRenewable(String(inbox.provider || ''))) {
        inboxesExpiredRenewable++;
      } else {
        inboxesExpiredNonRenewable++;
      }
    } else {
      inboxesActive++;
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
    inboxesTotal: inboxes.length,
    inboxesActive,
    inboxesExpired,
    inboxesExpiredRenewable,
    inboxesExpiredNonRenewable,
    filters: Array.isArray(data.savedSearchFilters) ? data.savedSearchFilters.length : 0,
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
  ext: { storage: { local: { get: (keys: string[] | null) => Promise<Record<string, unknown>> } } },
  categories: BackupCategory[],
  now = Date.now()
): Promise<BackupInspection> {
  const keys = keysForCategories(categories.length ? categories : ALL_BACKUP_CATEGORIES);
  const data = await ext.storage.local.get(keys);
  const payload: BackupFileV3 = {
    version: '3.0',
    exportDate: new Date().toISOString(),
    data,
  };
  return inspectBackup(payload, now);
}

function stripSensitiveFields(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (out.passwordSettings && typeof out.passwordSettings === 'object') {
    const ps = { ...(out.passwordSettings as Record<string, unknown>) };
    delete ps.customPassword;
    out.passwordSettings = ps;
  }
  // Profile pictures are large data URLs — never ship in default backup payload size / leak risk
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

  if (Array.isArray(out.inboxes)) {
    out.inboxes = (out.inboxes as Record<string, unknown>[]).map((item) => {
      const copy = { ...item };
      delete copy.token;
      delete copy.sidToken;
      return copy;
    });
  }

  // Not a password manager — never export vault material or session crypto
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

async function deriveBackupKey(password: string, saltHex: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBackupPayload(
  payload: BackupFileV3,
  password: string
): Promise<EncryptedBackupFile> {
  if (!password || password.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const salt = bytesToHex(saltBytes);
  const key = await deriveBackupKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const ciphertext = `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(encrypted))}`;
  return {
    version: '3.0',
    encrypted: true,
    salt,
    ciphertext,
    exportDate: payload.exportDate,
  };
}

export async function decryptBackupPayload(
  file: EncryptedBackupFile,
  password: string
): Promise<BackupFileV3> {
  if (!password) throw new Error('Password required');
  const key = await deriveBackupKey(password, file.salt);
  const [ivHex, dataHex] = file.ciphertext.split(':');
  if (!ivHex || !dataHex) throw new Error('Invalid encrypted backup');
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(ivHex) as BufferSource },
      key,
      hexToBytes(dataHex) as BufferSource
    );
    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as BackupFileV3;
    if (!parsed?.data || typeof parsed.data !== 'object') {
      throw new Error('Invalid decrypted backup');
    }
    return parsed;
  } catch {
    throw new Error('Incorrect password or corrupted backup file');
  }
}

export function isEncryptedBackup(obj: unknown): obj is EncryptedBackupFile {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return o.encrypted === true && typeof o.salt === 'string' && typeof o.ciphertext === 'string';
}

// ── Export ───────────────────────────────────────────────────────────────────

export async function buildBackupPayload(
  ext: { storage: { local: { get: (keys: string[] | null) => Promise<Record<string, unknown>> } } },
  selection: BackupSelection
): Promise<BackupFileV3> {
  const categories =
    selection.categories.length > 0 ? selection.categories : [...ALL_BACKUP_CATEGORIES];
  const keys = keysForCategories(categories);
  const result = await ext.storage.local.get(keys);
  let data = stripSensitiveFields({ ...result });
  if (selection.excludeSecrets) {
    data = stripSecretsFromData(data);
  }

  const allSelected =
    ALL_BACKUP_CATEGORIES.every((c) => categories.includes(c)) &&
    categories.length === ALL_BACKUP_CATEGORIES.length;

  return {
    version: '3.0',
    exportDate: new Date().toISOString(),
    categories: allSelected ? 'all' : categories,
    data,
    secretsExcluded: selection.excludeSecrets || undefined,
  };
}

export function downloadJson(obj: unknown, filename: string): void {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  // Prefer extension downloads API (survives popup close better than <a download>)
  try {
    const b = (globalThis as { browser?: { downloads?: { download: (o: unknown) => void } } })
      .browser;
    if (b?.downloads?.download) {
      void b.downloads.download({
        url,
        filename,
        saveAs: true,
      });
      // Revoke later so the download can start
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
  } catch {
    /* fall through */
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadBackup(
  payload: BackupFileV3 | EncryptedBackupFile,
  filenamePrefix = '1click-backup'
): void {
  const date = new Date().toISOString().split('T')[0];
  const encrypted = isEncryptedBackup(payload);
  const isPartial =
    !encrypted &&
    (payload as BackupFileV3).categories !== 'all' &&
    Array.isArray((payload as BackupFileV3).categories);
  let prefix = isPartial ? '1click-partial' : filenamePrefix;
  if (encrypted) prefix = `${prefix}-encrypted`;
  downloadJson(payload, `${prefix}-${date}.json`);
}

export const LAST_BACKUP_AT_KEY = 'lastBackupExportAt';

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
    throw new Error('No categories selected');
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

export async function getLastBackupExportAt(ext: {
  storage: { local: { get: (keys: string[] | null) => Promise<Record<string, unknown>> } };
}): Promise<number | null> {
  try {
    const res = (await ext.storage.local.get([LAST_BACKUP_AT_KEY])) as {
      [LAST_BACKUP_AT_KEY]?: number;
    };
    const n = res[LAST_BACKUP_AT_KEY];
    return typeof n === 'number' && n > 0 ? n : null;
  } catch {
    return null;
  }
}

// ── Parse ────────────────────────────────────────────────────────────────────

export type ParseBackupResult =
  | { kind: 'plain'; payload: BackupFileV3; bytes: number }
  | { kind: 'encrypted'; encrypted: EncryptedBackupFile; bytes: number };

/** Normalize older / loose export shapes into a v3-like data bag. */
function normalizeImportDataRoot(obj: Record<string, unknown>): Record<string, unknown> {
  const data = { ...obj };
  // Legacy aliases
  if (!Array.isArray(data.inboxes) && Array.isArray(data.accounts)) {
    data.inboxes = data.accounts;
  }
  if (!Array.isArray(data.loginInfo) && Array.isArray(data.savedLogins)) {
    data.loginInfo = data.savedLogins;
  }
  if (!Array.isArray(data.loginInfo) && Array.isArray(data.credentials)) {
    data.loginInfo = data.credentials;
  }
  if (!Array.isArray(data.savedSearchFilters) && Array.isArray(data.filters)) {
    data.savedSearchFilters = data.filters;
  }
  if (!Array.isArray(data.identities) && Array.isArray(data.profiles)) {
    data.identities = data.profiles;
  }
  return data;
}

function looksLikeImportableData(obj: Record<string, unknown>): boolean {
  return (
    Array.isArray(obj.inboxes) ||
    Array.isArray(obj.accounts) ||
    Array.isArray(obj.identities) ||
    Array.isArray(obj.profiles) ||
    Array.isArray(obj.loginInfo) ||
    Array.isArray(obj.savedLogins) ||
    Array.isArray(obj.credentials) ||
    Array.isArray(obj.emailHistory) ||
    Array.isArray(obj.savedSearchFilters) ||
    Array.isArray(obj.filters) ||
    obj.selectedProvider != null ||
    obj.storedEmails != null ||
    obj.archivedEmails != null ||
    obj.themeMode != null ||
    obj.autoCopy != null ||
    obj.autoRenew != null ||
    obj.analytics != null
  );
}

export async function parseBackupText(text: string): Promise<ParseBackupResult> {
  // Strip BOM + whitespace so Windows-saved JSON and clipboard paste still parse
  let trimmed = (text ?? '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    throw new Error('Empty backup content');
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
        .replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error('Invalid JSON format');
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Missing required format fields (version/data)');
  }
  const bytes = new TextEncoder().encode(trimmed).length;
  if (isEncryptedBackup(parsed)) {
    return { kind: 'encrypted', encrypted: parsed, bytes };
  }
  const obj = parsed as Record<string, unknown>;

  // Standard export shape: { version, data: { ... } }
  if (obj.data && typeof obj.data === 'object' && obj.data !== null) {
    const data = normalizeImportDataRoot(obj.data as Record<string, unknown>);
    return {
      kind: 'plain',
      payload: {
        version: String(obj.version || '3.0.0'),
        exportDate: typeof obj.exportDate === 'string' ? obj.exportDate : '',
        categories: obj.categories as BackupCategory[] | 'all' | undefined,
        secretsExcluded: obj.secretsExcluded === true,
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
            data: normalizeImportDataRoot(n),
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
        data: normalizeImportDataRoot(obj),
      },
      bytes,
    };
  }

  throw new Error('Missing required format fields (version/data)');
}

export async function parseBackupFile(file: File): Promise<ParseBackupResult> {
  return parseBackupText(await file.text());
}

/** Resolve plain payload, decrypting if needed. */
export async function resolveBackupPayload(
  parsed: ParseBackupResult,
  password?: string
): Promise<BackupFileV3> {
  if (parsed.kind === 'plain') return parsed.payload;
  if (!password) throw new Error('Password required');
  return decryptBackupPayload(parsed.encrypted, password);
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

function mergeByKey<T extends Record<string, unknown>>(
  existing: T[],
  incoming: T[],
  key: keyof T
): T[] {
  const merged = [...existing];
  for (const item of incoming) {
    if (item == null) continue;
    if (!merged.some((e) => e[key] === item[key])) merged.push(item);
  }
  return merged;
}

function mergeRecord<T>(
  existing: Record<string, T>,
  incoming: Record<string, T>
): Record<string, T> {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in merged)) merged[key] = value;
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

// ── Filter inboxes by expiry mode ────────────────────────────────────────────

export function filterInboxesForImport(
  rawInboxes: Account[],
  mode: ExpiredInboxMode,
  now = Date.now()
): {
  accepted: Account[];
  skippedExpired: number;
  renewableExpired: number;
  nonRenewableExpired: number;
} {
  const accepted: Account[] = [];
  let skippedExpired = 0;
  let renewableExpired = 0;
  let nonRenewableExpired = 0;

  for (const inbox of rawInboxes) {
    if (!inbox?.id) continue;
    const expired = isInboxExpired(inbox, now);
    if (expired) {
      const renewable = isProviderRenewable(String(inbox.provider || ''));
      if (!shouldImportExpiredInbox(inbox, mode, now)) {
        skippedExpired++;
        continue;
      }
      if (renewable) renewableExpired++;
      else nonRenewableExpired++;
    }
    accepted.push(normalizeImportedInbox(inbox, now));
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
    'inboxes',
    'emailHistory',
    'loginInfo',
    'identities',
    'savedSearchFilters',
  ]);

  const preview: ImportPreview = {
    newIdentities: 0,
    skippedExistingIdentities: 0,
    newLogins: 0,
    skippedExistingLogins: 0,
    newFilters: 0,
    skippedExistingFilters: 0,
    inboxesToImport: 0,
    inboxesNew: 0,
    inboxesExisting: 0,
    skippedExpiredInboxes: 0,
    renewableExpiredToImport: 0,
    nonRenewableExpiredToImport: 0,
    settingsKeys: 0,
    willReplace: policy === 'replace',
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
    const existingDomains = new Set(
      ((existing.loginInfo as { domain?: string }[]) || []).map((i) => i.domain)
    );
    for (const item of data.loginInfo as { domain?: string }[]) {
      if (!item?.domain) continue;
      if (policy === 'replace' || !existingDomains.has(item.domain)) preview.newLogins++;
      else preview.skippedExistingLogins++;
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

  if (selection.categories.includes('inboxes')) {
    const raw = Array.isArray(data.inboxes) ? (data.inboxes as Account[]) : [];
    const { accepted, skippedExpired, renewableExpired, nonRenewableExpired } =
      filterInboxesForImport(raw, mode, now);
    preview.inboxesToImport = accepted.length;
    preview.skippedExpiredInboxes = skippedExpired;
    preview.renewableExpiredToImport = renewableExpired;
    preview.nonRenewableExpiredToImport = nonRenewableExpired;
    const existingIds = new Set(((existing.inboxes as Account[]) || []).map((i) => i.id));
    for (const inbox of accepted) {
      if (policy === 'replace' || !existingIds.has(inbox.id)) preview.inboxesNew++;
      else preview.inboxesExisting++;
    }
  }

  return preview;
}

// ── Import ───────────────────────────────────────────────────────────────────

export async function importBackup(
  ext: StorageLike,
  payload: BackupFileV3,
  selection: BackupSelection,
  loadInboxes: () => Promise<void>,
  now = Date.now()
): Promise<ImportSummary> {
  if (!selection.categories.length) {
    throw new Error('No categories selected');
  }

  const includeEmails = selection.includeEmails !== false;
  const mode = resolveExpiredMode(selection);
  const policy = selection.conflictPolicy ?? 'merge';
  const importedDict = payload.data || {};
  const summary: ImportSummary = {
    imported: {},
    skippedExpiredInboxes: 0,
    importedInboxes: 0,
    renewableExpiredImported: 0,
    conflictPolicy: policy,
  };

  const existing = await ext.storage.local.get([
    'inboxes',
    'emailHistory',
    'loginInfo',
    'storedEmails',
    'archivedEmails',
    'identities',
    'savedSearchFilters',
    'activeInboxId',
  ]);

  const toSet: Record<string, unknown> = {};

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
      const ps = { ...(importedDict.passwordSettings as Record<string, unknown>) };
      delete ps.customPassword;
      toSet.passwordSettings = ps;
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
          : mergeByKey(
              (existing.emailHistory as Record<string, unknown>[]) || [],
              importedDict.emailHistory as Record<string, unknown>[],
              'email'
            );
    }
    if (Array.isArray(importedDict.loginInfo)) {
      toSet.loginInfo =
        policy === 'replace'
          ? importedDict.loginInfo
          : mergeByKey(
              (existing.loginInfo as Record<string, unknown>[]) || [],
              importedDict.loginInfo as Record<string, unknown>[],
              'domain'
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

  if (selection.categories.includes('inboxes')) {
    const rawInboxes = Array.isArray(importedDict.inboxes)
      ? (importedDict.inboxes as Account[])
      : [];
    const { accepted, skippedExpired, renewableExpired } = filterInboxesForImport(
      rawInboxes,
      mode,
      now
    );
    summary.skippedExpiredInboxes = skippedExpired;
    summary.renewableExpiredImported = renewableExpired;

    if (policy === 'replace') {
      toSet.inboxes = accepted;
    } else {
      toSet.inboxes = mergeById((existing.inboxes as Account[]) || [], accepted);
    }
    summary.importedInboxes = accepted.length;
    summary.imported.inboxes = accepted.length;

    // Always resolve a usable activeInboxId so post-hard-reset import isn't stuck on onboarding
    {
      const list = toSet.inboxes as Account[];
      const candidateId =
        typeof importedDict.activeInboxId === 'string' ? importedDict.activeInboxId : '';
      const candidate = candidateId ? list.find((i) => i.id === candidateId) : undefined;
      const existingActive =
        typeof existing.activeInboxId === 'string' ? existing.activeInboxId : '';
      const existingStillValid =
        policy !== 'replace' &&
        existingActive &&
        list.some((i) => i.id === existingActive && !isInboxExpired(i, now));

      if (candidate && !isInboxExpired(candidate, now)) {
        toSet.activeInboxId = candidate.id;
      } else if (existingStillValid) {
        // keep existing live selection on merge when import candidate is invalid
        toSet.activeInboxId = existingActive;
      } else {
        const firstLive = list.find((i) => !isInboxExpired(i, now));
        const firstAny = list[0];
        const pick = firstLive || firstAny;
        if (pick) toSet.activeInboxId = pick.id;
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
            filtered[canon] = [...existing, ...emails];
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
            : mergeRecord((existing.storedEmails as Record<string, unknown>) || {}, filtered);
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
            : mergeRecord((existing.archivedEmails as Record<string, unknown>) || {}, filtered);
      }
    } else if (policy === 'replace') {
      // replace mode without emails: leave email bags alone (don't wipe)
    }
  }

  if (Object.keys(toSet).length > 0) {
    await ext.storage.local.set(toSet);
  }
  await loadInboxes();
  return summary;
}

/** Format byte size for UI. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
