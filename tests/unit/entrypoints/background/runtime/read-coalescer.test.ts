import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── Mocks registered BEFORE the dynamic import of message-handler.js ────────
// wxt/browser is replaced with in-memory storage plus get-counters so the
// coalescers' storage round-trips are directly observable. Handlers are invoked
// through the exported `handlers` record (as check-emails-bulk.test.ts does),
// which exercises the coalescers in the handler bodies without the sender gate.
const store: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};
let localGetCount = 0;
const localReadKeys: Array<string | string[] | null | undefined> = [];
let sessionGetCount = 0;

const onChangedListeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];

function readKeys(keys?: string | string[] | null): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...store };
  const arr = Array.isArray(keys) ? keys : [keys];
  const out: Record<string, unknown> = {};
  for (const k of arr) if (k in store) out[k] = store[k];
  return out;
}

const fakeBrowser = {
  runtime: {
    id: 'test-extension',
    sendMessage: async () => null,
  },
  storage: {
    local: {
      get: async (keys?: string | string[] | null) => {
        localGetCount += 1;
        localReadKeys.push(keys);
        return readKeys(keys);
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      },
      remove: async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      },
    },
    session: {
      get: async (keys?: string | string[] | null) => {
        sessionGetCount += 1;
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
    onChanged: {
      addListener: (fn: (changes: Record<string, unknown>, area: string) => void) => {
        onChangedListeners.push(fn);
      },
      removeListener: (fn: (changes: Record<string, unknown>, area: string) => void) => {
        const i = onChangedListeners.indexOf(fn);
        if (i >= 0) onChangedListeners.splice(i, 1);
      },
    },
  },
};
mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
(globalThis as { browser?: unknown }).browser = fakeBrowser;

// getProviderDisplayName resolves through the real provider registry; pin a
// self-contained email-service mock so the suite doesn't depend on whether a
// sibling file's mock (which need not export DEFAULT_PROVIDER) is still
// registered - every test file must pass on its own mocks (AGENTS.md §5.14).
mock.module('@/utils/email/email-service.js', () => ({
  // Named for every importer in the graph (message-handler pulls EmailService
  // / getAllProviderConfigs / DEFAULT_PROVIDER; storage-keys pulls
  // DEFAULT_PROVIDER; instance-manager pulls loadAllProviderConfigs /
  // tryLoadProviderConfig / providerConfigsReady). Only loadProviderConfig
  // has behavior here.
  DEFAULT_PROVIDER: 'demo',
  DEMO_PROVIDER_CONFIG: { id: 'demo', name: 'demo', displayName: 'Demo' },
  EmailService: class {},
  ProviderConfig: undefined,
  providerConfigsReady: Promise.resolve(true),
  getAllProviderConfigs: () => [],
  loadAllProviderConfigs: () => [],
  loadProviderOverridesFromStorage: async () => false,
  saveProviderOverridesToStorage: async () => undefined,
  tryLoadProviderConfig: (providerId: string) =>
    providerId === 'demo' ? { id: 'demo', name: 'demo', displayName: 'Demo' } : null,
  loadProviderConfig: (providerId: string) => {
    if (providerId === 'demo') {
      return {
        id: 'demo',
        name: 'demo',
        displayName: 'Demo',
        apiUrl: 'https://example.com/demo',
        auth: { type: 'none', description: 'Demo mode - no network' },
      };
    }
    throw new Error(`ProviderNotFoundError: ${providerId}`);
  },
}));

const { handlers, __clearReadCoalescersForTests, installReadInvalidation } = await import(
  '@/entrypoints/background/runtime/message-handler.js'
);
const { __clearMutexRegistryForTests } = await import('@/utils/mutex.js');

// Bun runs the suite in one process with a shared module registry: a sibling
// file may have imported message-handler first, binding its onChanged install
// to THAT file's fake. Re-install against THIS file's fake (idempotent in
// production - registerMessageHandler callers never re-import the module).
installReadInvalidation();

const SETTINGS_KEY = 'smartAutofillSettings';
const WIZARD_KEY = 'autofillWizardSessions_v1';
const FIELD_MAPS_KEY = 'siteFieldMaps_v1';

type HandlerResp = Record<string, unknown>;

async function callHandler(
  key: keyof typeof handlers,
  message: Record<string, unknown>,
  sender: Record<string, unknown>
): Promise<HandlerResp> {
  let response: HandlerResp | undefined;
  await (
    handlers[key] as unknown as (
      msg: Record<string, unknown>,
      snd: Record<string, unknown>,
      sendResponse: (r: HandlerResp) => void
    ) => Promise<void>
  )(message, sender, (r) => {
    response = r;
  });
  return response ?? {};
}

// Sender shapes used by the gates: extension pages keep unredacted shapes,
// content scripts get redacted copies and key-allowlist / OTP-opt-in checks.
const EXT_SENDER = { url: 'chrome-extension://abc/popup.html' };
const contentSender = (host = 'example.com') => ({
  tab: { id: 7, url: `https://${host}/page` },
});

const readSettings = () =>
  callHandler('loadSmartAutofillSettings', { type: 'loadSmartAutofillSettings' }, {});
const readSession = (tabId: number) =>
  callHandler(
    'getWizardSession',
    { type: 'getWizardSession', domain: 'example.com' },
    { tab: { id: tabId } }
  );
const upsertSession = (tabId: number, partial: Record<string, unknown>) =>
  callHandler(
    'upsertWizardSession',
    { type: 'upsertWizardSession', partial: { domain: 'example.com', ...partial } },
    { tab: { id: tabId } }
  );
const advanceSession = (tabId: number, step: string) =>
  callHandler(
    'advanceWizardStep',
    { type: 'advanceWizardStep', domain: 'example.com', step },
    { tab: { id: tabId } }
  );
const clearSession = (tabId?: number) =>
  callHandler(
    'clearWizardSession',
    { type: 'clearWizardSession', domain: 'example.com' },
    tabId == null ? {} : { tab: { id: tabId } }
  );
const readStorage = (keys: string[], sender: Record<string, unknown> = contentSender()) =>
  callHandler('getStorageViaBg', { type: 'getStorageViaBg', keys }, sender);
const writeStorage = (items: Record<string, unknown>, sender = EXT_SENDER) =>
  callHandler('setStorageViaBg', { type: 'setStorageViaBg', items }, sender);
const readActiveMeta = () =>
  callHandler('getActiveAddressMeta', { type: 'getActiveAddressMeta' }, {});
const readFieldMap = (domain: string) =>
  callHandler('getFieldMap', { type: 'getFieldMap', domain }, contentSender());
const recordFieldMapHit = (domain: string, kind: string, selector: string) =>
  callHandler(
    'recordFieldMapHit',
    { type: 'recordFieldMapHit', domain, kind, selector },
    EXT_SENDER
  );

function fireStorageChanged(area: string, changes: Record<string, unknown>): void {
  for (const fn of onChangedListeners) fn(changes, area);
}

function seedSession(tabId: number, email: string): void {
  const all = (sessionStore[WIZARD_KEY] as Record<string, unknown>) || {};
  all[`example.com::tab:${tabId}`] = {
    domain: 'example.com',
    tabId,
    step: 'form',
    email,
    filled: {},
    startedAt: Date.now(),
    updatedAt: Date.now(),
    paths: [],
  };
  sessionStore[WIZARD_KEY] = all;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
  localGetCount = 0;
  localReadKeys.length = 0;
  sessionGetCount = 0;
  // NOTE: onChangedListeners is NOT reset - the module registered its
  // invalidation listener once at import; wiping the array here would cut it
  // off from every subsequent fireStorageChanged.
  // Shared module-registry across bun test files: a sibling that left locks
  // pending would otherwise wedge withLock here.
  __clearMutexRegistryForTests();
  // The read coalescers retain settled results for their TTL; without this
  // reset a previous test's result would satisfy a later test's read
  // (bounded staleness by design, not a test expectation).
  __clearReadCoalescersForTests();
  (globalThis as { browser?: unknown }).browser = fakeBrowser;
});

