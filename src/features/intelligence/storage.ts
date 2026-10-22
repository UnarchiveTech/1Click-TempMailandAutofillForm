/**
 * Persistence helpers for intelligence layer (browser.storage.local only).
 */

import { browser } from 'wxt/browser';
import { LOCKS, withLock } from '@/utils/mutex.js';
import { createStorageRepository } from '@/utils/storage/storage-repository.js';
import {
  type AddressLifecycleStats,
  DEFAULT_NOTIFICATION_INTELLIGENCE,
  INTELLIGENCE_CAPS,
  type NotificationIntelligenceSettings,
  type ProviderHealth,
  type SiteProfile,
} from './types.js';

const KEYS = {
  siteProfiles: 'siteProfiles',
  providerHealth: 'providerHealth',
  addressLifecycle: 'addressLifecycle',
  notificationIntelligence: 'notificationIntelligence',
  identityStickyByDomain: 'identityStickyByDomain',
} as const;

const siteProfilesRepository = () =>
  createStorageRepository(browser.storage.local, KEYS.siteProfiles, {});
const providerHealthRepository = () =>
  createStorageRepository(browser.storage.local, KEYS.providerHealth, {});
const addressLifecycleRepository = () =>
  createStorageRepository(browser.storage.local, KEYS.addressLifecycle, {});
const notificationIntelligenceRepository = () =>
  createStorageRepository(browser.storage.local, KEYS.notificationIntelligence, () => ({
    ...DEFAULT_NOTIFICATION_INTELLIGENCE,
  }));
const identityStickyRepository = () =>
  createStorageRepository(browser.storage.local, KEYS.identityStickyByDomain, {});

import { normalizeDomain } from '@/utils/validation.js';

export { normalizeDomain };

export async function loadSiteProfiles(): Promise<Record<string, SiteProfile>> {
  try {
    return await siteProfilesRepository().load();
  } catch {
    /* ignore */
    return {};
  }
}

async function saveSiteProfileUnlocked(profile: SiteProfile): Promise<void> {
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
  await siteProfilesRepository().save(trimmed);
}

export async function saveSiteProfile(profile: SiteProfile): Promise<void> {
  // Serialize the load→mutate→set so two concurrent form submissions (common
  // with iframes) can't clobber each other's fieldKindsSeen/successCount.
  await withLock(LOCKS.SITE_PROFILES, () => saveSiteProfileUnlocked(profile));
}

/** Persist a profile while the caller already holds SITE_PROFILES. */
export async function saveSiteProfileUnlockedForLockedCaller(profile: SiteProfile): Promise<void> {
  await saveSiteProfileUnlocked(profile);
}

export async function getSiteProfile(domain: string): Promise<SiteProfile | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const all = await loadSiteProfiles();
  return all[d] || null;
}

export async function loadProviderHealthMap(): Promise<Record<string, ProviderHealth>> {
  try {
    return await providerHealthRepository().load();
  } catch {
    /* ignore */
    return {};
  }
}

// NOTE: intentionally lock-free - do NOT add withLock here. The whole
// load→mutate→set runs inside the caller's `provider_health_lock`
// (recordProviderCreate / recordProviderFetch); nesting the same non-reentrant
// lock would deadlock until the mutex timeout.
export async function saveProviderHealthMap(map: Record<string, ProviderHealth>): Promise<void> {
  const entries = Object.values(map).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const trimmed: Record<string, ProviderHealth> = {};
  for (const p of entries.slice(0, INTELLIGENCE_CAPS.maxProviderEntries)) {
    trimmed[p.providerId] = p;
  }
  await providerHealthRepository().save(trimmed);
}

export async function loadAddressLifecycleMap(): Promise<Record<string, AddressLifecycleStats>> {
  try {
    return await addressLifecycleRepository().load();
  } catch {
    /* ignore */
    return {};
  }
}

// NOTE: the single set below is atomic; the load→mutate→set race lives in the
// callers (inbox-lifecycle.ts), which serialize under `address_lifecycle_lock`.
export async function saveAddressLifecycleMap(
  map: Record<string, AddressLifecycleStats>
): Promise<void> {
  await addressLifecycleRepository().save(map);
}

export async function loadNotificationIntelligence(): Promise<NotificationIntelligenceSettings> {
  try {
    const stored = await notificationIntelligenceRepository().load();
    return {
      ...DEFAULT_NOTIFICATION_INTELLIGENCE,
      ...(stored as Partial<NotificationIntelligenceSettings>),
    };
  } catch {
    /* ignore */
    return { ...DEFAULT_NOTIFICATION_INTELLIGENCE };
  }
}

