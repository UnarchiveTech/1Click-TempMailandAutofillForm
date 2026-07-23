/**
 * Persistence helpers for intelligence layer (browser.storage.local only).
 */

import { browser } from 'wxt/browser';
import {
  DEFAULT_NOTIFICATION_INTELLIGENCE,
  INTELLIGENCE_CAPS,
  type InboxLifecycleStats,
  type NotificationIntelligenceSettings,
  type ProviderHealth,
  type SiteProfile,
} from './types.js';

const KEYS = {
  siteProfiles: 'siteProfiles',
  providerHealth: 'providerHealth',
  inboxLifecycle: 'inboxLifecycle',
  notificationIntelligence: 'notificationIntelligence',
  identityStickyByDomain: 'identityStickyByDomain',
} as const;

function normalizeDomain(d: string): string {
  return (d || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .trim();
}

export { normalizeDomain };

export async function loadSiteProfiles(): Promise<Record<string, SiteProfile>> {
  try {
    const res = (await browser.storage.local.get([KEYS.siteProfiles])) as {
      siteProfiles?: Record<string, SiteProfile>;
    };
    return res.siteProfiles || {};
  } catch {
    return {};
  }
}

export async function saveSiteProfile(profile: SiteProfile): Promise<void> {
  const domain = normalizeDomain(profile.domain);
  if (!domain) return;
  const all = await loadSiteProfiles();
  all[domain] = { ...profile, domain, updatedAt: Date.now() };
  // Cap by recency
  const entries = Object.values(all).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const trimmed: Record<string, SiteProfile> = {};
  for (const p of entries.slice(0, INTELLIGENCE_CAPS.maxSiteProfiles)) {
    trimmed[p.domain] = p;
  }
  await browser.storage.local.set({ [KEYS.siteProfiles]: trimmed });
}

export async function getSiteProfile(domain: string): Promise<SiteProfile | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const all = await loadSiteProfiles();
  return all[d] || null;
}

export async function loadProviderHealthMap(): Promise<Record<string, ProviderHealth>> {
  try {
    const res = (await browser.storage.local.get([KEYS.providerHealth])) as {
      providerHealth?: Record<string, ProviderHealth>;
    };
    return res.providerHealth || {};
  } catch {
    return {};
  }
}

export async function saveProviderHealthMap(map: Record<string, ProviderHealth>): Promise<void> {
  const entries = Object.values(map).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const trimmed: Record<string, ProviderHealth> = {};
  for (const p of entries.slice(0, INTELLIGENCE_CAPS.maxProviderEntries)) {
    trimmed[p.providerId] = p;
  }
  await browser.storage.local.set({ [KEYS.providerHealth]: trimmed });
}

export async function loadInboxLifecycleMap(): Promise<Record<string, InboxLifecycleStats>> {
  try {
    const res = (await browser.storage.local.get([KEYS.inboxLifecycle])) as {
      inboxLifecycle?: Record<string, InboxLifecycleStats>;
    };
    return res.inboxLifecycle || {};
  } catch {
    return {};
  }
}

export async function saveInboxLifecycleMap(
  map: Record<string, InboxLifecycleStats>
): Promise<void> {
  await browser.storage.local.set({ [KEYS.inboxLifecycle]: map });
}

export async function loadNotificationIntelligence(): Promise<NotificationIntelligenceSettings> {
  try {
    const res = (await browser.storage.local.get([KEYS.notificationIntelligence])) as {
      notificationIntelligence?: Partial<NotificationIntelligenceSettings>;
    };
    return { ...DEFAULT_NOTIFICATION_INTELLIGENCE, ...(res.notificationIntelligence || {}) };
  } catch {
    return { ...DEFAULT_NOTIFICATION_INTELLIGENCE };
  }
}

export async function saveNotificationIntelligence(
  settings: NotificationIntelligenceSettings
): Promise<void> {
  await browser.storage.local.set({ [KEYS.notificationIntelligence]: settings });
}

export async function loadIdentityStickyMap(): Promise<Record<string, string>> {
  try {
    const res = (await browser.storage.local.get([KEYS.identityStickyByDomain])) as {
      identityStickyByDomain?: Record<string, string>;
    };
    return res.identityStickyByDomain || {};
  } catch {
    return {};
  }
}

export async function setStickyIdentityForDomain(
  domain: string,
  identityId: string
): Promise<void> {
  const d = normalizeDomain(domain);
  if (!d || !identityId) return;
  const map = await loadIdentityStickyMap();
  map[d] = identityId;
  // Cap sticky map
  const keys = Object.keys(map);
  if (keys.length > INTELLIGENCE_CAPS.maxSiteProfiles) {
    // drop arbitrary oldest — stickies don't have timestamps; keep last inserted domain
    const drop = keys.slice(0, keys.length - INTELLIGENCE_CAPS.maxSiteProfiles);
    for (const k of drop) delete map[k];
  }
  await browser.storage.local.set({ [KEYS.identityStickyByDomain]: map });
}

export async function getStickyIdentityForDomain(domain: string): Promise<string | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const map = await loadIdentityStickyMap();
  return map[d] || null;
}
