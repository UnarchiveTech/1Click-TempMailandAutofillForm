import { describe, expect, mock, test } from 'bun:test';
import {
  ALL_BACKUP_CATEGORIES,
  type BackupFileV3,
  buildBackupPayload,
  decryptBackupPayload,
  encryptBackupPayload,
  filterInboxesForImport,
  importBackup,
  inferPresentCategories,
  inspectBackup,
  isInboxExpired,
  keysForCategories,
  normalizeImportedInbox,
  parseBackupText,
  previewImport,
  resolveExpiredMode,
  stripSecretsFromData,
} from '@/features/settings/backup-actions.js';

mock.module('@/utils/email-service.js', () => ({
  loadProviderConfig: (id: string) => {
    if (id === 'guerrilla') {
      return { id, expiry: { renewable: true, duration: 3600000 } };
    }
    if (id === 'burner') {
      return { id, expiry: { renewable: false, duration: 86400000 } };
    }
    throw new Error(`Unknown provider: ${id}`);
  },
}));

const NOW = 1_700_000_000_000;

function makeAccount(
  overrides: Partial<{
    id: string;
    address: string;
    provider: string;
    expiresAt: number;
    accountStatus: 'active' | 'archived' | 'deleted';
    token?: string;
    sidToken?: string;
  }> = {}
) {
  return {
    id: overrides.id ?? 'inbox-1',
    address: overrides.address ?? 'a@test.com',
    provider: overrides.provider ?? 'guerrilla',
    createdAt: NOW - 3600000,
    expiresAt: overrides.expiresAt ?? NOW + 3600000,
    accountStatus: overrides.accountStatus ?? ('active' as const),
    token: overrides.token,
    sidToken: overrides.sidToken,
  };
}

function makeExt(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  return {
    store,
    ext: {
      storage: {
        local: {
          get: async (keys: string[] | null) => {
            if (!keys) return { ...store };
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              if (k in store) out[k] = store[k];
            }
            return out;
          },
          set: async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          },
        },
      },
    },
  };
}

describe('keysForCategories', () => {
  test('returns union of keys for selected categories', () => {
    const keys = keysForCategories(['identities', 'filters']);
    expect(keys).toContain('identities');
    expect(keys).toContain('selectedIdentityId');
    expect(keys).toContain('savedSearchFilters');
    expect(keys).not.toContain('inboxes');
  });

  test('all categories cover settings and inboxes keys', () => {
    const keys = keysForCategories([...ALL_BACKUP_CATEGORIES]);
    expect(keys).toContain('themeMode');
    expect(keys).toContain('inboxes');
    expect(keys).toContain('savedSearchFilters');
  });
});

describe('isInboxExpired / normalizeImportedInbox', () => {
  test('detects expired inbox', () => {
    expect(isInboxExpired({ expiresAt: NOW - 1 }, NOW)).toBe(true);
    expect(isInboxExpired({ expiresAt: NOW + 1 }, NOW)).toBe(false);
  });

  test('non-renewable expired active → archived', () => {
    const inbox = makeAccount({
      provider: 'burner',
      expiresAt: NOW - 1000,
      accountStatus: 'active',
    });
    expect(normalizeImportedInbox(inbox as never, NOW).accountStatus).toBe('archived');
  });

  test('renewable expired stays active', () => {
    const inbox = makeAccount({
      provider: 'guerrilla',
      expiresAt: NOW - 1000,
      accountStatus: 'active',
    });
    expect(normalizeImportedInbox(inbox as never, NOW).accountStatus).toBe('active');
  });
});

describe('resolveExpiredMode / filterInboxesForImport', () => {
  test('legacy includeExpiredInboxes maps correctly', () => {
    expect(resolveExpiredMode({ categories: [], includeExpiredInboxes: true })).toBe('all');
    expect(resolveExpiredMode({ categories: [] })).toBe('skip');
    expect(resolveExpiredMode({ categories: [], expiredMode: 'renewableOnly' })).toBe(
      'renewableOnly'
    );
  });

  test('skip mode drops all expired', () => {
    const raw = [
      makeAccount({ id: 'live', expiresAt: NOW + 1 }),
      makeAccount({ id: 'dead-g', provider: 'guerrilla', expiresAt: NOW - 1 }),
      makeAccount({ id: 'dead-b', provider: 'burner', expiresAt: NOW - 1 }),
    ];
    const r = filterInboxesForImport(raw as never, 'skip', NOW);
    expect(r.accepted.map((a) => a.id)).toEqual(['live']);
    expect(r.skippedExpired).toBe(2);
  });

  test('renewableOnly imports only renewable expired', () => {
    const raw = [
      makeAccount({ id: 'dead-g', provider: 'guerrilla', expiresAt: NOW - 1 }),
      makeAccount({ id: 'dead-b', provider: 'burner', expiresAt: NOW - 1, address: 'b@t.com' }),
    ];
    const r = filterInboxesForImport(raw as never, 'renewableOnly', NOW);
    expect(r.accepted.map((a) => a.id)).toEqual(['dead-g']);
    expect(r.renewableExpired).toBe(1);
    expect(r.skippedExpired).toBe(1);
  });

  test('all mode imports expired non-renewable as archived', () => {
    const raw = [
      makeAccount({
        id: 'dead-b',
        provider: 'burner',
        expiresAt: NOW - 1,
        address: 'b@t.com',
        accountStatus: 'active',
      }),
    ];
    const r = filterInboxesForImport(raw as never, 'all', NOW);
    expect(r.accepted[0].accountStatus).toBe('archived');
    expect(r.nonRenewableExpired).toBe(1);
  });
});

