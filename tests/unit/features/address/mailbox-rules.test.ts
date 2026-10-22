import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { preloadTranslations } from '@/utils/i18n/i18n-background.js';
import type { Address, Email } from '@/utils/types.js';

// Restore module mocks so nothing leaks into later test files (one Bun process).
afterAll(() => {
  mock.restore();
});
// ── In-memory browser mock (registered before the dynamic import) ───────────
const store: Record<string, unknown> = {};
const alarms = new Map<string, { name: string; scheduledTime?: number }>();
const tabsCreated: { url?: string }[] = [];
const scriptsExecuted: { tabId: number; text: string }[] = [];
let activeTabId: number | null = 11;
let failForward = false;

const fakeBrowser = {
  alarms: {
    get: async (name: string) => alarms.get(name),
    clear: async (name: string) => alarms.delete(name),
    create: async (name: string, info: { when?: number }) => {
      alarms.set(name, { name, scheduledTime: info.when });
    },
  },
  storage: {
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
  },
  tabs: {
    create: async (props: { url?: string }) => {
      if (failForward) throw new Error('test-forward-failure');
      tabsCreated.push(props);
      return { id: tabsCreated.length };
    },
    query: async (queryInfo: { active?: boolean; lastFocusedWindow?: boolean }) => {
      void queryInfo;
      return activeTabId != null ? [{ id: activeTabId }] : [];
    },
  },
  scripting: {
    executeScript: async (details: { target: { tabId: number }; args: unknown[] }) => {
      scriptsExecuted.push({
        tabId: details.target.tabId,
        text: String(details.args?.[0] ?? ''),
      });
      return [{ result: true }];
    },
  },
};

mock.module('wxt/browser', () => ({ browser: fakeBrowser }));
Object.assign(globalThis, { browser: fakeBrowser });

const {
  applyMailboxRulesToNewMessages,
  buildForwardMailtoUrl,
  clearMailboxRuleStats,
  deleteMailboxRule,
  saveMailboxRules,
  loadMailboxRuleStats,
  loadMailboxRules,
  matchMailboxRule,
  moveMailboxRule,
  parseSenderAddress,
  recordMailboxRuleMatches,
  resetForwardCooldowns,
  ruleMatchesMessage,
  rulePassesAllowlist,
  rulePassesRecipientAllowlist,
  upsertMailboxRule,
} = await import('@/features/address/mailbox-rules.js');
type MailboxRule = import('@/features/address/mailbox-rules.js').MailboxRule;
const { loadArchiveSchedule } = await import('@/features/intelligence/site-rules.js');

function email(id: string, opts: Partial<Email> = {}): Email {
  return {
    id,
    from: 'noreply@github.com',
    from_name: 'GitHub',
    subject: `Subject ${id}`,
    body_plain: `Body ${id}`,
    received_at: Math.floor(Date.now() / 1000),
    stored_at: Date.now(),
    ...opts,
  };
}

