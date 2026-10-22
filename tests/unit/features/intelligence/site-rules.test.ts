import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

afterAll(() => mock.restore());
const store: Record<string, unknown> = {};
const alarms = new Map<string, { scheduledTime: number }>();
const browser = {
  storage: {
    local: {
      get: async (keys: string | string[]) =>
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys])
            .filter((key) => key in store)
            .map((key) => [key, structuredClone(store[key])])
        ),
      set: async (items: Record<string, unknown>) => {
        Object.assign(store, structuredClone(items));
      },
      remove: async () => {},
    },
  },
  alarms: {
    get: async (name: string) => alarms.get(name),
    create: async (name: string, info: { when: number }) => {
      alarms.set(name, { scheduledTime: info.when });
    },
    clear: async (name: string) => alarms.delete(name),
  },
};
mock.module('wxt/browser', () => ({ browser }));
Object.assign(globalThis, { browser });
const rules = await import('@/features/intelligence/site-rules.js');
const validation = await import('@/features/intelligence/rule-validation.js');
beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  alarms.clear();
});

describe('site rule lifecycle', () => {
  test('first match is controllable by reorder and supports exact-host scope', async () => {
    const specific = await rules.upsertSiteRule({
      domainPattern: 'accounts.example.com',
      identityId: 'work',
      includeSubdomains: false,
    });
    const broad = await rules.upsertSiteRule({
      domainPattern: 'example.com',
      providerId: 'burner',
    });
    expect((await rules.matchSiteRule('accounts.example.com'))?.rule.id).toBe(broad.id);
    await rules.moveSiteRule(specific.id, -1);
    expect((await rules.matchSiteRule('accounts.example.com'))?.rule.id).toBe(specific.id);
    expect((await rules.matchSiteRule('other.accounts.example.com'))?.rule.id).toBe(broad.id);
    expect(await rules.matchSiteRule('notexample.com')).toBeNull();
  });

  test('at capacity, a new rule rejects without evicting data or its schedule', async () => {
    const first = await rules.upsertSiteRule({
      domainPattern: 'old.example.com',
      autoArchiveDays: 2,
    });
    await rules.scheduleArchiveFromRule('old.example.com', 'inbox');
    for (let index = 1; index < 40; index++)
      await rules.upsertSiteRule({ domainPattern: `site${index}.example.com` });
    const before = structuredClone(store);
    await expect(rules.upsertSiteRule({ domainPattern: 'new.example.com' })).rejects.toThrow(
      'rule-limit-exceeded'
    );
    expect(store).toEqual(before);
    expect((await rules.loadSiteRules()).some((rule) => rule.id === first.id)).toBe(true);
    await rules.upsertSiteRule({ ...first, enabled: false });
    expect(await rules.loadArchiveSchedule()).toEqual({});
  });

  test('successive fills preserve the first archive deadline', async () => {
    await rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: 3 });
    const first = await rules.scheduleArchiveFromRule('example.com', 'inbox');
    expect(await rules.scheduleArchiveFromRule('example.com', 'inbox')).toBe(first);
    expect((await rules.loadArchiveSchedule()).inbox.sources).toHaveLength(1);
  });

  test('clear, disable and delete cancel schedules; day edits retain the original clock', async () => {
    const rule = await rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: 3 });
    await rules.scheduleArchiveFromRule('example.com', 'inbox');
    const scheduledAt = (await rules.loadArchiveSchedule()).inbox.scheduledAt;
    await rules.upsertSiteRule({ ...rule, autoArchiveDays: 1 });
    expect((await rules.loadArchiveSchedule()).inbox.archiveAt).toBe(scheduledAt + 86400000);
    await rules.saveSiteRules([]);
    expect(await rules.loadArchiveSchedule()).toEqual({});
    expect(alarms.size).toBe(0);
  });

  test('changing domain scope cancels the old domain schedule', async () => {
    const rule = await rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: 3 });
    await rules.scheduleArchiveFromRule('example.com', 'inbox');
    await rules.upsertSiteRule({ ...rule, domainPattern: 'different.example' });
    expect(await rules.loadArchiveSchedule()).toEqual({});
  });

  test('multiple contributing rules retain the earliest deadline and survive removing its owner', async () => {
    const early = await rules.upsertSiteRule({
      domainPattern: 'early.example',
      autoArchiveDays: 1,
    });
    const late = await rules.upsertSiteRule({ domainPattern: 'late.example', autoArchiveDays: 7 });
    const earlyDeadline = await rules.scheduleArchiveFromRule('early.example', 'inbox');
    await rules.scheduleArchiveFromRule('late.example', 'inbox');
    expect((await rules.loadArchiveSchedule()).inbox.archiveAt).toBe(earlyDeadline as number);
    expect((await rules.loadArchiveSchedule()).inbox.sources).toHaveLength(2);
    await rules.deleteSiteRule(early.id);
    expect((await rules.loadArchiveSchedule()).inbox.ruleId).toBe(late.id);
    expect((await rules.loadArchiveSchedule()).inbox.sources).toHaveLength(1);
  });

  test('mailbox and site schedules with the same rule ID remain independent', async () => {
    const site = await rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: 7 });
    await rules.scheduleArchiveFromRule('example.com', 'inbox');
    await rules.scheduleAddressArchiveInDays('inbox', 1, { ruleId: site.id, ruleKind: 'mailbox' });
    await rules.deleteSiteRule(site.id);
    const remaining = (await rules.loadArchiveSchedule()).inbox;
    expect(remaining.sources).toHaveLength(1);
    expect(remaining.ruleKind).toBe('mailbox');
  });

  test('legacy single-source schedules reconcile without losing their starting time', async () => {
    const site = await rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: 3 });
    store.siteRuleArchiveSchedule = {
      inbox: { ruleId: site.id, domain: 'example.com', scheduledAt: 1000, archiveAt: 5000 },
    };
    await rules.upsertSiteRule({ ...site, autoArchiveDays: 2 });
    expect((await rules.loadArchiveSchedule()).inbox.archiveAt).toBe(1000 + 2 * 86400000);
  });

  test('processing a failed archive retains schedules for retry', async () => {
    store.siteRules = [
      { id: 'old', enabled: true, domainPattern: 'example.com', autoArchiveDays: 1 },
    ];
    store.siteRuleArchiveSchedule = {
      inbox: { ruleId: 'old', domain: 'example.com', scheduledAt: 1000, archiveAt: 2000 },
    };
    await expect(
      rules.processDueArchiveSchedules(async () => {
        throw new Error('test-failure');
      }, 86402000)
    ).rejects.toThrow('test-failure');
    expect((await rules.loadArchiveSchedule()).inbox).toBeDefined();
    await rules.processDueArchiveSchedules(async (ids) => {
      expect(ids).toEqual(['inbox']);
    }, 86402000);
    expect(await rules.loadArchiveSchedule()).toEqual({});
  });

  test('an orphan or disabled rule is rechecked at execution even if cleanup previously failed', async () => {
    store.siteRules = [
      { id: 'disabled', enabled: false, domainPattern: 'example.com', autoArchiveDays: 1 },
    ];
    store.siteRuleArchiveSchedule = {
      a: {
        ruleId: 'disabled',
        ruleKind: 'site',
        domain: 'example.com',
        scheduledAt: 1,
        archiveAt: 2,
      },
      b: {
        ruleId: 'deleted',
        ruleKind: 'mailbox',
        domain: 'inbox@example.com',
        scheduledAt: 1,
        archiveAt: 2,
      },
    };
    let ran = false;
    await rules.processDueArchiveSchedules(async () => {
      ran = true;
    }, 999999999);
    expect(ran).toBe(false);
    expect(await rules.loadArchiveSchedule()).toEqual({});
  });

  test('delete racing a fill cannot leave a deleted rule schedule', async () => {
    const site = await rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: 1 });
    await Promise.all([
      rules.scheduleArchiveFromRule('example.com', 'inbox'),
      rules.deleteSiteRule(site.id),
    ]);
    expect(await rules.loadArchiveSchedule()).toEqual({});
  });

  test('scope changes are verified at execution after a failed reconciliation', async () => {
    const site = await rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: 1 });
    await rules.scheduleArchiveFromRule('example.com', 'inbox');
    store.siteRules = [{ ...site, domainPattern: 'other.example' }];
    let ran = false;
    await rules.processDueArchiveSchedules(
      async () => {
        ran = true;
      },
      Date.now() + 2 * 86400000
    );
    expect(ran).toBe(false);
    expect(await rules.loadArchiveSchedule()).toEqual({});
  });
});

describe('rule validation', () => {
  test('domain patterns reject typos, paths and shared suffixes while accepting IDNs', () => {
    for (const value of [
      '',
      '*',
      '*.com',
      'github.io',
      'https://example.com/a',
      'exam ple.com',
      'a@b.com',
      'example.com:443',
    ]) {
      expect(validation.normalizeRuleDomain(value)).toBeNull();
    }
    expect(validation.normalizeRuleDomain('*.Example.COM')).toBe('*.example.com');
    expect(validation.normalizeRuleDomain('bücher.example')).toBe('xn--bcher-kva.example');
  });
  test('archive days must be bounded finite integers and forwards must have one recipient', async () => {
    for (const days of [-1, 366, 1.5, Infinity, NaN]) {
      await expect(
        rules.upsertSiteRule({ domainPattern: 'example.com', autoArchiveDays: days })
      ).rejects.toThrow('rule-invalid-days');
    }
    expect(
      validation.validateMailboxRuleInput({ contains: 'x', forwardTo: 'a@b.com,c@d.com' })
    ).toBe('rule-invalid-forward');
    expect(validation.validateMailboxRuleInput({ contains: ' ', field: 'sender' })).toBe(
      'rule-invalid-match'
    );
  });
});
