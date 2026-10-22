/**
 * Demo mode: isolated bag of fake addresses/emails.
 * Real user data is snapshotted and restored on exit so real mode is never mixed.
 */
import { copyToClipboardFromBackground } from '@/utils/clipboard/clipboard.js';
import { tSync } from '@/utils/i18n/i18n-background.js';
import { withLock } from '@/utils/mutex.js';
import { createBrowserNotification } from '@/utils/notifications/notification-permission.js';
import { playNotificationSoundIfEnabled } from '@/utils/notifications/notification-sound.js';
import { maybeAutoCopyOtp } from '@/utils/otp/otp-auto-copy.js';
import { updateStoredObject } from '@/utils/storage/rmw.js';
import {
  getEmailMaps,
  getStoredEmailsForAddress,
  setLogicalEmailMaps,
  setLogicalEmailMapsUnlockedForLockedCaller,
  setStoredEmailsForAddress,
  updateAddresses,
} from '@/utils/storage/storage-keys.js';
import { arrayOrEmpty } from '@/utils/storage/storage-shape-guards.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { Address, Email } from '@/utils/types.js';

export const DEMO_INBOX_ID = 'demo-inbox-1';
export const DEMO_ADDRESS = 'demo.user@example.com';
export const MAX_DEMO_INBOXES = 8;

const SNAPSHOT_KEY = 'realModeSnapshot_v1';
const USER_DATA_SNAPSHOT_KEY = 'realModeUserDataSnapshot_v1';
const DEMO_SHOWCASE_TAB_IDS_KEY = 'demoShowcaseTabIds';

/**
 * Is this record a playground inbox?
 *
 * Two spellings exist and both count: the seeded/created records carry
 * `provider: 'demo'`, and their ids are `demo-inbox-*` (the id is what survives
 * a username-derived address, which is why the list cannot be filtered by an
 * address prefix). One predicate, so a new call site cannot filter on half the
 * rule and leave a demo inbox behind on exit.
 */
function isDemoAddress(record: Address): boolean {
  return record.provider === 'demo' || String(record.id || '').startsWith('demo-');
}

const DEMO_SENDERS = [
  {
    from: 'security@github.com',
    from_name: 'GitHub',
    subject: 'Your verification code',
    otp: '482901',
    body: 'Your GitHub verification code is 482901. It expires in 10 minutes.',
    magic: false,
  },
  {
    from: 'no-reply@apple.com',
    from_name: 'Apple',
    subject: 'Sign-in code',
    otp: '719334',
    body: 'Your Apple Account code is: 719334',
    magic: false,
  },
  {
    from: 'hello@notion.so',
    from_name: 'Notion',
    subject: 'Magic link to sign in',
    otp: null as string | null,
    body: 'Click to sign in: https://www.notion.so/login/magic?token=demo-magic-abc123xyz',
    magic: true,
  },
  {
    from: 'billing@stripe.com',
    from_name: 'Stripe',
    subject: 'Receipt for payment',
    otp: null as string | null,
    body: 'Thanks for your payment of $12.00. Receipt #DEMO-1001.',
    magic: false,
  },
  {
    from: 'notify@linkedin.com',
    from_name: 'LinkedIn',
    subject: 'Confirm your email',
    otp: 'A9K2Q7',
    body: 'Your confirmation code is A9K2Q7. Enter it to continue.',
    magic: false,
  },
  {
    from: 'verify@discord.com',
    from_name: 'Discord',
    subject: 'Your Discord login code',
    otp: '338291',
    body: 'Your Discord login code is 338291. Do not share it.',
    magic: false,
  },
  {
    from: 'team@figma.com',
    from_name: 'Figma',
    subject: 'Magic link to open file',
    otp: null as string | null,
    body: 'Open your file: https://www.figma.com/login/magic?token=demo-figma-xyz789',
    magic: true,
  },
];