describe('inferPresentCategories / inspectBackup', () => {
  test('infers categories from data keys', () => {
    const cats = inferPresentCategories({
      themeMode: 'dark',
      identities: [{ id: '1' }],
      inboxes: [],
    });
    expect(cats).toContain('settings');
    expect(cats).toContain('identities');
    expect(cats).toContain('inboxes');
  });

  test('inspect counts expired renewable vs non-renewable', () => {
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: new Date().toISOString(),
      data: {
        inboxes: [
          makeAccount({ id: '1', provider: 'guerrilla', expiresAt: NOW + 1000 }),
          makeAccount({ id: '2', provider: 'guerrilla', expiresAt: NOW - 1000 }),
          makeAccount({
            id: '3',
            provider: 'burner',
            expiresAt: NOW - 1000,
            address: 'b@test.com',
          }),
        ],
        identities: [{ id: 'i1' }, { id: 'i2' }],
        loginInfo: [{ domain: 'x.com' }],
        savedSearchFilters: [{ id: 'f1' }],
        storedEmails: { 'a@test.com': [] },
      },
    };
    const inspection = inspectBackup(payload, NOW);
    expect(inspection.counts.inboxesTotal).toBe(3);
    expect(inspection.counts.inboxesActive).toBe(1);
    expect(inspection.counts.inboxesExpired).toBe(2);
    expect(inspection.counts.inboxesExpiredRenewable).toBe(1);
    expect(inspection.counts.inboxesExpiredNonRenewable).toBe(1);
  });
});

describe('stripSecretsFromData', () => {
  test('removes passwords tokens and custom passwords', () => {
    const stripped = stripSecretsFromData({
      loginInfo: [{ domain: 'a.com', password: 'secret' }],
      identities: [{ id: '1', customPassword: 'x' }],
      inboxes: [makeAccount({ token: 't', sidToken: 's' })],
      passwordSettings: { useCustom: true, customPassword: 'p' },
    });
    expect((stripped.loginInfo as { password?: string }[])[0].password).toBeUndefined();
    expect(
      (stripped.identities as { customPassword?: string }[])[0].customPassword
    ).toBeUndefined();
    expect((stripped.inboxes as { token?: string }[])[0].token).toBeUndefined();
    expect(
      (stripped.passwordSettings as { customPassword?: string }).customPassword
    ).toBeUndefined();
  });
});

describe('buildBackupPayload', () => {
  test('exports only selected category keys and strips customPassword', async () => {
    const storage: Record<string, unknown> = {
      themeMode: 'dark',
      passwordSettings: { useCustom: true, customPassword: 'secret' },
      identities: [{ id: '1' }],
      inboxes: [makeAccount()],
    };
    const ext = {
      storage: {
        local: {
          get: async (keys: string[] | null) => {
            if (!keys) return { ...storage };
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              if (k in storage) out[k] = storage[k];
            }
            return out;
          },
        },
      },
    };

    const payload = await buildBackupPayload(ext, {
      categories: ['settings', 'identities'],
    });

    expect(payload.version).toBe('3.0');
    expect(payload.categories).toEqual(['settings', 'identities']);
    expect(payload.data.themeMode).toBe('dark');
    expect(payload.data.inboxes).toBeUndefined();
    expect(
      (payload.data.passwordSettings as { customPassword?: string }).customPassword
    ).toBeUndefined();
  });

  test('excludeSecrets strips inbox tokens', async () => {
    const storage = {
      inboxes: [makeAccount({ token: 'abc', sidToken: 'def' })],
    };
    const ext = {
      storage: {
        local: {
          get: async () => ({ ...storage }),
        },
      },
    };
    const payload = await buildBackupPayload(ext, {
      categories: ['inboxes'],
      excludeSecrets: true,
    });
    expect(payload.secretsExcluded).toBe(true);
    expect((payload.data.inboxes as { token?: string }[])[0].token).toBeUndefined();
  });
});

describe('password encryption', () => {
  test('round-trips encrypt/decrypt', async () => {
    const original: BackupFileV3 = {
      version: '3.0',
      exportDate: '2026-01-01T00:00:00.000Z',
      categories: 'all',
      data: { themeMode: 'dark', identities: [{ id: '1' }] },
    };
    const enc = await encryptBackupPayload(original, 'test-password');
    expect(enc.encrypted).toBe(true);
    expect(enc.salt).toBeTruthy();
    const dec = await decryptBackupPayload(enc, 'test-password');
    expect(dec.data.themeMode).toBe('dark');
    await expect(decryptBackupPayload(enc, 'wrong')).rejects.toThrow();
  });

  test('parseBackupText detects encrypted files', async () => {
    const original: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: { themeMode: 'light' },
    };
    const enc = await encryptBackupPayload(original, 'secret1');
    const parsed = await parseBackupText(JSON.stringify(enc));
    expect(parsed.kind).toBe('encrypted');
  });
});

