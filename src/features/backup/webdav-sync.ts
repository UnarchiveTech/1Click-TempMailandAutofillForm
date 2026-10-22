/**
 * WebDAV Cloud Sync module for 1Click Temp Mail.
 * Allows users to test, upload, and download encrypted extension backups to WebDAV servers (Nextcloud, ownCloud, Fastmail, etc.).
 */
import { browser } from 'wxt/browser';
import {
  ALL_BACKUP_CATEGORIES,
  type BackupCategory,
  type BackupFileV3,
  buildBackupPayload,
  type EncryptedBackupFile,
  encryptBackupPayload,
  type ImportSummary,
  importBackup,
  parseBackupText,
  reencryptPayloadToLocalKey,
  resolveBackupPayload,
} from '@/features/settings/backup-actions.js';
import {
  BaseExtensionError,
  ErrorCode,
  ErrorSeverity,
  type LocalizedMessage,
  localizedMessage,
  toResultError,
} from '@/utils/errors.js';
import { logError } from '@/utils/logger.js';
import { validateFetchUrl } from '@/utils/provider/instance-validation.js';
import { decryptSecret, encryptSecret } from '@/utils/security/crypto.js';
import { fetchWithValidatedRedirects } from '@/utils/security/safe-fetch.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

export type WebDAVConfig = {
  url: string;
  username?: string;
  password?: string;
  /** Allow http:// URLs (cleartext). Default false - https required. */
  allowInsecureHttp?: boolean;
};

/**
 * The string form a WebDAV helper carries while it builds a result: a stable
 * `errors.*` key (the UI translates it) or raw diagnostic text. The *published*
 * result fields carry a `LocalizedMessage` instead - key and slot values as one
 * value - so the values cannot be separated from the key that needs them.
 */
type WebDAVResultMessage = `errors.${string}` | (string & {});

/**
 * Build a WebDAV error carrying a `LocalizedMessage` - a stable `errors.*`
 * translationKey **and** the values its `{slot}`s need. Taking the pair as one
 * value is what makes the download path's `{status}` impossible to lose between
 * the throw and the UI: the compiler rejects a slot-bearing key without its
 * values, and the catch site forwards both without re-deriving them from
 * `context`. The English `message` is dev/log text only.
 */
function webdavError(
  code: ErrorCode,
  message: string,
  translation: LocalizedMessage,
  context?: Record<string, unknown>
): BaseExtensionError {
  return new BaseExtensionError(
    message,
    code,
    ErrorSeverity.LOW,
    context,
    undefined,
    translation.key,
    translation.values
  );
}

async function validateWebDAVUrl(
  url: string,
  allowInsecureHttp = false
): Promise<{ ok: boolean; error?: WebDAVResultMessage }> {
  if (!url?.trim()) {
    return { ok: false, error: 'errors.webdavInvalidUrl' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'errors.webdavInvalidUrlFormat' };
  }
  if (parsed.protocol === 'http:' && !allowInsecureHttp) {
    return { ok: false, error: 'errors.webdavHttpsOnly' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'errors.webdavHttpsOnly' };
  }
  // Credentials belong in separately encrypted fields, never in the persisted
  // URL where they could leak through diagnostics or backup metadata.
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'errors.webdavInvalidUrl' };
  }
  // This is the static gate used while validating saved configuration. Every
  // actual request also runs the DNS-aware gate immediately before fetching.
  return validateFetchUrl(parsed.toString(), {
    allowHttp: parsed.protocol === 'http:' && allowInsecureHttp,
    skipDns: true,
  });
}

async function validateWebDAVRedirectUrl(
  url: string,
  allowInsecureHttp = false
): Promise<{ ok: boolean; error?: WebDAVResultMessage }> {
  return validateFetchUrl(url, {
    allowHttp: allowInsecureHttp,
    skipDns: false,
  });
}

async function fetchWebDAVWithValidatedRedirects(
  url: string,
  options: RequestInit,
  allowInsecureHttp = false
): Promise<Response> {
  // Validate the initial URL and every redirect target immediately before
  // making a request, so a public-looking hostname cannot resolve to a private
  // address on either the initial hop or an allowed HTTP redirect.
  const initialCheck = await validateWebDAVRedirectUrl(url, allowInsecureHttp);
  if (!initialCheck.ok) {
    // initialCheck.error is an errors.* locale key from the validator - pass it
    // as the translationKey so the UI renders it localized; the English here is
    // dev/log text only (display path is keyed, see formatWebDAVError).
    const reason = initialCheck.error;
    throw webdavError(
      ErrorCode.INVALID_URL,
      reason ? `WebDAV URL rejected: ${reason}` : 'WebDAV URL is not allowed',
      localizedMessage(reason ?? 'errors.webdavUrlNotAllowed')
    );
  }
  return fetchWithValidatedRedirects(url, options, (redirectUrl) =>
    validateWebDAVRedirectUrl(redirectUrl, allowInsecureHttp)
  );
}

