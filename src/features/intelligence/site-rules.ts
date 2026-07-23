/**
 * Site rules engine — if site matches X → identity Y + provider Z + auto-archive after N days.
 * Local-only power-user automation (not a vault).
 */

import { browser } from 'wxt/browser';
import { normalizeDomain } from './storage.js';

export interface SiteRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Domain match: exact host, suffix (example.com), or *.example.com */
  domainPattern: string;
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

function hostMatchesPattern(domain: string, pattern: string): boolean {
  const d = normalizeDomain(domain);
  let p = (pattern || '').toLowerCase().trim();
  if (!d || !p) return false;
  p = p
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/^www\./, '');
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return d === base || d.endsWith(`.${base}`);
  }
  return d === p || d.endsWith(`.${p}`);
}

export async function loadSiteRules(): Promise<SiteRule[]> {
  try {
    const res = (await browser.storage.local.get([KEY])) as { siteRules?: SiteRule[] };
    return Array.isArray(res.siteRules) ? res.siteRules : [];
  } catch {
    return [];
  }
}

export async function saveSiteRules(rules: SiteRule[]): Promise<void> {
  const trimmed = rules.slice(0, MAX_RULES);
  await browser.storage.local.set({ [KEY]: trimmed });
}

export async function upsertSiteRule(
  partial: Partial<SiteRule> & { domainPattern: string }
): Promise<SiteRule> {
  const rules = await loadSiteRules();
  const now = Date.now();
  if (partial.id) {
    const idx = rules.findIndex((r) => r.id === partial.id);
    if (idx >= 0) {
      const next: SiteRule = {
        ...rules[idx],
        ...partial,
        domainPattern: partial.domainPattern,
        updatedAt: now,
      };
      rules[idx] = next;
      await saveSiteRules(rules);
      return next;
    }
  }
  const created: SiteRule = {
    id: `rule_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: partial.name || partial.domainPattern,
    enabled: partial.enabled !== false,
    domainPattern: partial.domainPattern,
    identityId: partial.identityId ?? null,
    providerId: partial.providerId ?? null,
    autoArchiveDays: partial.autoArchiveDays ?? null,
    createdAt: now,
    updatedAt: now,
  };
  rules.unshift(created);
  await saveSiteRules(rules);
  return created;
}

export async function deleteSiteRule(id: string): Promise<void> {
  const rules = await loadSiteRules();
  await saveSiteRules(rules.filter((r) => r.id !== id));
}

/** First enabled matching rule (list order = priority). */
export async function matchSiteRule(domain: string): Promise<SiteRuleMatch | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const rules = await loadSiteRules();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (hostMatchesPattern(d, rule.domainPattern)) {
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

/** Schedule auto-archive of an inbox after rule.autoArchiveDays from now. */
export async function scheduleArchiveFromRule(
  domain: string,
  inboxId: string
): Promise<number | null> {
  const m = await matchSiteRule(domain);
  const days = m?.rule.autoArchiveDays;
  if (!m || !days || days <= 0 || !inboxId) return null;
  const archiveAt = Date.now() + days * 24 * 60 * 60 * 1000;
  const map = await loadArchiveSchedule();
  map[inboxId] = {
    archiveAt,
    ruleId: m.rule.id,
    domain: m.domain,
    scheduledAt: Date.now(),
  };
  await browser.storage.local.set({ [SCHEDULE_KEY]: map });
  return archiveAt;
}

export interface ArchiveScheduleEntry {
  archiveAt: number;
  ruleId: string;
  domain: string;
  scheduledAt: number;
}

export async function loadArchiveSchedule(): Promise<Record<string, ArchiveScheduleEntry>> {
  try {
    const res = (await browser.storage.local.get([SCHEDULE_KEY])) as {
      siteRuleArchiveSchedule?: Record<string, ArchiveScheduleEntry>;
    };
    return res.siteRuleArchiveSchedule || {};
  } catch {
    return {};
  }
}

/**
 * Return inbox IDs due for auto-archive (caller performs archive).
 */
export async function getDueArchiveInboxIds(now = Date.now()): Promise<string[]> {
  const map = await loadArchiveSchedule();
  return Object.entries(map)
    .filter(([, v]) => v.archiveAt <= now)
    .map(([id]) => id);
}

export async function clearArchiveSchedule(inboxId: string): Promise<void> {
  const map = await loadArchiveSchedule();
  if (!map[inboxId]) return;
  delete map[inboxId];
  await browser.storage.local.set({ [SCHEDULE_KEY]: map });
}

export { hostMatchesPattern };