describe('loadSmartAutofillSettings coalescing', () => {
  test('concurrent reads share one storage round-trip', async () => {
    const [a, b, c] = await Promise.all([readSettings(), readSettings(), readSettings()]);

    expect(a.success).toBe(true);
    expect((b.settings as { undoStackDepth: number }).undoStackDepth).toBe(5);
    expect((c.settings as { humanLikeFilling: boolean }).humanLikeFilling).toBe(true);
    expect(localGetCount).toBe(1);
  });

  test('a read within the TTL window reuses the retained result', async () => {
    await readSettings();
    await sleep(50); // << the 1s TTL

    await readSettings();

    expect(localGetCount).toBe(1);
  });

  test('a read after the TTL window starts fresh', async () => {
    await readSettings();
    await sleep(1_050); // > the 1s TTL

    await readSettings();

    expect(localGetCount).toBe(2);
  });

  test('a smartAutofillSettings write drops the retained read immediately', async () => {
    await readSettings();
    await readSettings();
    expect(localGetCount).toBe(1);

    // SettingsView saves via the feature module in the extension context -
    // write the store, then the change event fires (what a real save does).
    store[SETTINGS_KEY] = { undoStackDepth: 9 };
    fireStorageChanged('local', { [SETTINGS_KEY]: { newValue: { undoStackDepth: 9 } } });
    const next = await readSettings();

    expect(localGetCount).toBe(2);
    expect((next.settings as { undoStackDepth: number }).undoStackDepth).toBe(9);
  });

  test('unrelated storage events do not clear the retained read', async () => {
    await readSettings();

    fireStorageChanged('local', { someOtherKey: { newValue: 1 } });
    fireStorageChanged('session', { [SETTINGS_KEY]: { newValue: 1 } });
    await readSettings();

    expect(localGetCount).toBe(1);
  });
});

