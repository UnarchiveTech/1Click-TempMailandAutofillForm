/**
 * Site rules engine - if site matches X → identity Y + provider Z + auto-archive after N days.
 * Local-only power-user automation (not a vault).
 */

import { browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import { withLock } from '@/utils/mutex.js';
import { createLockedListRepository } from '@/utils/storage/storage-repository.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import { hostMatchesDomainScope } from '@/utils/validation.js';
import { normalizeRuleDomain, validArchiveDays } from './rule-validation.js';
import { normalizeDomain } from './storage.js';

export interface SiteRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Domain match: exact host, suffix (example.com), or *.example.com */
  domainPattern: string;
  /** Existing rules include subdomains; new rules can opt into exact-host scope. */
  includeSubdomains?: boolean;
  identityId?: string | null;
  providerId?: string | null;
  /** Archive the inbox used on this site after N days (null/0 = off) */
  autoArchiveDays?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SiteRuleMatch {
  rule: SiteRule;
  domain: string;
}

const KEY = 'siteRules';
const SCHEDULE_KEY = 'siteRuleArchiveSchedule';
const MAX_RULES = 40;
export const SITE_RULE_ARCHIVE_ALARM = 'siteRuleArchive';
const ARCHIVE_MIN_DELAY_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const siteRulesRepository = () =>
  createLockedListRepository<SiteRule>(browser.storage.local, KEY, {
    maxItems: MAX_RULES,
    overflow: 'reject',
    lockName: 'site_rules_lock',
    onSaved: async (previous, next) => {
      await reconcileArchiveSchedulesForRuleSet(previous, next, 'site');
    },
    parse: (value) =>
      Array.isArray(value)
        ? value.filter(
            (rule): rule is SiteRule =>
              !!rule &&
              typeof rule === 'object' &&
              typeof (rule as SiteRule).id === 'string' &&
              typeof (rule as SiteRule).domainPattern === 'string'
          )
        : [],
  });

function hostMatchesPattern(domain: string, pattern: string, includeSubdomains = true): boolean {
  const d = normalizeDomain(domain);
  let p = (pattern || '').toLowerCase().trim();
  if (!d || !p) return false;

  const isWildcard = p.startsWith('*.');
  if (isWildcard) p = p.slice(2);

  p =
    normalizeDomain(p) ||
    p
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^www\./, '');

  // Wildcard and parent-domain rules have the same safe scope: the parent
  // itself plus its subdomains, except when the parent is a shared suffix.
  return includeSubdomains ? hostMatchesDomainScope(d, p) : d === p;
}