function rule(partial: Partial<MailboxRule> & { contains: string }): MailboxRule {
  return {
    id: 'r1',
    name: partial.contains,
    enabled: true,
    field: 'sender',
    label: undefined,
    autoArchiveDays: null,
    silenceNotifications: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function record(partial: Partial<Address> = {}): Address {
  return {
    id: 'inbox-1',
    address: 'foo@bar.com',
    provider: 'guerrilla',
    accountStatus: 'active',
    status: 'active',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...partial,
  } as Address;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  alarms.clear();
  tabsCreated.length = 0;
  scriptsExecuted.length = 0;
  activeTabId = 11;
  failForward = false;
  resetForwardCooldowns();
});

describe('ruleMatchesMessage', () => {
  test('matches sender substring on from and from_name, case-insensitively', () => {
    const r = rule({ contains: 'github' });
    expect(ruleMatchesMessage(r, email('1', { from: 'noreply@github.com' }))).toBe(true);
    expect(ruleMatchesMessage(r, email('1', { from: 'noreply@x.com', from_name: 'GitHub' }))).toBe(
      true
    );
    expect(ruleMatchesMessage(r, email('1', { from: 'noreply@x.com', from_name: 'X Corp' }))).toBe(
      false
    );
    expect(ruleMatchesMessage(rule({ contains: 'GITHUB' }), email('1'))).toBe(true);
  });

  test('recipient matching is explicit and does not match sender text', () => {
    const r = rule({ contains: 'hello@x.com', field: 'recipient' });
    expect(ruleMatchesMessage(r, email('1', { original_inbox: 'hello@x.com' }))).toBe(true);
    expect(ruleMatchesMessage(r, email('1', { from: 'noreply@y.com' }), 'hello@x.com')).toBe(true);
    expect(
      ruleMatchesMessage(
        rule({ contains: 'x.com', field: 'recipient' }),
        email('1', { original_inbox: 'user@x.com' })
      )
    ).toBe(true);
    expect(ruleMatchesMessage(r, email('1', { from: 'noreply@y.com' }), 'other@z.com')).toBe(false);
    expect(ruleMatchesMessage(rule({ contains: 'hello@x.com' }), email('1'), 'hello@x.com')).toBe(
      false
    );
    expect(
      ruleMatchesMessage(
        rule({ contains: 'github', field: 'recipient' }),
        email('1'),
        'hello@x.com'
      )
    ).toBe(false);
    expect(ruleMatchesMessage(rule({ contains: 'github' }), email('1'))).toBe(true);
  });

  test('"Sender contains" does not scan subject or body', () => {
    expect(
      ruleMatchesMessage(
        rule({ contains: 'Your code' }),
        email('1', { subject: 'Your code is 482901' })
      )
    ).toBe(false);
    expect(
      ruleMatchesMessage(
        rule({ contains: 'invoice' }),
        email('1', { body_plain: 'Here is your invoice.' })
      )
    ).toBe(false);
  });

  test('"Anywhere contains" scans sender, recipient, subject, and body', () => {
    const anywhere = (contains: string) => rule({ contains, field: 'anywhere' });
    expect(ruleMatchesMessage(anywhere('github'), email('1'))).toBe(true); // sender
    expect(
      ruleMatchesMessage(anywhere('hello@x.com'), email('1', { original_inbox: 'hello@x.com' }))
    ).toBe(true); // recipient
    expect(ruleMatchesMessage(anywhere('hello@x.com'), email('1'), 'hello@x.com')).toBe(true);
    expect(
      ruleMatchesMessage(anywhere('Your code'), email('1', { subject: 'Your code is 482901' }))
    ).toBe(true); // subject
    expect(
      ruleMatchesMessage(anywhere('invoice'), email('1', { body_plain: 'Here is your invoice.' }))
    ).toBe(true); // body
    expect(
      ruleMatchesMessage(
        anywhere('INVOICE'),
        email('1', { body_plain: 'Your invoice is attached.' })
      )
    ).toBe(true); // case-insensitive
    expect(
      ruleMatchesMessage(anywhere('receipt'), email('1', { body_plain: 'Here is your invoice.' }))
    ).toBe(false);
  });

  test('matches subject and body fields', () => {
    expect(
      ruleMatchesMessage(
        rule({ contains: 'Your code', field: 'subject' }),
        email('1', { subject: 'Your code is 482901' })
      )
    ).toBe(true);
    expect(
      ruleMatchesMessage(
        rule({ contains: 'invoice', field: 'body' }),
        email('1', { body_plain: 'Here is your invoice.' })
      )
    ).toBe(true);
    expect(
      ruleMatchesMessage(
        rule({ contains: 'invoice', field: 'body' }),
        email('1', { body_plain: 'Here is your receipt.', body: 'Here is your receipt.' })
      )
    ).toBe(false);
  });

  test('disabled rules and empty needles never match', () => {
    expect(ruleMatchesMessage(rule({ contains: 'github', enabled: false }), email('1'))).toBe(
      false
    );
    expect(ruleMatchesMessage(rule({ contains: '' }), email('1'))).toBe(false);
  });
});

describe('mailbox rule match stats', () => {
  test('records aggregate counts and last match time per rule', async () => {
    await recordMailboxRuleMatches(
      new Map([
        ['a', { n: 2, field: 'sender' }],
        ['b', { n: 1, field: 'subject' }],
      ])
    );
    const stats = await loadMailboxRuleStats();
    expect(stats.a).toMatchObject({ count: 2, field: 'sender' });
    expect(stats.b).toMatchObject({ count: 1, field: 'subject' });
    expect(typeof stats.a.lastMatchedAt).toBe('number');

    // Re-recording merges instead of overwriting.
    await recordMailboxRuleMatches(new Map([['a', { n: 3, field: 'sender' }]]));
    expect((await loadMailboxRuleStats()).a.count).toBe(5);
  });

  test("deleteMailboxRule prunes the deleted rule's stats", async () => {
    await recordMailboxRuleMatches(new Map([['x', { n: 1, field: 'sender' }]]));
    await deleteMailboxRule('x');
    expect((await loadMailboxRuleStats()).x).toBeUndefined();
  });

  test('clearMailboxRuleStats wipes all stats when called without ids', async () => {
    await recordMailboxRuleMatches(new Map([['x', { n: 1, field: 'sender' }]]));
    await clearMailboxRuleStats();
    expect(await loadMailboxRuleStats()).toEqual({});
  });
});

describe('matchMailboxRule', () => {
  test('first enabled matching rule wins (list order = priority)', () => {
    const first = rule({ id: 'a', contains: 'github', label: 'first' });
    const second = rule({ id: 'b', contains: 'github', label: 'second' });
    const match = matchMailboxRule(email('1'), [first, second]);
    expect(match?.id).toBe('a');
  });

  test('disabled rules are skipped', () => {
    const disabled = rule({ id: 'a', contains: 'github', enabled: false });
    expect(matchMailboxRule(email('1'), [disabled])).toBeNull();
  });

  test('a sender allowlist restricts which senders the rule matches', () => {
    const r = rule({ contains: 'noreply', senderAllowlist: ['example.com'] });
    expect(matchMailboxRule(email('1', { from: 'noreply@example.com' }), [r])).not.toBeNull();
    expect(matchMailboxRule(email('1', { from: 'noreply@github.com' }), [r])).toBeNull();
  });

  test('a recipient allowlist restricts which inbox the rule applies to', () => {
    const r = rule({ contains: 'noreply', recipientAllowlist: ['foo@bar.com'] });
    expect(matchMailboxRule(email('1'), [r], 'foo@bar.com')).not.toBeNull();
    expect(matchMailboxRule(email('1'), [r], 'other@bar.com')).toBeNull();
    // No recipient passed (backward-compatible) → a non-empty allowlist never matches.
    expect(matchMailboxRule(email('1'), [r])).toBeNull();
    // No recipient allowlist → recipient is irrelevant.
    const open = rule({ contains: 'noreply' });
    expect(matchMailboxRule(email('1'), [open])).not.toBeNull();
  });

  test('recipient-aware sender matching composes with a recipient allowlist', () => {
    // The rule keys off the delivery address: the needle matches the recipient
    // even though the sender text contains nothing of interest, and the
    // recipient allowlist approves that same address.
    const byRecipient = rule({
      contains: 'foo@bar.com',
      field: 'recipient',
      recipientAllowlist: ['foo@bar.com'],
    });
    expect(matchMailboxRule(email('1'), [byRecipient], 'foo@bar.com')).not.toBeNull();
    expect(matchMailboxRule(email('1'), [byRecipient], 'other@bar.com')).toBeNull();

    // Bare-domain needle + bare-domain allowlist entry, both satisfied by the
    // delivery address (sender is the default GitHub address).
    const byDomain = rule({
      contains: 'bar.com',
      field: 'recipient',
      recipientAllowlist: ['bar.com'],
    });
    expect(matchMailboxRule(email('1'), [byDomain], 'alerts@bar.com')).not.toBeNull();
    expect(matchMailboxRule(email('1'), [byDomain], 'alerts@other.com')).toBeNull();

    // The allowlist still gates first: the sender contains the needle, but the
    // delivery address is not approved.
    const gated = rule({ contains: 'github', recipientAllowlist: ['foo@bar.com'] });
    expect(matchMailboxRule(email('1'), [gated], 'other@bar.com')).toBeNull();

    // original_inbox alone does not satisfy a non-empty recipient allowlist -
    // the delivery address must be passed explicitly.
    const viaOriginal = rule({ contains: 'foo@bar.com', recipientAllowlist: ['foo@bar.com'] });
    expect(
      matchMailboxRule(email('1', { original_inbox: 'foo@bar.com' }), [viaOriginal])
    ).toBeNull();
  });
});

describe('rulePassesRecipientAllowlist', () => {
  test('matches full address, bare domain, and @domain', () => {
    const base = { contains: 'x' };
    expect(
      rulePassesRecipientAllowlist(
        rule({ ...base, recipientAllowlist: ['foo@bar.com'] }),
        'foo@bar.com'
      )
    ).toBe(true);
    expect(
      rulePassesRecipientAllowlist(
        rule({ ...base, recipientAllowlist: ['bar.com'] }),
        'foo@bar.com'
      )
    ).toBe(true);
    expect(
      rulePassesRecipientAllowlist(
        rule({ ...base, recipientAllowlist: ['@bar.com'] }),
        'foo@bar.com'
      )
    ).toBe(true);
    expect(
      rulePassesRecipientAllowlist(rule({ ...base, recipientAllowlist: ['bar.com'] }), 'foo@x.com')
    ).toBe(false);
  });

  test('empty or missing allowlist is no restriction; missing recipient fails a non-empty list', () => {
    const base = { contains: 'x' };
    expect(rulePassesRecipientAllowlist(rule(base), 'anything@x.com')).toBe(true);
    expect(
      rulePassesRecipientAllowlist(rule({ ...base, recipientAllowlist: [] }), 'foo@x.com')
    ).toBe(true);
    expect(
      rulePassesRecipientAllowlist(rule({ ...base, recipientAllowlist: ['x.com'] }), undefined)
    ).toBe(false);
  });

  test('matching is case-insensitive', () => {
    expect(
      rulePassesRecipientAllowlist(
        rule({ contains: 'x', recipientAllowlist: ['  Bar.COM '] }),
        'Foo@Bar.com'
      )
    ).toBe(true);
  });
});

describe('parseSenderAddress / senderAllowlist matching', () => {
  test('parses bare and RFC-style From headers', () => {
    expect(parseSenderAddress('user@x.com')).toBe('user@x.com');
    expect(parseSenderAddress('Name <User@X.COM>')).toBe('user@x.com');
    expect(parseSenderAddress('no angle here')).toBeNull();
    expect(parseSenderAddress(undefined)).toBeNull();
  });

  test('allowlist matches full address, bare domain, and @domain', () => {
    const msg = email('1', { from: 'alerts@github.com' });
    expect(
      rulePassesAllowlist(rule({ contains: 'x', senderAllowlist: ['alerts@github.com'] }), msg)
    ).toBe(true);
    expect(rulePassesAllowlist(rule({ contains: 'x', senderAllowlist: ['github.com'] }), msg)).toBe(
      true
    );
    expect(
      rulePassesAllowlist(rule({ contains: 'x', senderAllowlist: ['@github.com'] }), msg)
    ).toBe(true);
    expect(
      rulePassesAllowlist(rule({ contains: 'x', senderAllowlist: ['example.com'] }), msg)
    ).toBe(false);
  });

  test('allowlist matching is case-insensitive and trims entries', () => {
    const msg = email('1', { from: 'ALERTS@GitHub.com' });
    expect(
      rulePassesAllowlist(rule({ contains: 'x', senderAllowlist: ['  GITHUB.COM '] }), msg)
    ).toBe(true);
  });

  test('empty or missing allowlist is no restriction', () => {
    const msg = email('1', { from: 'anything@x.com' });
    expect(rulePassesAllowlist(rule({ contains: 'x' }), msg)).toBe(true);
    expect(rulePassesAllowlist(rule({ contains: 'x', senderAllowlist: [] }), msg)).toBe(true);
  });

  test('a message without a parsable sender never passes a non-empty allowlist', () => {
    const msg = email('1', { from: 'no-address-here' });
    expect(rulePassesAllowlist(rule({ contains: 'x', senderAllowlist: ['x.com'] }), msg)).toBe(
      false
    );
  });
});

describe('buildForwardMailtoUrl', () => {
  test('builds a prefilled Fwd: compose for the destination', () => {
    const url = buildForwardMailtoUrl(
      email('1', {
        from: 'alerts@github.com',
        subject: 'Your code is 482901',
        body_plain: 'Code: 482901',
      }),
      'me@example.com'
    );
    // The recipient `@` stays literal so mail clients don't render "%40".
    // (The sender `@` in the body is correctly percent-encoded - only the To:
    // field must keep a literal `@`.)
    expect(url.startsWith('mailto:me@example.com?subject=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('Fwd: Your code is 482901');
    expect(decodeURIComponent(url)).toContain('From: alerts@github.com');
    expect(decodeURIComponent(url)).toContain('Code: 482901');
  });
});

describe('loadMailboxRules', () => {
  test('empty storage returns []', async () => {
    expect(await loadMailboxRules()).toEqual([]);
  });

  test('legacy non-array shape under the key is ignored', async () => {
    store.mailboxRules = { extendOnOtpArrival: true }; // old auto-extend preset shape
    expect(await loadMailboxRules()).toEqual([]);
  });

  test('filters malformed entries out of the array', async () => {
    store.mailboxRules = [rule({ contains: 'github' }), null, 'junk', { id: 'x' }];
    const rules = await loadMailboxRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].contains).toBe('github');
  });
});

describe('upsertMailboxRule / deleteMailboxRule', () => {
  test('clear all cancels archive schedules and capacity never evicts a rule', async () => {
    for (let index = 0; index < 40; index++)
      await upsertMailboxRule({ contains: `sender${index}` });
    const before = await loadMailboxRules();
    await expect(upsertMailboxRule({ contains: 'new' })).rejects.toThrow('rule-limit-exceeded');
    expect(await loadMailboxRules()).toEqual(before);
    store.siteRuleArchiveSchedule = {
      inbox: {
        ruleId: before[0].id,
        scheduledAt: Date.now(),
        archiveAt: Date.now() + 86400000,
        domain: 'test.com',
      },
    };
    await saveMailboxRules([]);
    expect(await loadArchiveSchedule()).toEqual({});
  });

  test('legacy combined sender/recipient behavior keeps an explicit name', async () => {
    store.mailboxRules = [rule({ contains: 'foo@bar.com' })];
    const [legacy] = await loadMailboxRules();
    expect(legacy.field).toBe('senderOrRecipient');
    expect(ruleMatchesMessage(legacy, email('1'), 'foo@bar.com')).toBe(true);
    const current = await upsertMailboxRule({ contains: 'foo@bar.com' });
    expect(ruleMatchesMessage(current, email('1'), 'foo@bar.com')).toBe(false);
  });
  test('creates with defaults and persists', async () => {
    const created = await upsertMailboxRule({ contains: 'noreply@' });
    expect(created.enabled).toBe(true);
    expect(created.field).toBe('sender');
    expect(created.autoArchiveDays).toBeNull();
    expect(created.silenceNotifications).toBe(false);
    const rules = await loadMailboxRules();
    expect(rules.map((r) => r.id)).toEqual([created.id]);
  });

  test('upsert with id updates in place (toggle)', async () => {
    const created = await upsertMailboxRule({ contains: 'github', label: 'work' });
    const updated = await upsertMailboxRule({
      ...created,
      enabled: false,
      label: 'other',
      contains: created.contains,
    });
    expect(updated.enabled).toBe(false);
    expect(updated.label).toBe('other');
    const rules = await loadMailboxRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].enabled).toBe(false);
  });

  test('delete removes the rule', async () => {
    const created = await upsertMailboxRule({ contains: 'github' });
    await deleteMailboxRule(created.id);
    expect(await loadMailboxRules()).toEqual([]);
  });
});