describe('getWizardSession coalescing', () => {
  test('concurrent reads for one tab share one storage round-trip', async () => {
    seedSession(1, 'a@x.com');

    const [a, b] = await Promise.all([readSession(1), readSession(1)]);

    expect((a.result as { email?: string }).email).toBe('a@x.com');
    expect((b.result as { email?: string }).email).toBe('a@x.com');
    expect(sessionGetCount).toBe(1);
  });

  test('tabs on the same domain never share a coalesced read', async () => {
    seedSession(1, 'a@x.com');
    seedSession(2, 'b@x.com');

    const [t1, t2] = await Promise.all([readSession(1), readSession(2)]);
    // Both were misses (separate keys) but they ran concurrently → one walk
    // of loadWizardSessions would have raced; here each key starts its own
    // run, so the storage read count equals the number of distinct keys.
    expect((t1.result as { email?: string }).email).toBe('a@x.com');
    expect((t2.result as { email?: string }).email).toBe('b@x.com');

    // Both results are retained per tab - repeats add no round-trips.
    await readSession(1);
    await readSession(2);
    expect(sessionGetCount).toBe(2);
  });

  test('a read within the TTL window reuses the retained session', async () => {
    seedSession(1, 'a@x.com');
    await readSession(1);
    await sleep(50); // << the 500ms TTL

    await readSession(1);

    expect(sessionGetCount).toBe(1);
  });

  test('upsert invalidates the retained read for that tab only', async () => {
    seedSession(1, 'a@x.com');
    seedSession(2, 'b@x.com');
    await readSession(1);
    await readSession(2);
    await readSession(1); // retained
    expect(sessionGetCount).toBe(2);

    // The write path itself walks the sessions once (loadWizardSessions).
    await upsertSession(1, { step: 'otp', email: 'new@x.com' });
    expect(sessionGetCount).toBe(3);

    const t1 = await readSession(1); // invalidated → fresh read
    const t2 = await readSession(2); // still retained
    expect((t1.result as { email?: string }).email).toBe('new@x.com');
    expect((t2.result as { email?: string }).email).toBe('b@x.com');
    expect(sessionGetCount).toBe(4);
  });

  test('advance invalidates so the re-read sees the new step', async () => {
    seedSession(1, 'a@x.com');
    await readSession(1);

    // The write path itself walks the sessions once (loadWizardSessions).
    await advanceSession(1, 'otp');
    const t1 = await readSession(1);

    expect((t1.result as { step?: string }).step).toBe('otp');
    expect(sessionGetCount).toBe(3);
  });

  test('clear with a tab invalidates that tab; tab-less invalidates every read', async () => {
    seedSession(1, 'a@x.com');
    seedSession(2, 'b@x.com');
    await readSession(1);
    await readSession(2);

    await clearSession(1);
    const t1 = await readSession(1); // invalidated → fresh, now cleared
    expect(t1.result).toBeNull();
    const readsAfterTabClear = sessionGetCount;
    await readSession(2); // tab 2's read was NOT invalidated
    expect(sessionGetCount).toBe(readsAfterTabClear);

    await clearSession(); // no tab → every session of the domain dies
    const t2 = await readSession(2); // invalidated → fresh, now cleared
    expect(t2.result).toBeNull();
  });
});