describe('previewImport', () => {
  test('reports new vs existing identities', async () => {
    const { ext } = makeExt({
      identities: [{ id: 'a' }],
      inboxes: [],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        identities: [{ id: 'a' }, { id: 'b' }],
        inboxes: [
          makeAccount({ id: 'live', expiresAt: NOW + 1000 }),
          makeAccount({ id: 'dead', expiresAt: NOW - 1 }),
        ],
      },
    };
    const preview = await previewImport(
      ext,
      payload,
      { categories: ['identities', 'inboxes'], expiredMode: 'skip' },
      NOW
    );
    expect(preview.newIdentities).toBe(1);
    expect(preview.skippedExistingIdentities).toBe(1);
    expect(preview.inboxesToImport).toBe(1);
    expect(preview.skippedExpiredInboxes).toBe(1);
  });
});

describe('importBackup', () => {
  test('skips expired inboxes when mode is skip', async () => {
    const { ext, store } = makeExt({ inboxes: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        inboxes: [
          makeAccount({ id: 'live', expiresAt: NOW + 5000, address: 'live@test.com' }),
          makeAccount({ id: 'dead', expiresAt: NOW - 5000, address: 'dead@test.com' }),
        ],
        storedEmails: {
          'live@test.com': [{ id: 'e1' }],
          'dead@test.com': [{ id: 'e2' }],
        },
      },
    };

    const summary = await importBackup(
      ext,
      payload,
      { categories: ['inboxes'], expiredMode: 'skip', includeEmails: true },
      async () => {},
      NOW
    );

    expect(summary.importedInboxes).toBe(1);
    expect(summary.skippedExpiredInboxes).toBe(1);
    expect((store.inboxes as { id: string }[]).map((i) => i.id)).toEqual(['live']);
    expect(Object.keys(store.storedEmails as object)).toEqual(['live@test.com']);
  });

  test('replace policy overwrites identities', async () => {
    const { ext, store } = makeExt({
      identities: [{ id: 'old', name: 'Old' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        identities: [{ id: 'new', name: 'New' }],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['identities'], conflictPolicy: 'replace' },
      async () => {},
      NOW
    );

    expect((store.identities as { id: string }[]).map((i) => i.id)).toEqual(['new']);
  });

  test('merge keeps existing identity', async () => {
    const { ext, store } = makeExt({
      identities: [{ id: 'a', name: 'A' }],
    });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        identities: [
          { id: 'a', name: 'A-new' },
          { id: 'b', name: 'B' },
        ],
      },
    };

    await importBackup(ext, payload, { categories: ['identities'] }, async () => {}, NOW);

    const ids = (store.identities as { id: string; name: string }[]).map((i) => i.id);
    expect(ids).toEqual(['a', 'b']);
    expect((store.identities as { name: string }[])[0].name).toBe('A');
  });

  test('tracks renewableExpiredImported', async () => {
    const { ext } = makeExt({ inboxes: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        inboxes: [
          makeAccount({
            id: 'g',
            provider: 'guerrilla',
            expiresAt: NOW - 1,
          }),
        ],
      },
    };
    const summary = await importBackup(
      ext,
      payload,
      { categories: ['inboxes'], expiredMode: 'renewableOnly' },
      async () => {},
      NOW
    );
    expect(summary.renewableExpiredImported).toBe(1);
    expect(summary.importedInboxes).toBe(1);
  });

  test('prefers live inbox for activeInboxId over expired candidate', async () => {
    const { ext, store } = makeExt({ inboxes: [], activeInboxId: 'prev' });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        activeInboxId: 'dead',
        inboxes: [
          makeAccount({
            id: 'dead',
            provider: 'guerrilla',
            expiresAt: NOW - 1,
            address: 'd@test.com',
          }),
          makeAccount({
            id: 'live',
            provider: 'guerrilla',
            expiresAt: NOW + 10_000,
            address: 'l@test.com',
          }),
        ],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['inboxes'], expiredMode: 'all', conflictPolicy: 'replace' },
      async () => {},
      NOW
    );

    expect(store.activeInboxId).toBe('live');
  });

  test('sets activeInboxId after hard-reset style empty storage import', async () => {
    const { ext, store } = makeExt({ inboxes: [] });
    const payload: BackupFileV3 = {
      version: '3.0',
      exportDate: '',
      data: {
        activeInboxId: 'a1',
        inboxes: [
          makeAccount({
            id: 'a1',
            expiresAt: NOW + 5000,
            address: 'a@test.com',
          }),
        ],
      },
    };

    await importBackup(
      ext,
      payload,
      { categories: ['inboxes'], expiredMode: 'all', conflictPolicy: 'replace' },
      async () => {},
      NOW
    );

    expect(store.activeInboxId).toBe('a1');
    expect((store.inboxes as { id: string }[]).map((i) => i.id)).toEqual(['a1']);
  });
});