export async function loadSiteRules(): Promise<SiteRule[]> {
  try {
    return await siteRulesRepository().load();
  } catch (error) {
    logError(
      'Failed to load site rules',
      undefined,
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

export async function saveSiteRules(rules: SiteRule[]): Promise<void> {
  await siteRulesRepository().save(rules);
}

export async function upsertSiteRule(
  partial: Partial<SiteRule> & { domainPattern: string }
): Promise<SiteRule> {
  const domainPattern = normalizeRuleDomain(partial.domainPattern);
  if (!domainPattern) throw new Error('rule-invalid-domain');
  if (!validArchiveDays(partial.autoArchiveDays)) throw new Error('rule-invalid-days');
  let result: SiteRule | undefined;
  await siteRulesRepository().update((rules) => {
    const now = Date.now();
    if (partial.id) {
      const idx = rules.findIndex((r) => r.id === partial.id);
      if (idx >= 0) {
        result = {
          ...rules[idx],
          ...partial,
          domainPattern,
          updatedAt: now,
        };
        const next = [...rules];
        next[idx] = result;
        return next;
      }
    }
    result = {
      id: `rule_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: partial.name || partial.domainPattern,
      enabled: partial.enabled !== false,
      domainPattern,
      includeSubdomains: partial.includeSubdomains ?? true,
      identityId: partial.identityId ?? null,
      providerId: partial.providerId ?? null,
      autoArchiveDays: partial.autoArchiveDays ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return [result, ...rules];
  });
  return result as SiteRule;
}

export async function deleteSiteRule(id: string): Promise<void> {
  await siteRulesRepository().removeWhere((rule) => rule.id === id);
}

export async function moveSiteRule(id: string, delta: -1 | 1): Promise<void> {
  await siteRulesRepository().update((rules) => {
    const index = rules.findIndex((rule) => rule.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= rules.length) return rules;
    const next = [...rules];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    return next;
  });
}

/** First enabled matching rule (list order = priority). */
export async function matchSiteRule(domain: string): Promise<SiteRuleMatch | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const rules = await loadSiteRules();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (hostMatchesPattern(d, rule.domainPattern, rule.includeSubdomains !== false)) {
      return { rule, domain: d };
    }
  }
  return null;
}

export async function resolveRuleIdentityId(domain: string): Promise<string | null> {
  const m = await matchSiteRule(domain);
  return m?.rule.identityId || null;
}

export async function resolveRuleProviderId(domain: string): Promise<string | null> {
  const m = await matchSiteRule(domain);
  return m?.rule.providerId || null;
}

/**
 * Schedule an inbox for auto-archive N days from now. Shared by the site-rules
 * engine (domain → auto-archive) and the mailbox-rules engine (sender match →
 * auto-archive), both writing into the same schedule map that the periodic
 * alarm sweep (`periodic-checks.ts` → `getDueArchiveAddressIds`) consumes.
 */
export async function scheduleAddressArchiveInDays(
  addressId: string,
  days: number,
  meta?: {
    ruleId?: string;
    domain?: string;
    ruleKind?: 'site' | 'mailbox';
    ruleSignature?: string;
  },
  options?: { preserveFirstDeadline?: boolean }
): Promise<number | null> {
  if (!addressId || !validArchiveDays(days) || days <= 0) return null;
  const archiveAt = await withLock('archive_schedule_lock', async () => {
    const now = Date.now();
    const map = await loadArchiveSchedule();
    const ruleId = meta?.ruleId ?? 'site-rule';
    const ruleKind =
      meta?.ruleKind ??
      (ruleId.startsWith('inbox-rule_') || meta?.domain?.includes('@') ? 'mailbox' : 'site');
    const sources = archiveScheduleSources(map[addressId]);
    const existing = sources.find(
      (source) => source.ruleId === ruleId && source.ruleKind === ruleKind
    );
    if (
      options?.preserveFirstDeadline &&
      existing?.ruleId === ruleId &&
      Number.isFinite(existing.archiveAt)
    ) {
      return map[addressId].archiveAt;
    }
    const nextArchiveAt = now + days * DAY_MS;
    const source: ArchiveScheduleSource = {
      archiveAt: nextArchiveAt,
      ruleId,
      ruleKind,
      ruleSignature: meta?.ruleSignature,
      domain: meta?.domain ?? '',
      scheduledAt: now,
    };
    map[addressId] = combineArchiveSources([
      ...sources.filter((entry) => entry !== existing),
      source,
    ]);
    await writeWithRetry({ [SCHEDULE_KEY]: map });
    return map[addressId].archiveAt;
  });
  await scheduleNextArchiveAlarm();
  return archiveAt;
}

/** Schedule the earliest pending archive independently of email polling. */
export async function scheduleNextArchiveAlarm(): Promise<number | null> {
  return await withLock('archive_alarm_lock', async () => {
    const entries = Object.values(await loadArchiveSchedule());
    const earliest = entries
      .map((entry) => entry.archiveAt)
      .filter((deadline) => Number.isFinite(deadline))
      .reduce<number | null>(
        (current, deadline) => (current === null ? deadline : Math.min(current, deadline)),
        null
      );
    const existing = await browser.alarms.get(SITE_RULE_ARCHIVE_ALARM);
    if (earliest === null) {
      if (existing) await browser.alarms.clear(SITE_RULE_ARCHIVE_ALARM);
      return null;
    }

    const deadline = Math.max(earliest, Date.now() + ARCHIVE_MIN_DELAY_MS);
    if (
      existing &&
      existing.periodInMinutes === undefined &&
      Math.abs((existing.scheduledTime ?? 0) - deadline) < ARCHIVE_MIN_DELAY_MS
    ) {
      return deadline;
    }
    if (existing) await browser.alarms.clear(SITE_RULE_ARCHIVE_ALARM);
    await browser.alarms.create(SITE_RULE_ARCHIVE_ALARM, { when: deadline });
    return deadline;
  });
}

/** Update or remove pending schedules when an automation rule changes. */
export async function reconcileArchiveSchedulesForRule(
  ruleId: string,
  enabled: boolean,
  days?: number | null
): Promise<void> {
  await withLock('archive_schedule_lock', async () => {
    const schedule = await loadArchiveSchedule();
    let changed = false;
    for (const [addressId, entry] of Object.entries(schedule)) {
      const sources = archiveScheduleSources(entry);
      if (!sources.some((source) => source.ruleId === ruleId)) continue;
      const next = sources.flatMap((source) => {
        if (source.ruleId !== ruleId) return [source];
        return enabled && days && days > 0
          ? [{ ...source, archiveAt: source.scheduledAt + days * DAY_MS }]
          : [];
      });
      if (next.length) schedule[addressId] = combineArchiveSources(next);
      else delete schedule[addressId];
      changed = true;
    }
    if (changed) await writeWithRetry({ [SCHEDULE_KEY]: schedule });
  });
  await scheduleNextArchiveAlarm();
}

/** Schedule auto-archive of an inbox after rule.autoArchiveDays from now. */
export async function scheduleArchiveFromRule(
  domain: string,
  addressId: string
): Promise<number | null> {
  return withLock('site_rules_lock', async () => {
    const m = await matchSiteRule(domain);
    const days = m?.rule.autoArchiveDays;
    if (!m || !days || days <= 0 || !addressId) return null;
    return scheduleAddressArchiveInDays(
      addressId,
      days,
      {
        ruleId: m.rule.id,
        domain: m.domain,
        ruleKind: 'site',
        ruleSignature: archiveRuleSignature(m.rule, 'site'),
      },
      { preserveFirstDeadline: true }
    );
  });
}

export interface ArchiveScheduleSource {
  archiveAt: number;
  ruleId: string;
  domain: string;
  scheduledAt: number;
  ruleKind?: 'site' | 'mailbox';
  ruleSignature?: string;
}

export interface ArchiveScheduleEntry extends ArchiveScheduleSource {
  sources?: ArchiveScheduleSource[];
}

function archiveScheduleSources(entry?: ArchiveScheduleEntry): ArchiveScheduleSource[] {
  if (!entry) return [];
  return (entry.sources ?? [entry])
    .filter((source) => Number.isFinite(source.archiveAt) && typeof source.ruleId === 'string')
    .map(({ sources: _sources, ...source }: ArchiveScheduleEntry) => ({
      ...source,
      // Older schedules did not name their engine. Mailbox schedules recorded
      // the recipient address; site schedules recorded the website hostname.
      ruleKind:
        source.ruleKind ??
        (source.ruleId.startsWith('inbox-rule_') || (source.domain || '').includes('@')
          ? ('mailbox' as const)
          : ('site' as const)),
    }));
}

function combineArchiveSources(sources: ArchiveScheduleSource[]): ArchiveScheduleEntry {
  const earliest = sources.reduce((first, source) =>
    source.archiveAt < first.archiveAt ? source : first
  );
  return { ...earliest, sources };
}

type ArchiveRule = {
  id: string;
  enabled: boolean;
  autoArchiveDays?: number | null;
  domainPattern?: string;
  includeSubdomains?: boolean;
  field?: string;
  contains?: string;
  senderAllowlist?: string[];
  recipientAllowlist?: string[];
  matchingVersion?: 2;
};

/** Matching criteria only: changing the delay retains the first-match clock. */
export function archiveRuleSignature(rule: ArchiveRule, kind: 'site' | 'mailbox'): string {
  return JSON.stringify(
    kind === 'site'
      ? [rule.domainPattern, rule.includeSubdomains !== false]
      : [rule.field, rule.contains, rule.senderAllowlist ?? [], rule.recipientAllowlist ?? []]
  );
}

/** Pure reconciliation also used when importing disabled automation into an isolated storage area. */
export function reconcileArchiveScheduleMap(
  map: Record<string, ArchiveScheduleEntry>,
  previous: ArchiveRule[],
  next: ArchiveRule[],
  kind: 'site' | 'mailbox'
): Record<string, ArchiveScheduleEntry> {
  const previousById = new Map(previous.map((rule) => [rule.id, rule]));
  const nextById = new Map(next.map((rule) => [rule.id, rule]));
  const result: Record<string, ArchiveScheduleEntry> = {};
  for (const [addressId, entry] of Object.entries(map)) {
    const sources = archiveScheduleSources(entry).flatMap((source) => {
      if (source.ruleKind !== kind && (source.ruleKind || !previousById.has(source.ruleId)))
        return [source];
      const rule = nextById.get(source.ruleId);
      const previousRule = previousById.get(source.ruleId);
      if (
        rule?.enabled !== true ||
        !rule.autoArchiveDays ||
        !validArchiveDays(rule.autoArchiveDays)
      )
        return [];
      if (source.ruleSignature && source.ruleSignature !== archiveRuleSignature(rule, kind))
        return [];
      if (
        previousRule &&
        archiveRuleSignature(previousRule, kind) !== archiveRuleSignature(rule, kind)
      )
        return [];
      if (
        kind === 'site' &&
        rule.domainPattern &&
        !hostMatchesPattern(source.domain, rule.domainPattern, rule.includeSubdomains !== false)
      )
        return [];
      const scheduledAt = Number.isFinite(source.scheduledAt) ? source.scheduledAt : Date.now();
      return [
        {
          ...source,
          ruleKind: kind,
          scheduledAt,
          archiveAt: scheduledAt + rule.autoArchiveDays * DAY_MS,
        },
      ];
    });
    if (sources.length) result[addressId] = combineArchiveSources(sources);
  }
  return result;
}

export async function reconcileArchiveSchedulesForRuleSet(
  previous: ArchiveRule[],
  next: ArchiveRule[],
  kind: 'site' | 'mailbox'
): Promise<void> {
  await withLock('archive_schedule_lock', async () => {
    const schedule = await loadArchiveSchedule();
    const reconciled = reconcileArchiveScheduleMap(schedule, previous, next, kind);
    if (JSON.stringify(schedule) !== JSON.stringify(reconciled))
      await writeWithRetry({ [SCHEDULE_KEY]: reconciled });
  });
  await scheduleNextArchiveAlarm();
}

export async function loadArchiveSchedule(): Promise<Record<string, ArchiveScheduleEntry>> {
  try {
    const res = (await browser.storage.local.get([SCHEDULE_KEY])) as {
      siteRuleArchiveSchedule?: Record<string, ArchiveScheduleEntry>;
    };
    return res.siteRuleArchiveSchedule || {};
  } catch (error) {
    logError('Could not read archive schedules', error);
    throw error;
  }
}

/**
 * Return inbox IDs due for auto-archive (caller performs archive).
 */
export async function getDueArchiveAddressIds(now = Date.now()): Promise<string[]> {
  const map = await loadArchiveSchedule();
  return Object.entries(map)
    .filter(([, v]) => v.archiveAt <= now)
    .map(([id]) => id);
}

/**
 * Run an archive operation against the current due set while schedule changes
 * are locked. Successful processing consumes those schedule entries; failures
 * leave them in place so the next alarm can retry.
 */
export async function processDueArchiveSchedules(
  process: (addressIds: string[]) => Promise<void>,
  now = Date.now()
): Promise<void> {
  await withLock('site_rules_lock', () =>
    withLock('mailbox_rules_lock', () =>
      withLock('archive_schedule_lock', async () => {
        const stored = await loadArchiveSchedule();
        const current = await browser.storage.local.get(['siteRules', 'mailboxRules']);
        const siteRules = Array.isArray(current.siteRules)
          ? (current.siteRules as ArchiveRule[])
          : [];
        const mailboxRules = Array.isArray(current.mailboxRules)
          ? (current.mailboxRules as ArchiveRule[]).map((rule) =>
              rule.field === 'sender' && rule.matchingVersion !== 2
                ? { ...rule, field: 'senderOrRecipient' }
                : rule
            )
          : [];
        // Storage cleanup can fail after a rule edit commits. Validate the current
        // owners again here so an orphan/disabled rule can never archive an inbox.
        const schedule = reconcileArchiveScheduleMap(
          reconcileArchiveScheduleMap(stored, siteRules, siteRules, 'site'),
          mailboxRules,
          mailboxRules,
          'mailbox'
        );
        const due = Object.entries(schedule)
          .filter(([, entry]) => Number.isFinite(entry.archiveAt) && entry.archiveAt <= now)
          .map(([addressId]) => addressId);
        if (due.length === 0) {
          if (JSON.stringify(stored) !== JSON.stringify(schedule))
            await writeWithRetry({ [SCHEDULE_KEY]: schedule });
          return;
        }

        await process(due);
        for (const addressId of due) delete schedule[addressId];
        await writeWithRetry({ [SCHEDULE_KEY]: schedule });
      })
    )
  );
  await scheduleNextArchiveAlarm();
}

export async function clearArchiveSchedule(addressId: string): Promise<void> {
  let changed = false;
  await withLock('archive_schedule_lock', async () => {
    const map = await loadArchiveSchedule();
    if (!map[addressId]) return;
    delete map[addressId];
    await writeWithRetry({ [SCHEDULE_KEY]: map });
    changed = true;
  });
  if (changed) await scheduleNextArchiveAlarm();
}

export async function createSmartAliasRule(
  domainPattern: string,
  providerId?: string | null,
  identityId?: string | null
): Promise<SiteRule> {
  return await upsertSiteRule({
    name: `Smart alias for ${domainPattern}`,
    enabled: true,
    domainPattern,
    providerId: providerId || null,
    identityId: identityId || null,
  });
}

export { hostMatchesPattern };