const WEBDAV_REQUEST_TIMEOUT_MS = 30_000;
const MAX_WEBDAV_BACKUP_BYTES = 50 * 1024 * 1024;

async function withWebDAVTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readWebDAVTextLimited(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBDAV_BACKUP_BYTES) {
    throw webdavError(
      ErrorCode.BACKUP_TOO_LARGE,
      'WebDAV backup is too large to download',
      localizedMessage('errors.backupTooLarge')
    );
  }
  if (!response.body) {
    // No streaming reader (older engines / some polyfills). Never fall back to
    // response.text() unconditionally - a hostile or compromised server could
    // stream an unbounded body and spike memory before the post-hoc size check
    // fires. Only trust a declared content-length that is present AND within
    // bounds; the encoded-length check below still guards a lying header.
    if (!Number.isFinite(declaredLength) || declaredLength > MAX_WEBDAV_BACKUP_BYTES) {
      throw webdavError(
        ErrorCode.BACKUP_TOO_LARGE,
        'WebDAV backup is too large to download',
        localizedMessage('errors.backupTooLarge')
      );
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_WEBDAV_BACKUP_BYTES) {
      throw webdavError(
        ErrorCode.BACKUP_TOO_LARGE,
        'WebDAV backup is too large to download',
        localizedMessage('errors.backupTooLarge')
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_WEBDAV_BACKUP_BYTES) {
        await reader.cancel();
        throw webdavError(
          ErrorCode.BACKUP_TOO_LARGE,
          'WebDAV backup is too large to download',
          localizedMessage('errors.backupTooLarge')
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validateWebDAVFilename(
  filename: string
): { ok: true; error?: undefined } | { ok: false; error: WebDAVResultMessage } {
  if (!filename || filename.length > 255 || filename === '.' || filename === '..') {
    return { ok: false, error: 'errors.webdavInvalidFilename' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) || filename.includes('..')) {
    return { ok: false, error: 'errors.webdavInvalidFilename' };
  }
  return { ok: true };
}

function buildWebDAVTargetUrl(base: string, filename: string): string {
  const safe = validateWebDAVFilename(filename);
  if (!safe.ok) {
    throw webdavError(ErrorCode.WEBDAV_INVALID_FILENAME, safe.error, localizedMessage(safe.error));
  }
  const baseUrl = base.endsWith('/') ? base : `${base}/`;
  return new URL(encodeURIComponent(filename), baseUrl).toString();
}

function getAuthHeaders(config: WebDAVConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  if (config.username || config.password) {
    const raw = `${config.username || ''}:${config.password || ''}`;
    const bytes = new TextEncoder().encode(raw);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const credentials = btoa(binary);
    headers.Authorization = `Basic ${credentials}`;
  }
  return headers;
}

/**
 * Convert technical network / CORS / offline errors into user-displayable
 * forms. Recognized failure classes map to stable `errors.*` locale keys and
 * everything else collapses to `defaultKey` (itself an `errors.*` key), with
 * the raw value logged.
 *
 * This result is rendered to the user by `translateResultMessage()`, so raw
 * English prose must never survive it - an unmapped `Error` from `fetch`,
 * storage or a DOM API has no keyable message, and its text would be English
 * in all eight locales. The diagnostic detail belongs in the log, not here.
 */
export function formatWebDAVError(
  err: unknown,
  defaultKey: string = 'errors.webdavNetworkError'
): LocalizedMessage {
  if (err instanceof BaseExtensionError) {
    if (err.translationKey?.startsWith('errors.')) return toResultError(err, defaultKey);
    logError('WebDAV error carried no errors.* translationKey', err);
    return localizedMessage(defaultKey);
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network request failed') ||
      msg.includes('connection refused') ||
      msg.includes('err_connection') ||
      msg.includes('err_name_not_resolved') ||
      msg.includes('err_internet_disconnected')
    ) {
      return localizedMessage('errors.webdavUnreachable');
    }
    if (msg.includes('abort') || msg.includes('timeout')) {
      return localizedMessage('errors.webdavTimeout');
    }
    if (msg.includes('ssl') || msg.includes('cert') || msg.includes('security error')) {
      return localizedMessage('errors.webdavTlsError');
    }
    logError('Unrecognized WebDAV failure', err);
    return localizedMessage(defaultKey);
  }
  return localizedMessage(typeof err === 'string' && err.startsWith('errors.') ? err : defaultKey);
}

/**
 * Test WebDAV server connection and credentials using a PROPFIND or HEAD request.
 */
export async function testWebDAVConnection(
  config: WebDAVConfig
): Promise<{ success: boolean; message?: LocalizedMessage }> {
  const safe = await validateWebDAVUrl(config.url, config.allowInsecureHttp);
  if (!safe.ok) {
    return {
      success: false,
      message: localizedMessage(safe.error ?? 'errors.webdavUrlNotAllowed'),
    };
  }
  try {
    const url = config.url.endsWith('/') ? config.url : `${config.url}/`;
    const res = await withWebDAVTimeout((signal) =>
      fetchWebDAVWithValidatedRedirects(
        url,
        {
          method: 'PROPFIND',
          headers: {
            ...getAuthHeaders(config),
            Depth: '0',
          },
          signal,
        },
        config.allowInsecureHttp
      )
    );
    if (res.ok || res.status === 207 || res.status === 405) {
      return { success: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, message: localizedMessage('errors.webdavAuthFailed') };
    }
    if (res.status === 404) {
      return { success: false, message: localizedMessage('errors.webdavDirectoryNotFound') };
    }
    return {
      success: false,
      message: localizedMessage('errors.webdavServerStatus', { status: res.status }),
    };
  } catch (err: unknown) {
    logError('WebDAV test failed', undefined, err instanceof Error ? err : new Error(String(err)));
    return { success: false, message: formatWebDAVError(err, 'errors.webdavNetworkError') };
  }
}

/**
 * Upload backup payload string (JSON) to WebDAV target directory.
 */
export async function uploadWebDAVBackup(
  config: WebDAVConfig,
  backupPayload: string,
  filename = '1click-mail-backup.json'
): Promise<{ success: boolean; error?: LocalizedMessage }> {
  const safe = await validateWebDAVUrl(config.url, config.allowInsecureHttp);
  if (!safe.ok) {
    return { success: false, error: localizedMessage(safe.error ?? 'errors.webdavUrlNotAllowed') };
  }
  try {
    const targetUrl = buildWebDAVTargetUrl(config.url, filename);
    const res = await withWebDAVTimeout((signal) =>
      fetchWebDAVWithValidatedRedirects(
        targetUrl,
        {
          method: 'PUT',
          headers: {
            ...getAuthHeaders(config),
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: backupPayload,
          signal,
        },
        config.allowInsecureHttp
      )
    );
    if (res.ok || res.status === 201 || res.status === 204) {
      return { success: true };
    }
    return {
      success: false,
      error: localizedMessage('errors.webdavUploadStatus', { status: res.status }),
    };
  } catch (err: unknown) {
    logError(
      'WebDAV upload failed',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    return { success: false, error: formatWebDAVError(err, 'errors.webdavUploadFailed') };
  }
}

/**
 * Download backup payload string from WebDAV target directory.
 */
export async function downloadWebDAVBackup(
  config: WebDAVConfig,
  filename = '1click-mail-backup.json'
): Promise<{ success: boolean; payload?: string; error?: LocalizedMessage }> {
  const safe = await validateWebDAVUrl(config.url, config.allowInsecureHttp);
  if (!safe.ok) {
    return { success: false, error: localizedMessage(safe.error ?? 'errors.webdavUrlNotAllowed') };
  }
  try {
    const targetUrl = buildWebDAVTargetUrl(config.url, filename);
    const payload = await withWebDAVTimeout(async (signal) => {
      const res = await fetchWebDAVWithValidatedRedirects(
        targetUrl,
        {
          method: 'GET',
          headers: getAuthHeaders(config),
          signal,
        },
        config.allowInsecureHttp
      );
      if (!res.ok) {
        throw webdavError(
          ErrorCode.NETWORK_ERROR,
          `File download failed (Status ${res.status})`,
          localizedMessage('errors.webdavDownloadStatus', { status: res.status })
        );
      }
      return readWebDAVTextLimited(res);
    });
    return { success: true, payload };
  } catch (err: unknown) {
    logError(
      'WebDAV download failed',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    // `formatWebDAVError` carries the key and its slot values together, so the
    // status a slot-bearing key needs survives without a context round-trip.
    return {
      success: false,
      error: formatWebDAVError(err, 'errors.webdavDownloadFailed'),
    };
  }
}

// ── Settings persistence (connection + optional backup-encryption password) ──
// Both passwords are stored ENCRYPTED with the device master key (via the
// shared `_enc_:` crypto pipeline) - never plaintext at rest.

export const WEBDAV_CONFIG_KEY = 'webdavConfig';

export interface WebDAVSettings {
  url: string;
  username?: string;
  /** Basic-auth password, encrypted at rest. */
  passwordEnc?: string;
  /** Optional password that encrypts the uploaded backup / decrypts downloads, encrypted at rest. */
  backupPasswordEnc?: string;
  /** Allow http:// URLs (cleartext). Default false - https required. */
  allowInsecureHttp?: boolean;
  /**
   * Master on/off for the WebDAV backup feature. Turning it off disables the
   * scheduled alarm (autoBackup is force-cleared) while KEEPING the connection
   * details so re-enabling is one toggle away. Legacy records without this
   * field default to enabled when a server URL is present.
   */
  enabled?: boolean;
  /** Scheduled auto-backup via browser.alarms. */
  autoBackup?: boolean;
  /** How often the auto-backup runs (days). Default 1. */
  autoBackupIntervalDays?: number;
}

/** Whether the master feature toggle is on (legacy records: on when URL set). */
export function isWebDAVEnabled(settings: WebDAVSettings): boolean {
  return settings.enabled === true || (settings.enabled === undefined && !!settings.url);
}

/** Settings as they should be re-persisted when the feature is toggled off. */
export function withWebDAVDisabled(settings: WebDAVSettings): WebDAVSettings {
  return { ...settings, enabled: false, autoBackup: false };
}

export async function loadWebDAVSettings(): Promise<WebDAVSettings> {
  try {
    const res = (await browser.storage.local.get([WEBDAV_CONFIG_KEY])) as {
      [WEBDAV_CONFIG_KEY]?: Partial<WebDAVSettings>;
    };
    const s = res[WEBDAV_CONFIG_KEY];
    if (!s || typeof s !== 'object') {
      return { url: '', allowInsecureHttp: false, autoBackup: false, autoBackupIntervalDays: 1 };
    }
    return {
      url: typeof s.url === 'string' ? s.url : '',
      username: typeof s.username === 'string' ? s.username : undefined,
      passwordEnc: typeof s.passwordEnc === 'string' ? s.passwordEnc : undefined,
      backupPasswordEnc: typeof s.backupPasswordEnc === 'string' ? s.backupPasswordEnc : undefined,
      allowInsecureHttp: s.allowInsecureHttp === true,
      // Legacy records never wrote `enabled`; treat a configured URL as enabled.
      enabled: s.enabled === undefined ? !!s.url : s.enabled === true,
      autoBackup: s.autoBackup === true,
      autoBackupIntervalDays:
        typeof s.autoBackupIntervalDays === 'number' && s.autoBackupIntervalDays > 0
          ? s.autoBackupIntervalDays
          : 1,
    };
  } catch {
    /* ignore */
    return { url: '', allowInsecureHttp: false };
  }
}

/**
 * Persist connection settings. Plaintext passwords passed via `password` /
 * `backupPassword` are encrypted before storage; values already encrypted
 * (`.passwordEnc` / `.backupPasswordEnc`) pass through unchanged.
 */
export async function saveWebDAVSettings(
  settings: WebDAVSettings & { password?: string; backupPassword?: string }
): Promise<WebDAVSettings> {
  // The master toggle defaults to "enabled when a URL is present" when the
  // caller does not pass it explicitly - that mirrors pre-`enabled` behaviour
  // (any saved URL meant the feature was on). The settings UI always passes an
  // explicit value when the user flips the master switch.
  const hasUrl = !!(settings.url || '').trim();
  const next: WebDAVSettings = {
    url: (settings.url || '').trim(),
    username: settings.username?.trim() || undefined,
    allowInsecureHttp: settings.allowInsecureHttp === true,
    enabled: settings.enabled === undefined ? hasUrl : settings.enabled === true,
    autoBackup: settings.autoBackup === true,
    autoBackupIntervalDays:
      typeof settings.autoBackupIntervalDays === 'number' && settings.autoBackupIntervalDays > 0
        ? settings.autoBackupIntervalDays
        : 1,
  };
  if (typeof settings.password === 'string') {
    // An explicitly supplied empty string clears the saved secret; undefined
    // means the caller is preserving the encrypted value unchanged.
    if (settings.password) next.passwordEnc = await encryptSecret(settings.password);
  } else if (settings.passwordEnc) {
    next.passwordEnc = settings.passwordEnc;
  }
  if (typeof settings.backupPassword === 'string') {
    if (settings.backupPassword)
      next.backupPasswordEnc = await encryptSecret(settings.backupPassword);
  } else if (settings.backupPasswordEnc) {
    next.backupPasswordEnc = settings.backupPasswordEnc;
  }
  await writeWithRetry({ [WEBDAV_CONFIG_KEY]: next });
  return next;
}

/** Decrypt a stored WebDAV password (returns '' when empty / undecryptable). */
export async function decryptWebDAVPassword(enc: string | undefined): Promise<string> {
  if (!enc) return '';
  try {
    return (await decryptSecret(enc)) || '';
  } catch {
    /* ignore */
    return '';
  }
}

/** Build a transport config from persisted settings (decrypting stored secrets). */
export async function buildWebDAVConfig(
  settings: WebDAVSettings,
  plainAuthPassword?: string
): Promise<WebDAVConfig> {
  const password = plainAuthPassword || (await decryptWebDAVPassword(settings.passwordEnc));
  return {
    url: settings.url,
    username: settings.username || undefined,
    password: password || undefined,
    allowInsecureHttp: settings.allowInsecureHttp === true,
  };
}

// ── Orchestration (upload / download-and-restore) ───────────────────────────

export const WEBDAV_BACKUP_FILENAME = '1click-mail-backup.json';

/** Storage key for the last successful upload timestamp (scheduled or manual). */
export const LAST_WEBDAV_SYNC_KEY = 'lastWebDAVSyncAt';

/** Record the last successful WebDAV upload time for the Settings indicator. */
export async function recordWebDAVSync(): Promise<void> {
  try {
    await writeWithRetry({ [LAST_WEBDAV_SYNC_KEY]: Date.now() });
  } catch {
    /* optional */
  }
}

export async function getLastWebDAVSyncAt(): Promise<number | null> {
  try {
    const res = (await browser.storage.local.get([LAST_WEBDAV_SYNC_KEY])) as {
      [LAST_WEBDAV_SYNC_KEY]?: number;
    };
    const n = res[LAST_WEBDAV_SYNC_KEY];
    return typeof n === 'number' && n > 0 ? n : null;
  } catch {
    /* ignore */
    return null;
  }
}

/**
 * Run the scheduled auto-backup: load persisted settings, decrypt stored
 * secrets, upload, and record the last-sync timestamp on success. When the
 * user configured a backup-encryption password but the vault is locked (so it
 * cannot be decrypted), the upload is SKIPPED - never fall back to uploading a
 * plaintext backup the user explicitly chose to encrypt.
 */
export async function runAutoWebDAVBackup(): Promise<WebDAVActionResult> {
  const settings = await loadWebDAVSettings();
  if (!isWebDAVEnabled(settings)) {
    return { success: false, error: localizedMessage('errors.webdavBackupDisabled') };
  }
  if (!settings.autoBackup) {
    return { success: false, error: localizedMessage('errors.webdavAutoBackupDisabled') };
  }
  if (!settings.url) {
    return { success: false, error: localizedMessage('errors.webdavUrlNotConfigured') };
  }
  const config = await buildWebDAVConfig(settings);
  let backupPassword: string | undefined;
  if (settings.backupPasswordEnc) {
    backupPassword = await decryptWebDAVPassword(settings.backupPasswordEnc);
    if (!backupPassword) {
      return { success: false, error: localizedMessage('errors.webdavBackupPasswordLocked') };
    }
  }
  return await uploadBackupToWebDAV(config, backupPassword);
}

export interface WebDAVActionResult {
  success: boolean;
  /**
   * Why the action failed: an `errors.*` locale key with its slot values, or raw
   * pass-through text. Pairing them here is what stops the UI from rendering a
   * key without the values that belong to it.
   */
  error?: LocalizedMessage;
  /** Success detail (a filename) or a keyed message - rendered the same way. */
  message?: LocalizedMessage;
  summary?: ImportSummary;
}

/**
 * Upload an already-built backup payload (plain or password-encrypted file) to
 * the WebDAV server. Transport-only - does not record the sync timestamp.
 */
export async function uploadPayloadToWebDAV(
  config: WebDAVConfig,
  payload: BackupFileV3 | EncryptedBackupFile,
  filename: string = WEBDAV_BACKUP_FILENAME
): Promise<WebDAVActionResult> {
  try {
    const res = await uploadWebDAVBackup(config, JSON.stringify(payload, null, 2), filename);
    return res.success
      ? { success: true, message: localizedMessage(filename) }
      : { success: false, error: res.error };
  } catch (err: unknown) {
    logError(
      'WebDAV backup upload failed',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    return {
      success: false,
      error: formatWebDAVError(err, 'errors.webdavUploadFailed'),
    };
  }
}

/**
 * Build a backup with the given export selections (categories + exclude
 * secrets - the same options as the Export dialog), optionally password-encrypt
 * it, upload it to the WebDAV server, and record the sync timestamp on success.
 */
export async function uploadExportToWebDAV(
  config: WebDAVConfig,
  selection: { categories: BackupCategory[]; excludeSecrets?: boolean },
  backupPassword?: string,
  filename: string = WEBDAV_BACKUP_FILENAME
): Promise<WebDAVActionResult> {
  try {
    const payload = await buildBackupPayload(browser, {
      categories: selection.categories.length ? selection.categories : [...ALL_BACKUP_CATEGORIES],
      excludeSecrets: selection.excludeSecrets === true,
    });
    const file = backupPassword ? await encryptBackupPayload(payload, backupPassword) : payload;
    const res = await uploadPayloadToWebDAV(config, file, filename);
    if (res.success) await recordWebDAVSync();
    return res;
  } catch (err: unknown) {
    logError(
      'WebDAV backup upload failed',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    return {
      success: false,
      error: formatWebDAVError(err, 'errors.webdavUploadFailed'),
    };
  }
}

/**
 * Build a full backup (all categories) and upload it to the WebDAV server.
 * When `backupPassword` is set the payload is AES-GCM password-encrypted (with
 * the device master key wrapped in) so it can be restored on another device.
 */
export async function uploadBackupToWebDAV(
  config: WebDAVConfig,
  backupPassword?: string,
  filename: string = WEBDAV_BACKUP_FILENAME
): Promise<WebDAVActionResult> {
  return await uploadExportToWebDAV(
    config,
    { categories: [...ALL_BACKUP_CATEGORIES] },
    backupPassword,
    filename
  );
}

/**
 * Download the backup file from the WebDAV server, decrypt it if needed, and
 * import it (merge policy, all categories incl. emails). Mirrors the import
 * dialog's cross-device path: a wrapped master key is unwrapped and every
 * secret store is re-encrypted to the LOCAL key.
 */
export async function downloadAndRestoreWebDAV(
  config: WebDAVConfig,
  backupPassword: string | undefined,
  loadAddresses: () => Promise<void>,
  filename: string = WEBDAV_BACKUP_FILENAME
): Promise<WebDAVActionResult> {
  try {
    const res = await downloadWebDAVBackup(config, filename);
    if (!res.success || res.payload == null) {
      return {
        success: false,
        error: res.error ?? localizedMessage('errors.webdavDownloadFailed'),
      };
    }
    const parsed = await parseBackupText(res.payload);
    let payload: BackupFileV3;
    if (parsed.kind === 'encrypted') {
      if (!backupPassword) {
        return { success: false, error: localizedMessage('errors.backupPasswordRequired') };
      }
      const resolved = await resolveBackupPayload(parsed, backupPassword);
      payload = resolved.payload;
      if (resolved.wrappedMasterKey) {
        const r = await reencryptPayloadToLocalKey(
          payload,
          resolved.wrappedMasterKey,
          backupPassword,
          resolved.salt,
          resolved.kdf
        );
        if (r.leftUntouched > 0) {
          // Do not import a partially re-keyed payload: one foreign-key blob can
          // invalidate the selected secret stores as a group.
          return { success: false, error: localizedMessage('errors.backupKeyMismatch') };
        }
        payload = r.payload;
      }
    } else {
      payload = parsed.payload;
    }
    const summary = await importBackup(
      browser,
      payload,
      {
        categories: [...ALL_BACKUP_CATEGORIES],
        includeEmails: true,
        expiredMode: 'all',
        conflictPolicy: 'merge',
      },
      loadAddresses
    );
    return { success: true, summary };
  } catch (err: unknown) {
    logError(
      'WebDAV download & restore failed',
      undefined,
      err instanceof Error ? err : new Error(String(err))
    );
    return {
      success: false,
      error: formatWebDAVError(err, 'errors.webdavRestoreFailed'),
    };
  }
}