function makeEmail(
  partial: {
    from: string;
    from_name: string;
    subject: string;
    body: string;
    otp?: string | null;
    magic?: boolean;
    id?: string;
    received_at?: number;
  },
  address: string
): Email {
  const id = partial.id || `demo-mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email: Email = {
    id,
    from: partial.from,
    from_name: partial.from_name,
    subject: partial.subject,
    body_plain: partial.body,
    body_html: `<p>${partial.body.replace(/https?:\/\/\S+/g, (u) => `<a href="${u}">${u}</a>`)}</p>`,
    received_at: partial.received_at ?? Date.now(),
    unread: true,
    otp: partial.otp || undefined,
    isOtp: !!partial.otp,
    original_inbox: address,
  };
  if (partial.magic) {
    const magicUrl =
      partial.body.match(/https?:\/\/\S+/)?.[0] ||
      'https://www.notion.so/login/magic?token=demo-magic-abc123xyz';
    let host = 'example.com';
    try {
      host = new URL(magicUrl).hostname.replace(/^www\./, '');
    } catch {
      /* ignore */
    }
    email.magicLinks = [
      {
        url: magicUrl,
        host,
        score: 0.9,
      },
    ];
    email.hasMagicLink = true;
  }
  return email;
}

export async function isDemoMode(ext: Browser): Promise<boolean> {
  const { demoMode } = (await ext.storage.local.get(['demoMode'])) as { demoMode?: boolean };
  return !!demoMode;
}

type Snapshot = {
  addresses: Address[];
  storedEmails: Record<string, Email[]>;
  archivedEmails: Record<string, Email[]>;
  activeAddressId?: string;
  latestOtp?: unknown;
  selectedEmail?: string;
};

type UserDataSnapshot = {
  identities: unknown[];
  loginInfo: unknown[];
  selectedIdentityId: string | null;
};

async function restoreDemoUserData(ext: Browser): Promise<void> {
  const { [USER_DATA_SNAPSHOT_KEY]: snapshot } = (await ext.storage.local.get([
    USER_DATA_SNAPSHOT_KEY,
  ])) as { [USER_DATA_SNAPSHOT_KEY]?: UserDataSnapshot };
  if (!snapshot) return;
  await writeWithRetry({
    identities: snapshot.identities,
    loginInfo: snapshot.loginInfo,
    selectedIdentityId: snapshot.selectedIdentityId,
  });
}

function buildDemoBag(index: number, username?: string): Address {
  const now = Date.now();
  const local = username?.trim() || (index === 0 ? 'demo.user' : `demo.user${index + 1}`);
  const address = `${local}@example.com`;
  return {
    id: `demo-inbox-${index + 1}`,
    address,
    provider: 'demo',
    accountStatus: 'active',
    autoExtend: index % 2 === 0,
    createdAt: now - (index + 1) * 3600_000,
    expiresAt: now + (24 - index) * 3600_000,
    sidToken: `demo-token-${index + 1}`,
    token: `demo-token-${index + 1}`,
    renewalCount: index === 0 ? 2 : 0,
  };
}

function buildDemoEmailsFor(address: string, seedOffset = 0): Email[] {
  const now = Date.now();
  // Seed a few messages with OTP + magic link variety
  return DEMO_SENDERS.slice(0, 4).map((s, i) =>
    makeEmail(
      {
        from: s.from,
        from_name: s.from_name,
        subject: s.subject,
        body: s.body,
        otp: s.otp,
        magic: s.magic,
        id: `demo-seed-${address}-${seedOffset}-${i}`,
        received_at: now - (i + 1) * 120_000 - seedOffset * 10_000,
      },
      address
    )
  );
}

/** Enter demo: snapshot real data once, swap in isolated demo bag. */
export async function setDemoMode(ext: Browser, enabled: boolean): Promise<void> {
  if (enabled) {
    await enterDemoMode(ext);
  } else {
    await exitDemoMode(ext);
  }
}

export async function enterDemoMode(ext: Browser): Promise<void> {
  const existing = (await ext.storage.local.get([
    'demoMode',
    SNAPSHOT_KEY,
    USER_DATA_SNAPSHOT_KEY,
    'addresses',
    'identities',
    'loginInfo',
    'selectedIdentityId',
    'activeAddressId',
    'latestOtp',
    'selectedEmail',
  ])) as {
    demoMode?: boolean;
    [SNAPSHOT_KEY]?: Snapshot;
    [USER_DATA_SNAPSHOT_KEY]?: UserDataSnapshot;
    addresses?: Address[];
    identities?: unknown[];
    loginInfo?: unknown[];
    selectedIdentityId?: string | null;
    activeAddressId?: string;
    latestOtp?: unknown;
    selectedEmail?: string;
  };

  const existingLogical = await getEmailMaps();

  // Only snapshot real data if we are not already in demo (avoid overwriting real snapshot)
  if (!existing.demoMode) {
    if (!existing[USER_DATA_SNAPSHOT_KEY]) {
      await writeWithRetry({
        [USER_DATA_SNAPSHOT_KEY]: {
          identities: existing.identities || [],
          loginInfo: existing.loginInfo || [],
          selectedIdentityId: existing.selectedIdentityId ?? null,
        } satisfies UserDataSnapshot,
      });
    }

    // If current bag is already pure demo, don't snapshot it as "real"
    const current = Array.isArray(existing.addresses) ? existing.addresses : [];
    const looksLikeDemoOnly =
      current.length > 0 &&
      current.every((i) => i.provider === 'demo' || String(i.id || '').startsWith('demo-'));
    if (!looksLikeDemoOnly) {
      const snapshot: Snapshot = {
        addresses: current,
        storedEmails: existingLogical.storedEmails,
        archivedEmails: existingLogical.archivedEmails,
        activeAddressId: existing.activeAddressId,
        latestOtp: existing.latestOtp,
        selectedEmail: existing.selectedEmail,
      };
      await writeWithRetry({ [SNAPSHOT_KEY]: snapshot });
    }
  }

  // Seed multiple demo addresses so address selector / OTP / magic strips are exercisable
  const address0 = buildDemoBag(0);
  const address1 = buildDemoBag(1);
  const address2 = buildDemoBag(2);
  const demos = [address0, address1, address2];
  const storedEmails: Record<string, Email[]> = {};
  for (let i = 0; i < demos.length; i++) {
    storedEmails[demos[i].address] = buildDemoEmailsFor(demos[i].address, i);
  }
  const firstBag = storedEmails[address0.address] || [];
  const firstOtp = firstBag.find((m) => m.otp);

  // Atomic swap: demo flag + isolated bags only (never merge with real addresses)
  await writeWithRetry({
    demoMode: true,
    addresses: demos,
    activeAddressId: address0.id,
    selectedEmail: address0.address,
    latestOtp: firstOtp
      ? {
          otp: firstOtp.otp,
          sender: firstOtp.from,
          senderName: firstOtp.from_name,
          context: firstOtp.subject || '',
          // The shortcut's staleness guard (resolveLatestOtpForCopy) refuses a
          // record that cannot prove freshness and CLEARS the key, so demo mode
          // must carry the same `received_at` every background writer does -
          // without it the playground's copy-latest-OTP shortcut was a silent
          // no-op that also wiped the OTP the playground displayed.
          received_at: firstOtp.received_at,
          recipient: address0.address,
        }
      : null,
    demoReceiveIndex: 0,
  });
  await setLogicalEmailMaps(storedEmails, {});

  // Open in-extension signup showcase pages so Autofill can be demonstrated
  try {
    await openDemoSignupShowcase(ext);
    setTimeout(() => {
      void simulateDemoReceive(ext);
    }, 2000);
  } catch {
    /* non-fatal - demo data still loaded */
  }
}

/** Bundled signup HTML pages for Autofill demos. */
export const DEMO_SIGNUP_PAGES = [
  'signup-social.html',
  'signup-newsletter.html',
  'signup-checkout.html',
] as const;

export const PROD_DEMO_BASE_URL = 'https://demo.1click.mail';
export const DEV_DEMO_BASE_URL = 'http://localhost:5173/demo';

/** Dynamically resolves demo page URL based on environment (localhost in dev/test, HTTPS domain in prod). */
export function getDemoPageUrl(page: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const cleanPage = page.replace(/^demo\//, '');
  if (isDev) {
    return `${DEV_DEMO_BASE_URL}/${cleanPage}`;
  }
  return `${PROD_DEMO_BASE_URL}/${cleanPage}`;
}

/** Open 2-3 signup demo pages in new tabs (used by demo mode). */
export async function openDemoSignupShowcase(ext: Browser): Promise<void> {
  const tabsApi = (
    ext as unknown as {
      tabs?: { create?: (o: { url: string; active?: boolean }) => Promise<unknown> };
    }
  ).tabs;
  if (!tabsApi?.create) return;

  let tabIds: number[] = [];
  try {
    const stored = (await ext.storage.session.get([DEMO_SHOWCASE_TAB_IDS_KEY])) as Record<
      string,
      unknown
    >;
    tabIds = Array.isArray(stored[DEMO_SHOWCASE_TAB_IDS_KEY])
      ? (stored[DEMO_SHOWCASE_TAB_IDS_KEY] as number[]).filter(Number.isInteger)
      : [];
  } catch {
    // Demo showcase tabs are best-effort; unavailable session storage must not
    // prevent the demo inbox itself from working.
  }

  for (let i = 0; i < DEMO_SIGNUP_PAGES.length; i++) {
    const page = DEMO_SIGNUP_PAGES[i];
    if (!page) continue;
    const url = getDemoPageUrl(page);
    // First page focused; others in background
    const tab = (await tabsApi.create({ url, active: i === 0 })) as { id?: number };
    if (typeof tab.id === 'number') {
      tabIds.push(tab.id);
      try {
        await ext.storage.session.set({ [DEMO_SHOWCASE_TAB_IDS_KEY]: tabIds });
      } catch {
        // The tabs still open; cleanup will be best-effort without session state.
      }
    }
  }
}

/** Exit demo: restore real snapshot if present. */
export async function exitDemoMode(ext: Browser): Promise<void> {
  try {
    const tabsApi = (
      ext as unknown as {
        tabs?: {
          get?: (tabId: number) => Promise<{ url?: string }>;
          remove?: (tabId: number) => Promise<unknown>;
        };
      }
    ).tabs;
    const tabState = (await ext.storage.session.get([DEMO_SHOWCASE_TAB_IDS_KEY])) as Record<
      string,
      unknown
    >;
    const tabIds = Array.isArray(tabState[DEMO_SHOWCASE_TAB_IDS_KEY])
      ? (tabState[DEMO_SHOWCASE_TAB_IDS_KEY] as number[]).filter(Number.isInteger)
      : [];
    const expectedUrls = new Set(DEMO_SIGNUP_PAGES.map(getDemoPageUrl));
    if (tabsApi?.get && tabsApi.remove) {
      await Promise.all(
        tabIds.map(async (tabId) => {
          try {
            const tab = await tabsApi.get?.(tabId);
            if (tab?.url && expectedUrls.has(tab.url)) await tabsApi.remove?.(tabId);
          } catch {
            // The tab may already be closed or unavailable.
          }
        })
      );
    }
    await ext.storage.session.remove(DEMO_SHOWCASE_TAB_IDS_KEY);
  } catch {
    // Showcase-tab cleanup must not prevent restoring the user's real data.
  }

  const { [SNAPSHOT_KEY]: snapshot } = (await ext.storage.local.get([SNAPSHOT_KEY])) as {
    [SNAPSHOT_KEY]?: Snapshot;
  };

  if (snapshot) {
    await writeWithRetry({
      addresses: snapshot.addresses || [],
      activeAddressId: snapshot.activeAddressId,
      latestOtp: snapshot.latestOtp ?? null,
      selectedEmail: snapshot.selectedEmail,
    });
    await setLogicalEmailMaps(snapshot.storedEmails || {}, snapshot.archivedEmails || {});
    await restoreDemoUserData(ext);
    await writeWithRetry({ demoMode: false });
    await ext.storage.local.remove([SNAPSHOT_KEY, USER_DATA_SNAPSHOT_KEY]);
  } else {
    // No snapshot (edge case): clear demo bag only. Demo bags are keyed by
    // ADDRESS, and createDemoAddress derives the address from the caller's
    // username (e.g. john@example.com, id demo-inbox-4) - so a key-prefix
    // filter on 'demo.' alone misses every custom-username inbox and orphans
    // its bag forever. Resolve the demo addresses from the address list
    // (provider === 'demo' || id starts with 'demo-') instead, keeping the
    // legacy 'demo.*@example.com' prefix check for pre-list seed keys.
    const logical = await getEmailMaps();
    const storedEmails = logical.storedEmails;
    // The list edit is a serialized read-modify-write: the updater sees the
    // addresses storage holds when it runs and reports back the demo records it
    // removed, so an inbox created or deleted meanwhile is neither erased nor
    // left behind. A whole-key write of the list read here used to do both.
    let demoAddresses = new Set<string>();
    await updateAddresses((current) => {
      const demo = current.filter(isDemoAddress);
      demoAddresses = new Set(demo.map((i) => i.address).filter(Boolean));
      return current.filter((i) => !isDemoAddress(i));
    });
    const isDemoBagKey = (k: string): boolean =>
      demoAddresses.has(k) || (k.endsWith('@example.com') && k.startsWith('demo.'));
    await setLogicalEmailMaps(
      Object.fromEntries(Object.entries(storedEmails || {}).filter(([k]) => !isDemoBagKey(k))),
      Object.fromEntries(
        Object.entries(logical.archivedEmails || {}).filter(([k]) => !isDemoBagKey(k))
      )
    );
    await restoreDemoUserData(ext);
    // The demo flag flips LAST: while it is still on the UI is a playground
    // (which tolerates an empty inbox list), where the reverse order would list
    // playground inboxes as if they were live mailboxes for a moment.
    await writeWithRetry({ demoMode: false, latestOtp: null });
    await ext.storage.local.remove(USER_DATA_SNAPSHOT_KEY);
  }
}

/** Create a new demo inbox (max MAX_DEMO_INBOXES). Returns address or null if at cap. */
export async function createDemoAddress(ext: Browser, emailUser?: string): Promise<string | null> {
  if (!(await isDemoMode(ext))) return null;

  // The cap, the bag index and the address-uniqueness walk are all decided
  // against the list storage holds when the write runs, so two surfaces
  // creating a demo inbox at once produce two distinct inboxes instead of the
  // second overwriting the first (or duplicating its id).
  const created: { record: Address | null; index: number } = { record: null, index: 0 };
  await updateAddresses((current) => {
    const demo = current.filter(isDemoAddress);
    if (demo.length >= MAX_DEMO_INBOXES) return current;
    created.index = demo.length;
    const record = buildDemoBag(demo.length, emailUser);
    // Ensure unique address
    let n = created.index;
    while (current.some((i) => i.address === record.address)) {
      n += 1;
      record.address = `demo.user${n + 1}@example.com`;
      record.id = `demo-inbox-${n + 1}`;
    }
    created.record = record;
    return [...demo, record];
  });
  // At the cap the updater left the list untouched and created nothing.
  if (!created.record) return null;

  const record = created.record;
  const bag = buildDemoEmailsFor(record.address, created.index);
  // Read and write under the same lock. Taking this snapshot before the lock
  // lets two concurrent inbox creations each persist a stale full-map copy,
  // erasing the other inbox's bag even though both address records survive.
  await withLock('emails_storage_lock', async () => {
    const logical = await getEmailMaps();
    await setLogicalEmailMapsUnlockedForLockedCaller(
      { ...logical.storedEmails, [record.address]: bag },
      logical.archivedEmails
    );
  });
  // Selection follows the list write: the inbox exists by the time it is
  // pointed at, so no reader can resolve the pointer to nothing.
  await writeWithRetry({ activeAddressId: record.id, selectedEmail: record.address });
  return record.address;
}

/** @deprecated use enterDemoMode via setDemoMode(true) */
export async function seedDemoData(ext: Browser): Promise<void> {
  await enterDemoMode(ext);
}

/** Simulate one new incoming message (only while demoMode is on). */
export interface DemoSimulateResult {
  mail: Email;
  /** Whether the per-site auto-copy feature fired for this delivery. */
  autoCopied: boolean;
}

/**
 * The demo delivery cursor: a whole number in `0..DEMO_SENDERS.length`.
 *
 * Parsed (not merely cast) because the value drives an array index - a corrupt
 * or hand-edited record must degrade to "start at the first sender" rather than
 * make every later delivery pick a template by `NaN`.
 */
function parseDemoReceiveIndex(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

export async function simulateDemoReceive(ext: Browser): Promise<DemoSimulateResult | null> {
  const {
    demoMode,
    activeAddressId,
    addresses = [],
  } = (await ext.storage.local.get(['demoMode', 'activeAddressId', 'addresses'])) as {
    demoMode?: boolean;
    activeAddressId?: string;
    addresses?: Address[];
  };
  if (!demoMode) return null;

  // Shape guard (storage-shape-guards.ts): a corrupt non-array addresses value
  // degrades to empty - `(x || []).find` does not catch truthy garbage, and this
  // runs in a message-handler path that must not throw.
  const addressList = arrayOrEmpty<Address>(addresses);
  const active =
    addressList.find((i) => i.id === activeAddressId) ||
    addressList.find((i) => i.provider === 'demo') ||
    null;
  const address = active?.address || DEMO_ADDRESS;

  const mail = await withLock('emails_storage_lock', async () => {
    const cursorResult = (await ext.storage.local.get(['demoReceiveIndex'])) as {
      demoReceiveIndex?: unknown;
    };
    const cursor = parseDemoReceiveIndex(cursorResult.demoReceiveIndex);
    const tpl = DEMO_SENDERS[cursor % DEMO_SENDERS.length];
    const delivery = makeEmail(
      {
        from: tpl.from,
        from_name: tpl.from_name,
        subject: tpl.subject,
        body: tpl.body,
        otp: tpl.otp,
        magic: tpl.magic,
      },
      address
    );
    const bag = [...(await getStoredEmailsForAddress(active?.id, address))];
    bag.unshift(delivery);
    if (bag.length > 40) bag.length = 40;
    await setStoredEmailsForAddress(active?.id || `demo-${address}`, address, bag);
    await updateStoredObject(
      'demoReceiveIndex',
      (current) => (current % DEMO_SENDERS.length) + 1,
      parseDemoReceiveIndex
    );
    return delivery;
  });
  await writeWithRetry({
    latestOtp: mail.otp
      ? {
          otp: mail.otp,
          sender: mail.from,
          senderName: mail.from_name,
          context: mail.subject || '',
          // Same freshness contract as the seed above and as every background
          // writer - a simulated delivery is the FRESHEST code there is.
          received_at: mail.received_at,
          recipient: address,
        }
      : undefined,
  });

  // Simulated delivery runs the SAME per-site auto-copy path as real
  // delivery, so demo mode exercises the full pipeline (clipboard copy +
  // value-free confirmation) and the behavior is testable offline.
  let autoCopied = false;
  const otp = mail.otp;
  if (otp) {
    autoCopied = await maybeAutoCopyOtp({
      otp,
      sender: mail.from || '',
      copy: (text) => copyToClipboardFromBackground(text),
      notify: (ok) => {
        try {
          // Audible confirmation for the auto-copy event - same custom sound
          // as real delivery, gated by the soundEnabled toggle.
          void playNotificationSoundIfEnabled();
          void ext.runtime.sendMessage({ type: 'otpAutoCopied', ok }).catch(() => {
            createBrowserNotification('otp_auto_copy', {
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: ok
                ? tSync('notifications.otpAutoCopiedTitle')
                : tSync('notifications.otpAutoCopyFailedTitle'),
              message: ok
                ? tSync('notifications.otpAutoCopiedMessage')
                : tSync('notifications.otpAutoCopyFailedMessage'),
            });
          });
        } catch {
          /* ignore */
        }
      },
    });
  }
  return { mail, autoCopied };
}