describe('moveMailboxRule', () => {
  // upsertMailboxRule generates its own id and unshifts new rules to the FRONT,
  // so after creating a, b, c the stored list is [c, b, a].
  async function seed(): Promise<{ a: string; b: string; c: string }> {
    const a = await upsertMailboxRule({ contains: 'aaa', label: 'A' });
    const b = await upsertMailboxRule({ contains: 'bbb', label: 'B' });
    const c = await upsertMailboxRule({ contains: 'ccc', label: 'C' });
    return { a: a.id, b: b.id, c: c.id };
  }

  test('moves a rule down and persists the new order', async () => {
    const { a, b, c } = await seed();
    expect((await loadMailboxRules()).map((r) => r.id)).toEqual([c, b, a]);
    await moveMailboxRule(c, 1);
    expect((await loadMailboxRules()).map((r) => r.id)).toEqual([b, c, a]);
  });

  test('moves a rule up', async () => {
    const { a, b, c } = await seed();
    await moveMailboxRule(a, -1);
    expect((await loadMailboxRules()).map((r) => r.id)).toEqual([c, a, b]);
  });

  test('clamps at the list edges', async () => {
    const { a, b, c } = await seed();
    await moveMailboxRule(c, -1); // already first
    expect((await loadMailboxRules()).map((r) => r.id)).toEqual([c, b, a]);
    await moveMailboxRule(a, 1); // already last
    expect((await loadMailboxRules()).map((r) => r.id)).toEqual([c, b, a]);
  });

  test('unknown ids are no-ops', async () => {
    const { a, b, c } = await seed();
    await moveMailboxRule('missing', 1);
    expect((await loadMailboxRules()).map((r) => r.id)).toEqual([c, b, a]);
  });

  test('reordering changes which rule matches first (priority)', async () => {
    // ra and rc BOTH match a sender of c@x.com (ra contains 'x', rc contains 'c').
    const ra = await upsertMailboxRule({ contains: 'x', label: 'A' });
    await upsertMailboxRule({ contains: 'c', label: 'C' });
    // rc was created last → it is first in the list → label C wins.
    const matchBefore = matchMailboxRule(email('1', { from: 'c@x.com' }), await loadMailboxRules());
    expect(matchBefore?.label).toBe('C');
    await moveMailboxRule(ra.id, -1); // promote ra above rc
    const matchAfter = matchMailboxRule(email('1', { from: 'c@x.com' }), await loadMailboxRules());
    expect(matchAfter?.label).toBe('A');
  });
});

