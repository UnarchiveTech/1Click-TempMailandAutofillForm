import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { canonicalHost, rejectedEmailDomain } from '@/utils/provider/site-email-domains.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

export const SITE_EMAIL_REJECTIONS_KEY = 'siteEmailRejections_v1';
const MAX_AGE_MS = 90 * 24 * 60 * 60_000;
type Rejections = Record<string, Record<string, number>>;

/** Bounded, expiring local observations; no page text or email local-parts are stored. */
export function sanitizeSiteEmailRejections(raw: unknown, now = Date.now()): Rejections {
  const result: Rejections = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [site, value] of Object.entries(raw).slice(-300)) {
    if (!canonicalHost(site) || !value || typeof value !== 'object' || Array.isArray(value))
      continue;
    const entries = Object.entries(value)
      .filter(
        (entry): entry is [string, number] =>
          !!canonicalHost(entry[0]) &&
          typeof entry[1] === 'number' &&
          Number.isFinite(entry[1]) &&
          entry[1] <= now &&
          now - entry[1] < MAX_AGE_MS
      )
      .slice(-32);
    if (entries.length)
      result[site.toLowerCase()] = Object.fromEntries(
        entries.map(([domain, at]) => [domain.toLowerCase(), at])
      );
  }
  return result;
}

export async function loadSiteEmailRejections(): Promise<Rejections> {
  const stored = await browser.storage.local.get(SITE_EMAIL_REJECTIONS_KEY);
  return sanitizeSiteEmailRejections(stored[SITE_EMAIL_REJECTIONS_KEY]);
}

export async function getSiteRejectedEmailDomains(site: string): Promise<string[]> {
  const host = canonicalHost(site);
  return host ? Object.keys((await loadSiteEmailRejections())[host] || {}) : [];
}

export async function recordSiteEmailRejection(
  site: string,
  email: string,
  text: string
): Promise<boolean> {
  const host = canonicalHost(site);
  const domain = rejectedEmailDomain(text, email);
  if (!host || !domain) return false;
  return withLock('site_email_rejections_lock', async () => {
    const records = await loadSiteEmailRejections();
    const previous = records[host] || {};
    delete previous[domain];
    previous[domain] = Date.now();
    // Move the touched site to the end before applying the size bound.
    delete records[host];
    records[host] = Object.fromEntries(Object.entries(previous).slice(-32));
    await writeWithRetry({
      [SITE_EMAIL_REJECTIONS_KEY]: Object.fromEntries(Object.entries(records).slice(-300)),
    });
    return true;
  });
}

export async function clearSiteEmailRejections(site: string): Promise<void> {
  const host = canonicalHost(site);
  if (!host) return;
  await withLock('site_email_rejections_lock', async () => {
    const records = await loadSiteEmailRejections();
    delete records[host];
    await writeWithRetry({ [SITE_EMAIL_REJECTIONS_KEY]: records });
  });
}
