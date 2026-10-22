import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

import type { Address } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── In-memory browser mock + fetch stub (registered before dynamic import) ──
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
let fetchCalls: { url: string; init: RequestInit }[] = [];
let fetchResponses: Response[] = [];
let dnsCalls: string[] = [];

const fakeBrowser = {
  runtime: { onMessage: { addListener: () => {} } },
  storage: {
    onChanged: { addListener: () => {} },
    local: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...store };
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => Object.assign(store, items),
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => {
        if (keys === null || keys === undefined) return { ...sessionStore };
        const list = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const key of list) if (key in sessionStore) result[key] = sessionStore[key];
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(sessionStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStore[key];
      },
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('https://dns.google/resolve?')) {
    dnsCalls.push(url);
    const isIpv6Query = new URL(url).searchParams.get('type') === 'AAAA';
    const answer = isIpv6Query
      ? { type: 28, data: '2606:4700:4700::1111' }
      : { type: 1, data: '8.8.8.8' };
    return new Response(JSON.stringify({ Answer: [answer] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  fetchCalls.push({ url, init: init || {} });
  const r = fetchResponses.shift();
  if (!r) return new Response('', { status: 404 });
  return r;
}) as typeof fetch;

const {
  buildWebDAVConfig,
  decryptWebDAVPassword,
  downloadAndRestoreWebDAV,
  formatWebDAVError,
  getLastWebDAVSyncAt,
  isWebDAVEnabled,
  LAST_WEBDAV_SYNC_KEY,
  loadWebDAVSettings,
  withWebDAVDisabled,
  runAutoWebDAVBackup,
  saveWebDAVSettings,
  uploadExportToWebDAV,
  testWebDAVConnection,
  uploadBackupToWebDAV,
  WEBDAV_BACKUP_FILENAME,
} = await import('@/features/backup/webdav-sync.js');
const { encryptBackupPayload } = await import('@/features/settings/backup-actions.js');
const { translateResultMessage } = await import('@/utils/errors.js');

const DAV_URL = 'https://dav.example.com/remote.php/dav/';
const CONFIG = {
  url: DAV_URL,
  username: 'user',
  password: 'pass',
  allowInsecureHttp: false,
};

function backupFile(overrides: Record<string, unknown> = {}): string {
  const payload = {
    version: '3.0',
    exportDate: new Date().toISOString(),
    categories: 'all',
    data: {
      addresses: [
        {
          id: 'imp-1',
          address: 'imported@x.com',
          provider: 'guerrilla',
          createdAt: 1,
          expiresAt: 0,
          accountStatus: 'active',
          status: 'active',
        },
      ],
    },
    ...overrides,
  };
  return JSON.stringify(payload, null, 2);
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  fetchCalls = [];
  fetchResponses = [];
  dnsCalls = [];
});

describe('WebDAV settings persistence', () => {
  test('plaintext passwords are encrypted at rest and decrypt back on read', async () => {
    await saveWebDAVSettings({
      url: DAV_URL,
      username: 'user',
      password: 'auth-secret',
      backupPassword: 'backup-secret',
      allowInsecureHttp: false,
    });
    const stored = store.webdavConfig as Record<string, string>;
    // Never plaintext at rest.
    expect(stored.passwordEnc).toBeDefined();
    expect(stored.passwordEnc).not.toContain('auth-secret');
    expect(stored.backupPasswordEnc).not.toContain('backup-secret');

    const loaded = await loadWebDAVSettings();
    expect(loaded.url).toBe(DAV_URL);
    expect(await decryptWebDAVPassword(loaded.passwordEnc)).toBe('auth-secret');
    expect(await decryptWebDAVPassword(loaded.backupPasswordEnc)).toBe('backup-secret');
  });

  test('empty password fields clear previously stored credentials', async () => {
    await saveWebDAVSettings({
      url: DAV_URL,
      password: 'auth-secret',
      backupPassword: 'backup-secret',
    });
    await saveWebDAVSettings({
      url: DAV_URL,
      password: '',
      backupPassword: '',
    });

    const stored = store.webdavConfig as Record<string, unknown>;
    expect(stored.passwordEnc).toBeUndefined();
    expect(stored.backupPasswordEnc).toBeUndefined();
    const loaded = await loadWebDAVSettings();
    expect(await decryptWebDAVPassword(loaded.passwordEnc)).toBe('');
    expect(await decryptWebDAVPassword(loaded.backupPasswordEnc)).toBe('');
  });

  test('buildWebDAVConfig decrypts the stored auth password', async () => {
    await saveWebDAVSettings({
      url: DAV_URL,
      username: 'user',
      password: 'auth-secret',
      allowInsecureHttp: false,
    });
    const config = await buildWebDAVConfig(await loadWebDAVSettings());
    expect(config.password).toBe('auth-secret');
    expect(config.username).toBe('user');
  });

  test('empty / missing settings load as safe defaults', async () => {
    const s = await loadWebDAVSettings();
    expect(s.url).toBe('');
    expect(s.allowInsecureHttp).toBe(false);
    expect(s.autoBackup).toBe(false);
    expect(s.autoBackupIntervalDays).toBe(1);
    expect(await decryptWebDAVPassword(s.passwordEnc)).toBe('');
  });

  test('auto-backup schedule flags round-trip through save/load', async () => {
    await saveWebDAVSettings({
      url: DAV_URL,
      autoBackup: true,
      autoBackupIntervalDays: 3,
    });
    const s = await loadWebDAVSettings();
    expect(s.autoBackup).toBe(true);
    expect(s.autoBackupIntervalDays).toBe(3);
  });

  test('master enable flag round-trips; legacy records default to enabled with a URL', async () => {
    // Explicit off survives a reload and keeps the connection details.
    await saveWebDAVSettings({ url: DAV_URL, enabled: false, autoBackup: true });
    let s = await loadWebDAVSettings();
    expect(isWebDAVEnabled(s)).toBe(false);
    expect(s.url).toBe(DAV_URL);
    // Explicit on round-trips too.
    await saveWebDAVSettings({ url: DAV_URL, enabled: true, autoBackup: true });
    s = await loadWebDAVSettings();
    expect(isWebDAVEnabled(s)).toBe(true);
    // Legacy stored record without the flag counts as enabled when a URL is set.
    store.webdavConfig = { url: DAV_URL, autoBackup: false };
    s = await loadWebDAVSettings();
    expect(isWebDAVEnabled(s)).toBe(true);
  });

  test('withWebDAVDisabled preserves details while clearing enabled and autoBackup', async () => {
    const s = withWebDAVDisabled({
      url: DAV_URL,
      username: 'user',
      autoBackup: true,
      autoBackupIntervalDays: 3,
    });
    expect(s.url).toBe(DAV_URL);
    expect(s.username).toBe('user');
    expect(s.autoBackupIntervalDays).toBe(3);
    expect(s.enabled).toBe(false);
    expect(s.autoBackup).toBe(false);
  });
});

describe('testWebDAVConnection', () => {
  test('207 multi-status is a success', async () => {
    fetchResponses.push(new Response(null, { status: 207 }));
    const res = await testWebDAVConnection(CONFIG);
    expect(res.success).toBe(true);
    expect(fetchCalls[0].init.method).toBe('PROPFIND');
    expect(fetchCalls[0].init.redirect).toBe('manual');
    expect(dnsCalls).toHaveLength(2);
  });

  test('401 surfaces authentication failure', async () => {
    fetchResponses.push(new Response(null, { status: 401 }));
    const res = await testWebDAVConnection(CONFIG);
    expect(res.success).toBe(false);
    expect(res.message?.key).toBe('errors.webdavAuthFailed');
  });
});

describe('uploadBackupToWebDAV', () => {
  test('PUTs a full plain backup payload', async () => {
    store.addresses = [
      {
        id: 'live-1',
        address: 'live@x.com',
        provider: 'guerrilla',
        createdAt: 1,
        expiresAt: 0,
        accountStatus: 'active',
      },
    ] as Address[];
    fetchResponses.push(new Response(null, { status: 201 }));
    const res = await uploadBackupToWebDAV(CONFIG);
    expect(res.success).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`${DAV_URL}${WEBDAV_BACKUP_FILENAME}`);
    expect(fetchCalls[0].init.method).toBe('PUT');
    const body = JSON.parse(String(fetchCalls[0].init.body));
    expect(body.version).toBe('3.0');
    expect(body.data.addresses).toHaveLength(1);
  });

  test('with a backup password the payload is AES-GCM encrypted', async () => {
    fetchResponses.push(new Response(null, { status: 204 }));
    const res = await uploadBackupToWebDAV(CONFIG, 'password-1234');
    expect(res.success).toBe(true);
    const body = JSON.parse(String(fetchCalls[0].init.body));
    expect(body.encrypted).toBe(true);
    expect(typeof body.ciphertext).toBe('string');
  });

  test('rejects an insecure URL unless explicitly allowed', async () => {
    fetchResponses.push(new Response(null, { status: 201 }));
    const res = await uploadBackupToWebDAV({
      url: 'http://dav.example.com/',
      username: 'u',
      password: 'p',
    });
    expect(res.success).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe('uploadExportToWebDAV', () => {
  test('with a category subset only those categories are exported', async () => {
    store.themeMode = 'dark';
    store.addresses = [
      {
        id: 'live-1',
        address: 'live@x.com',
        provider: 'guerrilla',
        createdAt: 1,
        expiresAt: 0,
        accountStatus: 'active',
      },
    ] as Address[];
    fetchResponses.push(new Response(null, { status: 201 }));
    const res = await uploadExportToWebDAV(CONFIG, { categories: ['settings'] });
    expect(res.success).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    const body = JSON.parse(String(fetchCalls[0].init.body));
    expect(body.categories).toEqual(['settings']);
    expect(body.data.themeMode).toBe('dark');
    expect(body.data.addresses).toBeUndefined();
    // Success records the sync timestamp.
    expect((store[LAST_WEBDAV_SYNC_KEY] as number) > 0).toBe(true);
  });

  test('excludeSecrets strips secrets and flags the payload', async () => {
    store.savedLogins = [
      {
        id: 'login-1',
        name: 'Example',
        username: 'u@x.com',
        password: 'hunter2',
        url: 'https://example.com',
      },
    ];
    fetchResponses.push(new Response(null, { status: 201 }));
    const res = await uploadExportToWebDAV(CONFIG, {
      categories: ['savedLogins'],
      excludeSecrets: true,
    });
    expect(res.success).toBe(true);
    const body = JSON.parse(String(fetchCalls[0].init.body));
    expect(body.secretsExcluded).toBe(true);
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  test('empty selection falls back to all categories', async () => {
    store.themeMode = 'dark';
    fetchResponses.push(new Response(null, { status: 201 }));
    const res = await uploadExportToWebDAV(CONFIG, { categories: [] });
    expect(res.success).toBe(true);
    const body = JSON.parse(String(fetchCalls[0].init.body));
    expect(body.categories).toBe('all');
  });
});

describe('downloadAndRestoreWebDAV', () => {
  test('imports a plain backup (merge policy) and refreshes addresses', async () => {
    fetchResponses.push(new Response(backupFile(), { status: 200 }));
    let refreshed = false;
    const res = await downloadAndRestoreWebDAV(CONFIG, undefined, async () => {
      refreshed = true;
    });
    expect(res.success).toBe(true);
    expect(res.summary?.importedAddresses).toBe(1);
    expect(refreshed).toBe(true);
    const addresses = store.addresses as Address[];
    expect(addresses.some((i) => i.id === 'imp-1')).toBe(true);
  });

  test('decrypts a password-encrypted backup before importing', async () => {
    const payload = JSON.parse(backupFile()) as Parameters<typeof encryptBackupPayload>[0];
    const encrypted = await encryptBackupPayload(payload, 'password-1234');
    fetchResponses.push(new Response(JSON.stringify(encrypted), { status: 200 }));
    const res = await downloadAndRestoreWebDAV(CONFIG, 'password-1234', async () => {});
    expect(res.success).toBe(true);
    expect((store.addresses as Address[]).some((i) => i.id === 'imp-1')).toBe(true);
  });

  test('encrypted file without a password fails cleanly', async () => {
    const payload = JSON.parse(backupFile()) as Parameters<typeof encryptBackupPayload>[0];
    const encrypted = await encryptBackupPayload(payload, 'password-1234');
    fetchResponses.push(new Response(JSON.stringify(encrypted), { status: 200 }));
    const res = await downloadAndRestoreWebDAV(CONFIG, undefined, async () => {});
    expect(res.success).toBe(false);
    expect((store.addresses as Address[] | undefined) ?? []).toHaveLength(0);
  });

  test('network failure surfaces an error without writing', async () => {
    fetchResponses.push(new Response('nope', { status: 500 }));
    const res = await downloadAndRestoreWebDAV(CONFIG, undefined, async () => {});
    expect(res.success).toBe(false);
    // The errors.* key and its {status} value travel as ONE value (the UI
    // layer translates it), so neither can be rendered without the other.
    expect(res.error?.key).toBe('errors.webdavDownloadStatus');
    expect(res.error?.values?.status).toBe(500);
  });
});

describe('runAutoWebDAVBackup', () => {
  test('does nothing when auto-backup is disabled', async () => {
    await saveWebDAVSettings({ url: DAV_URL, autoBackup: false });
    const res = await runAutoWebDAVBackup();
    expect(res.success).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  test('does nothing when the master feature toggle is off even with a URL + autoBackup', async () => {
    await saveWebDAVSettings({ url: DAV_URL, enabled: false, autoBackup: true });
    const res = await runAutoWebDAVBackup();
    expect(res.success).toBe(false);
    expect(res.error?.key).toBe('errors.webdavBackupDisabled');
    expect(fetchCalls).toHaveLength(0);
  });

  test('does nothing without a server URL', async () => {
    await saveWebDAVSettings({ url: '', autoBackup: true });
    const res = await runAutoWebDAVBackup();
    expect(res.success).toBe(false);
    expect(fetchCalls).toHaveLength(0);
  });

  test('uploads with decrypted stored credentials and records the sync time', async () => {
    await saveWebDAVSettings({
      url: DAV_URL,
      username: 'user',
      password: 'auth-secret',
      backupPassword: 'password-1234',
      autoBackup: true,
      autoBackupIntervalDays: 2,
    });
    fetchResponses.push(new Response(null, { status: 201 }));
    const before = Date.now();
    const res = await runAutoWebDAVBackup();
    expect(res.success).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    // Auth header uses the decrypted password.
    const headers = fetchCalls[0].init.headers as Record<string, unknown>;
    expect(String(headers.Authorization ?? '')).toContain('Basic');
    // The uploaded payload was encrypted with the stored backup password.
    const body = JSON.parse(String(fetchCalls[0].init.body));
    expect(body.encrypted).toBe(true);
    const syncAt = await getLastWebDAVSyncAt();
    expect(syncAt).not.toBeNull();
    expect(syncAt as number).toBeGreaterThanOrEqual(before);
    expect((store[LAST_WEBDAV_SYNC_KEY] as number) > 0).toBe(true);
  });

  test('skips instead of uploading unencrypted when the backup password cannot be decrypted', async () => {
    // Simulate a vault-locked state: an encrypted backup-password value that
    // cannot be decrypted with the current key.
    store.webdavConfig = {
      url: DAV_URL,
      autoBackup: true,
      passwordEnc: undefined,
      backupPasswordEnc: '_enc_:AAAAAAAAAAAAAAAA',
    };
    const res = await runAutoWebDAVBackup();
    expect(res.success).toBe(false);
    expect(res.error?.key).toBe('errors.webdavBackupPasswordLocked');
    expect(fetchCalls).toHaveLength(0);
  });

  test('a failed upload does not record a sync time', async () => {
    await saveWebDAVSettings({ url: DAV_URL, autoBackup: true });
    fetchResponses.push(new Response('denied', { status: 403 }));
    const res = await runAutoWebDAVBackup();
    expect(res.success).toBe(false);
    expect(await getLastWebDAVSyncAt()).toBeNull();
  });
});

describe('WebDAV network and CORS error formatting', () => {
  test('formats Failed to fetch and NetworkError as clear connection guidance', () => {
    const error1 = new TypeError('Failed to fetch');
    expect(formatWebDAVError(error1).key).toBe('errors.webdavUnreachable');

    const error2 = new Error('NetworkError when attempting to fetch resource');
    expect(formatWebDAVError(error2).key).toBe('errors.webdavUnreachable');

    const error3 = new Error('net::ERR_NAME_NOT_RESOLVED');
    expect(formatWebDAVError(error3).key).toBe('errors.webdavUnreachable');
  });

  test('formats timeouts and abort errors cleanly', () => {
    const timeoutErr = new Error('The operation was aborted due to timeout');
    expect(formatWebDAVError(timeoutErr).key).toBe('errors.webdavTimeout');
  });

  test('formats certificate and SSL errors cleanly', () => {
    const sslErr = new Error('SSL cert validation failed');
    expect(formatWebDAVError(sslErr).key).toBe('errors.webdavTlsError');
  });

  test('an unrecognized failure renders the localized fallback, never its own message', () => {
    const weird = new TypeError('EIO: i/o error, write failed');
    const message = formatWebDAVError(weird, 'errors.webdavUploadFailed');
    // No raw prose may survive into the result this is rendered from: the
    // message is shown to the user via translateResultMessage(), so an English
    // `err.message` would leak verbatim in all eight locales.
    expect(message.key).toBe('errors.webdavUploadFailed');
    expect(JSON.stringify(message)).not.toContain('EIO');
    expect(formatWebDAVError(weird).key).toBe('errors.webdavNetworkError');

    const t = (key: string) => `<${key}>`;
    expect(translateResultMessage(message, t)).toBe('<errors.webdavUploadFailed>');
  });

  test('testWebDAVConnection surfaces friendly error on fetch exception', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    const res = await testWebDAVConnection(CONFIG);
    expect(res.success).toBe(false);
    expect(res.message?.key).toBe('errors.webdavUnreachable');
  });
});