describe('applyMailboxRulesToNewMessages', () => {
  test('auto-copy rejects stale, expired and invalid future codes using the configured limit', async () => {
    store.mailboxRules = [rule({ contains: 'github', autoCopyOtp: true })];
    store.verificationPreferences = { maxAgeMinutes: 1 };
    for (const message of [
      email('stale', { otp: '123456', received_at: Date.now() - 61000 }),
      email('expired', { otp: '123456', otpExpiresAt: Date.now() - 1000 }),
      email('future', { otp: '123456', received_at: Date.now() + 180000 }),
    ])
      expect((await applyMailboxRulesToNewMessages(record(), [message])).otpCopiedCount).toBe(0);
    expect(scriptsExecuted).toHaveLength(0);
  });

  test('newest auto-copy normalizes mixed second and millisecond timestamps', async () => {
    store.mailboxRules = [rule({ contains: 'github', autoCopyOtp: true })];
    await applyMailboxRulesToNewMessages(record(), [
      email('older', { otp: '111111', received_at: Date.now() - 10000 }),
      email('newer', { otp: '222222', received_at: Math.floor(Date.now() / 1000) }),
    ]);
    expect(scriptsExecuted[0]?.text).toBe('222222');
  });

  test('failed forwarding is reported separately from matching and successful drafts', async () => {
    failForward = true;
    store.mailboxRules = [rule({ contains: 'github', forwardTo: 'me@example.com' })];
    const result = await applyMailboxRulesToNewMessages(record(), [email('1')]);
    expect(result.matchedCount).toBe(1);
    expect(result.forwardedCount).toBe(0);
    expect(result.failedActions).toBe(1);
    expect((await loadMailboxRuleStats()).r1.failedActions).toBe(1);
    expect((await loadMailboxRuleStats()).r1.lastSucceeded).toEqual([]);
  });

  test('every matching archive rule in a batch contributes a separate deadline', async () => {
    store.mailboxRules = [
      rule({ id: 'early', field: 'subject', contains: 'early', autoArchiveDays: 1 }),
      rule({ id: 'late', field: 'subject', contains: 'late', autoArchiveDays: 7 }),
    ];
    await applyMailboxRulesToNewMessages(record(), [
      email('1', { subject: 'late' }),
      email('2', { subject: 'early' }),
    ]);
    const schedule = (await loadArchiveSchedule())['inbox-1'];
    expect(schedule.ruleId).toBe('early');
    expect(schedule.sources).toHaveLength(2);
    expect((await loadMailboxRuleStats()).early.lastSucceeded).toEqual(['archive']);
  });
  test('merges a label into the emailLabels map for matching messages', async () => {
    store.emailLabels = { 'foo@bar.com_1': ['existing'] };
    store.mailboxRules = [rule({ contains: 'github', label: 'work' })];
    const res = await applyMailboxRulesToNewMessages(record(), [
      email('1'),
      email('2', { from: 'x@y.z', from_name: 'Other' }),
    ]);
    expect(res.matchedCount).toBe(1);
    expect((store.emailLabels as Record<string, string[]>)['foo@bar.com_1']).toEqual([
      'existing',
      'work',
    ]);
    expect((store.emailLabels as Record<string, string[]>)['foo@bar.com_2']).toBeUndefined();
  });

  test('dedupes a label that is already applied', async () => {
    store.emailLabels = { 'foo@bar.com_1': ['work'] };
    store.mailboxRules = [rule({ contains: 'github', label: 'work' })];
    await applyMailboxRulesToNewMessages(record(), [email('1')]);
    expect((store.emailLabels as Record<string, string[]>)['foo@bar.com_1']).toEqual(['work']);
  });

  test('reports silenced message ids', async () => {
    store.mailboxRules = [rule({ contains: 'github', silenceNotifications: true })];
    const res = await applyMailboxRulesToNewMessages(record(), [
      email('1'),
      email('2', { from: 'x@y.z', from_name: 'Other' }),
    ]);
    expect(res.silencedIds.has('1')).toBe(true);
    expect(res.silencedIds.has('2')).toBe(false);
  });

  test('schedules the mailbox auto-archive via the shared site-rule schedule', async () => {
    store.mailboxRules = [rule({ id: 'rr', contains: 'github', autoArchiveDays: 3 })];
    const before = Date.now();
    const res = await applyMailboxRulesToNewMessages(record({ id: 'inbox-9' }), [email('1')]);
    expect(res.archiveAt).toBeGreaterThan(before);
    const schedule = await loadArchiveSchedule();
    expect(schedule['inbox-9']).toBeDefined();
    expect(schedule['inbox-9'].ruleId).toBe('rr');
    expect(schedule['inbox-9'].domain).toBe('foo@bar.com');
    expect(schedule['inbox-9'].archiveAt).toBeGreaterThanOrEqual(before + 3 * 24 * 60 * 60 * 1000);
  });

  test('schedules nothing without an inbox record or archive days', async () => {
    store.mailboxRules = [rule({ contains: 'github', autoArchiveDays: 3 })];
    await applyMailboxRulesToNewMessages(undefined, [email('1')]);
    expect(await loadArchiveSchedule()).toEqual({});

    store.mailboxRules = [rule({ contains: 'github' })];
    await applyMailboxRulesToNewMessages(record(), [email('1')]);
    expect(await loadArchiveSchedule()).toEqual({});
  });

  test('no enabled rules is a no-op', async () => {
    store.mailboxRules = [rule({ contains: 'github', enabled: false, label: 'x' })];
    const res = await applyMailboxRulesToNewMessages(record(), [email('1')]);
    expect(res.matchedCount).toBe(0);
    expect(res.silencedIds.size).toBe(0);
    expect(store.emailLabels).toBeUndefined();
  });

  test('empty message list is a no-op', async () => {
    store.mailboxRules = [rule({ contains: 'github', label: 'x' })];
    const res = await applyMailboxRulesToNewMessages(record(), []);
    expect(res.matchedCount).toBe(0);
    expect(store.emailLabels).toBeUndefined();
  });

  test('a forwardTo rule opens a mailto compose and reports forwardedCount', async () => {
    store.mailboxRules = [rule({ contains: 'github', forwardTo: 'me@example.com' })];
    const res = await applyMailboxRulesToNewMessages(record(), [email('1')]);
    expect(res.forwardedCount).toBe(1);
    expect(tabsCreated).toHaveLength(1);
    expect(tabsCreated[0].url?.startsWith('mailto:me@example.com')).toBe(true);
    expect(decodeURIComponent(tabsCreated[0].url || '')).toContain('Fwd: Subject 1');
  });

  test('the forwarded body follows the ACTIVE LOCALE - the same keys the manual forward uses', async () => {
    // The rule-driven mailto and the manual forward button (MailView) are one
    // feature, so a fixed English skeleton here would win over the locale for
    // every rule-driven forward. Expected values are read out of the shipped
    // minimal dictionary rather than restated, so this cannot pass by asserting
    // English against English.
    const de = JSON.parse(
      readFileSync(`${import.meta.dir}/../../../../src/locales/background/de.json`, 'utf8')
    ) as {
      inbox: { emailActions: Record<string, string> };
      notifications: Record<string, string>;
      common: Record<string, string>;
    };
    const fwd = de.inbox.emailActions;

    await preloadTranslations('de');
    try {
      store.mailboxRules = [
        rule({ id: 'de-fwd', contains: 'github', field: 'anywhere', forwardTo: 'me@example.com' }),
      ];
      // Every stand-in in the body is one the locale has to supply: no subject,
      // no sender, no timestamp. The rule still matches on the body text.
      await applyMailboxRulesToNewMessages(record(), [
        email('1', { subject: '', from: '', from_name: '', received_at: 0, body_plain: 'github' }),
      ]);
      const url = decodeURIComponent(tabsCreated[tabsCreated.length - 1].url || '');

      expect(url).toContain(`subject=${fwd.forwardSubjectPrefix} ${de.notifications.noSubject}`);
      expect(url).toContain(fwd.forwardHeader);
      expect(url).toContain(`${fwd.forwardFromLabel} ${de.notifications.unknownSender}`);
      expect(url).toContain(`${fwd.forwardDateLabel} ${de.common.unknown}`);
      // The English stand-ins must not win anywhere in the composed mail.
      expect(url).not.toContain('No Subject');
      expect(url).not.toContain('Unknown Sender');
    } finally {
      await preloadTranslations('en');
    }
  });

  test('forwarding is rate-limited per rule (one compose per minute)', async () => {
    store.mailboxRules = [rule({ id: 'fr', contains: 'github', forwardTo: 'me@example.com' })];
    await applyMailboxRulesToNewMessages(record(), [email('1')]);
    await applyMailboxRulesToNewMessages(record(), [email('2')]);
    expect(tabsCreated).toHaveLength(1);
    // A different rule id forwards independently of the first.
    store.mailboxRules = [rule({ id: 'fr2', contains: 'github', forwardTo: 'other@example.com' })];
    await applyMailboxRulesToNewMessages(record(), [email('3')]);
    expect(tabsCreated).toHaveLength(2);
  });

  test('no tab is opened without a forwardTo destination', async () => {
    store.mailboxRules = [rule({ contains: 'github', label: 'work' })];
    const res = await applyMailboxRulesToNewMessages(record(), [email('1')]);
    expect(res.forwardedCount).toBe(0);
    expect(tabsCreated).toHaveLength(0);
  });

  test('allowlist gates all actions in the pipeline', async () => {
    store.mailboxRules = [
      rule({
        contains: 'noreply',
        senderAllowlist: ['example.com'],
        label: 'work',
        silenceNotifications: true,
        forwardTo: 'me@example.com',
      }),
    ];
    await applyMailboxRulesToNewMessages(record(), [
      email('1', { from: 'noreply@example.com' }),
      email('2', { from: 'noreply@github.com' }),
    ]);
    expect((store.emailLabels as Record<string, string[]> | undefined)?.['foo@bar.com_1']).toEqual([
      'work',
    ]);
    expect(
      (store.emailLabels as Record<string, string[]> | undefined)?.['foo@bar.com_2']
    ).toBeUndefined();
    expect(tabsCreated).toHaveLength(1);
  });

  test('an autoCopyOtp rule copies the newest OTP to the active tab', async () => {
    store.mailboxRules = [rule({ contains: 'github', autoCopyOtp: true })];
    const res = await applyMailboxRulesToNewMessages(record(), [
      email('old', { otp: '111111', received_at: Date.now() - 10000 }),
      email('new', { otp: '222222', received_at: Date.now() - 1000 }),
    ]);
    expect(res.otpCopiedCount).toBe(1);
    expect(scriptsExecuted).toHaveLength(1);
    expect(scriptsExecuted[0].tabId).toBe(11);
    expect(scriptsExecuted[0].text).toBe('222222');
  });

  test('no copy happens without an OTP or without the autoCopyOtp flag', async () => {
    store.mailboxRules = [rule({ contains: 'github', autoCopyOtp: true })];
    const noOtp = await applyMailboxRulesToNewMessages(record(), [email('1')]);
    expect(noOtp.otpCopiedCount).toBe(0);
    expect(scriptsExecuted).toHaveLength(0);

    store.mailboxRules = [rule({ contains: 'github', label: 'work' })];
    const noFlag = await applyMailboxRulesToNewMessages(record(), [email('2', { otp: '333333' })]);
    expect(noFlag.otpCopiedCount).toBe(0);
    expect(scriptsExecuted).toHaveLength(0);
  });

  test('rules can target different recipient addresses', async () => {
    store.mailboxRules = [
      rule({ id: 'ra', contains: 'github', recipientAllowlist: ['a@test.com'], label: 'A' }),
      rule({ id: 'rb', contains: 'github', recipientAllowlist: ['b@test.com'], label: 'B' }),
    ];
    await applyMailboxRulesToNewMessages(record({ id: 'in-a', address: 'a@test.com' }), [
      email('1'),
    ]);
    await applyMailboxRulesToNewMessages(record({ id: 'in-b', address: 'b@test.com' }), [
      email('2'),
    ]);
    const tags = store.emailLabels as Record<string, string[]>;
    expect(tags['a@test.com_1']).toEqual(['A']);
    expect(tags['b@test.com_2']).toEqual(['B']);
  });

  test('labels stay isolated when provider message IDs collide across inboxes', async () => {
    store.mailboxRules = [rule({ contains: 'github', label: 'work' })];
    await applyMailboxRulesToNewMessages(record({ address: 'a@test.com' }), [email('shared')]);
    await applyMailboxRulesToNewMessages(record({ address: 'b@test.com' }), [email('shared')]);

    expect(store.emailLabels).toEqual({
      'a@test.com_shared': ['work'],
      'b@test.com_shared': ['work'],
    });
  });

  test('a message original_inbox overrides the polling inbox for recipient matching', async () => {
    store.mailboxRules = [
      rule({ id: 'ra', contains: 'github', recipientAllowlist: ['a@test.com'], label: 'A' }),
      rule({ id: 'rb', contains: 'github', recipientAllowlist: ['b@test.com'], label: 'B' }),
    ];
    // Polling inbox is B, but the message was originally delivered to A.
    await applyMailboxRulesToNewMessages(record({ id: 'in-b', address: 'b@test.com' }), [
      email('1', { original_inbox: 'a@test.com' }),
    ]);
    expect((store.emailLabels as Record<string, string[]> | undefined)?.['a@test.com_1']).toEqual([
      'A',
    ]);
  });

  test('falls back to the worker clipboard when no active tab exists', async () => {
    const writes: string[] = [];
    const originalNavigator = globalThis.navigator as unknown;
    Object.assign(globalThis, {
      navigator: {
        ...(originalNavigator && typeof originalNavigator === 'object'
          ? (originalNavigator as object)
          : {}),
        clipboard: {
          readText: async () => '',
          writeText: async (t: string) => void writes.push(t),
        },
      },
    });
    try {
      activeTabId = null;
      store.mailboxRules = [rule({ contains: 'github', autoCopyOtp: true })];
      const res = await applyMailboxRulesToNewMessages(record(), [email('1', { otp: '444444' })]);
      expect(res.otpCopiedCount).toBe(1);
      expect(scriptsExecuted).toHaveLength(0);
      expect(writes).toEqual(['444444']);
    } finally {
      Object.assign(globalThis, { navigator: originalNavigator });
    }
  });
});