describe('getActiveAddressMeta coalescing', () => {
  const seedAddresses = () => {
    store.activeAddressId = 'a1';
    store.addresses = [
      { id: 'a1', address: 'one@test.com', provider: 'burner', createdAt: 1, expiresAt: 9e15 },
      { id: 'a2', address: 'two@test.com', provider: 'burner', createdAt: 2, expiresAt: 9e15 },
    ];
  };

  test('concurrent reads share one storage round-trip', async () => {
    seedAddresses();

    const [a, b] = await Promise.all([readActiveMeta(), readActiveMeta()]);

    expect((a.result as { addressId?: string }).addressId).toBe('a1');
    expect((b.result as { addressId?: string }).addressId).toBe('a1');
    expect(localGetCount).toBe(1);
  });

  test('an activeAddressId change drops the retained meta (switch addresses)', async () => {
    seedAddresses();
    await readActiveMeta();

    store.activeAddressId = 'a2';
    fireStorageChanged('local', { activeAddressId: { newValue: 'a2' } });
    const next = await readActiveMeta();

    expect((next.result as { addressId?: string }).addressId).toBe('a2');
    expect(localGetCount).toBe(2);
  });

  test('an addresses rewrite drops the retained meta too', async () => {
    seedAddresses();
    await readActiveMeta();

    // A real rewrite lands in storage BEFORE the change event fires.
    store.addresses = [];
    fireStorageChanged('local', { addresses: { newValue: [] } });
    const next = await readActiveMeta();

    expect((next.result as { addressId?: string | null }).addressId).toBeNull();
    expect(localGetCount).toBe(2);
  });

  test('unrelated changes keep the retained meta', async () => {
    seedAddresses();
    await readActiveMeta();

    fireStorageChanged('local', { themeColors: { newValue: {} } });
    await readActiveMeta();

    expect(localGetCount).toBe(1);
  });
});

