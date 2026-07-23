/**
 * Demo mode: isolated bag of fake inboxes/emails.
 * Real user data is snapshotted and restored on exit so real mode is never mixed.
 */
import type { Browser } from 'wxt/browser';
import type { Account, Email } from '@/utils/types.js';

export const DEMO_INBOX_ID = 'demo-inbox-1';
export const DEMO_ADDRESS = 'demo.user@example.com';
export const MAX_DEMO_INBOXES = 8;

const SNAPSHOT_KEY = 'realModeSnapshot_v1';

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
  inboxAddress: string
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
    original_inbox: inboxAddress,
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
  inboxes: Account[];
  storedEmails: Record<string, Email[]>;
  archivedEmails: Record<string, Email[]>;
  activeInboxId?: string;
  latestOtp?: unknown;
  selectedEmail?: string;
};

function buildDemoBag(index: number, username?: string): Account {
  const now = Date.now();
  const local = username?.trim() || (index === 0 ? 'demo.user' : `demo.user${index + 1}`);
  const address = `${local}@example.com`;
  return {
    id: `demo-inbox-${index + 1}`,
    address,
    provider: 'demo',
    status: 'active',
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
    'inboxes',
    'storedEmails',
    'archivedEmails',
    'activeInboxId',
    'latestOtp',
    'selectedEmail',
  ])) as {
    demoMode?: boolean;
    [SNAPSHOT_KEY]?: Snapshot;
    inboxes?: Account[];
    storedEmails?: Record<string, Email[]>;
    archivedEmails?: Record<string, Email[]>;
    activeInboxId?: string;
    latestOtp?: unknown;
    selectedEmail?: string;
  };

  // Only snapshot real data if we are not already in demo (avoid overwriting real snapshot)
  if (!existing.demoMode) {
    // If current bag is already pure demo, don't snapshot it as "real"
    const current = Array.isArray(existing.inboxes) ? existing.inboxes : [];
    const looksLikeDemoOnly =
      current.length > 0 &&
      current.every((i) => i.provider === 'demo' || String(i.id || '').startsWith('demo-'));
    if (!looksLikeDemoOnly) {
      const snapshot: Snapshot = {
        inboxes: current,
        storedEmails:
          existing.storedEmails && typeof existing.storedEmails === 'object'
            ? existing.storedEmails
            : {},
        archivedEmails:
          existing.archivedEmails && typeof existing.archivedEmails === 'object'
            ? existing.archivedEmails
            : {},
        activeInboxId: existing.activeInboxId,
        latestOtp: existing.latestOtp,
        selectedEmail: existing.selectedEmail,
      };
      await ext.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
    }
  }

  // Seed multiple demo inboxes so address selector / OTP / magic strips are exercisable
  const inbox0 = buildDemoBag(0);
  const inbox1 = buildDemoBag(1);
  const inbox2 = buildDemoBag(2);
  const demos = [inbox0, inbox1, inbox2];
  const storedEmails: Record<string, Email[]> = {};
  for (let i = 0; i < demos.length; i++) {
    storedEmails[demos[i].address] = buildDemoEmailsFor(demos[i].address, i);
  }
  const firstBag = storedEmails[inbox0.address] || [];
  const firstOtp = firstBag.find((m) => m.otp);

  // Atomic swap: demo flag + isolated bags only (never merge with real inboxes)
  await ext.storage.local.set({
    demoMode: true,
    inboxes: demos,
    storedEmails,
    archivedEmails: {},
    activeInboxId: inbox0.id,
    selectedEmail: inbox0.address,
    latestOtp: firstOtp
      ? {
          otp: firstOtp.otp,
          sender: firstOtp.from,
          senderName: firstOtp.from_name,
          context: firstOtp.subject || '',
        }
      : null,
    demoReceiveIndex: 0,
  });
}