export async function saveNotificationIntelligence(
  settings: NotificationIntelligenceSettings
): Promise<void> {
  await notificationIntelligenceRepository().save(settings);
}

export async function loadIdentityStickyMap(): Promise<Record<string, string>> {
  try {
    return await identityStickyRepository().load();
  } catch {
    /* ignore */
    return {};
  }
}

export async function setStickyIdentityForDomain(
  domain: string,
  identityId: string
): Promise<void> {
  const d = normalizeDomain(domain);
  if (!d || !identityId) return;
  // Serialize the load→mutate→set so concurrent fills can't lose the sticky choice.
  await withLock(LOCKS.IDENTITY_STICKY, async () => {
    const map = await loadIdentityStickyMap();
    map[d] = identityId;
    // Cap sticky map
    const keys = Object.keys(map);
    if (keys.length > INTELLIGENCE_CAPS.maxSiteProfiles) {
      // drop arbitrary oldest - stickies don't have timestamps; keep last inserted domain
      const drop = keys.slice(0, keys.length - INTELLIGENCE_CAPS.maxSiteProfiles);
      for (const k of drop) delete map[k];
    }
    await identityStickyRepository().save(map);
  });
}

export async function getStickyIdentityForDomain(domain: string): Promise<string | null> {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const map = await loadIdentityStickyMap();
  return map[d] || null;
}

/**
 * Purge every reference to the given inboxes from the intelligence stores.
 * Called when inboxes are deleted: a burned inbox must not keep a site-profile
 * pointer alive (the content script switches the ACTIVE inbox to
 * `lastAddressId`), nor a lifecycle entry.
 *
 * The site profile ITSELF (success counts, field kinds, preferred mode)
 * describes the SITE, not the inbox, so it survives - only the pointers naming
 * the deleted inbox are dropped. If the site is used again later, the next
 * successful autofill repopulates them.
 */
export async function forgetAddressesFromIntelligence(
  entries: Array<{ id?: string | null; address?: string | null }>
): Promise<void> {
  const ids = new Set(entries.map((e) => e.id).filter((id): id is string => !!id));
  const addresses = new Set(
    entries.map((e) => (e.address || '').trim().toLowerCase()).filter((a): a is string => !!a)
  );
  if (ids.size === 0 && addresses.size === 0) return;

  await withLock(LOCKS.SITE_PROFILES, async () => {
    const all = await loadSiteProfiles();
    let changed = false;
    for (const [domain, p] of Object.entries(all)) {
      const dropAddress = !!(p.lastAddressId && ids.has(p.lastAddressId));
      const dropEmail = !!(p.lastEmail && addresses.has(p.lastEmail.trim().toLowerCase()));
      if (dropAddress || dropEmail) {
        const next: SiteProfile = { ...p };
        if (dropAddress) delete next.lastAddressId;
        if (dropEmail) delete next.lastEmail;
        all[domain] = next;
        changed = true;
      }
    }
    if (changed) await siteProfilesRepository().save(all);
  });

  if (ids.size === 0) return;
  await withLock(LOCKS.ADDRESS_LIFECYCLE, async () => {
    const map = await loadAddressLifecycleMap();
    let changed = false;
    for (const id of ids) {
      if (map[id]) {
        delete map[id];
        changed = true;
      }
    }
    if (changed) await saveAddressLifecycleMap(map);
  });
}

/**
 * Purge every reference to the given identity IDs from the intelligence
 * stores. Called when identities are deleted: a removed identity must not
 * keep steering routing (`identityStickyByDomain`, site-profile
 * `lastIdentityId`) - both consumers re-validate against the live list, so
 * a dead entry is a permanent tombstone rather than a correctness bug, but
 * it still biases the cap-based eviction against live domains.
 */
export async function forgetIdentitiesFromIntelligence(identityIds: string[]): Promise<void> {
  const ids = new Set(identityIds.filter(Boolean));
  if (ids.size === 0) return;

  await withLock(LOCKS.SITE_PROFILES, async () => {
    const all = await loadSiteProfiles();
    let changed = false;
    for (const [domain, p] of Object.entries(all)) {
      if (p.lastIdentityId && ids.has(p.lastIdentityId)) {
        const next: SiteProfile = { ...p };
        delete next.lastIdentityId;
        all[domain] = next;
        changed = true;
      }
    }
    if (changed) await siteProfilesRepository().save(all);
  });

  await withLock(LOCKS.IDENTITY_STICKY, async () => {
    const map = await loadIdentityStickyMap();
    let changed = false;
    for (const [domain, identityId] of Object.entries(map)) {
      if (ids.has(identityId)) {
        delete map[domain];
        changed = true;
      }
    }
    if (changed) await identityStickyRepository().save(map);
  });
}