describe('getStorageViaBg coalescing', () => {
  const seedTokens = () => {
    store.addresses = [
      {
        id: 'a1',
        address: 'one@test.com',
        provider: 'burner',
        token: 'secret-token',
        createdAt: 1,
        expiresAt: 9e15,
      },
    ];
    store.identities = [
      {
        id: 'i1',
        name: 'N',
        firstNames: 'F',
        lastNames: 'L',
        useRandomPassword: false,
        isDefault: true,
        createdAt: 1,
        customPassword: 'hunter2',
      },
    ];
  };

  test('concurrent reads of the same keys share one storage round-trip', async () => {
    store.themeColors = { primary: '#123456' };

    const [a, b, c] = await Promise.all([
      readStorage(['themeColors']),
      readStorage(['themeColors']),
      readStorage(['themeColors']),
    ]);

    expect((a.data as { themeColors?: unknown }).themeColors).toEqual({ primary: '#123456' });
    expect((b.data as { themeColors?: unknown }).themeColors).toEqual({ primary: '#123456' });
    expect((c.data as Record<string, unknown>).success).toBeUndefined();
    expect(localGetCount).toBe(1);
  });

  test('key order and duplicates do not split coalesce keys', async () => {
    store.themeColors = { primary: '#123456' };
    store.activeAddressId = 'a1';

    await readStorage(['themeColors', 'activeAddressId']);
    await readStorage(['activeAddressId', 'themeColors', 'themeColors']);

    expect(localGetCount).toBe(1);
  });

  test('different key sets never share', async () => {
    store.themeColors = { primary: '#123456' };
    store.activeAddressId = 'a1';

    await readStorage(['themeColors']);
    await readStorage(['activeAddressId']);

    expect(localGetCount).toBe(2);
  });
  test('extension and content senders never share - redaction is per audience', async () => {
    seedTokens();

    const ext = await readStorage(['addresses', 'identities'], EXT_SENDER);
    const contentAddr = await readStorage(['addresses'], contentSender());
    const contentId = await readStorage(['identities'], contentSender());

    // Extension pages retain the complete internal shapes…
    const extAddresses = (ext.data as { addresses?: Array<{ token?: string }> }).addresses || [];
    expect(extAddresses[0]?.token).toBe('secret-token');
    const extIdentities =
      (ext.data as { identities?: Array<{ customPassword?: string }> }).identities || [];
    expect(extIdentities[0]?.customPassword).toBe('hunter2');

    // …content scripts get token/customPassword stripped, with the
    // hasCustomPassword boolean kept so the UI still learns the fact.
    const contentAddresses =
      (contentAddr.data as { addresses?: Array<{ token?: string }> }).addresses || [];
    expect(contentAddresses[0]?.token).toBeUndefined();
    const contentIdentities =
      (
        contentId.data as {
          identities?: Array<{ customPassword?: string; hasCustomPassword?: boolean }>;
        }
      ).identities || [];
    expect(contentIdentities[0]?.customPassword).toBeUndefined();
    expect(contentIdentities[0]?.hasCustomPassword).toBe(true);

    // Three distinct audience/key-set reads, plus the exact-site exclusion
    // lookup. Count their keys so auxiliary authorization reads cannot hide
    // an accidental merge of privileged and redacted storage payloads.
    expect(
      localReadKeys.filter((keys) => Array.isArray(keys) && keys.includes('addresses'))
    ).toEqual([['addresses', 'identities'], ['addresses']]);
    expect(
      localReadKeys.filter(
        (keys) => Array.isArray(keys) && keys.length === 1 && keys[0] === 'identities'
      )
    ).toHaveLength(1);
    expect(localGetCount).toBe(4);
  });

  test('a denied latestOtp read (no opt-in) is rejected before any coalescing', async () => {
    const res = await readStorage(['latestOtp'], contentSender('mail.example.com'));

    expect(res.success).toBe(false);
    expect(res.error).toBe('errors.otpAccessNotEnabled');
    // The gate's own opt-in walk runs, but no read is retained for the key.
    expect(localGetCount).toBe(1);
  });

  test('an opted-in content sender reads latestOtp like any other key', async () => {
    store.otpOptInList = ['example.com'];
    store.latestOtp = { code: '123456', received_at: Date.now() };

    const res = await readStorage(['latestOtp'], contentSender('mail.example.com'));

    expect(res.success).toBe(true);
    expect((res.data as { latestOtp?: { code?: string } }).latestOtp?.code).toBe('123456');
    // One opt-in walk + one coalesced storage read.
    expect(localGetCount).toBe(2);
  });

  test('setStorageViaBg drops only retained reads intersecting the written keys', async () => {
    store.themeColors = { primary: '#123456' };
    store.activeAddressId = 'a1';

    await readStorage(['themeColors']);
    await readStorage(['activeAddressId']);
    expect(localGetCount).toBe(2);

    // The write path reads-then-writes under its lock (+1).
    await writeStorage({ activeAddressId: 'a2' });

    const unchanged = await readStorage(['themeColors']); // retained
    const invalidated = await readStorage(['activeAddressId']); // fresh
    expect((unchanged.data as { themeColors?: unknown }).themeColors).toEqual({
      primary: '#123456',
    });
    expect((invalidated.data as { activeAddressId?: string }).activeAddressId).toBe('a2');
    expect(localGetCount).toBe(4);
  });

  test('storage.onChanged drops precisely the retained reads that overlap the change', async () => {
    store.themeColors = { primary: '#123456' };
    store.loginInfo = [];
    store.activeAddressId = 'a1';

    await readStorage(['themeColors']);
    await readStorage(['loginInfo', 'activeAddressId']);

    fireStorageChanged('local', { themeColors: { newValue: { primary: '#654321' } } });

    await readStorage(['themeColors']); // overlapped → fresh
    await readStorage(['loginInfo', 'activeAddressId']); // untouched → retained

    expect(localGetCount).toBe(3);
  });

  test('a read after the 250ms TTL starts fresh', async () => {
    store.themeColors = { primary: '#123456' };

    await readStorage(['themeColors']);
    await sleep(300);

    await readStorage(['themeColors']);

    expect(localGetCount).toBe(2);
  });
});