/** Exit demo: restore real snapshot if present. */
export async function exitDemoMode(ext: Browser): Promise<void> {
  const { [SNAPSHOT_KEY]: snapshot } = (await ext.storage.local.get([SNAPSHOT_KEY])) as {
    [SNAPSHOT_KEY]?: Snapshot;
  };

  if (snapshot) {
    await ext.storage.local.set({
      demoMode: false,
      inboxes: snapshot.inboxes || [],
      storedEmails: snapshot.storedEmails || {},
      archivedEmails: snapshot.archivedEmails || {},
      activeInboxId: snapshot.activeInboxId,
      latestOtp: snapshot.latestOtp ?? null,
      selectedEmail: snapshot.selectedEmail,
    });
    await ext.storage.local.remove(SNAPSHOT_KEY);
  } else {
    // No snapshot (edge case): clear demo bag only
    const { inboxes = [], storedEmails = {} } = (await ext.storage.local.get([
      'inboxes',
      'storedEmails',
    ])) as { inboxes?: Account[]; storedEmails?: Record<string, Email[]> };
    await ext.storage.local.set({
      demoMode: false,
      inboxes: (inboxes || []).filter(
        (i) => i.provider !== 'demo' && !String(i.id || '').startsWith('demo-')
      ),
      storedEmails: Object.fromEntries(
        Object.entries(storedEmails || {}).filter(
          ([k]) => !k.endsWith('@example.com') || !k.startsWith('demo.')
        )
      ),
      archivedEmails: {},
      latestOtp: null,
    });
  }
}

/** Create a new demo inbox (max MAX_DEMO_INBOXES). Returns address or null if at cap. */
export async function createDemoInbox(ext: Browser, emailUser?: string): Promise<string | null> {
  if (!(await isDemoMode(ext))) return null;
  const { inboxes = [], storedEmails = {} } = (await ext.storage.local.get([
    'inboxes',
    'storedEmails',
  ])) as { inboxes?: Account[]; storedEmails?: Record<string, Email[]> };

  const demoInboxes = (inboxes || []).filter(
    (i) => i.provider === 'demo' || String(i.id || '').startsWith('demo-')
  );
  if (demoInboxes.length >= MAX_DEMO_INBOXES) return null;

  const index = demoInboxes.length;
  const inbox = buildDemoBag(index, emailUser);
  // Ensure unique address
  let n = index;
  while ((inboxes || []).some((i) => i.address === inbox.address)) {
    n += 1;
    inbox.address = `demo.user${n + 1}@example.com`;
    inbox.id = `demo-inbox-${n + 1}`;
  }
  const bag = buildDemoEmailsFor(inbox.address, index);
  const nextInboxes = [
    ...(inboxes || []).filter(
      (i) => i.provider === 'demo' || String(i.id || '').startsWith('demo-')
    ),
    inbox,
  ];
  await ext.storage.local.set({
    inboxes: nextInboxes,
    storedEmails: { ...storedEmails, [inbox.address]: bag },
    activeInboxId: inbox.id,
    selectedEmail: inbox.address,
  });
  return inbox.address;
}

/** @deprecated use enterDemoMode via setDemoMode(true) */
export async function seedDemoData(ext: Browser): Promise<void> {
  await enterDemoMode(ext);
}

/** Simulate one new incoming message (only while demoMode is on). */
export async function simulateDemoReceive(ext: Browser): Promise<Email | null> {
  const {
    demoMode,
    storedEmails = {},
    demoReceiveIndex = 0,
    activeInboxId,
    inboxes = [],
  } = (await ext.storage.local.get([
    'demoMode',
    'storedEmails',
    'demoReceiveIndex',
    'activeInboxId',
    'inboxes',
  ])) as {
    demoMode?: boolean;
    storedEmails?: Record<string, Email[]>;
    demoReceiveIndex?: number;
    activeInboxId?: string;
    inboxes?: Account[];
  };
  if (!demoMode) return null;

  const active =
    (inboxes || []).find((i) => i.id === activeInboxId) ||
    (inboxes || []).find((i) => i.provider === 'demo') ||
    null;
  const address = active?.address || DEMO_ADDRESS;

  const tpl = DEMO_SENDERS[demoReceiveIndex % DEMO_SENDERS.length];
  const mail = makeEmail(
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
  const bag = [...(storedEmails[address] || [])];
  bag.unshift(mail);
  if (bag.length > 40) bag.length = 40;

  await ext.storage.local.set({
    storedEmails: { ...storedEmails, [address]: bag },
    demoReceiveIndex: (demoReceiveIndex % DEMO_SENDERS.length) + 1,
    latestOtp: mail.otp
      ? {
          otp: mail.otp,
          sender: mail.from,
          senderName: mail.from_name,
          context: mail.subject || '',
        }
      : undefined,
  });
  return mail;
}