describe('getFieldMap coalescing', () => {
  const seedMap = (domain: string) => {
    const all = (store[FIELD_MAPS_KEY] as Record<string, unknown>) || {};
    all[domain] = {
      domain,
      entries: [{ kind: 'email', selector: '#email', hits: 3, lastUsedAt: Date.now() }],
      updatedAt: Date.now(),
    };
    store[FIELD_MAPS_KEY] = all;
  };

  test('concurrent reads for one domain share one storage round-trip', async () => {
    seedMap('example.com');

    const [a, b] = await Promise.all([readFieldMap('example.com'), readFieldMap('example.com')]);

    const entries = (a.result as { entries?: unknown[] }).entries || [];
    expect(entries).toHaveLength(1);
    expect((b.result as { entries?: unknown[] }).entries).toHaveLength(1);
    expect(localGetCount).toBe(1);
  });

  test('different domains never share', async () => {
    seedMap('example.com');
    seedMap('other.com');

    await readFieldMap('example.com');
    await readFieldMap('other.com');

    expect(localGetCount).toBe(2);
  });

  test('recordFieldMapHit write-through invalidates that domain only', async () => {
    seedMap('example.com');
    seedMap('other.com');
    await readFieldMap('example.com');
    await readFieldMap('other.com');
    expect(localGetCount).toBe(2);

    // The hit walks the maps once (read) and writes once - +1 get.
    await recordFieldMapHit('example.com', 'password', '#password');
    expect(localGetCount).toBe(3);

    const updated = await readFieldMap('example.com'); // invalidated → fresh
    const untouched = await readFieldMap('other.com'); // retained
    const entries = (updated.result as { entries?: Array<{ kind: string }> }).entries || [];
    expect(entries.some((e) => e.kind === 'password')).toBe(true);
    // The retained map for the untouched domain still carries the pre-hit state.
    const otherEntries = (untouched.result as { entries?: Array<{ kind: string }> }).entries || [];
    expect(otherEntries.some((e) => e.kind === 'password')).toBe(false);
    expect(localGetCount).toBe(4);
  });

  test('a siteFieldMaps_v1 change (backup import) drops every retained map', async () => {
    seedMap('example.com');
    seedMap('other.com');
    await readFieldMap('example.com');
    await readFieldMap('other.com');
    expect(localGetCount).toBe(2);

    fireStorageChanged('local', { [FIELD_MAPS_KEY]: { newValue: {} } });

    await readFieldMap('example.com');
    await readFieldMap('other.com');
    expect(localGetCount).toBe(4);
  });

  test('a read after the 1s TTL starts fresh', async () => {
    seedMap('example.com');

    await readFieldMap('example.com');
    await sleep(1_050);

    await readFieldMap('example.com');

    expect(localGetCount).toBe(2);
  });
});

// ── getProvider coalescing ──────────────────────────────────────────────────

const readProvider = () => callHandler('getProvider', { type: 'getProvider' }, {});

describe('getProvider coalescing', () => {
  test('concurrent reads share one storage round-trip', async () => {
    store.selectedProvider = 'demo';
    const [a, b] = await Promise.all([readProvider(), readProvider()]);
    expect(a.success).toBe(true);
    expect(a.provider).toBe('demo');
    expect(b.provider).toBe('demo');
    expect(localGetCount).toBe(1);
  });

  test('a selectedProvider change drops the retained read', async () => {
    store.selectedProvider = 'demo';
    expect((await readProvider()).provider).toBe('demo');

    store.selectedProvider = 'other';
    fireStorageChanged('local', { selectedProvider: { newValue: 'other' } });

    expect((await readProvider()).provider).toBe('other');
  });

  test('a read after the 250ms TTL starts fresh', async () => {
    store.selectedProvider = 'demo';
    await readProvider();
    await sleep(300);
    await readProvider();
    expect(localGetCount).toBe(2);
  });
});

// ── getProviderDisplayName coalescing ───────────────────────────────────────

const readProviderName = (provider: string) =>
  callHandler('getProviderDisplayName', { type: 'getProviderDisplayName', provider }, {});

describe('getProviderDisplayName coalescing', () => {
  test('concurrent reads for one provider share one resolution', async () => {
    const [a, b] = await Promise.all([readProviderName('demo'), readProviderName('demo')]);
    expect(a.displayName).toBe('Demo');
    expect(b.displayName).toBe('Demo');
  });

  test('different providers never share; unknown ids still error (soft-fail for empty only)', async () => {
    const [a, b] = await Promise.all([readProviderName('demo'), readProviderName('no-such')]);
    expect(a.displayName).toBe('Demo');
    expect(b.success).toBe(false); // loadProviderConfig throws for unknown ids
  });

  test('a providerConfigOverrides change drops every retained name', async () => {
    await readProviderName('demo');
    fireStorageChanged('local', { providerConfigOverrides: { newValue: [] } });
    // Entry gone → re-resolves (same value, but a real resolution again).
    expect((await readProviderName('demo')).displayName).toBe('Demo');
  });
});

// ── shouldPreferReplay coalescing ───────────────────────────────────────────

const readReplay = (domain: string) =>
  callHandler('shouldPreferReplay', { type: 'shouldPreferReplay', domain }, contentSender());
const recordOutcome = (domain: string, success: boolean) =>
  callHandler(
    'recordAutofillOutcome',
    { type: 'recordAutofillOutcome', opts: { domain, success } },
    EXT_SENDER
  );

describe('shouldPreferReplay coalescing', () => {
  test('concurrent reads for one domain share one site-profile read', async () => {
    const [a, b, c] = await Promise.all([
      readReplay('example.com'),
      readReplay('example.com'),
      readReplay('example.com'),
    ]);
    // No profile yet → default true (offer replay when available).
    expect(a.result).toBe(true);
    expect(b.result).toBe(true);
    expect(c.result).toBe(true);
    expect(localGetCount).toBe(1);
  });

  test('casing variants of one domain share one entry (normalized key)', async () => {
    await readReplay('Example.com');
    await readReplay('example.com');
    expect(localGetCount).toBe(1);
  });

  test('recordAutofillOutcome write-through invalidates that domain', async () => {
    expect((await readReplay('example.com')).result).toBe(true); // default
    expect(localGetCount).toBe(1);

    // A failed fill flips the answer on a profile-less domain (0 ≥ 1 fails).
    // The outcome itself does 2 gets: getSiteProfile + saveSiteProfile's
    // load→mutate→set reload.
    await recordOutcome('example.com', false);
    expect((await readReplay('example.com')).result).toBe(false); // invalidated → fresh
    expect(localGetCount).toBe(4);
  });

  test('other domains keep their retained entries after an outcome write', async () => {
    await readReplay('example.com');
    await readReplay('other.com');
    expect(localGetCount).toBe(2);

    await recordOutcome('example.com', false); // only example.com's entry dies

    await readReplay('other.com'); // retained - no new read
    expect(localGetCount).toBe(4); // 2 + outcome's own 2 gets
  });

  test('a siteProfiles change (backup import) drops every retained entry', async () => {
    await readReplay('example.com');
    await readReplay('other.com');
    expect(localGetCount).toBe(2);

    fireStorageChanged('local', { siteProfiles: { newValue: {} } });

    await readReplay('example.com');
    await readReplay('other.com');
    expect(localGetCount).toBe(4);
  });
});
